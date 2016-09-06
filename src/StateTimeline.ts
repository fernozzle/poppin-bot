import * as firebase from 'firebase';
import {mapObject} from './Util'

/**
 * Returns `optional` but `fallback` when it's undefined
 */
function fallback(optional, fallback) {
    return (optional !== undefined) ? optional : fallback;
}
/**
 * Note that the returned list of keys is a subset
 * of `newProps`, not of all keys between the two.
 */
function deltaKeys(newProps:{}, oldProps:{}) {
    return Object.keys(newProps).filter(
        key => newProps[key] !== oldProps[key]);
}
function applyProps(source:{}, target:{}, keys:string[]) {
    for (const key in keys) {
        if (source[key] === undefined) delete target[key];
        else target[key] = source[key];
    }
}

const Keys = Object.freeze({
    ACCESS: 'access',
});
const Status = Object.freeze({
    ONLINE: 'online',
    OFFLINE: 'offline',
    FOREIGN: ''
});

export default class StateTimeline {
    static KEYS = Keys;
    static STATUS = Status;

    private root:firebase.database.Reference;
    private id:string;
    state:{};
    gotReady = firebase.Promise.reject(
        `Timeline hasn't been initialized`);
    private asOfRef:firebase.database.Reference;

    /**
     * `allProps` is an object containing all current properties,
     * although the event produced is still differential.
     */
    constructor(root, id, allProps:{}) {
        this.root = root;
        this.id = id;
        this.asOfRef = this.root.child(this.asOfID());

        this.asOfRef.onDisconnect().set(
            firebase.database.ServerValue.TIMESTAMP);
        allProps[Keys.ACCESS] = Status.ONLINE;

        const now = Date.now();
        this.gotReady = firebase.Promise.all([
            this.asOfRef.once('value'), // Time last left
            this.root.child(this.stateID()).once('value')
        ]).then(([timeSnap, stateSnap]) => {

            // timeSnap ('as_of') - 3 possibilities:
            // +number: return after logoff
            // -number: return after kick
            // none: new timeline

            this.state = stateSnap.val() || {};
            const oldTime  =   timeSnap.val();
            const updateObject = {[this.asOfID()]: 'now'};

            if (!oldTime) { // New server: foreign before now
                this.state[Keys.ACCESS] = Status.FOREIGN;

            } else if (Number.isInteger(oldTime)) { // Returning
                this.state[Keys.ACCESS] = (oldTime > 0)
                    ? Status.OFFLINE : Status.FOREIGN;

                // Create "was online" event at leave time
                const leavent = this.eventID(
                    Keys.ACCESS, Math.abs(oldTime));
                updateObject[leavent] = Status.ONLINE;
            }

            const changedKeys = [ // New keys that are different...
                ...deltaKeys(allProps, this.state),
                // and old keys that don't exist anymore
                ...deltaKeys(this.state, allProps)
            ]; // Many duplicates, doesn't matter with mapObject
            this.buildEvent(
                allProps, this.state,
                changedKeys, now,
                updateObject);

            applyProps(allProps, this.state, changedKeys);
            return this.root.update(updateObject);
        });
    }

    update(newProps:{}, time = Date.now()) {
        return this.gotReady.then(() => {
            const changedKeys = deltaKeys(newProps, this.state);
            const updateObject = this.buildEvent(
                newProps, this.state,
                changedKeys, time);

            applyProps(newProps, this.state, changedKeys);
            return this.root.update(updateObject);
        });
    }

    destroy() {
        this.gotReady = firebase.Promise.reject(
            `Timeline has been destroyed`);

        firebase.Promise.all([
            this.asOfRef.onDisconnect().cancel(),
            this.asOfRef.update(-Date.now())
        ]).then(() => {});
    }


    private buildEvent(
        newProps:{}, oldProps:{},
        keys:string[], time:number,
        updateObject = {}) {

        mapObject(keys,
            key => this.eventID(key, time),
            key => fallback(oldProps[key], ''),
            updateObject);
        return mapObject(keys,
            key => this.stateID(key),
            key => fallback(newProps[key], null),
            updateObject);
    }
    private eventID(key:string, time:number) {
        return `event/${this.id}/${time}/${key}`;
    }
    private stateID(key?:string) {
        if (key) return `state/${this.id}/${key}`;
        return `state/${this.id}`;
    }
    private asOfID() {
        return `as_of/${this.id}`;
    }
}