import * as THREE from 'three'

import { COLOR_PRESETS } from './config.js'

// Waypoint for the 'flash' transition: everything blows out to white before
// the next palette reveals itself.
const WHITE_PRESET = {
	skyTop: new THREE.Color(0xffffff), skyBottom: new THREE.Color(0xffffff),
	skyCloudColor: new THREE.Color(0xffffff), cloudsColor: new THREE.Color(0xffffff),
	bodyRim: new THREE.Color(0xffffff),
}

// Layered LFOs over the static-feeling params. Writes go directly into the params
// struct (and into the sky/clouds colors), so the audio-reactive update() logic
// composes on top: autopilot sets the slow baseline, audio adds beat-driven spikes.
// Disabling autopilot lets the manual GUI values take over again instantly.
export default class Autopilot {

	constructor(params, sky, clouds, body) {
		this.params = params
		this.sky = sky
		this.clouds = clouds
		this.body = body
		this.phase = 0
		this.prevKick = 0   // for the 'steps' transition's kick-edge detection
		this.onPresetAdvanced = null   // wired by the scene- lets the GUI mirror the cycle
	}

	// Abort any running transition (manual GUI picks call this).
	resetPresetTimer() {
		this.transition = null
	}

	// Palette change on a musical drop- the ONLY thing that moves the palette.
	// dropMode picks the style ('random' draws one per drop):
	// - snap: hard cut to the next preset, a deliberate color slam
	// - surge: the transition glides to the next preset in ~1.5s
	// - flash: colors blow out THROUGH white with the drop flash, the new
	//   palette reveals itself as it settles
	// - steps: quantized- a quarter of the way on each kick, landing in 4 beats
	skipToNext() {
		const p = this.params.autopilot
		let mode = p.dropMode
		if (mode === 'random') mode = ['snap', 'snap', 'surge', 'flash', 'flash', 'steps'][Math.floor(Math.random() * 6)]
		if (mode === 'snap') {
			p.preset = (p.preset + 1) % COLOR_PRESETS.length
			this.transition = null   // a pending transition must not keep running
			this.onPresetAdvanced?.(p.preset)
			return
		}
		this.transition = { mode, t: 0, step: 0, idle: 0 }
	}

	// Advance the running transition; returns the current mix factor (0..1).
	transitionMix(dt, audio) {
		const tr = this.transition
		if (tr.mode === 'surge') {
			tr.t = Math.min(1, tr.t + dt / 1.5)
			return tr.t * tr.t * (3 - 2 * tr.t)
		}
		if (tr.mode === 'flash') {
			tr.t = Math.min(1, tr.t + dt / 1.2)
			return tr.t
		}
		// steps: a quarter per kick edge, with a fallback tick if the kicks stop.
		const kickHit = audio.kick > 0.9 && this.prevKick <= 0.9
		tr.idle += dt
		if (kickHit || tr.idle > 0.8) {
			tr.step = Math.min(4, tr.step + 1)
			tr.idle = 0
		}
		tr.t = tr.step / 4
		return tr.t
	}

	update(dt, audio) {
		this.phase += dt * this.params.autopilot.speed
		const phase = this.phase
		// Normalized sine [-1, 1] and [0, 1] helpers- period in seconds (at speed=1).
		const osc = (period, off = 0) => Math.sin(phase * (Math.PI * 2) / period + off)
		const osc01 = (period, off = 0) => osc(period, off) * 0.5 + 0.5

		const p = this.params

		// Camera bob amplitude sweep (framing- radius/height- now belongs to the
		// Director, which hard-cuts between shots).
		p.camera.verticalAmp = 0.4 + osc01(19, 0.4) * 0.9

		// Sky atmosphere- scale + brightness baseline pulse.
		p.sky.cloudScale = 6.0 + osc(40, 0.2) * 3.0
		p.sky.brightnessBase = 0.55 + osc01(22, 2.1) * 0.4

		// Cloud field veil density.
		p.clouds.opacity = 0.75 + osc(14, 1.1) * 0.2

		// Lens dynamics- bloom shape + lens distortion + RGB rotation. The bloom
		// threshold must stay ABOVE the white body's ~0.70 max luminance (see
		// config) so only the rim-boosted edges ever bloom.
		p.bloom.radius = 0.35 + osc(18, 0.6) * 0.2
		p.bloom.threshold = 0.8 + osc01(24, 0.9) * 0.15
		p.fisheye.strengthBase = 0.6 + osc(28, 2.4) * 0.6
		p.rgbShift.angle = (phase * 0.4) % (Math.PI * 2)

		if (!p.autopilot.colorCycle) return

		// The palette holds still- it only moves when a drop calls skipToNext().
		// `params.autopilot.preset` stays the source of truth, advanced +
		// mirrored into the GUI dropdown when a transition lands.
		const cur = p.autopilot.preset
		const nxt = (cur + 1) % COLOR_PRESETS.length
		let A = COLOR_PRESETS[cur]
		let B = COLOR_PRESETS[nxt]
		let f = 0
		if (this.transition) {
			f = this.transitionMix(dt, audio)
			if (this.transition.mode === 'flash') {
				// Through-white: blow out over the first 35%, reveal over the rest.
				if (f < 0.35) { B = WHITE_PRESET; f = f / 0.35 }
				else { A = WHITE_PRESET; B = COLOR_PRESETS[nxt]; f = (f - 0.35) / 0.65 }
			}
			if (this.transition.t >= 1) {
				this.transition = null
				p.autopilot.preset = nxt
				this.onPresetAdvanced?.(nxt)
				A = COLOR_PRESETS[nxt]
				f = 0
			}
		}
		this.prevKick = audio.kick
		this.sky.lerpColors(A, B, f)
		this.clouds.lerpColors(A, B, f)
		this.body.lerpColors(A, B, f)
	}

}
