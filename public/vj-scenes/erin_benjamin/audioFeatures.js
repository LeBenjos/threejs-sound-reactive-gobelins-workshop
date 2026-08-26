// Derives musically-meaningful signals from the Analyzer's raw spectrum.
// Unlike analyzer.volume (AGC: a quiet passage is renormalized toward 1),
// `energy` tracks the ABSOLUTE spectral level- quiet music reads low, drops
// read high. It gates every punctual reaction in the scene, so the visuals
// ramp up when the music ramps up and settle when it settles.
export default class AudioFeatures {

	constructor(params) {
		this.params = params
		this.bass = 0     // ~86-690 Hz     body breathing
		this.mid = 0      // ~0.7-5 kHz     (unused yet- exposed for future effects)
		this.high = 0     // ~5-17 kHz      hats/cymbals → RGB shift
		this.energy = 0   // absolute passage intensity → global reactivity gate
	}

	update(dt, audio) {
		const p = this.params.audio
		const f = audio.volumeByFrequency
		// Band means over fftSize 512 ⇒ 256 bins of ~86 Hz each. Per-band gains
		// compensate the natural spectral tilt (music carries far less energy up high).
		this.bass = follow(this.bass, Math.min(1, mean(f, 1, 8) * p.bassGain), dt, 0.04, 0.25)
		this.mid = follow(this.mid, Math.min(1, mean(f, 8, 60) * p.midGain), dt, 0.04, 0.25)
		this.high = follow(this.high, Math.min(1, mean(f, 60, 200) * p.highGain), dt, 0.04, 0.25)

		// Absolute intensity: spectrum mean shaped between the calibrated quiet/loud
		// levels (smoothstep expands the useful range), then eased asymmetrically-
		// a drop ramps the scene up in ~attack seconds, a breakdown lets it settle
		// over ~release seconds.
		const raw = mean(f, 1, 120)
		const t = Math.min(1, Math.max(0, (raw - p.quiet) / Math.max(0.01, p.loud - p.quiet)))
		this.energy = follow(this.energy, t * t * (3 - 2 * t), dt, p.attack, p.release)
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
