#ifdef GL_ES
    precision highp float;
#endif

uniform float uDotStride;

varying vec2 vPosition;

void main(void) {
    float dist2 = dot(vPosition, vPosition);
    float alpha = smoothstep(1., 1. - 7. / uDotStride, dist2);
    gl_FragColor = vec4(.2, .8, .6, 1.) * alpha;
}