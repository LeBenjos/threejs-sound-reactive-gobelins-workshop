import * as THREE from 'three'

// Per-cloud billboard quad: soft radial falloff masked by FBM for a puffy,
// non-uniform alpha. Seed uniform varies the noise per instance.
export default {
	uniforms: {
		seed: { value: 0 },
		opacity: { value: 0.85 },
		cloudColor: { value: new THREE.Color(0xffffff) },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		varying vec3 vViewPos;
		void main() {
			vUv = uv;
			vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
			vViewPos = mvPosition.xyz;
			gl_Position = projectionMatrix * mvPosition;
		}
	`,
	fragmentShader: /* glsl */`
		uniform float seed;
		uniform float opacity;
		uniform vec3 cloudColor;
		varying vec2 vUv;
		varying vec3 vViewPos;

		float hash( vec2 p ) {
			return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
		}
		float noise( vec2 p ) {
			vec2 i = floor( p );
			vec2 f = fract( p );
			f = f * f * ( 3.0 - 2.0 * f );
			return mix(
				mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ),
				mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ),
				f.y
			);
		}
		float fbm( vec2 p ) {
			float v = 0.0;
			float a = 0.5;
			for ( int i = 0; i < 4; i ++ ) {
				v += a * noise( p );
				p *= 2.0;
				a *= 0.5;
			}
			return v;
		}

		void main() {
			vec2 uv = vUv - 0.5;
			float r = length( uv ) * 2.0;
			// Radial soft mask (1 at center, 0 at edge) keeps the quad invisible.
			float disk = 1.0 - smoothstep( 0.0, 1.0, r );
			// Per-instance noise sample with seed offset for variation.
			float n = fbm( vUv * 3.0 + vec2( seed * 7.3, seed * 2.1 ) );
			float puff = smoothstep( 0.3, 0.7, n );
			// The close camera shots orbit INSIDE the near cloud band, so sprites
			// can cross the lens: without this they pop in as huge dark blobs the
			// instant the billboard flips past the camera. Dissolve them over the
			// last 2 world units instead- fully gone before the near plane.
			float nearFade = smoothstep( 0.7, 2.0, length( vViewPos ) );
			float alpha = disk * puff * opacity * nearFade;
			if ( alpha < 0.01 ) discard;   // avoid sorting artifacts on near-empty pixels
			gl_FragColor = vec4( cloudColor, alpha );
		}
	`,
}
