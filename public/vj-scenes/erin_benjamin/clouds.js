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
		this.mixScratch = new THREE.Color()   // reused per-frame by lerpColors to avoid GC
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
				material.uniforms.cloudColor.value.set(this.params.clouds.color)
				material.uniforms.opacity.value = this.params.clouds.opacity
				const mesh = new THREE.Mesh(this.geometry, material)
				const angle = Math.random() * Math.PI * 2
				const radius = layer.radiusMin + Math.random() * (layer.radiusMax - layer.radiusMin)
				const y = (Math.random() * 2 - 1) * layer.yRange
				const scale = layer.scaleMin + Math.random() * (layer.scaleMax - layer.scaleMin)
				mesh.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius)
				mesh.scale.setScalar(scale)
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
		for (const cloud of this.group.children) cloud.material.uniforms.cloudColor.value.set(value)
	}

	// Lerp the sprite tint between two color presets at factor f (0=A, 1=B).
	lerpColors(A, B, f) {
		const mixed = this.mixScratch.copy(A.cloudsColor).lerp(B.cloudsColor, f)
		for (const cloud of this.group.children) cloud.material.uniforms.cloudColor.value.copy(mixed)
	}

	update(dt, audio, features, camera) {
		const p = this.params.clouds
		this.group.visible = p.enabled
		if (!p.enabled) return
		// World-space rise scaled by per-layer speedMult: near layers run faster
		// than far ones, multiplying the natural perspective parallax into a true
		// layered effect. Each cloud recycles within its own band so layers stay
		// visually coherent over time. Rise speed follows the passage energy, and
		// the BASE speed itself sinks toward `floor` when the music goes silent.
		const floor = this.params.audio.floor
		const base = p.riseSpeedBase * (floor + (1 - floor) * features.energy)
		const baseRise = base + features.energy * p.riseEnergyMult + audio.kick * p.riseKickMult * features.energy
		const baseDy = dt * baseRise
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
			cloud.material.uniforms.opacity.value = p.opacity
		}
		this.billboard(camera)
	}

	// Cylindrical billboard: rotate only around world Y to face camera. Keeps clouds
	// upright (no roll) even when the camera bobs, which matches "real" cloud sprites.
	billboard(camera) {
		const cx = camera.position.x
		const cz = camera.position.z
		for (const cloud of this.group.children) {
			cloud.rotation.y = Math.atan2(cx - cloud.position.x, cz - cloud.position.z)
		}
	}

}
