import * as THREE from 'three'

import AudioFeatures from './audioFeatures.js'
import Autopilot from './autopilot.js'
import Body from './body.js'
import CameraRig from './cameraRig.js'
import Clouds from './clouds.js'
import { createDefaultParams } from './config.js'
import Director from './director.js'
import MusicEvents from './events.js'
import Gui from './gui.js'
import Motes from './motes.js'
import PostFX from './postfx.js'
import Rays from './rays.js'
import Sky from './sky.js'
import SpeedLines from './speedLines.js'

// Orchestrator: owns the renderer + the shared params tree, wires the modules
// together and drives the Analyzer lifecycle (load → init/warmup → play/stop).
export default class ErinBenjaminScene {

	constructor(audio) {
		this.audio = audio
		this.params = createDefaultParams()
		this.features = new AudioFeatures(this.params)
		this.body = new Body(this.params)
		this.renderer = null
		this.scene = null
		this.pivot = null
		this.clock = null
		this.cameraRig = null
		this.sky = null
		this.clouds = null
		this.postfx = null
		this.autopilot = null
		this.gui = null
		this.onResize = this.onResize.bind(this)
	}

	async load() {
		await this.body.load()
	}

	init() {
		this.renderer = new THREE.WebGLRenderer({ antialias: false }) // no MSAA- every frame goes through EffectComposer targets, the canvas only shows the OutputPass quad
		this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.params.quality.renderScale))
		this.renderer.setSize(innerWidth, innerHeight)
		document.body.appendChild(this.renderer.domElement)

		this.scene = new THREE.Scene()
		this.cameraRig = new CameraRig(this.params)
		this.sky = new Sky(this.scene, this.params)
		this.clouds = new Clouds(this.scene, this.params)
		this.speedLines = new SpeedLines(this.scene, this.params)
		this.motes = new Motes(this.scene, this.params)
		this.rays = new Rays(this.scene, this.params)

		this.pivot = new THREE.Group()
		this.scene.add(this.pivot)
		this.body.init(this.pivot)
		this.cameraRig.body = this.body   // head anchor for the director's face shot

		this.postfx = new PostFX(this.renderer, this.scene, this.cameraRig.camera, this.params)
		this.director = new Director(this.params, this.cameraRig)
		this.events = new MusicEvents(this.params, this.body, this.director)
		this.autopilot = new Autopilot(this.params, this.sky, this.clouds, this.body)
		this.gui = new Gui(this)
		this.autopilot.onPresetAdvanced = (idx) => this.gui.onPresetAdvanced(idx)

		addEventListener('resize', this.onResize)
	}

	warmup() {
		this.postfx.warmup()
	}

	play() {
		this.clock = new THREE.Clock()   // fresh delta on every resume- no jump after a long stop()
		this.renderer.setAnimationLoop(() => this.update())
	}

	stop() {
		this.renderer.setAnimationLoop(null)
	}

	update() {
		const a = this.audio // volume · volumeSmooth · kick · kickHard · volumeByFrequency
		const dt = this.clock.getDelta()

		// Derived signals first- everything below reads them.
		this.features.update(dt, a)
		this.body.update(dt, a, this.features, this.cameraRig.camera)

		// Autopilot next- mutates params so the audio-reactive logic below adds on top.
		if (this.params.autopilot.enabled) this.autopilot.update(dt)

		// The body breathes with the bass, and slowly drifts on air currents
		// (two incommensurate periods- reads as wandering, not oscillating).
		this.pivot.scale.setScalar(1 + this.features.bass * this.params.body.bassScale)
		this.driftPhase = (this.driftPhase ?? 0) + dt
		const drift = this.params.body.drift
		this.pivot.position.set(Math.sin(this.driftPhase * 0.31) * drift, 0, Math.sin(this.driftPhase * 0.23 + 1.3) * drift)
		// A detected drop is a MOMENT: hard palette switch + camera accent (the
		// flash itself rides features.dropPulse inside sky/bloom/rim).
		if (this.features.dropPulse > 0.9 && this.prevDropPulse <= 0.9) {
			this.autopilot.skipToNext()
			if (this.director.mode === 'base') this.director.enterAccent(this.features.energy)
		}
		this.prevDropPulse = this.features.dropPulse

		this.events.update(dt, a, this.features)
		this.director.update(dt, a, this.features)
		this.cameraRig.update(dt, a, this.features)
		this.sky.update(dt, a, this.features, this.cameraRig.camera)
		this.clouds.update(dt, a, this.features, this.cameraRig.camera)
		this.speedLines.update(dt, a, this.features, this.cameraRig.camera)
		this.motes.update(dt, this.features, this.cameraRig.camera)
		this.rays.update(dt, this.features)
		this.postfx.update(a, this.features)
		this.postfx.render(dt)
	}

	onResize() {
		this.cameraRig.resize()
		this.renderer.setSize(innerWidth, innerHeight)
		this.postfx.resize()
		this.sky.resize()
	}

}
