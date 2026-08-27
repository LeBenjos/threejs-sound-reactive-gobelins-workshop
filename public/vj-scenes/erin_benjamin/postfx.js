import * as THREE from 'three'
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'

import { BLOOM_LAYER } from './config.js'
import BloomMergeShader from './shaders/BloomMergeShader.js'
import LensShader from './shaders/LensShader.js'

// Trails are a smear by nature- accumulating them at half resolution with a
// linear upscale reads the same while costing a quarter of the fill, and the
// pass only ever draws fullscreen quads so its targets never need depth.
// setSize is the single owner of the halving so window resizes keep the policy.
class HalfResAfterimagePass extends AfterimagePass {

	constructor(damp) {
		super(damp)
		for (const target of [this._textureComp, this._textureOld]) {
			target.depthBuffer = false
			target.texture.magFilter = THREE.LinearFilter
		}
	}

	setSize(width, height) {
		super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)))
	}

}

// The postprocessing chain: selective bloom (body layer only, merged additively
// over the base render), afterimage trails, RGB shift and a fisheye lens.
export default class PostFX {

	constructor(renderer, scene, camera, params) {
		this.renderer = renderer
		this.camera = camera
		this.params = params

		this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.6, 0.0)   // strength, radius, threshold

		// Bloom composer: renders only BLOOM_LAYER (body) into a render target.
		// Camera layer mask is flipped per-frame in render() so the sky is excluded.
		// HALF resolution: bloom is a blur by nature- the halved pipeline (scene
		// pass + UnrealBloom's mip chain) is visually identical for a glow and
		// costs a quarter of the fragments.
		this.bloomComposer = new EffectComposer(renderer)
		this.bloomComposer.setPixelRatio(Math.min(devicePixelRatio, params.quality.renderScale) / 2)
		this.bloomComposer.setSize(innerWidth, innerHeight)
		this.bloomComposer.renderToScreen = false
		this.bloomComposer.addPass(new RenderPass(scene, camera))
		this.bloomComposer.addPass(this.bloomPass)

		// Main composer
		this.composer = new EffectComposer(renderer)
		this.composer.setPixelRatio(Math.min(devicePixelRatio, params.quality.renderScale))
		this.composer.setSize(innerWidth, innerHeight)

		const renderPass = new RenderPass(scene, camera)
		this.afterimagePass = new HalfResAfterimagePass(0.85)   // damp- updated per-frame
		this.bloomMergePass = new ShaderPass(new THREE.ShaderMaterial({
			uniforms: {
				baseTexture: { value: null },   // wired by ShaderPass via textureID below
				bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
			},
			vertexShader: BloomMergeShader.vertexShader,
			fragmentShader: BloomMergeShader.fragmentShader,
		}), 'baseTexture')
		// One combined lens pass (fisheye + RGB shift)- was two fullscreen passes.
		// It also carries the bloom add whenever it runs, so the standalone merge
		// pass only wakes up as a fallback when the lens is disabled at runtime.
		this.lensPass = new ShaderPass(LensShader)
		this.lensPass.uniforms.bloomTexture.value = this.bloomComposer.renderTarget2.texture
		const outputPass = new OutputPass()   // tone mapping + sRGB- required after bloom

		this.composer.addPass(renderPass)
		this.composer.addPass(this.afterimagePass)
		this.composer.addPass(this.bloomMergePass)
		this.composer.addPass(this.lensPass)
		this.composer.addPass(outputPass)

