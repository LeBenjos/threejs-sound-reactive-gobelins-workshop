import * as THREE from 'three'

// The orbiting camera: base rotation + kick-driven angular impulses, sine bob
// + volume push on the vertical. Owns the PerspectiveCamera and its orbit state.
export default class CameraRig {

	constructor(params) {
		this.params = params
		this.orbit = { angle: 0, radius: 4.5, baseHeight: 0.95, verticalPhase: 0 }
		this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000)
		// Initial pose- update() recomputes from orbit each frame
		const { angle, radius, baseHeight } = this.orbit
		this.camera.position.set(Math.sin(angle) * radius, baseHeight, Math.cos(angle) * radius)
		this.camera.lookAt(0, 0, 0)
	}

	update(dt, audio) {
		const p = this.params.camera
		// Integrating into angular *velocity* (not angle directly) keeps motion
		// smooth: audio.kick spikes then decays, so each beat reads as an accelerator
		// rather than a teleport. Vertical motion: slow sine bob + volume push.
		// lookAt(0,0,0) is fixed so the body stays framed as the cam rises/falls.
		this.orbit.angle += dt * (p.baseSpeed + audio.kick * p.kickMult)
		this.orbit.verticalPhase += dt * p.verticalSpeed
		const { angle, radius, baseHeight, verticalPhase } = this.orbit
		const height = baseHeight + Math.sin(verticalPhase) * p.verticalAmp + audio.volumeSmooth * p.verticalVolumeMult
		this.camera.position.set(Math.sin(angle) * radius, height, Math.cos(angle) * radius)
		this.camera.lookAt(0, 0, 0)
	}

	resize() {
		this.camera.aspect = innerWidth / innerHeight
		this.camera.updateProjectionMatrix()
	}

}
