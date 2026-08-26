import * as THREE from 'three'

import SkyShader from './shaders/SkyShader.js'

// The screen-space FBM sky background. Owns its fullscreen quad + the scroll
// time integration (audio-reactive rise speed).
export default class Sky {

	constructor(scene, params) {
		this.params = params
		this.time = 0
		this.churn = 0   // warp clock- cumulus shapes boil, faster with the energy
		// Orbital pan state: the FBM background pans with the camera azimuth so
		// it moves as one world with the 3D sprites (see update).
		this.pan = 0
		this.prevAzimuth = null
		const geometry = new THREE.PlaneGeometry(2, 2)
		const material = new THREE.ShaderMaterial({
			uniforms: THREE.UniformsUtils.clone(SkyShader.uniforms),
			vertexShader: SkyShader.vertexShader,
			fragmentShader: SkyShader.fragmentShader,
			depthTest: false,
			depthWrite: false,
		})
		material.uniforms.resolution.value.set(innerWidth, innerHeight)
		material.uniforms.skyTop.value.set(params.sky.topColor)
		material.uniforms.skyBottom.value.set(params.sky.bottomColor)
		material.uniforms.cloudColor.value.set(params.sky.cloudColor)
		this.mesh = new THREE.Mesh(geometry, material)
		this.mesh.renderOrder = -1   // draws before body- depth disabled so body still occludes
		this.mesh.frustumCulled = false
		scene.add(this.mesh)
	}

	get uniforms() {
		return this.mesh.material.uniforms
	}

	update(dt, audio, features, camera) {
		const p = this.params.sky
		this.mesh.visible = p.enabled
		// Integrate speed·dt (not raw clock time) so kick spikes register as
		// transient accelerators, mirroring the camera-orbit pattern. The fall
		// speed follows the passage energy: intense music = faster fall, and the
		// BASE speed itself sinks toward `floor` when the music goes silent.
		const floor = this.params.audio.floor
		const base = p.scrollSpeedBase * (floor + (1 - floor) * features.energy)
		this.time += dt * features.rate * (base + features.energy * p.scrollEnergyMult + features.flow * p.scrollKickMult * features.energy)
		this.churn += dt * (0.05 + features.energy * 0.25)
		// The background pans with the camera's orbital sweep, calibrated on the
		// horizontal FOV (a sweep of one FOV pans one screen width): the FBM and
		// the 3D sprites read as ONE world when the camera orbits or whip-pans.
		// The azimuth is unwrapped so the ±π seam never jumps the pattern; hard
		// cuts do jump it, masked by the cut itself.
		const az = Math.atan2(camera.position.x, camera.position.z)
		if (this.prevAzimuth === null) this.prevAzimuth = az
		let dAz = az - this.prevAzimuth
		if (dAz > Math.PI) dAz -= Math.PI * 2
		else if (dAz < -Math.PI) dAz += Math.PI * 2
		this.prevAzimuth = az
		const hFov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect)
		this.pan -= dAz * (camera.aspect / hFov)
		const u = this.uniforms
		u.time.value = this.time
		u.panX.value = this.pan
		u.churnTime.value = this.churn
		u.cloudScale.value = p.cloudScale
		// Clamped at white: past 1.0 the cloud tint burns the whole frame out and
		// the sky gradient disappears- the "wall of white" during intense passages.
		// The drop flash rides ABOVE the white clamp on purpose- a brief burst.
		u.brightness.value = Math.min(1, p.brightnessBase + features.energy * p.brightnessEnergyMult) + features.dropPulse * 0.8
		// Intense passages thin the cloud cover (see SkyShader): speed reads
		// through fewer, denser clouds- not through more noise.
		u.coverageShift.value = features.energy * 0.17
	}

	// Lerp the sky uniforms between two color presets at factor f (0=A, 1=B).
	// With A===B and f=0 it just snaps to A.
	lerpColors(A, B, f) {
		const u = this.uniforms
		u.skyTop.value.copy(A.skyTop).lerp(B.skyTop, f)
		u.skyBottom.value.copy(A.skyBottom).lerp(B.skyBottom, f)
		u.cloudColor.value.copy(A.skyCloudColor).lerp(B.skyCloudColor, f)
	}

	resize() {
		this.uniforms.resolution.value.set(innerWidth, innerHeight)
	}

}
