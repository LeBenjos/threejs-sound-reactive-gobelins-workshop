import * as THREE from 'three'

// Dark silhouette + fresnel rim: the body reads as a shape against the bright
// sky, with a colored glow hugging its contour (view-facing surfaces stay
// dark, grazing angles light up). The rim color contrasts with the active
// color preset and rimStrength pulses on hard kicks- the selective bloom
// then picks up the bright rim, so the glow halos without whiting the body.
// Skinning chunks make it work on the animated SkinnedMesh (three supplies
// the bone uniforms for any material on a SkinnedMesh).
export default {
	uniforms: {
		baseColor: { value: new THREE.Color(0x0b0b14) },
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
			vec3 col = baseColor + rimColor * fresnel * rimStrength;
			gl_FragColor = vec4( col, 1.0 );
		}
	`,
}
