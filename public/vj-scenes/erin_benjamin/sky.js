import * as THREE from 'three'

import SkyShader from './shaders/SkyShader.js'

// The screen-space FBM sky background. Owns its fullscreen quad + the scroll
// time integration (audio-reactive rise speed).
export default class Sky {

	constructor(scene, params) {
		this.params = params
		this.time = 0
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

	update(dt, audio, features) {
		const p = this.params.sky
		this.mesh.visible = p.enabled
		// Integrate speed·dt (not raw clock time) so kick spikes register as
		// transient accelerators, mirroring the camera-orbit pattern. The fall
		// speed follows the passage energy: intense music = faster fall.
		this.time += dt * (p.scrollSpeedBase + features.energy * p.scrollEnergyMult + audio.kick * p.scrollKickMult * features.energy)
		const u = this.uniforms
		u.time.value = this.time
		u.cloudScale.value = p.cloudScale
		u.brightness.value = p.brightnessBase + features.energy * p.brightnessEnergyMult
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
