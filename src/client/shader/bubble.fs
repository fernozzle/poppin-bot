#ifdef GL_ES
    precision highp float;
#endif

uniform float uBubbleStride;

varying vec2 vPosition;

void main(void) {
    float dist2 = dot(vPosition, vPosition);
    float alpha = smoothstep(1., 1. - 7. / uBubbleStride, dist2);
    //alpha = 1.;
    gl_FragColor = vec4(0., 0., 0., alpha);
}