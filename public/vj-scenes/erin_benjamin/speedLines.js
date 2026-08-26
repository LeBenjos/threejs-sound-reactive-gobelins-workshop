import * as THREE from 'three'

// Thin vertical streaks rushing up past the camera- the classic freefall
// speed cue. The field recycles in a cylinder around the CAMERA (whatever
// shot is running), and the whole layer's opacity follows energy squared:
// invisible in calm passages, a rain of streaks in the drops. Each streak
// fades softly at both ends and across its width (a light filament, not a
// hard-edged bar) and STRETCHES with the current speed- motion-blur feel.
// Per-streak brightness variation comes from the width spread: thinner
// filaments simply read fainter.
const StreakShader = {
	uniforms: {
		globalOpacity: { value: 0 },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,
	fragmentShader: /* glsl */`
		uniform float globalOpacity;
		varying vec2 vUv;
		void main() {
			// Soft falloff along the streak (both ends) and across its width.
			float along = sin( vUv.y * 3.14159 );
			float across = 1.0 - abs( vUv.x - 0.5 ) * 2.0;
			float alpha = along * along * across * globalOpacity;
			if ( alpha < 0.01 ) discard;
			gl_FragColor = vec4( vec3( 1.0 ), alpha );
		}
	`,
}

export default class SpeedLines {

	constructor(scene, params) {
		this.params = params
		this.group = new THREE.Group()
		scene.add(this.group)
		this.geometry = new THREE.PlaneGeometry(1, 1)
		this.material = new THREE.ShaderMaterial({
			uniforms: THREE.UniformsUtils.clone(StreakShader.uniforms),
			vertexShader: StreakShader.vertexShader,
			fragmentShader: StreakShader.fragmentShader,
			transparent: true,
			depthWrite: false,
		})
		this.populate()
	}

	populate() {
		for (let i = 0; i < this.params.lines.count; i++) {
			const mesh = new THREE.Mesh(this.geometry, this.material)
			this.respawn(mesh, 0, 0)
			mesh.position.y = (Math.random() * 2 - 1) * 10
			this.group.add(mesh)
		}
	}

	rebuild() {
		this.group.clear()   // shared geometry/material stay alive
		this.populate()
	}

	respawn(mesh, cx, cz) {
		const p = this.params.lines
		const angle = Math.random() * Math.PI * 2
		const r = 0.8 + Math.random() * p.radius
		mesh.position.set(cx + Math.cos(angle) * r, 0, cz + Math.sin(angle) * r)
		mesh.userData.width = 0.006 + Math.random() * 0.014
		mesh.userData.baseLen = 1.2 + Math.random() * 2.2
		mesh.userData.mult = 0.7 + Math.random() * 0.6   // per-streak speed variation
		return mesh
	}

	update(dt, audio, features, camera) {
		const p = this.params.lines
		this.group.visible = p.enabled
		if (!p.enabled) return
		const e = features.energy
		// Quadratic gate: the layer only exists when the music pushes.
		this.material.uniforms.globalOpacity.value = p.opacity * e * e
		if (this.material.uniforms.globalOpacity.value < 0.01) return
		const speed = (p.speedBase + p.speedEnergyMult * e + features.flow * 8 * e) * features.rate
		// Faster = longer streaks (motion-blur feel).
		const stretch = 0.5 + speed * 0.09
		const cx = camera.position.x
		const cy = camera.position.y
		const cz = camera.position.z
		for (const mesh of this.group.children) {
			mesh.position.y += dt * speed * mesh.userData.mult
			mesh.scale.set(mesh.userData.width, mesh.userData.baseLen * stretch, 1)
			if (mesh.position.y > cy + 10) {
				this.respawn(mesh, cx, cz)
				mesh.position.y = cy - 10 - Math.random() * 4
			}
			// cylindrical billboard (same trick as the clouds)
			mesh.rotation.y = Math.atan2(cx - mesh.position.x, cz - mesh.position.z)
		}
	}

}
