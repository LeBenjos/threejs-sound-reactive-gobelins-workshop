// Barrel-distortion fisheye. Sampling formula uv = c / (1 + k·r²) magnifies
// the centre and pulls source edges off-screen as k grows; k=0 is identity,
// k<0 reverses to pincushion (corners go out of bounds, clamped to edge).
export default {
	uniforms: {
		tDiffuse: { value: null },
		strength: { value: 0 },
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
		varying vec2 vUv;
		void main() {
			vec2 c = vUv - 0.5;
			float r2 = dot( c, c );
			vec2 uv = c / ( 1.0 + strength * r2 ) + 0.5;
			gl_FragColor = texture2D( tDiffuse, clamp( uv, 0.0, 1.0 ) );
		}
	`,
}
