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
	{ name: 'spin', hold: 0, calm: 1.5, intense: 2.5 },          // flat helicopter spin- one-shot, returns by itself
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
		this.state = { last: '-' }   // GUI monitor binds to this
	}

	// Manual trigger (GUI test buttons): the full real path- camera staging,
	// monitor- bypassing only the chance roll and the cooldown.
	trigger(name) {
		const ev = EVENTS.find((e) => e.name === name)
		if (!ev) return
		const hold = Array.isArray(ev.hold) ? rand(ev.hold[0], ev.hold[1]) : ev.hold
		if (!this.body.playEvent(name, hold)) return
		this.state.last = name
		if (this.director.mode === 'base') this.director.enterAccent(0.8)
	}

	update(dt, audio, features) {
		const p = this.params.events
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
		this.state.last = picked.name
		this.cooldown = p.cooldown
		// Stage the move: punch the camera if the director is idling in base.
		if (this.director.mode === 'base') this.director.enterAccent(features.energy)
	}

}
