import * as THREE from 'three'

// White body + colored fresnel rim: view-facing surfaces stay bright (with a
// soft facing-based shading so the white reads as volume, not a flat blob),
// grazing angles tint toward the rim color- a saturated contour that
// contrasts with the active preset's sky and separates the body from the
// white clouds. rimStrength pulses on hard kicks; the rim pushes edge
// luminance past the (raised) bloom threshold, so only the contour halos.
// Skinning chunks make it work on the animated SkinnedMesh (three supplies
// the bone uniforms for any material on a SkinnedMesh).
export default {
	uniforms: {
		baseColor: { value: new THREE.Color(0xe8e8f0) },
		rimColor: { value: new THREE.Color(0xff6a00) },
		rimPower: { value: 2.5 },
		rimStrength: { value: 1.2 },
	},
	vertexShader: /* glsl */`
		#include <common>
		#include <skinning_pars_vertex>
		varying vec3 vNormal;
		varying vec3 vViewDir;
		void main() {
			#include <beginnormal_vertex>
			#include <skinbase_vertex>
			#include <skinnormal_vertex>
			#include <begin_vertex>
			#include <skinning_vertex>
			vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
			vNormal = normalize( normalMatrix * objectNormal );
			vViewDir = normalize( - mvPosition.xyz );
			gl_Position = projectionMatrix * mvPosition;
		}
	`,
	fragmentShader: /* glsl */`
		uniform vec3 baseColor;
		uniform vec3 rimColor;
		uniform float rimPower;
		uniform float rimStrength;
		varying vec3 vNormal;
		varying vec3 vViewDir;
		void main() {
			float facing = max( dot( normalize( vNormal ), normalize( vViewDir ) ), 0.0 );
			float fresnel = pow( 1.0 - facing, rimPower );
			// Soft facing shading gives the white some volume; the colored rim adds on top.
			vec3 col = baseColor * ( 0.72 + 0.28 * facing ) + rimColor * fresnel * rimStrength;
			gl_FragColor = vec4( col, 1.0 );
		}
	`,
}
