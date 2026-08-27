// Rare animation events: on a hard kick- gated by a LOW chance, a LONG
// cooldown and a minimum energy- the body breaks its fall for a special
// clip, then glides back. Rarity is the point: one event every ~30-60s
// keeps them precious. When one fires, the director punches to an accent
// shot at the same moment (if it was idling in base) so the move is staged.
const EVENTS = [
	// calm/intense: selection weights blended by energy. Events mostly fire at
	// high energy (hard kicks live there), so flying keeps real weight in
	// intense too- otherwise backflip wins nearly every roll.
	// (the flying clip is still in character.glb- re-add a line here to bring it back)
	{ name: 'backflip', hold: 0, calm: 0.5, intense: 3 },        // one-shot- returns by itself
	{ name: 'backfalling', hold: [5, 9], calm: 3, intense: 2 },  // rolls onto his back- held then released
]
const REPEAT_PENALTY = 0.35   // last-played event's weight multiplier- variety without strict alternation

const rand = (min, max) => min + Math.random() * (max - min)

export default class MusicEvents {

	constructor(params, body, director) {
		this.params = params
		this.body = body
		this.director = director
		this.cooldown = 0
		this.prevKickHard = 0
		this.bulletIn = 0     // countdown to the bullet-time freeze (armed by a backflip)
		this.bulletLeft = 0   // seconds of freeze remaining
		this.state = { last: '-' }   // GUI monitor binds to this
	}

	update(dt, audio, features) {
		const p = this.params.events
		// Bullet time: mid-backflip, the WORLD freezes for ~0.8s while the
		// camera keeps carving around the suspended body (the rig ignores
		// features.freeze- see cameraRig). Armed 1.3s after the flip starts.
		features.freeze = 1
		if (this.bulletIn > 0) {
			this.bulletIn -= dt
			if (this.bulletIn <= 0) this.bulletLeft = 0.8
		}
		if (this.bulletLeft > 0) {
			this.bulletLeft -= dt
			features.freeze = 0.02
		}
		if (!p.enabled) return
		this.cooldown -= dt

		// Rising edge of the hard kick (it decays from 1 every frame).
		const kickHit = audio.kickHard > 0.9 && this.prevKickHard <= 0.9
		this.prevKickHard = audio.kickHard
		if (!kickHit || this.cooldown > 0 || features.energy < p.minEnergy) return
		if (Math.random() >= p.chance) return

		// Energy-blended weighted pick, repeat-penalized.
		let total = 0
		const weights = EVENTS.map((ev) => {
			let w = ev.calm + (ev.intense - ev.calm) * features.energy
			if (ev.name === this.state.last) w *= REPEAT_PENALTY
			total += w
			return w
		})
		let roll = Math.random() * total
		let picked = EVENTS[0]
		for (let i = 0; i < EVENTS.length; i++) {
			roll -= weights[i]
			if (roll <= 0) { picked = EVENTS[i]; break }
		}

		const hold = Array.isArray(picked.hold) ? rand(picked.hold[0], picked.hold[1]) : picked.hold
		if (!this.body.playEvent(picked.name, hold)) return
		if (picked.name === 'backflip') this.bulletIn = 1.3   // matrix moment mid-flip
		this.state.last = picked.name
		this.cooldown = p.cooldown
		// Stage the move: punch the camera if the director is idling in base.
		if (this.director.mode === 'base') this.director.enterAccent(features.energy)
	}

}
