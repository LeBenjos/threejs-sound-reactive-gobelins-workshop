import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

import { BLOOM_LAYER, COLOR_PRESETS, TARGET_HEIGHT } from './config.js'
import RimShader from './shaders/RimShader.js'

const BODY_URL = './assets/body.glb'
const FALLING_URL = './assets/falling.fbx'

// The falling character: GLB mesh + FBX animation clip retargeted onto it.
// Owns the skinned model, its animation mixer and its (single, shared) material.
export default class Body {

	constructor(params) {
		this.params = params
		this.object = null
		this.fallingClip = null
		this.mixer = null
		this.mat = null
	}

	async load() {
		const gltfLoader = new GLTFLoader()
		const fbxLoader = new FBXLoader()
		const safeLoad = (loader, url) => loader.loadAsync(url).catch((err) => {
			console.error(`[erin_benjamin] failed to load ${url}`, err)
			return null
		})
		const [gltf, falling] = await Promise.all([
			safeLoad(gltfLoader, BODY_URL),
			safeLoad(fbxLoader, FALLING_URL),
		])
		this.object = gltf?.scene ?? null
		// The user-provided falling.fbx is the intended animation; body.glb may also
		// embed a T-pose/idle clip we want to ignore.
		const fbxClip = falling?.animations?.[0] ?? null
		const gltfClip = gltf?.animations?.[0] ?? null
		this.fallingClip = fbxClip ?? gltfClip
		console.log(`[erin_benjamin] clip source: ${fbxClip ? 'falling.fbx' : gltfClip ? 'body.glb (fallback)' : 'none'}`)
		if (!this.object) console.error('[erin_benjamin] body missing- scene will render empty')
		if (!this.fallingClip) console.warn('[erin_benjamin] no animation clip found')
	}

	init(pivot) {
		if (!this.object) return
		this.normalize()

		let meshCount = 0
		this.object.traverse((child) => {
			if (child.isMesh || child.isSkinnedMesh) {
				child.frustumCulled = false   // SkinnedMesh bounds in bind pose can clip the model out
				child.layers.enable(BLOOM_LAYER)   // keeps default layer 0 + adds bloom layer
				meshCount++
			}
		})
		this.setMaterial(this.params.body.material)
		console.log(`[erin_benjamin] body: ${meshCount} mesh(es)`)
		if (meshCount === 0) console.warn('[erin_benjamin] body has no renderable meshes (skeleton only?)')

		pivot.add(this.object)

		if (this.fallingClip) {
			this.remapClipToBody()
			this.mixer = new THREE.AnimationMixer(this.object)
			this.mixer.clipAction(this.fallingClip).play()
			this.diagnoseRetarget()
		}
	}

	update(dt, audio, features) {
		if (this.mixer) this.mixer.update(dt)
		// Rim material: the contour glow pulses on the strong beats (energy-gated,
		// like the other flash effects).
		const u = this.mat?.uniforms
		if (u?.rimStrength) {
			const r = this.params.body.rim
			u.rimStrength.value = r.strength + audio.kickHard * r.kickHardMult * features.energy
			u.rimPower.value = r.power
		}
	}

	// Lerp the rim color between two presets at factor f (0=A, 1=B). No-op for
	// the non-rim materials.
	lerpColors(A, B, f) {
		const u = this.mat?.uniforms
		if (u?.rimColor) u.rimColor.value.copy(A.bodyRim).lerp(B.bodyRim, f)
	}

	normalize() {
		// Mixamo-style FBX is typically ~100 units tall- scale to TARGET_HEIGHT, recenter.
		const box = new THREE.Box3().setFromObject(this.object)
		const size = box.getSize(new THREE.Vector3())
		console.log(`[erin_benjamin] body raw size: ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`)
		if (size.y > 0) this.object.scale.setScalar(TARGET_HEIGHT / size.y)
		else console.warn('[erin_benjamin] body has zero height- skipping normalization')
		box.setFromObject(this.object)
		const center = box.getCenter(new THREE.Vector3())
		this.object.position.sub(center)
	}

	remapClipToBody() {
		// Body bones may carry a numeric suffix (e.g. "MaleBaseMeshHips_01") absent
		// from the clip's track names ("MaleBaseMeshHips"). Build a stripped-key map
		// then rewrite each track name to the matching body bone.
		const bodyByStrippedName = new Map()
		this.object.traverse((o) => {
			if (!o.isBone) return
			const stripped = o.name.replace(/_\d+$/, '')
			if (!bodyByStrippedName.has(stripped)) bodyByStrippedName.set(stripped, o.name)
		})
		let remapped = 0
		for (const track of this.fallingClip.tracks) {
			const lastDot = track.name.lastIndexOf('.')
			if (lastDot < 0) continue
			const trackBone = track.name.slice(0, lastDot)
			const prop = track.name.slice(lastDot)
			const mapped = bodyByStrippedName.get(trackBone)
			if (mapped && mapped !== trackBone) {
				track.name = mapped + prop
				remapped++
			}
		}
		console.log(`[erin_benjamin] remapped ${remapped}/${this.fallingClip.tracks.length} tracks to body bones`)
	}

	diagnoseRetarget() {
		const clip = this.fallingClip
		const bodyBones = new Set()
		this.object.traverse((o) => { if (o.isBone) bodyBones.add(o.name) })
		const clipTargets = new Set(clip.tracks.map((t) => t.name.split('.')[0]))
		const matched = [...clipTargets].filter((n) => bodyBones.has(n)).length
		console.log(`[erin_benjamin] clip "${clip.name}" - ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks`)
		console.log(`[erin_benjamin] body has ${bodyBones.size} bones, clip targets ${clipTargets.size} bones, ${matched} match`)
		if (matched === 0) {
			console.error('[erin_benjamin] zero matching bones- animation will not affect body. Sample names:')
			console.error('  body bones:', [...bodyBones].slice(0, 6))
			console.error('  clip targets:', [...clipTargets].slice(0, 6))
		}
	}

	setMaterial(type) {
		if (!this.object) return
		const next = this.createMaterial(type)
		if (!next) return
		this.object.traverse((child) => {
			if (child.isMesh || child.isSkinnedMesh) child.material = next
		})
		if (this.mat && this.mat !== next) this.mat.dispose()
		this.mat = next
	}

	createMaterial(type) {
		const b = this.params.body
		switch (type) {
			case 'rim': {
				const mat = new THREE.ShaderMaterial({
					uniforms: THREE.UniformsUtils.clone(RimShader.uniforms),
					vertexShader: RimShader.vertexShader,
					fragmentShader: RimShader.fragmentShader,
				})
				mat.uniforms.baseColor.value.set(b.rim.baseColor)
				// Start from the active preset's rim color- the autopilot color cycle
				// keeps it in sync afterwards.
				const preset = COLOR_PRESETS[this.params.autopilot.preset]
				if (preset) mat.uniforms.rimColor.value.copy(preset.bodyRim)
				return mat
			}
			case 'normal': return new THREE.MeshNormalMaterial({ wireframe: b.normal.wireframe, flatShading: b.normal.flatShading })
			case 'basic': return new THREE.MeshBasicMaterial({ color: b.basic.color, wireframe: b.basic.wireframe })
			case 'wireframe': return new THREE.MeshBasicMaterial({ color: b.wireframe.color, wireframe: true })
			case 'depth': return new THREE.MeshDepthMaterial({ wireframe: b.depth.wireframe })
			default:
				console.warn(`[erin_benjamin] unknown material type "${type}"- falling back to normal`)
				return new THREE.MeshNormalMaterial()
		}
	}

}
