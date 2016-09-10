import Emoji from '../core/Emoji';
import * as firebase from 'firebase';
declare const d3: any;

const DOT_STRIDE = 30;
const DOT_LIMIT = 1000;
const COL_TIME = 5 * 60 * 1000;

const ATLAS_SIZE = 2048;
const AVATAR_SIZE = 32;

const dpr = window.devicePixelRatio;
const container = d3.select('#container');
const rect = container.node().getBoundingClientRect();
const canvas = container.select('canvas')
    .property('width',  rect.width  * dpr)
    .property('height', rect.height * dpr)
    .style   ('width',  `${rect.width }px`)
    .style   ('height', `${rect.height}px`);

const colsVisible = rect.width / DOT_STRIDE;
const backTime = Date.now() - COL_TIME * colsVisible;

// BEGIN GL STUFF

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

let currentCol = Number.NEGATIVE_INFINITY;
let currentRow = 0;
let dotCount = 0;

const dotBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(DOT_LIMIT * 3), gl.STATIC_DRAW);

const instanceExt = gl.getExtension('ANGLE_instanced_arrays');

const program = createProgram(
    require('./shader/dot.vs'),
    require('./shader/dot.fs'));
// Uniform
const uResolutionLoc = gl.getUniformLocation(program, 'uResolution');
const uTimeLoc = gl.getUniformLocation(program, 'uTime');
const uDotStrideLoc = gl.getUniformLocation(program, 'uDotStride');
const uOffsetLoc = gl.getUniformLocation(program, 'uOffset');
// Instancing
const aDotCoordLoc = gl.getAttribLocation(program, 'aDotCoord');
const aDotTimeLoc = gl.getAttribLocation(program, 'aDotTime');
// Attribute
const aPositionLoc = gl.getAttribLocation(program, 'aPosition');
gl.clearColor(.1, .1, .1, 1.0);
gl.enable(gl.BLEND);

const start = Date.now();
let time = start;

animate();
function animate() {
    window.requestAnimationFrame(animate);
    render();
}
function render() {
    if (!program) return;

    time = (Date.now() - start) / 1000;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    // Index buffer
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    // Uniforms
    gl.uniform2f(uResolutionLoc,
        canvas.node().width  / dpr,
        canvas.node().height / dpr);
    gl.uniform1f(uTimeLoc, time);
    gl.uniform1f(uDotStrideLoc, DOT_STRIDE + 1 * Math.sin(time * 5));
    gl.uniform2f(uOffsetLoc, 100, 100);

    // Attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, attrBuffer);
    gl.enableVertexAttribArray(aPositionLoc);
    gl.vertexAttribPointer(aPositionLoc, 2, gl.FLOAT, false, 0, 0);

    // Instancing
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
    gl.enableVertexAttribArray(aDotCoordLoc);
    gl.enableVertexAttribArray(aDotTimeLoc );
    gl.vertexAttribPointer(aDotCoordLoc, 2, gl.FLOAT, false, 3 * 4, 0 * 4);
    gl.vertexAttribPointer(aDotTimeLoc,  1, gl.FLOAT, false, 3 * 4, 2 * 4);
    instanceExt.vertexAttribDivisorANGLE(aDotCoordLoc, 1);
    instanceExt.vertexAttribDivisorANGLE(aDotTimeLoc,  1);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    instanceExt.drawElementsInstancedANGLE(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, DOT_LIMIT);

    gl.disableVertexAttribArray(aPositionLoc);
    gl.disableVertexAttribArray(aDotCoordLoc);
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



// Initialize Firebase
var config = {
    apiKey: "AIzaSyB-fx2BFroqOBHleP59wvpWhST0gdcVpu4",
    authDomain: "poppin-bot.firebaseapp.com",
    databaseURL: "https://poppin-bot.firebaseio.com",
    storageBucket: "poppin-bot.appspot.com",
};
firebase.initializeApp(config);
const root = firebase.database().ref();

console.log(`backTime: ${new Date(backTime)}`);
const serverID = '199257044161789952';
root.child(`messages/base/${serverID}`).orderByChild('time').startAt(backTime)
.once('value', messagesSnap => {
    // Upload new data dot buffer ===============

    const size = 3;
    const newData = new Float32Array(messagesSnap.numChildren() * size);

    let index = 0;
    messagesSnap.forEach(messageSnap => {
        const message = messageSnap.val();

        const col = Math.floor((message.time - backTime) / COL_TIME);
        if (col !== currentCol) {
            currentCol = col;
            currentRow = 0;
        } else {
            currentRow++;
        }
        const offset = index * size;
        newData[offset + 0] = currentCol;
        newData[offset + 1] = currentRow;
        newData[offset + 2] = time + index * .03;
        index++;

        /*root.child(`messages/text/${serverID}/${messageSnap.key}`).once('value').then(textSnap => {
            console.log(`"${textSnap.val()}" ${new Date(message.time)}`);
        });*/
        return false;
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, newData);

    // Make avatar atlas ===============
    const atlasCanvas = d3.select('#atlas-container > canvas')
        .property('width',  ATLAS_SIZE)
        .property('height', ATLAS_SIZE)
        .style   ('width',  `${ATLAS_SIZE / dpr}px`)
        .style   ('height', `${ATLAS_SIZE / dpr}px`)
        .node();
    const atlasContext:CanvasRenderingContext2D =
        atlasCanvas.getContext('2d');
    let currentX = 0;
    let currentY = 0;

    const usersRequested = {};
    messagesSnap.forEach(messageSnap => {
        const {user} = messageSnap.val();
        if (usersRequested[user]) return false;

        const id = `timelines/state/${serverID}/member-${user}:icon`;
        root.child(id).once('value')
        .then(urlSnap => new firebase.Promise((resolve, reject) => {
            const avatar = new Image();
            avatar.onload  = e => resolve(avatar);
            avatar.onerror = reject;
            avatar.src = urlSnap.val();
        })).then((avatar:HTMLImageElement) => {
            atlasContext.drawImage(avatar,
                currentX * AVATAR_SIZE, currentY * AVATAR_SIZE,
                AVATAR_SIZE, AVATAR_SIZE);
            currentX++;
            if (currentX >= Math.floor(ATLAS_SIZE / AVATAR_SIZE)) {
                currentX = 0;
                currentY++;
            }
        }).catch((event:Event) => {
            console.group('Error loading avatar:');
            console.error(event);
            console.groupEnd();
        });
        usersRequested[user] = true;

        return false;
    });
});
