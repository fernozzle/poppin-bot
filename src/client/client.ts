import Emoji from '../core/Emoji';
import * as firebase from 'firebase';
declare const d3: any;
declare const CCapture: any;

var capturer = new CCapture({
    format: 'gif',
    workersPath: 'js/',
    verbose: true,
    framerate: 30
});
capturer.start();
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
    .datum((d, i, s) => ({width: 400, height: 300} || s[i].getBoundingClientRect()));
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

const dotCount = 9;
const dotBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0, 1,
    0, 2,

    1, 1,
    1, 2,
    1, 3,
    1, 4,

    2, 1,
    2, 2,
    2, 3,
]), gl.STATIC_DRAW);
const instanceExt = gl.getExtension('ANGLE_instanced_arrays');

const program = createProgram(
    require('./shader/dot.vs'),
    require('./shader/dot.fs'));
// Uniform
const uResolutionLoc = gl.getUniformLocation(program, 'uResolution');
const uDotStrideLoc = gl.getUniformLocation(program, 'uDotStride');
const uDotSizeLoc = gl.getUniformLocation(program, 'uDotSize');
// Instancing
const uDotCoordLoc = gl.getAttribLocation(program, 'uDotCoord');
// Attribute
const aPositionLoc = gl.getAttribLocation(program, 'aPosition');
gl.clearColor(.93, .93, .93, 1.);
gl.disable(gl.BLEND);

//const start = Date.now();
let time = 0;
let gotten = false;

animate();

function animate() {
    window.requestAnimationFrame(animate);
    render();
}
function render() {
    if (!program) return;

    time += 1 / 30;
    //const time = (Date.now() - start) / 1000;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    // Index buffer
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    // Uniforms
    gl.uniform2f(uResolutionLoc,
        canvas.node().width,
        canvas.node().height);
    gl.uniform1f(uDotStrideLoc, 100 * dpr + 5 * Math.sin(time * 5));
    gl.uniform1f(uDotSizeLoc, .5 * dpr + .1 * Math.sin(time * 7));

    instanceExt.vertexAttribDivisorANGLE(aPositionLoc, 0);
    instanceExt.vertexAttribDivisorANGLE(uDotCoordLoc, 0);
    // Attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer);
    gl.enableVertexAttribArray(aPositionLoc);
    gl.vertexAttribPointer(aPositionLoc, 2, gl.FLOAT, false, 0, 0);

    // Instancing
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
    gl.enableVertexAttribArray(uDotCoordLoc);
    gl.vertexAttribPointer(uDotCoordLoc, 2, gl.FLOAT, false, 0, 0);
    instanceExt.vertexAttribDivisorANGLE(uDotCoordLoc, 1);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    instanceExt.drawElementsInstancedANGLE(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, dotCount);

    gl.disableVertexAttribArray(aPositionLoc);
    gl.disableVertexAttribArray(uDotCoordLoc);

    capturer.capture(canvas.node());

    if (time > Math.PI * 2) {
        if (!gotten) {
            capturer.stop();
            capturer.save();
            gotten = true;
        }
    } else {
        capturer.capture();
    }
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