// Combined lens pass: barrel-distortion fisheye + RGB shift + drop shockwave
// in ONE fullscreen pass. The shift offsets are applied in the pre-fisheye
// source space- sampling src(fisheye(uv) ± off)- which is exactly equivalent
// to the old two-pass chain (shift first, then fisheye warping the result).
//
// Fisheye: uv = c / (1 + k·r²) magnifies the centre and pulls source edges
// off-screen as k grows; k=0 is identity, k<0 reverses to pincushion.
// Shockwave: a gaussian ring of radial displacement expanding from screen
// center (radius shockR, strength shockAmp- driven by the drop pulse in
// postfx.js), with chromatic aberration riding its front. Zero cost when
// shockAmp is 0.
export default {
	uniforms: {
		tDiffuse: { value: null },
		strength: { value: 0 },   // fisheye k
		amount: { value: 0 },     // rgb shift offset length
		angle: { value: 0 },      // rgb shift offset angle
		shockR: { value: 0 },     // shockwave ring radius (aspect-corrected screen units)
		shockAmp: { value: 0 },   // shockwave displacement strength
		aspect: { value: 1 },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,
	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse;
		uniform float strength;
		uniform float amount;
		uniform float angle;
		uniform float shockR;
		uniform float shockAmp;
		uniform float aspect;
		varying vec2 vUv;
		void main() {
			vec2 c = vUv - 0.5;
			float r2 = dot( c, c );
			vec2 uv = clamp( c / ( 1.0 + strength * r2 ) + 0.5, 0.0, 1.0 );
			vec2 off = amount * vec2( cos( angle ), sin( angle ) );
			vec2 chroma = vec2( 0.0 );
			if ( shockAmp > 0.0001 ) {
				// Expanding gaussian ring: pixels on the front get pushed outward,
				// and the chromatic split rides the wave.
				float d = length( vec2( c.x * aspect, c.y ) );
				vec2 rd = d < 1e-4 ? vec2( 0.0 ) : c / d;
				// Main front + a trailing echo at half amplitude: double detonation.
				float ring = exp( -pow( ( d - shockR ) * 11.0, 2.0 ) )
					+ 0.45 * exp( -pow( ( d - shockR * 0.55 ) * 11.0, 2.0 ) );
				uv = clamp( uv + rd * ring * shockAmp, 0.0, 1.0 );
				chroma = rd * ring * shockAmp * 0.5;
			}
			vec4 base = texture2D( tDiffuse, uv );
			float cr = texture2D( tDiffuse, clamp( uv + off + chroma, 0.0, 1.0 ) ).r;
			float cb = texture2D( tDiffuse, clamp( uv - off - chroma, 0.0, 1.0 ) ).b;
			gl_FragColor = vec4( cr, base.g, cb, base.a );
		}
	`,
}
