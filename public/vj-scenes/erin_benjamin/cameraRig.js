import * as THREE from 'three'

// The orbiting camera: base rotation + kick-driven angular impulses, sine bob
// + volume push on the vertical. Owns the PerspectiveCamera and its orbit state.
export default class CameraRig {

	constructor(params) {
		this.params = params
		this.orbit = { angle: 0, radius: 4.5, baseHeight: 0.95, verticalPhase: 0 }
		// Framing state written by the Director on each cut.
		this.lookY = 0
		this.shotSpeedMult = 1
		this.shotBobMult = 1
		this.orbitDir = 1   // +1 / -1, re-rolled by the Director on each cut
		this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000)
		// Initial pose- update() recomputes from orbit each frame
		const { angle, radius, baseHeight } = this.orbit
		this.camera.position.set(Math.sin(angle) * radius, baseHeight, Math.cos(angle) * radius)
		this.camera.lookAt(0, 0, 0)
	}

	update(dt, audio, features) {
		const p = this.params.camera
		// Integrating into angular *velocity* (not angle directly) keeps motion
		// smooth, and the beat impulse comes from features.flow (the smoothed
		// kick)- the raw kick is a velocity STEP, which reads as a stutter.
		// Impulses are gated by the passage energy: no whip-pans during quiet
		// sections. Vertical motion: slow sine bob + energy push. lookAt(0,0,0)
		// is fixed so the body stays framed.
		this.orbit.angle += dt * this.orbitDir * (p.baseSpeed * this.shotSpeedMult + features.flow * p.kickMult * features.energy)
		this.orbit.verticalPhase += dt * p.verticalSpeed
		const { angle, radius, baseHeight, verticalPhase } = this.orbit
		const bob = (Math.sin(verticalPhase) * p.verticalAmp + features.energy * p.verticalEnergyMult) * this.shotBobMult
		this.camera.position.set(Math.sin(angle) * radius, baseHeight + bob, Math.cos(angle) * radius)
		this.camera.lookAt(0, this.lookY, 0)
	}

	resize() {
		this.camera.aspect = innerWidth / innerHeight
		this.camera.updateProjectionMatrix()
	}

}
