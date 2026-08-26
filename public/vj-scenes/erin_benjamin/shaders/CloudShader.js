import * as THREE from 'three'

// Per-cloud billboard quad: soft radial falloff masked by FBM for a puffy,
// non-uniform alpha. Seed uniform varies the noise per instance.
export default {
	uniforms: {
		seed: { value: 0 },
		opacity: { value: 0.85 },
		time: { value: 0 },        // churn clock- integrated in clouds.js, energy-driven
		noiseRot: { value: 0 },    // per-sprite noise-domain rotation (radians)
		shadowMult: { value: 1 },  // per-sprite shadow depth variation
		cloudColor: { value: new THREE.Color(0xffffff) },
		shadowColor: { value: new THREE.Color(0xbfbfbf) },   // kept in-palette by clouds.js (preset skyTop pull)
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
		uniform float time;
		uniform float noiseRot;
		uniform float shadowMult;
		uniform vec3 cloudColor;
		uniform vec3 shadowColor;
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
			vec2 p = vUv - 0.5;
			vec2 seedOff = vec2( seed * 7.3, seed * 2.1 );
			// Per-sprite rotation of the noise domain- breaks the clone look
			// without touching the (screen-up) lighting below.
			float ca = cos( noiseRot );
			float sa = sin( noiseRot );
			vec2 w = vec2( ca * p.x - sa * p.y, sa * p.x + ca * p.y ) * 3.0 + seedOff;
			// Domain warp: the field curls on itself- organic billows instead of
			// raw noise- and time drifts the warp so the cloud churns from the
			// inside (energy-driven clock, integrated in clouds.js).
			vec2 warp = vec2( fbm( w + vec2( 0.0, time ) ), fbm( w + vec2( 5.2, 1.3 + time ) ) );
			float n = fbm( w + ( warp - 0.5 ) * 1.4 );
			// FBM-warped radius: the silhouette turns jagged and organic instead of
			// showing the quad's circular falloff. Dense core, soft ragged edge.
			float r = length( p ) * 2.0 + ( n - 0.5 ) * 0.8;
			float body = 1.0 - smoothstep( 0.1, 0.95, r );
			float puff = smoothstep( 0.16, 0.55, n );
			// Top-lit modeling, same rule as the sky shader: a denser field just
			// above means this pixel is an underside. The offset is rotated into
			// the noise domain so "up" stays screen-up, and the smooth warp is
			// reused- close enough at this distance. (1-vUv.y) biases the lower
			// half darker.
			float above = fbm( w + vec2( -sa, ca ) * 0.48 + ( warp - 0.5 ) * 1.4 );
			float delta = n - above;
			float shadow = min( 1.0, ( smoothstep( 0.0, 0.3, -delta ) * 0.6 + ( 1.0 - vUv.y ) * 0.25 ) * shadowMult );
			vec3 col = mix( cloudColor, shadowColor, shadow );
			// Silver lining: where density drops toward the light (delta > 0) the
			// top edge catches it- pushed toward white so it reads as sun, echoing
			// the body's rim language.
			float lining = smoothstep( 0.1, 0.4, delta ) * ( 1.0 - shadow );
			col += mix( cloudColor, vec3( 1.0 ), 0.5 ) * lining * 0.3;
			// The close camera shots orbit INSIDE the near cloud band, so sprites
			// can cross the lens: without this they pop in as huge dark blobs the
			// instant the billboard flips past the camera. Dissolve them over the
			// last 2 world units instead- fully gone before the near plane.
			float nearFade = smoothstep( 0.7, 2.0, length( vViewPos ) );
			float alpha = body * puff * opacity * nearFade;
			if ( alpha < 0.01 ) discard;   // avoid sorting artifacts on near-empty pixels
			gl_FragColor = vec4( col, alpha );
		}
	`,
}