		// Debounced bloom gate: both flags agree with the last applied decision
		// so the very first update() cannot force a spurious toggle.
		this._bloomWanted = params.bloom.enabled
		this._bloomActive = params.bloom.enabled
	}

	// THE master perf lever: every fragment cost scales with pixelRatio². The
	// chain already softens the frame (trails, lens warp), so a cap below the
	// display's ratio is well hidden. Bloom keeps its half-ratio relationship.
	setRenderScale(cap) {
		const ratio = Math.min(devicePixelRatio, cap)
		this.renderer.setPixelRatio(ratio)
		this.composer.setPixelRatio(ratio)
		this.bloomComposer.setPixelRatio(ratio / 2)
	}

	warmup() {
		// The bloom pipeline compiles its programs only when its composer actually
		// renders- without this mirror of the per-frame layer flip the first real
		// frame pays a multi-hundred-ms compilation hitch at play start.
		this.camera.layers.set(BLOOM_LAYER)
		this.bloomComposer.render()
		this.camera.layers.set(0)
		this.composer.render()
	}

	update(audio, features) {
		const p = this.params
		const e = features.energy
		// One driver per effect, every punctual reaction gated by the passage
		// energy: bloom swells with intensity and flares on the strong beats only,
		// RGB shift follows the highs (hats/cymbals), the fisheye breathes with
		// the energy and only kickHard still punches it.
		// bloomPass lives in bloomComposer- the gate below owns the visual on/off.
		this.bloomPass.strength = p.bloom.strengthBase + e * p.bloom.energyMult + audio.kickHard * p.bloom.kickHardMult * e + features.dropPulse * 2.5
		this.bloomPass.radius = p.bloom.radius
		this.bloomPass.threshold = p.bloom.threshold
		// Below ~0.05 strength nothing survives the high-pass threshold, yet the
		// pipeline would still pay a second skinned-body render plus the mip
		// chain for an invisible layer. The toggle waits for two agreeing frames
		// so a strength oscillating across the cutoff cannot flicker the glow.
		const bloomWanted = p.bloom.enabled && this.bloomPass.strength >= 0.05
		if (bloomWanted === this._bloomWanted) this._bloomActive = bloomWanted
		this._bloomWanted = bloomWanted
		this.afterimagePass.enabled = p.afterimage.enabled
		// Capped at 0.92 (was 0.96): above that the trails stop reading as speed
		// and smear the whole frame into radial mush during intense passages.
		// The drop burst may exceed the usual 0.92 smear cap- explosion trails.
		this.afterimagePass.uniforms.damp.value = Math.min(0.95,
			Math.min(0.92, p.afterimage.dampBase + audio.kickHard * p.afterimage.kickHardMult * e) + features.dropPulse * 0.12)
		// The lens pass carries all three effects; a disabled one just zeroes its
		// term. The drop shockwave: the ring starts at screen center at the drop
		// (dropPulse=1) and travels to the edges as the pulse fades- the palette
		// change BURSTS out instead of just happening.
		const u = this.lensPass.uniforms
		u.strength.value = p.fisheye.enabled ? p.fisheye.strengthBase + e * p.fisheye.energyMult + audio.kickHard * p.fisheye.kickHardMult * e : 0
		u.amount.value = p.rgbShift.enabled ? features.high * p.rgbShift.highMult : 0
		u.angle.value = p.rgbShift.angle
		u.shockR.value = (1 - features.dropPulse) * 1.3
		u.shockAmp.value = features.dropPulse * p.drop.shock
		u.aspect.value = this.camera.aspect
		this.lensPass.enabled = p.fisheye.enabled || p.rgbShift.enabled || u.shockAmp.value > 0.0001
		// Bloom rides the lens pass when it runs (added at the warped uv, so the
		// glow bends with the distortion); the standalone merge only covers the
		// lens-off case. Both are gated by the same decision as the bloom render
		// so a stale target from the last active frame can never be added.
		u.bloomOn.value = this._bloomActive ? 1 : 0
		this.bloomMergePass.enabled = this._bloomActive && !this.lensPass.enabled
	}

	render(dt) {
		// Selective bloom: render only the body layer into bloomComposer's target,
		// then run the main composer which merges that bloom on top of the full scene.
		// Skip the bloom render when the debounced gate is off- the merge fallback
		// and the lens bloom term are both off with it, so the stale texture from
		// the last active frame is never added.
		if (this._bloomActive) {
			this.camera.layers.set(BLOOM_LAYER)
			this.bloomComposer.render()
			this.camera.layers.set(0)
		}
		this.composer.render(dt)
	}

	resize() {
		this.composer.setSize(innerWidth, innerHeight)
		this.bloomComposer.setSize(innerWidth, innerHeight)
	}

}
