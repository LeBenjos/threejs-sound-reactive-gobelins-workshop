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
	// far: the body becomes a small figure lost in the sky.
	{ name: 'far', radius: [9, 15], height: [1.0, 3.5], lookY: 0, speedMult: 0.7, bobMult: 1.6, calm: 3, intense: 2 },
	{ name: 'closeup', radius: [1.7, 2.4], height: [0.2, 0.7], lookY: 0.35, speedMult: 0.6, bobMult: 0.25, calm: 1, intense: 3 },
	{ name: 'lowAngle', radius: [2.5, 3.5], height: [-2.2, -1.2], lookY: 0.2, speedMult: 0.8, bobMult: 0.4, calm: 1, intense: 2 },
	{ name: 'topDown', radius: [1.2, 2.0], height: [2.6, 3.4], lookY: -0.3, speedMult: 0.9, bobMult: 0.3, calm: 1, intense: 2 },
	// dolly: radius glides from radius[0] toward radius[1] over the shot.
	{ name: 'dolly', radius: [6.5, 2.5], height: [0.4, 0.9], lookY: 0.1, speedMult: 0.35, bobMult: 0.5, dolly: true, calm: 3, intense: 1 },
	// Bone-tracked shots (kind handled by the CameraRig):
	// face- in front of the head, looking at it. below- under the falling
	// body, silhouette against the sky. hand- close on a hand, the body behind.
	{ name: 'face', track: 'face', dist: [0.9, 1.4], calm: 1, intense: 2 },
	{ name: 'below', track: 'below', dist: [2.2, 3.2], calm: 2, intense: 2 },
	{ name: 'hand', track: 'hand', dist: [0.5, 0.9], calm: 2, intense: 1 },
]

const rand = (min, max) => min + Math.random() * (max - min)
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// Closest the zoom drift may come, per shot kind- outside the body even with
// arms spread and the bass scale pulse (~1.55x on a ~1 unit half arm-span).
const ORBIT_MIN_RADIUS = 1.6
const TRACK_MIN_DIST = { face: 0.55, hand: 0.35, below: 1.6 }
const ORBIT_MAX_RADIUS = 20

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
		// Rising edge of the hard kick (it decays from 1 every frame); only a
		// fraction of them cut, so the montage stays musical without being
		// mechanical- one cut per beat reads as too much.
		const kickHit = audio.kickHard > 0.9 && this.prevKickHard <= 0.9
		this.prevKickHard = audio.kickHard
		const kickCut = p.cutOnKickHard && kickHit && Math.random() < p.kickCutChance

		if ((kickCut && this.shotTime >= p.minShot) || this.shotTime >= maxDur) this.cut(features.energy)

		// Dolly shots keep gliding toward their target radius.
		if (this.shot.dolly) {
			const r = this.rig.orbit
			r.radius += (this.shot.radius[1] - r.radius) * (1 - Math.exp(-dt / this.dollyTau))
		}

		// Random per-shot zoom drift (in / out / none, rolled at cut time).
		if (this.drift) {
			const k = 1 - Math.exp(-dt / this.drift.tau)
			if (this.rig.trackShot) this.rig.trackShot.dist += (this.drift.target - this.rig.trackShot.dist) * k
			else this.rig.orbit.radius += (this.drift.target - this.rig.orbit.radius) * k
		}
	}

	// Roll the zoom drift for the shot that was just cut to: zoom in, zoom out
	// or hold, gliding toward a clamped target so the lens never enters the body.
	rollDrift(next) {
		this.drift = null
		if (next.dolly) return   // the dolly IS a zoom- don't stack another one
		const roll = Math.random()
		if (roll >= this.params.director.zoomDrift) return
		const dir = roll < this.params.director.zoomDrift * 0.5 ? -1 : 1
		const tau = rand(5, 10)
		if (next.track) {
			const base = this.rig.trackShot.dist
			this.drift = { tau, target: clamp(base * (1 + dir * rand(0.3, 0.6)), TRACK_MIN_DIST[next.track], base * 1.8) }
		} else {
			const base = this.rig.orbit.radius
			this.drift = { tau, target: clamp(base * (1 + dir * rand(0.25, 0.55)), ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS) }
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

		// Bone-tracked shot: the rig ignores the orbit while trackShot is set.
		// side/side2 give the 'below' shot a random lateral offset per cut.
		if (next.track) {
			this.rig.trackShot = {
				kind: next.track,
				dist: rand(next.dist[0], next.dist[1]),
				side: rand(-1, 1), side2: rand(-1, 1),
				fresh: true,
			}
			this.rollDrift(next)
			return
		}
		this.rig.trackShot = null

		// Hard cut: reframe instantly + jump to a fresh viewpoint, and re-roll
		// the orbit direction so the camera doesn't always circle the same way.
		const r = this.rig.orbit
		r.angle += rand(1.2, 2.5) * (Math.random() < 0.5 ? -1 : 1)
		this.rig.orbitDir = Math.random() < 0.5 ? -1 : 1
		r.radius = next.dolly ? next.radius[0] : rand(next.radius[0], next.radius[1])
		r.baseHeight = rand(next.height[0], next.height[1])
		this.rig.lookY = next.lookY
		this.rig.shotSpeedMult = next.speedMult
		this.rig.shotBobMult = next.bobMult
		if (next.dolly) this.dollyTau = rand(3, 6)   // seconds to close most of the distance
		this.rollDrift(next)
	}

}
