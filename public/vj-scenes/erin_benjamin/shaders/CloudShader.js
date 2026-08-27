import * as THREE from 'three'

// Instanced cloud sprite: ONE draw call for the whole field. Per-sprite
// variation (seed, noise rotation, shadow depth, edge fade, position, aspect
// scale) rides instanced attributes; palette colors, churn clock and global
// opacity are shared uniforms. The vertex builds a point-facing billboard
// with world-up (same orientation lookAt gave the per-mesh version), and the
// fragment is the original puffy FBM: domain warp, top-lit modeling in the
// preset's palette, silver lining, near-lens dissolve.
export default {
	uniforms: {
		opacity: { value: 0.85 },
		time: { value: 0 },        // churn clock- integrated in clouds.js, energy-driven
		cloudColor: { value: new THREE.Color(0xffffff) },
		shadowColor: { value: new THREE.Color(0xbfbfbf) },   // kept in-palette by clouds.js (preset skyTop pull)
		hazeColor: { value: new THREE.Color(0xbfe1ff) },     // the preset's horizon- lerped with the color cycle
		hazeAmount: { value: 0.7 },
		// Second palette + front for the 'wipe' transition (see SkyShader)-
		// wipe stays 0 outside transitions.
		cloudColorB: { value: new THREE.Color(0xffffff) },
		shadowColorB: { value: new THREE.Color(0xbfbfbf) },
		hazeColorB: { value: new THREE.Color(0xbfe1ff) },
		wipe: { value: 0 },
		aspect: { value: 1 },
	},
	vertexShader: /* glsl */`
		attribute vec3 aOffset;
		attribute vec2 aScale;
		attribute vec3 aSprite;   // x: seed · y: noise rotation · z: shadow depth
		attribute float aFade;    // band-edge envelope, updated per frame
		varying vec2 vUv;
		varying vec3 vViewPos;
		varying vec3 vSprite;
		varying float vFade;
		varying vec4 vClip;
		void main() {
			vUv = uv;
			vSprite = aSprite;
			vFade = aFade;
			// The group carries the camera's vertical lock- bring the anchor
			// through the model matrix before billboarding around it.
			vec3 anchor = ( modelMatrix * vec4( aOffset, 1.0 ) ).xyz;
			vec3 fwd = normalize( cameraPosition - anchor );
			// World-up billboard (matches lookAt with default up); fall back to Z
			// when looking straight down/up, where the cross degenerates.
			vec3 upRef = abs( fwd.y ) > 0.99 ? vec3( 0.0, 0.0, 1.0 ) : vec3( 0.0, 1.0, 0.0 );
			vec3 right = normalize( cross( upRef, fwd ) );
			vec3 up = cross( fwd, right );
			vec3 world = anchor + right * position.x * aScale.x + up * position.y * aScale.y;
			vec4 mv = viewMatrix * vec4( world, 1.0 );
			vViewPos = mv.xyz;
			gl_Position = projectionMatrix * mv;
			vClip = gl_Position;
		}
	`,
	fragmentShader: /* glsl */`
		uniform float opacity;
		uniform float time;
		uniform vec3 cloudColor;
		uniform vec3 shadowColor;
		uniform vec3 hazeColor;
		uniform float hazeAmount;
		uniform vec3 cloudColorB;
		uniform vec3 shadowColorB;
		uniform vec3 hazeColorB;
		uniform float wipe;
		uniform float aspect;
		varying vec2 vUv;
		varying vec3 vViewPos;
		varying vec3 vSprite;
		varying float vFade;
		varying vec4 vClip;

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
		// 2-octave variant for the shading probe- the shadow term is smoothstepped
		// anyway, the missing high octaves are invisible there and it cuts the
		// sprite's ALU noticeably (the field is the scene's biggest fragment cost).
		// +0.09375 restores the dropped octaves' expected value, so delta
		// against the 4-octave fbm keeps an unbiased mean.
		float fbm2( vec2 p ) {
			return 0.5 * noise( p ) + 0.25 * noise( p * 2.0 ) + 0.09375;
		}

		void main() {
			float seed = vSprite.x;
			float noiseRot = vSprite.y;
			float shadowMult = vSprite.z;
			// Wipe transition: same screen-space metric as the sky shader, so the
			// front crosses background and sprites as ONE circle.
			vec2 ndc = vClip.xy / vClip.w;
			float wd = length( vec2( ndc.x * aspect, ndc.y ) ) * 0.5;
			float front = wipe * 1.25;
			float wm = 1.0 - smoothstep( front - 0.18, front, wd );
			vec3 cloudColorM = mix( cloudColor, cloudColorB, wm );
			vec3 shadowColorM = mix( shadowColor, shadowColorB, wm );
			vec3 hazeColorM = mix( hazeColor, hazeColorB, wm );
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
			float above = fbm2( w + vec2( -sa, ca ) * 0.48 + ( warp - 0.5 ) * 1.4 );
			float delta = n - above;
			float shadow = min( 1.0, ( smoothstep( 0.0, 0.3, -delta ) * 0.6 + ( 1.0 - vUv.y ) * 0.25 ) * shadowMult );
			vec3 col = mix( cloudColorM, shadowColorM, shadow );
			// Silver lining: where density drops toward the light (delta > 0) the
			// top edge catches it- pushed toward white so it reads as sun, echoing
			// the body's rim language.
			float lining = smoothstep( 0.1, 0.4, delta ) * ( 1.0 - shadow );
			col += mix( cloudColorM, vec3( 1.0 ), 0.5 ) * lining * 0.3;
			// Aerial perspective: distant sprites melt toward the preset's horizon
			// color and thin out- the depth turns milky instead of staying crisp
			// to the last layer. THE dreamy ingredient.
			float dist = length( vViewPos );
			float haze = smoothstep( 25.0, 110.0, dist ) * hazeAmount;
			col = mix( col, hazeColorM, haze );
			// The close camera shots orbit INSIDE the near cloud band, so sprites
			// can cross the lens: without this they pop in as huge dark blobs the
			// instant the billboard flips past the camera. Dissolve them over the
			// last 2 world units instead- fully gone before the near plane.
			float nearFade = smoothstep( 0.7, 2.0, dist );
			float alpha = body * puff * opacity * vFade * nearFade * ( 1.0 - haze * 0.35 );
			if ( alpha < 0.01 ) discard;   // avoid sorting artifacts on near-empty pixels
			gl_FragColor = vec4( col, alpha );
		}
	`,
}
