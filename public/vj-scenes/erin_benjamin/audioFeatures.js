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
		this.bpm = 100    // live tempo estimate from kick intervals
		this.pace = 0.5   // bpm normalized between bpmSlow..bpmFast, eased
		this.rate = 1     // global world-speed multiplier derived from pace
		this.dropPulse = 0   // 1 on a detected drop, decays over ~0.7s
		this.quietTime = 0   // seconds spent below the quiet threshold
		this.peaks = { bass: 0.05, mid: 0.05, high: 0.05, energy: 0.05 }
		this.floorLevel = 0.05   // slow-rising minimum tracker- see update()
		this.time = 0
		this.prevKick = 0
		this.lastKickAt = null
		this.intervals = []
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

		// Intensity: where the spectrum sits inside the track's ACTUAL dynamic
		// range- (raw - floor) / (peak - floor). Peak-only normalization pinned
		// compressed music (which lives in a narrow band near its peak) at ~1
		// permanently; tracking the floor too (rises slowly toward raw over
		// ~25s, snaps down instantly) re-spreads that band over 0..1. Then
		// shaped between quiet/loud and eased asymmetrically: a drop ramps the
		// scene up in ~attack seconds, a breakdown settles over ~release.
		const raw = mean(f, 1, 120)
		const peaks = this.peaks
		peaks.energy = Math.max(0.05, raw, peaks.energy * Math.pow(0.99985, dt * 60))
		this.floorLevel = Math.min(raw, this.floorLevel + (raw - this.floorLevel) * (1 - Math.exp(-dt / 25)))
		const rel = (raw - this.floorLevel) / Math.max(0.02, peaks.energy - this.floorLevel)
		const t = Math.min(1, Math.max(0, (rel - p.quiet) / Math.max(0.01, p.loud - p.quiet)))
		this.energy = follow(this.energy, t * t * (3 - 2 * t), dt, p.attack, p.release)

		// Smoothed kick for anything driving a VELOCITY (camera orbit, sky scroll,
		// cloud rise): the raw kick is a step- stepping a velocity reads as a
		// stutter- while this swells and settles. Raw kick stays for flashes.
		this.flow = follow(this.flow, audio.kick, dt, 0.09, 0.35)

		// Live BPM from the soft-kick intervals (median of the last 6, outliers
		// rejected), then a normalized pace and a WORLD-SPEED multiplier: the
		// whole scene- animation, sky, clouds, streaks, orbit- accelerates and
		// settles with the track's tempo.
		this.time += dt
		const kickHit = audio.kick > 0.9 && this.prevKick <= 0.9
		this.prevKick = audio.kick
		if (kickHit) {
			if (this.lastKickAt !== null) {
				let gap = this.time - this.lastKickAt
				// Octave folding, but ONLY for gaps near an integer multiple of the
				// current period (±15%- the signature of MISSED beats on the same
				// grid, i.e. a breakdown). A gap that fits no multiple is a genuine
				// tempo change and must pass through raw, or the estimate can never
				// move. No folding on SHORT gaps: the kick detector's refractory
				// hold already prevents double-fires, and folding there swallowed
				// genuine tempo doublings.
				const period = 60 / this.bpm
				const ratio = gap / period
				const nearest = Math.round(ratio)
				if (nearest >= 2 && Math.abs(ratio - nearest) < 0.15 * nearest) gap /= nearest
				if (gap >= 0.25 && gap <= 2.0) {   // 30-240 bpm plausibility window
					this.intervals.push(gap)
					if (this.intervals.length > 6) this.intervals.shift()
					const sorted = [...this.intervals].sort((a, b) => a - b)
					this.bpmTarget = 60 / sorted[Math.floor(sorted.length / 2)]
				}
			}
			this.lastKickAt = this.time
		}
		this.bpm = follow(this.bpm, this.bpmTarget ?? this.bpm, dt, 1.5, 1.5)
		const pt = Math.min(1, Math.max(0, (this.bpm - p.bpmSlow) / Math.max(1, p.bpmFast - p.bpmSlow)))
		this.pace = follow(this.pace, pt, dt, 1.0, 1.5)
		this.rate = p.rateMin + (p.rateMax - p.rateMin) * this.pace

		// Drop detection: energy surging hot after a sustained quiet stretch.
		// dropPulse spikes to 1 and decays- consumers watch its rising edge for
		// one-shot moments (palette switch, camera accent) and use its value as
		// a flash envelope.
		if (this.energy < 0.4) this.quietTime += dt
		else if (this.energy > 0.72) {
			if (this.quietTime > 1.5) this.dropPulse = 1
			this.quietTime = 0
		}
		this.dropPulse = Math.max(0, this.dropPulse - dt * 1.5)
		// Impact frame: the whole world (rate drives everything that moves)
		// freezes for the first ~80ms of the drop hit, then blasts back- the
		// breath before the explosion.
		if (this.dropPulse > 0.88) this.rate *= 0.08
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
