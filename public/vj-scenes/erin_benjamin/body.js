import * as THREE from 'three'
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js'

import { BLOOM_LAYER, COLOR_PRESETS, TARGET_HEIGHT } from './config.js'
import RimShader from './shaders/RimShader.js'

const BODY_URL = './assets/body.glb'
const CLIP_URLS = {
	falling: './assets/falling.fbx',   // the base loop
	backflip: './assets/Backflip.fbx', // rare event- one-shot
	flying: './assets/Flying.fbx',     // rare event- held a few seconds
}
const FADE = 0.35   // crossfade duration between animations (seconds)

// The falling character: GLB mesh + FBX animation clips retargeted onto it.
// `falling` loops as the base state; playEvent() crossfades to a rare event
// clip (backflip one-shot, flying held) and back. Owns the skinned model,
// its animation mixer and its (single, shared) material.
export default class Body {

	constructor(params) {
		this.params = params
		this.object = null
		this.clips = {}
		this.actions = {}
		this.currentAction = null
		this.eventTimer = 0   // seconds left on a held event (flying)
		this.mixer = null
		this.mat = null
		// Fixed world-space light for the rim material's modeling (above, slightly
		// right and front); rotated into view space each frame in update().
		this.lightDirWorld = new THREE.Vector3(0.5, 0.8, 0.3).normalize()
		this.lightScratch = new THREE.Vector3()
		this.headBone = null   // found in init()- anchors for the tracked camera shots
		this.handBone = null
	}

	getHandPosition(target) {
		if (this.handBone) return this.handBone.getWorldPosition(target)
		return this.getHeadPosition(target)   // fallback: track the head instead
	}

	// Head world position/orientation for the face shot (fallback: rough head
	// height at the pivot). Called after the mixer update, so poses are current.
	getHeadPosition(target) {
		if (this.headBone) return this.headBone.getWorldPosition(target)
		return target.set(0, 0.8, 0)
	}

	getHeadQuaternion(target) {
		if (this.headBone) return this.headBone.getWorldQuaternion(target)
		return target.identity()
	}

	async load() {
		const gltfLoader = new GLTFLoader()
		const fbxLoader = new FBXLoader()
		const safeLoad = (loader, url) => loader.loadAsync(url).catch((err) => {
			console.error(`[erin_benjamin] failed to load ${url}`, err)
			return null
		})
		const names = Object.keys(CLIP_URLS)
		const [gltf, ...fbxes] = await Promise.all([
			safeLoad(gltfLoader, BODY_URL),
			...names.map((n) => safeLoad(fbxLoader, CLIP_URLS[n])),
		])
		this.object = gltf?.scene ?? null
		this.sourceRigs = {}   // the loaded FBX scenes- source skeletons for retargeting
		names.forEach((n, i) => {
			const clip = fbxes[i]?.animations?.[0] ?? null
			if (clip) {
				this.clips[n] = clip
				this.sourceRigs[n] = fbxes[i]
			}
		})
		// body.glb may embed a T-pose/idle clip- only used if falling.fbx failed.
		if (!this.clips.falling && gltf?.animations?.[0]) this.clips.falling = gltf.animations[0]
		console.log(`[erin_benjamin] clips loaded: ${Object.keys(this.clips).join(', ') || 'none'}`)
		if (!this.object) console.error('[erin_benjamin] body missing- scene will render empty')
		if (!this.clips.falling) console.warn('[erin_benjamin] no base animation clip found')
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
		this.object.traverse((o) => {
			if (!o.isBone) return
			if (!this.headBone && /head/i.test(o.name)) this.headBone = o
			if (!this.handBone && /hand/i.test(o.name)) this.handBone = o
		})
		console.log(`[erin_benjamin] anchor bones: head=${this.headBone?.name ?? 'none'} hand=${this.handBone?.name ?? 'none'}`)
		this.setMaterial(this.params.body.material)
		console.log(`[erin_benjamin] body: ${meshCount} mesh(es)`)
		if (meshCount === 0) console.warn('[erin_benjamin] body has no renderable meshes (skeleton only?)')

		pivot.add(this.object)

		if (this.clips.falling) {
			this.mixer = new THREE.AnimationMixer(this.object)
			for (const [name, clip] of Object.entries(this.clips)) {
				// falling.fbx was authored for this rig- a simple track rename is
				// enough. The Mixamo event clips animate a DIFFERENT skeleton (other
				// bind orientations): they must be properly retargeted, or the raw
				// rotations mangle the pose.
				let finalClip = clip
				if (name === 'falling') this.remapClipToBody(clip)
				else {
					finalClip = this.retargetForeignClip(clip, this.sourceRigs[name])
					// A failed retarget must NOT become an action: fading to a clip
					// that drives no bones collapses the body into a bind T-pose.
					if (!finalClip) {
						console.warn(`[erin_benjamin] "${name}" retarget failed- event disabled`)
						continue
					}
				}
				this.clips[name] = finalClip
				this.diagnoseRetarget(finalClip, name)
				this.actions[name] = this.mixer.clipAction(finalClip)
			}
			// backflip is a one-shot: clamp on the last frame while fading back
			// (the 'finished' listener below triggers the return to falling).
			if (this.actions.backflip) {
				this.actions.backflip.setLoop(THREE.LoopOnce)
				this.actions.backflip.clampWhenFinished = true
			}
			this.mixer.addEventListener('finished', (e) => {
				if (e.action === this.actions.backflip) this.fadeTo('falling')
			})
			this.actions.falling.play()
			this.currentAction = this.actions.falling
		}
	}

