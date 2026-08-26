import { COLOR_PRESETS } from './config.js'

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
		this.presetTimer = 0   // seconds spent on current preset (color cycle)
		this.onPresetAdvanced = null   // wired by the scene- lets the GUI mirror the cycle
	}

	// Restart the dwell window from the current preset (manual GUI picks call this).
	resetPresetTimer() {
		this.presetTimer = 0
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

		// Preset cycle: dwell `switchInterval` seconds on each preset, smooth-lerp to
		// the next. `params.autopilot.preset` is the SOURCE OF TRUTH for the current
		// preset and is advanced + reflected in the GUI dropdown as the cycle ticks-
		// so the user always sees which preset is active. Manual dropdown picks reset
		// the timer (resetPresetTimer) so the lerp starts fresh from the chosen one.
		const interval = Math.max(0.5, p.autopilot.switchInterval)
		this.presetTimer += dt * p.autopilot.speed
		if (this.presetTimer >= interval) {
			this.presetTimer -= interval
			p.autopilot.preset = (p.autopilot.preset + 1) % COLOR_PRESETS.length
			this.onPresetAdvanced?.(p.autopilot.preset)
		}
		const cur = p.autopilot.preset
		const nxt = (cur + 1) % COLOR_PRESETS.length
		const f = this.presetTimer / interval
		const smooth = f * f * (3 - 2 * f)   // ease so each preset feels held, not constantly drifting
		this.sky.lerpColors(COLOR_PRESETS[cur], COLOR_PRESETS[nxt], smooth)
		this.clouds.lerpColors(COLOR_PRESETS[cur], COLOR_PRESETS[nxt], smooth)
		this.body.lerpColors(COLOR_PRESETS[cur], COLOR_PRESETS[nxt], smooth)
	}

}
