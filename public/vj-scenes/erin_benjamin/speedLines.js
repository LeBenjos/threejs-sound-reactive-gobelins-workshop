import * as THREE from 'three'

// Thin vertical streaks rushing up past the camera- the classic freefall
// speed cue. The field recycles in a cylinder around the CAMERA (whatever
// shot is running), and the whole layer's opacity follows energy squared:
// invisible in calm passages, a rain of streaks in the drops.
export default class SpeedLines {

	constructor(scene, params) {
		this.params = params
		this.group = new THREE.Group()
		scene.add(this.group)
		this.geometry = new THREE.PlaneGeometry(1, 1)
		this.material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
		this.populate()
	}

	populate() {
		for (let i = 0; i < this.params.lines.count; i++) {
			const mesh = new THREE.Mesh(this.geometry, this.material)
			this.respawn(mesh, 0, 0, true)
			this.group.add(mesh)
		}
	}

	rebuild() {
		this.group.clear()   // shared geometry/material stay alive
		this.populate()
	}

	respawn(mesh, cx, cz, anywhere = false) {
		const p = this.params.lines
		const angle = Math.random() * Math.PI * 2
		const r = 0.8 + Math.random() * p.radius
		mesh.position.set(cx + Math.cos(angle) * r, 0, cz + Math.sin(angle) * r)
		mesh.scale.set(0.008 + Math.random() * 0.015, 1.2 + Math.random() * 2.5, 1)
		mesh.userData.mult = 0.7 + Math.random() * 0.6   // per-streak speed variation
		return mesh
	}

	update(dt, audio, features, camera) {
		const p = this.params.lines
		this.group.visible = p.enabled
		if (!p.enabled) return
		const e = features.energy
		// Quadratic gate: the layer only exists when the music pushes.
		this.material.opacity = p.opacity * e * e
		if (this.material.opacity < 0.01) return
		const speed = p.speedBase + p.speedEnergyMult * e + features.flow * 8 * e
		const cx = camera.position.x
		const cy = camera.position.y
		const cz = camera.position.z
		for (const mesh of this.group.children) {
			mesh.position.y += dt * speed * mesh.userData.mult
			if (mesh.position.y > cy + 8) {
				this.respawn(mesh, cx, cz)
				mesh.position.y = cy - 8 - Math.random() * 4
			}
			// cylindrical billboard (same trick as the clouds)
			mesh.rotation.y = Math.atan2(cx - mesh.position.x, cz - mesh.position.z)
		}
	}

}
