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
    .property('width',  rect => rect.width  * dpr)
    .property('height', rect => rect.height * dpr)
    .style   ('width',  rect => `${rect.width }px`)
    .style   ('height', rect => `${rect.height}px`);

const gl = canvas.node().getContext('webgl') as WebGLRenderingContext;

const attrBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
    -1, +1,
    +1, +1,
    +1, -1,
]), gl.STATIC_DRAW);

const indexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Int8Array([
    0, 1, 2,
    2, 3, 0
]), gl.STATIC_DRAW);

const program = createProgram(
    require('./shader/bubble.vs'),
    require('./shader/bubble.fs'));
const aPositionLoc = gl.getAttribLocation (program, 'aPosition');

const uResolutionLoc = gl.getUniformLocation(program, 'uResolution');
const uBubbleStrideLoc = gl.getUniformLocation(program, 'uBubbleStride');
const uBubbleCoordLoc = gl.getUniformLocation(program, 'uBubbleCoord');
const start = Date.now();

animate();

function animate() {
    window.requestAnimationFrame(animate);
    render();
}
function render() {
    if (!program) return;

    const time = (Date.now() - start) / 1000;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniform2f(uResolutionLoc,
        canvas.node().width,
        canvas.node().height);
    gl.uniform1f(uBubbleStrideLoc, 100 * dpr + 50 * Math.sin(time * 10));
    gl.uniform2f(uBubbleCoordLoc, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    gl.vertexAttribPointer(aPositionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enableVertexAttribArray(aPositionLoc);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0);
    gl.disableVertexAttribArray(aPositionLoc);
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

console.log(`People watching you:\n${d3.range(100).map(Emoji.randomHuman.bind(Emoji)).join('')}`);