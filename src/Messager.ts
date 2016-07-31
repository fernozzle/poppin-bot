import * as Discord from 'discord.js';
import Emoji from './Emoji'

interface PendingMessage {
    completed?: boolean;
    latestCompletes: Promise<any>;
    getsId?: Promise<string>; // Used so me-messages can await
    arrive?: (eventMessage:Discord.Message) => void;
};
type Channelesque = Discord.ChannelResolvable;

export default class Messager {

    private _client:Discord.Client;

    // Each channel handles only 1 message at a time
	private _pendingChannels;

    constructor(client:Discord.Client) {
        this._client = client;
        this._pendingChannels = new Map<Channelesque, PendingMessage>();
    }

    send(cesque: Channelesque, text:string) {
        const pend = this._pendingChannels.get(cesque)
            || {latestCompletes: Promise.resolve()};
        if (!pend.arrive) this._pendingChannels.set(cesque, pend);

        // Tack on a `then` to the current promise
        return pend.latestCompletes = pend.latestCompletes.then(() => new Promise(resolve => {
            // When the previous promise is resolved, send the message and
            // allow recieved messages to await its ID so they can compare with it
            pend.getsId = this._client.sendMessage(cesque, text).then(({id}) => id);
            // It's up to them to call this if they're the lucky one
            pend.arrive = message => {
                pend.completed = true;
                resolve(message); // For send().then(message) convenience
            };
            pend.completed = false;
        })).catch(error => {
            console.error(`Couldn't pend ${text} ${Emoji.MORE}`);
            console.dir(error);
        });
    }

    type(channel: Channelesque, texts: (string | string[])) {
        if (texts.length === 0) return Promise.resolve(null);

        return typeit((typeof texts === 'string') ? [texts] : texts);

        function typeit(remain: string[]) {
            if (remain.length === 0) return Promise.resolve();
            return this.send(channel, remain[0]).then(() => typeit(remain.slice(1)));
        }

        // client.startTyping(channel);
        // return new Promise(function(resolve, reject) {
        //     function startTyping(remaining: string[]) {
        //         client.stopTyping(channel);
        //         if (remaining.length === 0) {
        //             resolve();
        //             return;
        //         }
        //         client.startTyping(channel);
        //         setTimeout(function() {
        //             client.sendMessage(channel, remaining[0])
        //             startTyping(remaining.slice(1));
        //         }, 1500);
        //     }
        //     startTyping((typeof messageArg === 'string') ? [messageArg] : messageArg);
        // });
    }
    receiveOwnMessage(message:Discord.Message) {
        for (const pend of this._pendingChannels.values()) {
            // We've already received & acted on this message
            if (pend.completed) continue;

            pend.getsId.then(id => {
                if (id === message.id) pend.arrive(message);
            });
        }
    }
}