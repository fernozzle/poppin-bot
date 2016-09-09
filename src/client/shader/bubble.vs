// uniform
uniform vec2 uResolution;
uniform float uBubbleStride;

// instance
uniform vec2 uBubbleCoord;

// vertex
attribute vec2 aPosition;

// fragment
varying vec2 vPosition;

void main() {
    vPosition = aPosition;

    vec2 pos = uBubbleStride * (uBubbleCoord + aPosition * .8) / uResolution;
    gl_Position = vec4(pos, 0., 1.);
}