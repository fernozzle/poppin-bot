// uniform
uniform vec2 uResolution;
uniform float uDotStride;
uniform vec2 uOffset;

// instance
attribute vec2 uDotCoord;

// vertex
attribute vec2 aPosition;

// fragment
varying vec2 vPosition;

void main() {
    vPosition = aPosition;

    vec2 pos = (uDotStride * (uDotCoord + aPosition * .4) + uOffset) / uResolution - vec2(1., 1.);
    gl_Position = vec4(pos, 0., 1.);
}