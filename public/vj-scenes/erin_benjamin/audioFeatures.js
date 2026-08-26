// Derives musically-meaningful signals from the Analyzer's raw spectrum.
// Unlike analyzer.volume (AGC: a quiet passage is renormalized toward 1),
// `energy` tracks the passage intensity- quiet music reads low, drops read
// high. It gates every punctual reaction in the scene, so the visuals ramp
// up when the music ramps up and settle when it settles.
//
// Every signal is normalized by its own slow-decaying peak: a loud master
// doesn't pin everything at 1- what matters is the level RELATIVE to the
// track's own recent maximum, so variation survives any mastering level.
// The peak floor keeps true silence reading as ~0 instead of being boosted.
export default class AudioFeatures {

	constructor(params) {
		this.params = params
		this.bass = 0     // ~86-690 Hz     body breathing
		this.mid = 0      // ~0.7-5 kHz     (unused yet- exposed for future effects)
		this.high = 0     // ~5-17 kHz      hats/cymbals → RGB shift
		this.energy = 0   // passage intensity → global reactivity gate
		this.flow = 0     // smoothed kick- a bell-shaped swell per beat, for VELOCITIES
		this.peaks = { bass: 0.05, mid: 0.05, high: 0.05, energy: 0.05 }
	}

	// Normalize a raw band level by its slow-decaying peak (instant attack,
	// ~40% decay per minute of silence, floored so silence stays ~0).
	normalized(key, raw, dt) {
		const peaks = this.peaks
		peaks[key] = Math.max(0.05, raw, peaks[key] * Math.pow(0.99985, dt * 60))
		return raw / peaks[key]
	}

	update(dt, audio) {
		const p = this.params.audio
		const f = audio.volumeByFrequency
		// Band means over fftSize 512 ⇒ 256 bins of ~86 Hz each.
		this.bass = follow(this.bass, this.normalized('bass', mean(f, 1, 8), dt), dt, 0.04, 0.3)
		this.mid = follow(this.mid, this.normalized('mid', mean(f, 8, 60), dt), dt, 0.04, 0.3)
		this.high = follow(this.high, this.normalized('high', mean(f, 60, 200), dt), dt, 0.04, 0.3)

		// Intensity: spectrum mean relative to the track's recent peak, shaped
		// between quiet/loud (fractions of that peak- smoothstep expands the
		// useful range), then eased asymmetrically: a drop ramps the scene up in
		// ~attack seconds, a breakdown lets it settle over ~release seconds.
		const rel = this.normalized('energy', mean(f, 1, 120), dt)
		const t = Math.min(1, Math.max(0, (rel - p.quiet) / Math.max(0.01, p.loud - p.quiet)))
		this.energy = follow(this.energy, t * t * (3 - 2 * t), dt, p.attack, p.release)

		// Smoothed kick for anything driving a VELOCITY (camera orbit, sky scroll,
		// cloud rise): the raw kick is a step- stepping a velocity reads as a
		// stutter- while this swells and settles. Raw kick stays for flashes.
		this.flow = follow(this.flow, audio.kick, dt, 0.09, 0.35)
	}

}

function mean(arr, start, end) {
	let s = 0
	for (let i = start; i < end; i++) s += arr[i]
	return s / (end - start)
}

// Frame-rate independent exponential follower with separate attack/release time constants.
function follow(current, target, dt, attackTau, releaseTau) {
	const tau = target > current ? attackTau : releaseTau
	return current + (target - current) * (1 - Math.exp(-dt / tau))
}
