import Emoji from '../core/Emoji';
import * as firebase from 'firebase';
declare const d3: any;
/*
// Initialize Firebase
var config = {
    apiKey: "AIzaSyB-fx2BFroqOBHleP59wvpWhST0gdcVpu4",
    authDomain: "poppin-bot.firebaseapp.com",
    databaseURL: "https://poppin-bot.firebaseio.com",
    storageBucket: "poppin-bot.appspot.com",
};
firebase.initializeApp(config);
const root = firebase.database().ref();

const serverID = '199257044161789952';
root.child(`messages/base/${serverID}`).orderByKey().limitToLast(100)
.on('child_added', (snap) => {
    root.child(`messages/text/${serverID}/${snap.key}`).once('value')
    .then((snap:firebase.database.DataSnapshot) => {
        console.log(snap.val());
    });
});
*/

const dpr = window.devicePixelRatio;
const container = d3.select('#container')
    .datum((d, i, s) => s[i].getBoundingClientRect());
const canvas = container.select('canvas')
    .attr ('width',  rect =>  rect.width * dpr)
    .attr ('height', rect => rect.height * dpr)
    .style('width',  rect => `${rect.width }px`)
    .style('height', rect => `${rect.height}px`);

const gl = canvas.node().getContext('webgl') as WebGLRenderingContext;
const buffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,

     1, -1,
     1,  1,
    -1,  1
]), gl.STATIC_DRAW);
const program = createProgram(`
    attribute vec3 position;
    void main() {
        gl_Position = vec4( position, 1.0 );
    }
`, `
    #ifdef GL_ES
        precision highp float;
    #endif
    uniform float time;
    uniform vec2 resolution;
    void main( void ) {
        vec2 position = - 1.0 + 2.0 * gl_FragCoord.xy / resolution.xy;
        float red =   abs( sin( position.x * position.y + time / 5.0 ) );
        float green = abs( sin( position.x * position.y + time / 4.0 ) );
        float blue =  abs( sin( position.x * position.y + time / 3.0 ) );
        gl_FragColor = vec4( red, green, blue, 1.0 );
    }
`);
const timeLoc = gl.getUniformLocation(program, 'time'      );
const resoLoc = gl.getUniformLocation(program, 'resolution');
const start = Date.now();

animate();

function animate() {
    render();
    window.requestAnimationFrame(animate);
}
function render() {
    if (!program) return;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniform1f(timeLoc,
        (Date.now() - start) / 1000);
    gl.uniform2f(resoLoc,
        +canvas.attr('width'),
        +canvas.attr('height'));

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const vertexPosition = 0;
    gl.vertexAttribPointer(vertexPosition, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vertexPosition);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(vertexPosition);
}

function createProgram(vertex:string, fragment:string) {
    const program = gl.createProgram();
    const vs = createShader(vertex,   gl.VERTEX_SHADER  );
    const fs = createShader(fragment, gl.FRAGMENT_SHADER);
    if (vs === null || fs === null) return null;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const status = gl.getProgramParameter(program, gl.VALIDATE_STATUS);
        console.error(
            `VALIDATE_STATUS: ${status}\n` +
            `ERROR: ${gl.getError()}\n\n` +
            `VERTEX ===\n${vertex}\n\n` +
            `FRAGMENT ===\n${fragment}`);
    }
    return program;
}
function createShader(source:string, type:number) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const typeString = type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT';
        const log = gl.getShaderInfoLog(shader);
        console.error(`HORRIBLE ${typeString} SHADER:\n${log}`);
        return null;
    }
    return shader;
}

console.log(`Hey here's a random person: ${Emoji.randomHuman()}`);