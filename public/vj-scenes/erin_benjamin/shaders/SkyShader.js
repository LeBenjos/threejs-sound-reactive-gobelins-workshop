import * as THREE from 'three'

// Fullscreen background quad rendered in clip space (vertex bypasses projection),
// so the sky is screen-stable regardless of camera orbit. Vertical UV scroll +
// FBM noise = clouds rising = sensation of falling.
export default {
	uniforms: {
		time: { value: 0 },
		panX: { value: 0 },            // horizontal world-pan- follows the camera azimuth (sky.js)
		churnTime: { value: 0 },       // warp clock- shapes boil slowly, energy-driven (sky.js)
		cloudScale: { value: 3.0 },
		coverageShift: { value: 0 },   // raises the FBM threshold- sparser clouds at high energy
		brightness: { value: 0.95 },
		resolution: { value: new THREE.Vector2(1, 1) },
		skyTop: { value: new THREE.Color(0x6fb4ff) },
		skyBottom: { value: new THREE.Color(0xbfe1ff) },
		cloudColor: { value: new THREE.Color(0xffffff) },
		// Second palette + front for the 'wipe' transition: the new colors grow
		// from screen center outward. wipe stays 0 outside transitions.
		skyTopB: { value: new THREE.Color(0x6fb4ff) },
		skyBottomB: { value: new THREE.Color(0xbfe1ff) },
		cloudColorB: { value: new THREE.Color(0xffffff) },
		wipe: { value: 0 },
		wipeMode: { value: 0 },   // 0 circle · 1 curtain · 2 iris · 3 dissolve
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
		uniform float panX;
		uniform float churnTime;
		uniform float cloudScale;
		uniform float coverageShift;
		uniform float brightness;
		uniform vec2 resolution;
		uniform vec3 skyTop;
		uniform vec3 skyBottom;
		uniform vec3 cloudColor;
		uniform vec3 skyTopB;
		uniform vec3 skyBottomB;
		uniform vec3 cloudColorB;
		uniform float wipe;
		uniform float wipeMode;
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
			// panX couples the background to the camera's orbital sweep (set in
			// sky.js), so the FBM pans WITH the 3D sprites instead of sitting
			// frozen behind their arcs. The vertical scroll stays the fall.
			uv.x += panX;
			uv.y -= time;

			// Spatial palette transitions: the B palette advances behind a moving
			// front (metric picked by wipeMode). Skipped entirely outside
			// transitions (wipe stays 0).
			float wm = 0.0;
			if ( wipe > 0.0 ) {
				float aspectW = resolution.x / resolution.y;
				float wd = length( vec2( ( vUv.x - 0.5 ) * aspectW, vUv.y - 0.5 ) );
				if ( wipeMode < 0.5 ) {          // circle bursting from center
					float front = wipe * 1.25;
					wm = 1.0 - smoothstep( front - 0.18, front, wd );
				} else if ( wipeMode < 1.5 ) {   // curtain rising with the fall stream
					float front = wipe * 1.3;
					wm = 1.0 - smoothstep( front - 0.25, front, vUv.y );
				} else if ( wipeMode < 2.5 ) {   // inverse iris- closes on the center
					float inner = ( 1.0 - wipe ) * 1.25 - 0.18;
					wm = smoothstep( inner, inner + 0.18, wd );
				} else {                         // organic FBM dissolve
					float th = 1.05 - wipe * 1.2;
					wm = smoothstep( th - 0.08, th + 0.08, fbm( vec2( vUv.x * aspectW, vUv.y ) * 3.5 ) );
				}
			}
			vec3 topC = mix( skyTop, skyTopB, wm );
			vec3 bottomC = mix( skyBottom, skyBottomB, wm );
			vec3 cloudC = mix( cloudColor, cloudColorB, wm );

			vec3 sky = mix( bottomC, topC, vUv.y );
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
			vec3 shadowCol = mix( cloudC, topC, 0.45 ) * 0.8;
			vec3 cloudCol = mix( cloudC * brightness, shadowCol, shadow );
			vec3 col = mix( sky, cloudCol, clouds );
			gl_FragColor = vec4( col, 1.0 );
		}
	`,
}
