// uniform
uniform vec2 uResolution;
uniform float uDotStride;
uniform float uDotSize;

// instance
attribute vec2 uDotCoord;

// vertex
attribute vec2 aPosition;

// fragment
varying vec2 vPosition;

void main() {
    vPosition = aPosition;

    vec2 pos = (uDotStride * (uDotCoord + aPosition * uDotSize) - vec2(200., 500.)) / uResolution;
    gl_Position = vec4(pos, 0., 1.);
}