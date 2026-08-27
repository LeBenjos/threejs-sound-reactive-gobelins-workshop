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
		this.bloomComposer.setPixelRatio(Math.min(devicePixelRatio, 2) / 2)
		this.bloomComposer.setSize(innerWidth, innerHeight)
		this.bloomComposer.renderToScreen = false
		this.bloomComposer.addPass(new RenderPass(scene, camera))
		this.bloomComposer.addPass(this.bloomPass)

		// Main composer
		this.composer = new EffectComposer(renderer)
		this.composer.setPixelRatio(Math.min(devicePixelRatio, 2))
		this.composer.setSize(innerWidth, innerHeight)

		const renderPass = new RenderPass(scene, camera)
		this.afterimagePass = new AfterimagePass(0.85)   // damp- updated per-frame
		this.bloomMergePass = new ShaderPass(new THREE.ShaderMaterial({
			uniforms: {
				baseTexture: { value: null },   // wired by ShaderPass via textureID below
				bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
			},
			vertexShader: BloomMergeShader.vertexShader,
			fragmentShader: BloomMergeShader.fragmentShader,
		}), 'baseTexture')
		// One combined lens pass (fisheye + RGB shift)- was two fullscreen passes.
		this.lensPass = new ShaderPass(LensShader)
		const outputPass = new OutputPass()   // tone mapping + sRGB- required after bloom

		this.composer.addPass(renderPass)
		this.composer.addPass(this.afterimagePass)
		this.composer.addPass(this.bloomMergePass)
		this.composer.addPass(this.lensPass)
		this.composer.addPass(outputPass)
	}

	warmup() {
		this.composer.render()
	}

	update(audio, features) {
		const p = this.params
		const e = features.energy
		// One driver per effect, every punctual reaction gated by the passage
		// energy: bloom swells with intensity and flares on the strong beats only,
		// RGB shift follows the highs (hats/cymbals), the fisheye breathes with
		// the energy and only kickHard still punches it.
		// bloomPass lives in bloomComposer- merge pass gates the visual on/off.
		this.bloomPass.strength = p.bloom.strengthBase + e * p.bloom.energyMult + audio.kickHard * p.bloom.kickHardMult * e + features.dropPulse * 2.5
		this.bloomPass.radius = p.bloom.radius
		this.bloomPass.threshold = p.bloom.threshold
		this.bloomMergePass.enabled = p.bloom.enabled
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
	}

	render(dt) {
		// Selective bloom: render only the body layer into bloomComposer's target,
		// then run the main composer which merges that bloom on top of the full scene.
		// Skip the bloom render when disabled- mergePass.enabled is also false so the
		// stale texture from the last enabled frame is not added.
		if (this.params.bloom.enabled) {
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
