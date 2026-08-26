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
		// Head-tracked "face" shot: set by the Director ({dist, fresh}), null = orbit.
		// this.body is wired by the scene after construction.
		this.body = null
		this.trackShot = null
		this.faceAxis = new THREE.Vector3(0, -1, 0)   // head-bone local axis pointing out of the face (verified visually on this rig)
		this.headPos = new THREE.Vector3()
		this.handPos = new THREE.Vector3()
		this.headQuat = new THREE.Quaternion()
		this.faceDir = new THREE.Vector3()
		this.desiredPos = new THREE.Vector3()
		this.lookScratch = new THREE.Vector3()
		this.upNudge = new THREE.Vector3()
		this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000)
		// Initial pose- update() recomputes from orbit each frame
		const { angle, radius, baseHeight } = this.orbit
		this.camera.position.set(Math.sin(angle) * radius, baseHeight, Math.cos(angle) * radius)
		this.camera.lookAt(0, 0, 0)
	}

	update(dt, audio, features) {
		const p = this.params.camera
		// Bone-tracked shots: anchored to the skeleton, following it with a
		// slight lag (handheld feel- snap on the cut itself).
		if (this.trackShot && this.body) {
			const t = this.trackShot
			this.body.getHeadPosition(this.headPos)
			this.body.getHeadQuaternion(this.headQuat)
			this.faceDir.copy(this.faceAxis).applyQuaternion(this.headQuat).normalize()
			if (t.kind === 'below') {
				// Under the falling body, silhouetted against the sky above.
				this.desiredPos.set(t.side, -t.dist, t.side2)
				this.lookScratch.copy(this.headPos)
			} else if (t.kind === 'hand') {
				// Close on a hand, the body falling behind it.
				this.body.getHandPosition(this.handPos)
				this.faceDir.copy(this.handPos).sub(this.headPos).normalize()
				this.desiredPos.copy(this.handPos).addScaledVector(this.faceDir, t.dist).add(this.upNudge.set(0, t.dist * 0.3, 0))
				this.lookScratch.copy(this.handPos)
			} else {
				// face: in front of the head, looking straight at it.
				this.desiredPos.copy(this.headPos).addScaledVector(this.faceDir, t.dist)
				this.lookScratch.copy(this.headPos)
			}
			if (t.fresh) { this.camera.position.copy(this.desiredPos); t.fresh = false }
			else this.camera.position.lerp(this.desiredPos, 1 - Math.exp(-dt / 0.15))
			this.camera.lookAt(this.lookScratch)
			return
		}
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
