import * as THREE from 'three'

// Fullscreen background quad rendered in clip space (vertex bypasses projection),
// so the sky is screen-stable regardless of camera orbit. Vertical UV scroll +
// FBM noise = clouds rising = sensation of falling.
export default {
	uniforms: {
		time: { value: 0 },
		churnTime: { value: 0 },       // warp clock- shapes boil slowly, energy-driven (sky.js)
		cloudScale: { value: 3.0 },
		coverageShift: { value: 0 },   // raises the FBM threshold- sparser clouds at high energy
		brightness: { value: 0.95 },
		resolution: { value: new THREE.Vector2(1, 1) },
		skyTop: { value: new THREE.Color(0x6fb4ff) },
		skyBottom: { value: new THREE.Color(0xbfe1ff) },
		cloudColor: { value: new THREE.Color(0xffffff) },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = vec4( position.xy, 1.0, 1.0 );
		}
	`,
	fragmentShader: /* glsl */`
		uniform float time;
		uniform float churnTime;
		uniform float cloudScale;
		uniform float coverageShift;
		uniform float brightness;
		uniform vec2 resolution;
		uniform vec3 skyTop;
		uniform vec3 skyBottom;
		uniform vec3 cloudColor;
		varying vec2 vUv;

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
			for ( int i = 0; i < 5; i ++ ) {
				v += a * noise( p );
				p *= 2.0;
				a *= 0.5;
			}
			return v;
		}

		void main() {
			// Aspect correction keeps clouds round; subtracting from y samples lower
			// rows over time, which reads as upward motion.
			vec2 uv = vUv;
			uv.x *= resolution.x / resolution.y;
			uv.y -= time;

			vec3 sky = mix( skyBottom, skyTop, vUv.y );
			// Two scales: the large one places cumulus masses, the fine one adds
			// detail only INSIDE those masses (mass-modulated)- no more uniform
			// full-screen grain. The mass field is domain-warped (it curls on
			// itself: billowing shapes, not raw noise) and churnTime drifts the
			// warp so the masses boil slowly.
			vec2 m = uv * cloudScale * 0.35;
			vec2 warp = vec2( fbm( m + vec2( 0.0, churnTime ) ), fbm( m + vec2( 5.2, 1.3 + churnTime ) ) );
			vec2 mw = m + ( warp - 0.5 ) * 1.2;
			float mass = fbm( mw );
			float detail = fbm( uv * cloudScale + vec2( 37.2, 11.7 ) );
			float density = mass + ( detail - 0.5 ) * 0.55 * mass;
			// coverageShift raises the window at high energy: only the dense FBM
			// cores survive, so the sky gradient stays visible behind the speed
			// streaks instead of drowning under a full-frame noise wall.
			float clouds = smoothstep( 0.36 + coverageShift, 0.68 + coverageShift, density );
			// Top-lit self-shadowing: a denser field just above means this pixel is
			// an underside. The shadow tint comes from the preset palette (cloud
			// color pulled toward skyTop), so the color cycle carries through.
			float above = fbm( mw + vec2( 0.0, 0.12 * cloudScale * 0.35 ) );
			float shadow = smoothstep( 0.0, 0.25, above - mass ) * 0.55;
			vec3 shadowCol = mix( cloudColor, skyTop, 0.45 ) * 0.8;
			vec3 cloudCol = mix( cloudColor * brightness, shadowCol, shadow );
			vec3 col = mix( sky, cloudCol, clouds );
			gl_FragColor = vec4( col, 1.0 );
		}
	`,
}
