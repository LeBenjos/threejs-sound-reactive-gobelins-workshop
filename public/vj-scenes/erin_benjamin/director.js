// The "réalisation": picks camera shots and HARD-CUTS between them like a
// music video- on the strong beats (after a minimum hold, so it never
// strobes) or when the current shot has run its course. Shot choice is
// energy-weighted: calm passages hold wide/slow frames, intense ones chain
// punchy close framings. The CameraRig stays the executor- this module only
// writes its orbit/framing state.
const SHOTS = [
	// radius/height: [min, max] picked at cut time. lookY: lookAt height.
	// speedMult/bobMult scale the rig's orbit speed and vertical bob.
	// calm/intense: selection weights blended by energy.
	{ name: 'wide', radius: [4.5, 6.5], height: [0.6, 1.4], lookY: 0, speedMult: 1.0, bobMult: 1.0, calm: 3, intense: 1 },
	{ name: 'closeup', radius: [1.7, 2.4], height: [0.2, 0.7], lookY: 0.35, speedMult: 0.6, bobMult: 0.25, calm: 1, intense: 3 },
	{ name: 'lowAngle', radius: [2.5, 3.5], height: [-2.2, -1.2], lookY: 0.2, speedMult: 0.8, bobMult: 0.4, calm: 1, intense: 2 },
	{ name: 'topDown', radius: [1.2, 2.0], height: [2.6, 3.4], lookY: -0.3, speedMult: 0.9, bobMult: 0.3, calm: 1, intense: 2 },
	// dolly: radius glides from radius[0] toward radius[1] over the shot.
	{ name: 'dolly', radius: [6.5, 2.5], height: [0.4, 0.9], lookY: 0.1, speedMult: 0.35, bobMult: 0.5, dolly: true, calm: 3, intense: 1 },
]

const rand = (min, max) => min + Math.random() * (max - min)

export default class Director {

	constructor(params, rig) {
		this.params = params
		this.rig = rig
		this.shotTime = 0
		this.prevKickHard = 0
		this.dollyTau = 0
		this.state = { shot: 'wide' }   // GUI monitor binds to this
		this.cut(0)
	}

	update(dt, audio, features) {
		const p = this.params.director
		if (!p.enabled) return
		this.shotTime += dt

		// Max shot length shrinks as the music intensifies.
		const maxDur = p.maxShotCalm + (p.maxShotIntense - p.maxShotCalm) * features.energy
		// Rising edge of the hard kick (it decays from 1 every frame).
		const kickCut = p.cutOnKickHard && audio.kickHard > 0.9 && this.prevKickHard <= 0.9
		this.prevKickHard = audio.kickHard

		if ((kickCut && this.shotTime >= p.minShot) || this.shotTime >= maxDur) this.cut(features.energy)

		// Dolly shots keep gliding toward their target radius.
		if (this.shot.dolly) {
			const r = this.rig.orbit
			r.radius += (this.shot.radius[1] - r.radius) * (1 - Math.exp(-dt / this.dollyTau))
		}
	}

	cut(energy) {
		// Energy-blended weighted pick (avoid replaying the same shot).
		let total = 0
		const weights = SHOTS.map((s) => {
			const w = s === this.shot ? 0 : s.calm + (s.intense - s.calm) * energy
			total += w
			return w
		})
		let roll = Math.random() * total
		let next = SHOTS[0]
		for (let i = 0; i < SHOTS.length; i++) {
			roll -= weights[i]
			if (roll <= 0) { next = SHOTS[i]; break }
		}
		this.shot = next
		this.state.shot = next.name
		this.shotTime = 0

		// Hard cut: reframe instantly + jump to a fresh viewpoint.
		const r = this.rig.orbit
		r.angle += rand(1.2, 2.5) * (Math.random() < 0.5 ? -1 : 1)
		r.radius = next.dolly ? next.radius[0] : rand(next.radius[0], next.radius[1])
		r.baseHeight = rand(next.height[0], next.height[1])
		this.rig.lookY = next.lookY
		this.rig.shotSpeedMult = next.speedMult
		this.rig.shotBobMult = next.bobMult
		if (next.dolly) this.dollyTau = rand(3, 6)   // seconds to close most of the distance
	}

}
