#ifdef GL_ES
    precision highp float;
#endif

uniform float uTime;
uniform vec2  uRes;

varying vec3  vColor;

void main(void) {
    vec2 position = - 1.0 + 2.0 * gl_FragCoord.xy / uRes.xy;
    vec3 c = abs(sin(vec3(position.x * position.y + uTime) / vec3(.5, .4, .3)));
    gl_FragColor = vec4(c * vColor, 1.);
}