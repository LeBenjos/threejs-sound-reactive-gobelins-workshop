// Combined lens pass: barrel-distortion fisheye + RGB shift in ONE fullscreen
// pass (they were two). The shift offsets are applied in the pre-fisheye
// source space- sampling src(fisheye(uv) ± off)- which is exactly equivalent
// to the old chain (shift first, then fisheye warping the result).
//
// Fisheye: uv = c / (1 + k·r²) magnifies the centre and pulls source edges
// off-screen as k grows; k=0 is identity, k<0 reverses to pincushion.
export default {
	uniforms: {
		tDiffuse: { value: null },
		strength: { value: 0 },   // fisheye k
		amount: { value: 0 },     // rgb shift offset length
		angle: { value: 0 },      // rgb shift offset angle
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
		varying vec2 vUv;
		void main() {
			vec2 c = vUv - 0.5;
			float r2 = dot( c, c );
			vec2 uv = clamp( c / ( 1.0 + strength * r2 ) + 0.5, 0.0, 1.0 );
			vec2 off = amount * vec2( cos( angle ), sin( angle ) );
			vec4 base = texture2D( tDiffuse, uv );
			float cr = texture2D( tDiffuse, clamp( uv + off, 0.0, 1.0 ) ).r;
			float cb = texture2D( tDiffuse, clamp( uv - off, 0.0, 1.0 ) ).b;
			gl_FragColor = vec4( cr, base.g, cb, base.a );
		}
	`,
}
