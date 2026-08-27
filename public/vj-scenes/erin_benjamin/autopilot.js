import * as THREE from 'three'

import { COLOR_PRESETS } from './config.js'

// Waypoints for the through-X transitions: 'flash' blows out to white before
// the next palette reveals itself; 'dip' sinks into darkness and relights.
const WHITE_PRESET = {
	skyTop: new THREE.Color(0xffffff), skyBottom: new THREE.Color(0xffffff),
	skyCloudColor: new THREE.Color(0xffffff), cloudsColor: new THREE.Color(0xffffff),
	bodyRim: new THREE.Color(0xffffff),
}
const BLACK_PRESET = {
	skyTop: new THREE.Color(0x030308), skyBottom: new THREE.Color(0x050510),
	skyCloudColor: new THREE.Color(0x08080f), cloudsColor: new THREE.Color(0x060609),
	bodyRim: new THREE.Color(0x101018),
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
	// - dip: colors sink into darkness, then the new palette relights- a blink
	// - wipe: the new palette grows in a circle from screen center to the edges
	skipToNext() {
		const p = this.params.autopilot
		let mode = p.dropMode
		if (mode === 'random') mode = ['snap', 'snap', 'surge', 'flash', 'flash', 'dip', 'wipe', 'wipe'][Math.floor(Math.random() * 8)]
		if (mode === 'snap') {
			p.preset = (p.preset + 1) % COLOR_PRESETS.length
			this.transition = null   // a pending transition must not keep running
			this.onPresetAdvanced?.(p.preset)
			return
		}
		this.transition = { mode, t: 0 }
	}

	// Advance the running transition; returns the current mix factor (0..1).
	transitionMix(dt) {
		const tr = this.transition
		if (tr.mode === 'surge') {
			tr.t = Math.min(1, tr.t + dt / 1.5)
			return tr.t * tr.t * (3 - 2 * tr.t)
		}
		if (tr.mode === 'wipe') {
			// Ease-out: the circle bursts open then settles on the edges.
			tr.t = Math.min(1, tr.t + dt / 1.4)
			return 1 - (1 - tr.t) * (1 - tr.t)
		}
		// flash (1.2s) and dip (1.5s): linear clock, the waypoint split in
		// update() shapes the two phases.
		tr.t = Math.min(1, tr.t + dt / (tr.mode === 'dip' ? 1.5 : 1.2))
		return tr.t
	}

	update(dt) {
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
			f = this.transitionMix(dt)
			const mode = this.transition.mode
			if (mode === 'wipe' && this.transition.t < 1) {
				// Spatial: sky and clouds carry BOTH palettes with a growing front;
				// the body sits at screen center, so it leads the wipe.
				this.sky.setWipe(A, B, f)
				this.clouds.setWipe(A, B, f)
				this.body.lerpColors(A, B, Math.min(1, f * 1.6))
				return
			}
			if (mode === 'flash' || mode === 'dip') {
				// Through a waypoint: out over the first phase, reveal over the rest.
				// flash blows out fast (35%); dip falls into black a bit slower (40%).
				const waypoint = mode === 'flash' ? WHITE_PRESET : BLACK_PRESET
				const split = mode === 'flash' ? 0.35 : 0.4
				if (f < split) { B = waypoint; f = f / split }
				else { A = waypoint; B = COLOR_PRESETS[nxt]; f = (f - split) / (1 - split) }
			}
			if (this.transition.t >= 1) {
				this.transition = null
				p.autopilot.preset = nxt
				this.onPresetAdvanced?.(nxt)
				A = COLOR_PRESETS[nxt]
				f = 0
			}
		}
		this.sky.lerpColors(A, B, f)
		this.clouds.lerpColors(A, B, f)
		this.body.lerpColors(A, B, f)
	}

}
