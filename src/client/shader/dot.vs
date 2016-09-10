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

    float radius = .4 * smoothstep(.0, .6, uTime - aDotTime);
    vec2 pos = uDotStride * (aDotCoord + aPosition * radius) + uOffset; // In pixels
    gl_Position = vec4(pos / uResolution - 1., 0., 1.);
}