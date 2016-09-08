import {pick} from './Util';

export default Object.freeze({
    ERROR: '\u{1f6a8}',
    INFO: '\u2139',
    MORE: '\u2199', // down left arrow
    STAR: '\u2B50',

    SERVER: '\u{1F4F1}', // phone
    JOIN: '\u{1F4F2}', // arrow to phone
    UPLOAD_SERVER: '\u{1F4F3}', // phone w heart
    LEAVE: '\u{1F4F5}', // phone with "no" symbol
    LEAVE_TO_CLEAR: '\u{1F3C3}', // running man

    MESSAGE: '\u{1F4E8}', // message w stink lines
    UPLOAD_MESSAGE: '\u{1F48C}', // envelope w heart
    LOGS: '\u{1F4E9}', // envelope w arrow

    CHANNEL: '\u{1F4EB}', // mailbox, flag up
    CHANNEL_CREATE: '\u{1F4EC}', // mailbox, envelope entering
    CHANNEL_DELETE: '\u{1F4ED}', // mailbox, flag down

    UPLOAD_USER: '\u{1F48F}', // people w heart
    WHEW: '\u{1F62A}', // sleepy face
    OBLITERATE: '\u{1F4A5}', // boom

    randomHuman() {
        return pick(...this.HUMAN_BASES) + pick(...this.TONES);
    },

    HUMAN_BASES: Object.freeze([
        '\u{1F466}', // boy
        '\u{1F467}', // girl
        '\u{1F468}', // man
        '\u{1F469}', // woman
        '\u{1F474}', // old man
        '\u{1F475}', // old woman
        '\u{1F471}', // blond hair
        '\u{1F46E}', // police officer
        '\u{1F472}', // gua pi mao
        '\u{1F473}', // turban
        '\u{1F477}', // builder
        '\u{1F478}', // princess
        '\u{1F482}', // guardsman
        '\u{1F385}', // santa
        '\u{1F470}', // bride
        '\u{1F47C}', // baby angel
        '\u{1F486}', // face massage
        '\u{1F487}', // haircut
        '\u{1F64D}', // frown
        '\u{1F64E}', // pout
        '\u{1F645}', // x-arms
        '\u{1F646}', // o-arms
        '\u{1F481}', // SASS
        '\u{1F64B}', // raise hand
        '\u{1F647}', // bow
        '\u{1F464}', // silhouette
        '\u{1F6B6}', // pedestrian
        '\u{1F3C3}', // runner
        '\u{1F483}', // dancer
    ]),
    TONES: Object.freeze([
        '\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'
    ]),

});