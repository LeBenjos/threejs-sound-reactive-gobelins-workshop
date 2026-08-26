import * as THREE from 'three'

import { CLOUD_LAYERS } from './config.js'
import CloudShader from './shaders/CloudShader.js'

// The 3D parallax cloud field: billboarded FBM sprites distributed over the
// depth layers of CLOUD_LAYERS, rising with the music and recycling in-band.
export default class Clouds {

	constructor(scene, params) {
		this.params = params
		this.group = new THREE.Group()
		// World-space (not pivot) so the pivot's audio-driven scale doesn't pulse them.
		scene.add(this.group)
		// Shared geometry- only materials clone per instance (unique seed/color uniforms).
		this.geometry = new THREE.PlaneGeometry(1, 1)
		this.mixScratch = new THREE.Color()      // reused per-frame by lerpColors to avoid GC
		this.shadowScratch = new THREE.Color()   // same, for the sprites' underside tint
		this.churn = 0   // internal-billow clock- advances with the energy (see update)
		this.populate()
	}

	populate() {
		const total = this.params.clouds.count
		// Distribute total across layers per countShare; round each, push leftover into
		// last layer so the exact total is respected.
		const perLayer = CLOUD_LAYERS.map((L) => Math.floor(total * L.countShare))
		const assigned = perLayer.reduce((s, n) => s + n, 0)
		perLayer[perLayer.length - 1] += total - assigned

		for (let li = 0; li < CLOUD_LAYERS.length; li++) {
			const layer = CLOUD_LAYERS[li]
			for (let i = 0; i < perLayer[li]; i++) {
				const material = new THREE.ShaderMaterial({
					uniforms: THREE.UniformsUtils.clone(CloudShader.uniforms),
					vertexShader: CloudShader.vertexShader,
					fragmentShader: CloudShader.fragmentShader,
					transparent: true,
					depthWrite: false,
				})
				material.uniforms.seed.value = Math.random()
				material.uniforms.noiseRot.value = Math.random() * Math.PI * 2
				material.uniforms.shadowMult.value = 0.8 + Math.random() * 0.4
				material.uniforms.cloudColor.value.set(this.params.clouds.color)
				// Neutral shadow fallback- the autopilot color cycle (lerpColors)
				// replaces it with the palette-derived tint on the first frame.
				material.uniforms.shadowColor.value.set(this.params.clouds.color).multiplyScalar(0.75)
				material.uniforms.opacity.value = this.params.clouds.opacity
				const mesh = new THREE.Mesh(this.geometry, material)
				const angle = Math.random() * Math.PI * 2
				const radius = layer.radiusMin + Math.random() * (layer.radiusMax - layer.radiusMin)
				const y = (Math.random() * 2 - 1) * layer.yRange
				const scale = layer.scaleMin + Math.random() * (layer.scaleMax - layer.scaleMin)
				mesh.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
				// Real cumulus run wider than tall- the random aspect also breaks
				// the clone look across the field.
				mesh.scale.set(scale * (1.1 + Math.random() * 0.6), scale, 1)
				// Stash layer index- needed at recycle time to respawn in the same band
				// and at update time to apply per-layer speed multiplier.
				mesh.userData.layerIndex = li
				this.group.add(mesh)
			}
		}
	}

	rebuild() {
		// Dispose per-instance materials- shared geometry stays alive.
		for (const cloud of this.group.children) cloud.material.dispose()
		this.group.clear()
		this.populate()
	}

	setColor(value) {
		// Per-cloud material clones- propagate to every instance's uniform.
		for (const cloud of this.group.children) {
			cloud.material.uniforms.cloudColor.value.set(value)
			cloud.material.uniforms.shadowColor.value.set(value).multiplyScalar(0.75)
		}
	}

