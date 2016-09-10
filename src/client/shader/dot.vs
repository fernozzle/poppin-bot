// uniform
uniform vec2 uResolution;
uniform float uTime;
uniform float uDotStride;
uniform vec2 uOffset;

// instance
attribute vec2 aDotCoord;
attribute float aDotTime;

// vertex
attribute vec2 aPosition;

// fragment
varying vec2 vPosition;

void main() {
    vPosition = aPosition;

    float fac = smoothstep(1., .0, uTime - aDotTime);
    float radius = step(.001, aDotTime) * .4 * (1. - fac * fac * fac * fac * fac);
    vec2 pos = uDotStride * (aDotCoord + aPosition * radius) + uOffset; // In pixels
    gl_Position = vec4(pos / uResolution - 1., 0., 1.);
}