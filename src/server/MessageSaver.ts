import * as Discord from 'discord.js';
import * as firebase from 'firebase';
import {mapObject} from '../core/Util'
import Loggy from './Loggy';
import Emoji from '../core/Emoji';
const swearFilter = new (require('bad-words'))();

type Mess = Discord.Message;
type Snap = firebase.database.DataSnapshot;
const NS = Object.freeze({
    BASE: 'base',

    SWEAR: 'swear',
    MENTIONS: 'mentions',
    TEXT: 'text',
    TOLD: 'told',
});

function serverID(ns:string, {server}:Discord.TextChannel) {
    return `${ns}/${server.id}`;
}
function messageID(ns:string, {server, id}:Mess) {
    return `${ns}/${server.id}/${id}`;
}
function channelName(channel:Discord.ServerChannel) {
    return `${channel.server.name}#${channel.name}`;
}
function messageDate(message:Mess) {
    return new Date(message.timestamp).toLocaleString();
}

export default class MessageSaver {
    private root:firebase.database.Reference;
    private loggy:Loggy;

    constructor(root, loggy) {
        this.root = root;
        this.loggy = loggy;
    }

    messagesPosted(...messages: Mess[]) {
        if (messages.length === 0) {
            return firebase.Promise.resolve(null);
        }
        return this.root.update(messages.reduce(
            (update, message) => this.buildMessage(message, update),
        {}));
    }
    messageUpdated(oldMessage: Mess, newMessage: Mess) {
        if (newMessage.content === oldMessage.content) {
            return firebase.Promise.resolve(null);
        }
        return this.root.update(
            this.buildMessage(newMessage, {}, oldMessage));
    }
    messageDeleted(message: Mess) {
        const id = messageID(NS.BASE, message) + '/dele';
        return this.root.update({[id]: Date.now()});
    }

    private buildMessage(
        message:Mess, updateObject:{}, oldMessage?:Mess) {

        // BASE edit timestamp
        const base = messageID(NS.BASE, message);
        updateObject[base + '/edit'] =
            message.editedTimestamp || null;
        updateObject[base + '/pin'] = message.pinned || null;
        updateObject[base + '/tts'] = message.tts    || null;

        if (message.embeds && false) {
            console.dir(message.embeds);
        }

        // SWEAR
        updateObject[messageID(NS.SWEAR, message)] =
            swearFilter.isProfane(message.content) || null;
        // MENTIONS
        updateObject[messageID(NS.MENTIONS, message)] =
            mapObject(message.mentions, u => u.id, u => true);
        // Latest TEXT
        updateObject[messageID(NS.TEXT, message)] =
            message.content;

        if (oldMessage) { // This is an update
            // Previous TOLD
            const prevTime = message.editedTimestamp;
            const told = messageID(NS.TOLD, oldMessage);
            updateObject[told + '/' + prevTime] = oldMessage.content;

        } else { // Brand new message
            // BASE
            updateObject[base + '/time'] = message.timestamp;
            updateObject[base + '/user'] = message.author.id;
            updateObject[base + '/chan'] = message.channel.id;
        }

        return updateObject;
    }

    /*              D O O Z Y               */
    /* This one is different from the rest. */

    catchUp(channel: Discord.TextChannel) {
        const getDiscordMessages = (before?: Mess) => {
            // Step 1: get 100 messages from Discord
            return channel.client.getChannelLogs(channel, 100, {before})
            .then(messages => {
                const count = messages.length;
                // Early out if no messages remain
                if (count === 0) return `reached creation ` +
                    `after ${total}`;

                const earliestMessage = messages[count - 1];

                // Step 2: check Firebase for these messages
                return messageQuery
                .startAt(earliestMessage.id)
                .endAt(messages[0].id)
                .once('value').then(
                    snap => checkFirebaseMessages(messages, snap));
            });
        };
        const checkFirebaseMessages =
            (discordMessages:Mess[], onlineMessages:Snap) => {

            const earliestMessage =
                discordMessages[discordMessages.length - 1];

            // Earliest message given by Discord is already on record
            const more = onlineMessages.hasChild(earliestMessage.id)
                ? `recognized message from ` +
                  `${messageDate(earliestMessage)}` +
                  ` after ${total}`
                : getDiscordMessages(earliestMessage);

            // Don't overwrite already online messages (it'd discard edits)
            const offlineMessages = discordMessages.filter(
                 ({id}) => !onlineMessages.hasChild(id));
            const offlineCount = offlineMessages.length;
            total += offlineCount;

            const upload = this.messagesPosted(...offlineMessages).then(
                () => (offlineCount > 0) ? this.loggy.log(
                    `${Emoji.LOGS} Kept ${offlineCount} ` +
                    `(${total} total) from ${name}: ` +
                    `${messageDate(earliestMessage)}`) : null);

            // Discard uploadMessage's return value
            return Promise.all([more, upload]).then(([more]) => more);
        };

        let total = 0;
        const messageQuery = this.root.child(
            serverID(NS.BASE, channel)).orderByKey();
        const name = channelName(channel);

        return getDiscordMessages().then(note => this.loggy.log(
            `${Emoji.UPLOAD_MESSAGE} Caught up ${name}: ${note}`)
        ).catch(error => this.loggy.error(
            `Error getting logs on ${name} ${Emoji.MORE}`, error));
    }
}