	// Crossfade to a rare event clip: backflip plays once then returns by
	// itself; flying holds `hold` seconds (counted down in update()) before
	// returning. False if the clip is missing or an event is already running.
	playEvent(name, hold = 0) {
		if (!this.actions[name] || this.currentAction !== this.actions.falling) return false
		this.fadeTo(name)
		this.eventTimer = hold
		return true
	}

	fadeTo(name, duration = FADE) {
		const to = this.actions[name]
		if (!to || this.currentAction === to) return
		to.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(duration).play()
		this.currentAction?.fadeOut(duration)
		this.currentAction = to
	}

	update(dt, audio, features, camera) {
		if (this.mixer) this.mixer.update(dt)
		// Held event (flying) running out → glide back to the base fall.
		if (this.eventTimer > 0) {
			this.eventTimer -= dt
			if (this.eventTimer <= 0) this.fadeTo('falling')
		}
		// Rim material: the contour glow pulses on the strong beats (energy-gated,
		// like the other flash effects), and the fixed world light is rotated into
		// view space so the modeling sweeps across the body as the camera orbits.
		const u = this.mat?.uniforms
		if (u?.rimStrength) {
			const r = this.params.body.rim
			u.rimStrength.value = r.strength + audio.kickHard * r.kickHardMult * features.energy
			u.rimPower.value = r.power
			u.shading.value = r.shading
			u.ambientTint.value = r.ambient
			u.lightDir.value.copy(this.lightScratch.copy(this.lightDirWorld).transformDirection(camera.matrixWorldInverse))
		}
	}

	// Lerp the rim + ambient colors between two presets at factor f (0=A, 1=B).
	// The ambient is the preset's skyTop- the palette's signature color, far
	// more saturated than the pale horizon- so the body visibly carries the
	// scene's mood. No-op for the non-rim materials.
	lerpColors(A, B, f) {
		const u = this.mat?.uniforms
		if (!u?.rimColor) return
		u.rimColor.value.copy(A.bodyRim).lerp(B.bodyRim, f)
		// Saturation boost: skyTop values are airy pastels- multiplied over a
		// white body they read as barely-there. Recomputed from the presets
		// every frame, so the offset never accumulates.
		u.ambientColor.value.copy(A.skyTop).lerp(B.skyTop, f).offsetHSL(0, 0.25, 0)
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

	remapClipToBody(clip) {
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
		for (const track of clip.tracks) {
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
		console.log(`[erin_benjamin] "${clip.name}": remapped ${remapped}/${clip.tracks.length} tracks to body bones`)
	}

	// Proper cross-rig retarget for the Mixamo event clips: their skeleton has
	// different bind orientations, so raw rotation copies mangle the pose.
	// SkeletonUtils.retargetClip replays the clip on the SOURCE skeleton and
	// rebakes each bone's rotation into the target's frame. Rotations only-
	// root motion is meaningless in free fall.
	retargetForeignClip(clip, sourceRoot) {
		if (!sourceRoot) return null
		let targetSkin = null
		this.object.traverse((o) => { if (!targetSkin && o.isSkinnedMesh) targetSkin = o })
		let sourceSkin = null
		const sourceBones = []
		sourceRoot.traverse((o) => {
			if (!sourceSkin && o.isSkinnedMesh) sourceSkin = o
			if (o.isBone) sourceBones.push(o)
		})
		if (!targetSkin || sourceBones.length === 0) return null

		// names: target bone → source bone. "MaleBaseMeshHips_05" → core "Hips"
		// → "mixamorig:Hips" (this rig is Mixamo-derived, so cores line up).
		const names = {}
		let mapped = 0
		for (const bone of targetSkin.skeleton.bones) {
			const core = bone.name.replace(/_\d+$/, '').replace(/^MaleBaseMesh/i, '')
			const hit = sourceBones.find((sb) => sb.name.replace(/^mixamorig:?/i, '') === core)
			if (hit) { names[bone.name] = hit.name; mapped++ }
		}
		if (mapped === 0) {
			console.warn(`[erin_benjamin] "${clip.name}": no bones mapped for retarget`)
			return null
		}

		const source = sourceSkin ?? new THREE.Skeleton(sourceBones)
		const result = SkeletonUtils.retargetClip(targetSkin, source, clip, {
			names,
			hip: '__none__',   // no source bone matches → no position track baked
		})
		result.tracks = result.tracks.filter((t) => t.name.endsWith('.quaternion'))
		result.name = clip.name
		targetSkin.skeleton.pose()   // the bake left the skeleton in the last frame- reset to bind
		console.log(`[erin_benjamin] "${clip.name}": retargeted via ${mapped} mapped bones, ${result.tracks.length} rotation tracks`)
		return result
	}

	diagnoseRetarget(clip, label) {
		const bodyBones = new Set()
		this.object.traverse((o) => { if (o.isBone) bodyBones.add(o.name) })
		const clipTargets = new Set(clip.tracks.map((t) => t.name.split('.')[0]))
		const matched = [...clipTargets].filter((n) => bodyBones.has(n)).length
		console.log(`[erin_benjamin] ${label} "${clip.name}" - ${clip.duration.toFixed(2)}s, ${clip.tracks.length} tracks`)
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
				// Start from the active preset's colors- the autopilot color cycle
				// keeps them in sync afterwards.
				const preset = COLOR_PRESETS[this.params.autopilot.preset]
				if (preset) {
					mat.uniforms.rimColor.value.copy(preset.bodyRim)
					mat.uniforms.ambientColor.value.copy(preset.skyTop).offsetHSL(0, 0.25, 0)   // same boost as lerpColors
				}
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
