import * as THREE from 'three'

export const TARGET_HEIGHT = 2   // body normalized to ~2 world units tall
export const BLOOM_LAYER = 1     // body meshes get this layer- bloomComposer renders only it
// Default total cloud count- live-tunable via params.clouds.count.
export const CLOUD_COUNT_DEFAULT = 290
export const PRESET_HOLD_SECONDS = 60   // dwell on one preset before lerping to the next (at autopilot speed=1)

// Discrete parallax depth layers (near -> horizon). Each band gets its own
// radius/scale/height range and speed multiplier. Far layers are slower and
// larger, near ones are fast and small: same world rise speed × per-layer
// multiplier × audio reactivity produces the layered parallax. `countShare`
// splits the total count across layers (must roughly sum to 1). Weights are
// biased toward far layers so the depth dominates the visual.
export const CLOUD_LAYERS = [
	{ radiusMin: 2, radiusMax: 6, yRange: 8, scaleMin: 1.0, scaleMax: 2.2, speedMult: 1.9, countShare: 0.18 },
	{ radiusMin: 5, radiusMax: 12, yRange: 12, scaleMin: 1.8, scaleMax: 3.8, speedMult: 1.0, countShare: 0.22 },
	{ radiusMin: 11, radiusMax: 24, yRange: 20, scaleMin: 3.2, scaleMax: 6.5, speedMult: 0.55, countShare: 0.20 },
	{ radiusMin: 22, radiusMax: 48, yRange: 32, scaleMin: 5.5, scaleMax: 13.0, speedMult: 0.28, countShare: 0.17 },
	{ radiusMin: 42, radiusMax: 85, yRange: 50, scaleMin: 9.0, scaleMax: 22.0, speedMult: 0.13, countShare: 0.13 },
	// Horizon backdrop: few but HUGE and near-static- fills the far background
	// so wide shots never face a bare sky gradient.
	{ radiusMin: 80, radiusMax: 160, yRange: 70, scaleMin: 22.0, scaleMax: 45.0, speedMult: 0.06, countShare: 0.10 },
]

// Sky + cloud color palettes. Autopilot cycles between them (smooth lerp) when
// colorCycle is on; the GUI dropdown picks one manually when it's off.
// Each preset defines: sky top/bottom gradient, sky's internal FBM cloud tint,
// the 3D cloud sprite tint, and the body's rim color- picked to CONTRAST with
// that preset's sky so the silhouette always separates from the background.
export const COLOR_PRESETS = [
	{
		name: 'Daylight',
		skyTop: new THREE.Color(0x6fb4ff), skyBottom: new THREE.Color(0xbfe1ff),
		skyCloudColor: new THREE.Color(0xffffff), cloudsColor: new THREE.Color(0xffffff),
		bodyRim: new THREE.Color(0xff6a00),
	},
	{
		name: 'Sunset',
		skyTop: new THREE.Color(0xeca36a), skyBottom: new THREE.Color(0xd895c6),
		skyCloudColor: new THREE.Color(0xf4aea6), cloudsColor: new THREE.Color(0xeba599),
		bodyRim: new THREE.Color(0x00e5ff),
	},
	{
		name: 'Twilight',
		skyTop: new THREE.Color(0x383679), skyBottom: new THREE.Color(0x6c558d),
		skyCloudColor: new THREE.Color(0x78528c), cloudsColor: new THREE.Color(0x58407b),
		bodyRim: new THREE.Color(0xffd166),
	},
	{
		name: 'Aurora',
		skyTop: new THREE.Color(0x041a36), skyBottom: new THREE.Color(0x118a72),
		skyCloudColor: new THREE.Color(0x9affe6), cloudsColor: new THREE.Color(0x55ffd0),
		bodyRim: new THREE.Color(0xff4fd8),
	},
]