	// Lerp the sprite tint between two color presets at factor f (0=A, 1=B).
	// The underside tint pulls the cloud color toward the preset's skyTop (same
	// rule as the sky shader), so sprites and background share one light.
	lerpColors(A, B, f) {
		const mixed = this.mixScratch.copy(A.cloudsColor).lerp(B.cloudsColor, f)
		const shadow = this.shadowScratch.copy(A.skyTop).lerp(B.skyTop, f).lerp(mixed, 0.55).multiplyScalar(0.8)
		for (const cloud of this.group.children) {
			cloud.material.uniforms.cloudColor.value.copy(mixed)
			cloud.material.uniforms.shadowColor.value.copy(shadow)
		}
	}

	update(dt, audio, features, camera) {
		const p = this.params.clouds
		this.group.visible = p.enabled
		if (!p.enabled) return
		// The field is vertically LOCKED to the camera (bob, bone-tracked shots,
		// director height changes- all of it): otherwise camera vertical motion
		// overtakes the slow far layers and they visibly fall on screen, reading
		// as broken. Locked, the only apparent vertical motion left is the
		// clouds' own world rise- and the band stays centered on the camera at
		// any shot height. Horizontal parallax (orbit, dolly) is untouched.
		this.group.position.y = camera.position.y
		// World-space rise scaled by per-layer speedMult: near layers run faster
		// than far ones, multiplying the natural perspective parallax into a true
		// layered effect. Each cloud recycles within its own band so layers stay
		// visually coherent over time. Rise speed follows the passage energy, and
		// the BASE speed itself sinks toward `floor` when the music goes silent.
		const floor = this.params.audio.floor
		const base = p.riseSpeedBase * (floor + (1 - floor) * features.energy)
		const baseRise = base + features.energy * p.riseEnergyMult + features.flow * p.riseKickMult * features.energy
		const baseDy = dt * features.rate * baseRise
		// Sprites ease back as the energy rises: at full intensity they streak as
		// translucent accents instead of stacking a second wall over the FBM sky.
		const spriteOpacity = p.opacity * (1 - 0.25 * features.energy)
		// Placid billows when calm, boiling on the drops.
		this.churn += dt * (0.06 + features.energy * 0.3)
		for (const cloud of this.group.children) {
			const layer = CLOUD_LAYERS[cloud.userData.layerIndex]
			cloud.position.y += baseDy * layer.speedMult
			if (cloud.position.y > layer.yRange) {
				cloud.position.y = -layer.yRange
				const angle = Math.random() * Math.PI * 2
				const radius = layer.radiusMin + Math.random() * (layer.radiusMax - layer.radiusMin)
				cloud.position.x = Math.cos(angle) * radius
				cloud.position.z = Math.sin(angle) * radius
			}
			// Vertical edge envelope: sprites are born transparent at the bottom of
			// their band and dissolve before the recycle teleport at the top- no
			// visible spawn/despawn pop whatever the camera angle. Respawn happens
			// exactly at ±yRange, where this envelope is zero.
			// The fade distance follows the layer's CURRENT rise speed (at least
			// half a second of travel inside the fade, capped at half the band):
			// a fixed slice reads as a hard pop when kicks push the rise fast.
			const fadeDist = Math.min(layer.yRange * 0.5, Math.max(layer.yRange * 0.15, baseRise * layer.speedMult * 0.5))
			const edgeFade = 1 - THREE.MathUtils.smoothstep(Math.abs(cloud.position.y), layer.yRange - fadeDist, layer.yRange)
			cloud.material.uniforms.opacity.value = spriteOpacity * edgeFade
			cloud.material.uniforms.time.value = this.churn
		}
		this.billboard(camera)
	}

	// Billboard: each quad faces the camera in yaw AND pitch (lookAt with the
	// default world-up), so clouds stay visible from the top-down and low-angle
	// shots too- the previous yaw-only cylinder showed them edge-on from
	// above/below. World-up roll keeps them from spinning when the camera bobs.
	billboard(camera) {
		for (const cloud of this.group.children) cloud.lookAt(camera.position)
	}

}