// One mutable params tree per scene instance- mutated live by the GUI and the
// autopilot, read every frame by the modules' update() methods.
export function createDefaultParams() {
	return {
		// AudioFeatures calibration: quiet/loud bracket the spectrum level as
		// FRACTIONS of the track's own recent peak (watch the GUI meters);
		// attack/release are the energy envelope's ramp-up / settle times (seconds);
		// floor is the share of base background speed kept when the music is silent.
		audio: { quiet: 0.25, loud: 0.75, attack: 0.4, release: 2.0, floor: 0.15 },
		autopilot: { enabled: true, speed: 0.5, colorCycle: true, preset: 0, switchInterval: PRESET_HOLD_SECONDS },
		// Director (base flow + hard-kick accents): a hard kick punches to an
		// accent shot when energy >= minEnergy, the cooldown has elapsed and the
		// accentChance roll passes; the accent holds accentMin..accentMax seconds
		// then cuts back to the base flow. zoomDrift: chance an accent slowly
		// zooms during its run (half in, half out).
		// chainChance: an expiring accent may cut straight to another shot
		// instead of returning to base (geometric decay- base stays the norm).
		director: { enabled: true, accentChance: 0.6, accentCooldown: 6, accentMin: 2.5, accentMax: 5, minEnergy: 0.45, zoomDrift: 0.7, chainChance: 0.35 },
		// Rare animation events (backflip / backfalling): low chance + long
		// cooldown on the hard kicks ⇒ roughly one event every 1.5-2.5 min.
		// Rarity is the point.
		events: { enabled: true, chance: 0.08, cooldown: 45, minEnergy: 0.3 },
		body: {
			material: 'rim',
			bassScale: 0.55,
			drift: 0.35,   // lateral wind-drift amplitude of the whole body
			rim: { baseColor: '#d5d5dd', power: 3.0, strength: 1.4, kickHardMult: 1.5, shading: 0.45, ambient: 0.65 },
			normal: { wireframe: false, flatShading: false },
			basic: { color: '#ffffff', wireframe: false },
			wireframe: { color: '#ffffff' },
			depth: { wireframe: false },
		},
		// shake: wind turbulence amplitude (energy²-gated); rollAmp/rollSpeed:
		// slow horizon roll- freefall has no up.
		camera: { baseSpeed: 0.2, kickMult: 2.0, verticalSpeed: 0.26, verticalAmp: 0.85, verticalEnergyMult: 0.5, shake: 0.05, rollAmp: 0.12, rollSpeed: 0.06 },
		sky: {
			enabled: true,
			scrollSpeedBase: 0.36,
			scrollEnergyMult: 0.27,
			scrollKickMult: 0.7,
			cloudScale: 8.0,
			brightnessBase: 0.57,
			brightnessEnergyMult: 0.6,
			topColor: '#6fb4ff',
			bottomColor: '#bfe1ff',
			cloudColor: '#ffffff',
		},
		clouds: {
			enabled: true,
			count: CLOUD_COUNT_DEFAULT,
			riseSpeedBase: 1.6,
			riseEnergyMult: 2.4,
			riseKickMult: 4.0,
			opacity: 0.85,
			color: '#ffffff',
		},
		// Freefall speed streaks near the camera- opacity gated by energy².
		lines: { enabled: true, count: 70, opacity: 0.4, speedBase: 5, speedEnergyMult: 16, radius: 6 },
		// threshold must stay ABOVE the white body's max luminance (~0.70 with the
		// #d5d5dd base): only the rim-boosted edges cross it, so the bloom halos
		// the contour instead of flaring the whole body.
		bloom: { enabled: true, strengthBase: 0.15, energyMult: 0.35, kickHardMult: 2.2, radius: 1.50, threshold: 0.85 },
		afterimage: { enabled: true, dampBase: 0.85, kickHardMult: 0.2 },
		rgbShift: { enabled: true, highMult: 0.006, angle: 1.98 },
		fisheye: { enabled: true, strengthBase: 1.0, energyMult: 0.45, kickHardMult: 1.3 },
	}
}
