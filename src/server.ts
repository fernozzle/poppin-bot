import * as Discord from 'discord.js';
import * as config from 'config';
import * as firebase from 'firebase';
import * as util from 'util';

const pkginfo = require('pkginfo')(module);
const swearFilter = new (require('bad-words'))();

import {pick, mapObject} from './Util'
import Emoji from './Emoji';
import Messager from './Messager';
import Loggy from './Loggy';
import StateTimeline from './StateTimeline';
import MessageSaver from './MessageSaver';

type Snap = firebase.database.DataSnapshot;
const SERVER_NOW = firebase.database.ServerValue.TIMESTAMP;
const root = firebase.initializeApp(config.get('firebase.initializeParams')).database().ref();

type Chan = Discord.ServerChannel;
const client = new Discord.Client();
const messager:Messager = new Messager(client);
const loggy = new Loggy(messager);

const timelines = new Map<Discord.User | Discord.Server, StateTimeline>();
const messageSaver = new MessageSaver(root.child('messages'), loggy);

function userCan(user:Discord.User, server?:Discord.Server, permission?:string) {
    // Yes if it's me
    if (config.get('settings.discordGod') === user.id) return true;

    // No if no server specified
    if (!server) return false;

    // Yes if it's the server's owner
    if (server.owner === user) return true;

    // Yes if the user's role in the server can "manage server"
    const roles = server.rolesOf(user);
    return roles.findIndex(role => role.hasPermission(permission)) !== -1;
}
function getLiveUrl(serverId:string) {
    return config.get('settings.liveUrl') + '/' + serverId;
}
// Look up a server ON FIREBASE!
function findServerId(query:string):Promise<{id:string, name:string}> {
    return new Promise((resolve, reject) => {
        // Try by name
        root.child('servers').orderByChild('name').equalTo(query).once('value')
        .then(serverSnap => {
            if (!serverSnap.exists()) throw null;
            const ids = Object.keys(serverSnap.val());
            if (ids.length > 1) reject(`There are ${ids.length} servers named "${query}"`);
            resolve({id: ids[0], name: query});
        // Try by ID
        }).catch(() => root.child(`servers/${query}`).once('value'))
        .then(serverSnap => {
            if (serverSnap.exists()) {
                resolve({id: query, name: serverSnap.val().name});
            } else {
                reject(`Couldn't find a server with name or ID "${query}"`);
            }
        });
    })
}
function selectServer(query:string, message:Discord.Message, {permission, missing, unprivileged}):Promise<Discord.Server> {
    return new Promise((resolve, reject) => {
        // PM, no server specified
        if (!message.server && !query) {
            throw messager.type(message, missing);
        }

        // Find specified server, with message's server as default
        const foundServer:Discord.Server = client.servers.find(server => {
            const serve = server as Discord.Server;
            return serve.id === query || serve.name.toLowerCase() === query.toLowerCase();
        }) || message.server;

        // Server not found
        if (!foundServer) {
            throw messager.type(message, `I'm not watching any servers with the name or ID "${query}"`);
        }

        // Insufficient permissions
        if (!userCan(message.author, foundServer, permission)) {
            throw messager.type(message, unprivileged(foundServer));
        }
        resolve(foundServer);
    });
}
const commands = {
    'leave': function(tail:string, message:Discord.Message, {announce = true} = {}) {
        const options = {
            permission: "manageServer",
            missing: [
                `Could you repeat that with a server name or ID?`,
                `You could also type \`@${client.user.name} stop\` in the server itself.`,
                `Or you could just kick me from the server`
            ],
            unprivileged: (server:Discord.Server) => [
                `Sorry ${message.author}, you have to be a mod (who can "manage server")`,
                `to pull the plug. My rampage on ${server.name} continues`
            ]
        };
        return selectServer(tail, message, options).then(server => {
            // All good
            const lines = [
                `All right ${message.author}, I'm disconnecting from ${server.name}.`,
                `I'll be stalking your members no longer`,
                `I'M OUT`
            ];
            if (!message.server) messager.type(message.author, lines); // PM? Tell em
            const leave = () => server.leave();
            return (announce ? messager.type(server, lines) : Promise.resolve(null)).then(leave);
        }).catch(error => {
            loggy.error(`Error leaving a server ${Emoji.MORE}`, error)
        });
    },
    'silently-leave': function(tail:string, message:Discord.Message) {
        return this['leave'](tail, message, {announce: false});
    },

    // throwIfUnable is true for command-less callings, gives a dumb response on catch
    'join': function(tail:string, message:Discord.Message, {throwIfUnable = false, announce = true} = {}) {
        if (!tail) {
            if (throwIfUnable) return Promise.reject(`No invite URL given`);
            return messager.type(message, `Repeat that with an invite URL after it!`);
        }

        const serversOld = client.servers.slice();
        const name = message.author.name;
        return new Promise((resolve, reject) => (/^http/.test(tail) ? resolve : reject)())
        .then(() => client.joinServer(tail))
        .then(server => { // It's an invite!
            if (serversOld.indexOf(server) !== -1) {
                return messager.type(message, [
                    `Thanks for the invite ${name}`,
                    `It was very good and it worked`,
                    `But I'm already on ${server.name}!`,
                    `Check it out: ${getLiveUrl(server.id)}`
                ]);
            }
            loggy.log(`${Emoji.JOIN} Used invite ${tail} to join server ${server.name}, which has ${server.members.length} members`);
            const thank = messager.type(message, pick(
                `Dam ${name} you just got me into ${server.name} imma check out whats poppin in there`,
                `O shingle waddup ${name} its ${server.name} thanks for the invite`,
                `Woah is this ${server.name}? Thank you so much for the invite ${name}`
            ));
            root.child(`invites/${server.id}`).push(tail);
            if (!announce) return thank;

            const serverRef = root.child(`servers/${server.id}`);
            return thank.then(() => serverRef.once('value'))
            .then(serverSnap => {
                // Server join is handled by the `serverCreated` listener
                return messager.type(server, !serverSnap.exists() ? [
                    `Hi I'm ${client.user.name}, and ${message.author} sent me here`,
                    `I make live dot plots of your server's activity stats so you can always see which channels are POPPIN.`,
                    `Here's the graph for ${server.name}: ${getLiveUrl(server.id)}`
                ] : [
                    `Hi I'm ${client.user.name} and ${message.author} has brought me back`,
                    `Once again, my live dot plot of ${server.name} is at ${getLiveUrl(server.id)}`
                ])
            });
        }).catch(() => {
            if (throwIfUnable) throw `Couldn't join invite`;
            loggy.error(`Couldn't join server from the invite ${tail}`);
            return messager.type(message, [
                `I couldn't use that as an invite.`,
                `(Is ${tail} an invite? Am I banned?)`
            ]);
        });
    },
    'silently-join': function(tail:string, message:Discord.Message) {
        return this['join'](tail, message, {announce: false});
    },
    'list': function(tail:string, message:Discord.Message) {
        if (!userCan(message.author)) {
            return messager.type(message, `${Emoji.ERROR} You don't have permission to do list em off`);
        }
        return root.child('servers').once('value')
        .then(serversSnap => {
            const serversObj = serversSnap.val();
            const ids = Object.keys(serversObj);
            const firebaseIdNames = ids.map(id => ({id, name: serversObj[id].name}));

            const onlineIdNames = [], offlineIdNames = [];
            for (const idName of firebaseIdNames) {
                const isOnline = client.servers.has('id', idName.id);
                (isOnline ? onlineIdNames : offlineIdNames).push(idName);
            }
            return messager.type(message, [
                `I'm connected to ${onlineIdNames.length} servers  ${Emoji.MORE}`,
                onlineIdNames.map(({id, name}) => `${Emoji.JOIN} ${name} (${id})`).join('\n'),
                `I'm not connected to ${offlineIdNames.length} servers  ${Emoji.MORE}`,
                offlineIdNames.map(({id, name}) => `${Emoji.LEAVE} ${name} (${id})`).join('\n')
            ]);
        });
    },
    'users': function(tail:string, message:Discord.Message) {
        const options = {
            permission: "readMessages", // everyone on the server
            missing: [
                `Could you repeat that with a server name or ID?`,
                `You could also type \`@${client.user.name} users\` on any channel in the server itself.`
            ],
            unprivileged: (server:Discord.Server) => [
                `Sorry ${message.author}, you have to be a member`,
                `of ${server.name} to get a list of its members.`
            ]
        };
        return selectServer(tail, message, options)
        .then(server => messager.type(message, [
            `${Emoji.SERVER} ${server.name} has ${server.members.length} members  ${Emoji.MORE}`,
            server.members.map(m => Emoji.randomHuman() + ' ' + m).join('\n')
        ]));
    },
    'channels': function(tail:string, message:Discord.Message) {
        const options = {
            permission: "readMessages", // everyone on the server
            missing: [
                `Could you repeat that with a server name or ID?`
            ],
            unprivileged: (server:Discord.Server) => [
                `Sorry ${message.author}, you have to be a member`,
                `of ${server.name} to get a list of its channels.`
            ]
        };
        return selectServer(tail, message, options).then(server => {
            const cs = server.channels.filter(c => c.type === 'text');
            return messager.type(message, [
                `${Emoji.SERVER} ${server.name} has ${cs.length} channel${cs.length === 1 ? '' : 's'} ${Emoji.MORE}`,
                cs.map(c => `${Emoji.CHANNEL} ${c}`).join('\n')
            ])
        });
    },
    'clear': function(tail:string, message:Discord.Message) {
        if (!userCan(message.author)) {
            return messager.type(message, `You don't have permission to clear all knowledge of ${tail}`);
        }
        if (!tail && !message.server) return messager.type(message, [
            `Could you repeat that with a server name or ID?`
        ]);

        if (tail === 'all') {
            return root.child('servers').once('value')
            .then(serversSnap => {
                const serversObj = serversSnap.val();
                const ids = Object.keys(serversObj);
                const idNames = ids.map(id => ({id, name: serversObj[id].name}));
                return Promise.all(idNames.map(clearServer))
                .catch(error => loggy.error(`${Emoji.ERROR} Error clearing all servers ${Emoji.MORE}`, error));
            });
        }

        return findServerId(tail || message.server.id)
        .then(clearServer)
        .catch(error => loggy.error(`${Emoji.ERROR} Error clearing server ${tail} ${Emoji.MORE}`, error));

        function clearServer({id, name}) {
            if (id === loggy.logServer.id) return;
            const server = client.servers.find(server => server.id === id);
            if (server) server.leave().then(() => loggy.log(`${Emoji.LEAVE_TO_CLEAR} Left ${name} to clear`));
            const updateObj = {
                [`servers/${ id}`]: null,
                [`channels/${id}`]: null,
                [`messages/${id}`]: null
            };
            return root.update(updateObj)
            .then(() => messager.type(message, `${Emoji.OBLITERATE} Cleared messages on ${name}`));
        }
    }
};
function takeCommand(message:Discord.Message) {
    // A public message that doesn't involve us;
    const mentionsUs = message.isMentioned(client.user);
    if (message.channel instanceof Discord.TextChannel && !mentionsUs) {
        return Promise.resolve();
    }

    let commandText = message.content.trim();
    if (mentionsUs) {
        const mention = `<@${client.user.id}>`;
        commandText = message.content.split(mention)[1].trim();
    }

    const [head, ...tail] = commandText.split(' ');
    const command = commands[head];
    if (command) return command.call(commands, tail.join(' '), message);

    // Command not found, try invite
    return commands['join'](commandText, message, {throwIfUnable: true})
    .catch(() => dumbResponse(commandText, message));
}
function dumbResponse(text:string, message:Discord.Message) {
    const name = message.author.name;
    if (!text) {
        return messager.type(message, `Here's my live dot plot of ${message.server}  ${Emoji.MORE}\n${getLiveUrl(message.server.id)}`);
    }
    return messager.type(message, pick(
        `${pick('Eh dont', 'Dont')} mention it ${name}`,
        `You know what ${name}? You're right`,
        `${name}, you couldn't have said it any better`,
        `${pick('Mm', 'Uh', 'Well')} not really`,
        `Okay ${pick('sure', 'fine', 'whatever')} ${name}`,
        `${pick('Easy', 'Hey easy')} there ${name}`,
        [
            'Hold on I just found this old plaque: `WORLD\'S DUMBEST UTTERANCE`.',
            'Let me read it to you:',
            '```\n' + message.cleanContent + '\n```',
            'Woh that is pretty dumb'
        ]
    ));
}

function objectifyServer(server:Discord.Server) {
    const prefix = `attr:`;
    return {
        [`${prefix}name`   ]: server.name,
        [`${prefix}icon`   ]: server.iconURL,
        [`${prefix}default`]: server.defaultChannel.id
    };
}
function objectifyChannel(channel:Discord.ServerChannel) {
    if (channel instanceof Discord.TextChannel) {
        const prefix = `chantxt-${channel.id}:`;
        return {
            [`${prefix}name` ]: channel.name,
            [`${prefix}pos`  ]: channel.position,
            [`${prefix}topic`]: channel.topic,
        };
    } else if (channel instanceof Discord.VoiceChannel) {
        const prefix = `chanvox-${channel.id}:`;
        return {
            [`${prefix}name`]: channel.name,
            [`${prefix}pos` ]: channel.position,
        };
    }
    return {};
}
function objectifyMember(server:Discord.Server, user:Discord.User) {
    const details = server.detailsOf(user);
    const voiceId = (user.voiceChannel || {id: undefined}).id;
    const game    = (user.game || {name: undefined}).name;

    const prefix = `member-${user.id}:`;
    return {
        [`${prefix}nick`    ]: details.nick,
        [`${prefix}icon`    ]: user.avatarURL,
        [`${prefix}status`  ]: user.status,
        [`${prefix}game`    ]: game,
        [`${prefix}vox-chan`]: voiceId,
        [`${prefix}vox-mute`]: details.mute || details.selfMute,
        [`${prefix}vox-deaf`]: details.deaf || details.selfDeaf,
    }
}
function deletify(object:{}) {
    for (const key of Object.keys(object)) {
        object[key] = undefined;
    }
    return object;
}

function createServerTimeline(server:Discord.Server) {
    const tlRoot = root.child(`timelines`);
    const channels = server.channels.map(objectifyChannel);
    const members = server.members.map(member => {
        return objectifyMember(server, member);
    });
    const props = Object.assign(objectifyServer(server),
        ...channels, ...members);

    return new StateTimeline(tlRoot, server.id, props);
}

client.on('message', message => {
    const author = message.author;

    // Log public messages
    if (message.channel instanceof Discord.TextChannel) {
        messageSaver.messagesPosted(message);
    } else if (message.channel instanceof Discord.PMChannel) {
        loggy.log(`${Emoji.MESSAGE} Message from ${author} ${Emoji.MORE}`, message.cleanContent);
    }
    // Receive our pending messages
    if (author === client.user) {
        messager.receiveOwnMessage(message);
        return;
    }
    // Respond to commands
    takeCommand(message).catch(error => {
        loggy.error(`Couldn't take ${author.name}'s command "${message.cleanContent}" ${Emoji.MORE}`, error)
    });
});
client.on('messageUpdated', (oldMessage, newMessage) => {
    messageSaver.messageUpdated(oldMessage, newMessage);
});
client.on('messageDeleted', message => {
    messageSaver.messageDeleted(message);
});

client.on('serverCreated', server => {
    if (timelines.has(server)) {
        loggy.error(`Oh no, ${server.name} is already timelined`);
    } else timelines.set(server, createServerTimeline(server));
});
client.on('serverDeleted', server => {
    loggy.log(`${Emoji.LEAVE} Just left ${server.name}`);
    timelines.get(server).destroy();
    timelines.delete(server);
});

/*client.on('userBanned', (user, server) => {
    if (user !== client.user) return;
    loggy.error(`Daaang I just got banned from ${server.name}!`);
});
client.on('userTypingStarted', (user, channel:Discord.TextChannel) => {
    if (!channel.server) return; // A PM channel
    //loggy.log(`Ho boy ${channel.name} get ready for a brand spanking steamy new post from ${user.name}`);
});
client.on('userTypingStopped', (user, channel:Discord.TextChannel) => {
    if (!channel.server) return; // A PM channel
    //loggy.log(`Aww ${channel.name} just saw ${user.name} stop typing`);
});*/

client.on('serverUpdated', (oldServer, newServer) => {
    timelines.get(newServer).update(
        objectifyServer(newServer));
});
client.on('channelCreated', (channel:Discord.ServerChannel) => {
    if (!channel.server) return;
    timelines.get(channel.server).update(
        objectifyChannel(channel));
});
client.on('channelUpdated', (channelOld, channel:Discord.ServerChannel) => {
    if (!channel.server) return;
    timelines.get(channel.server).update(
        objectifyChannel(channel));
});
client.on('channelDeleted', (channel:Discord.ServerChannel) => {
    if (!channel.server) return;
    timelines.get(channel.server).update(
        deletify(objectifyChannel(channel)));
});

client.on('serverNewMember', (server, user) => {
    timelines.get(server).update(
        objectifyMember(server, user));
});
client.on('serverMemberRemoved', (server, user) => {
    timelines.get(server).update(
        deletify(objectifyMember(server, user)));
});
client.on('presence', (oldUser, newUser) => {
    const serverHasUser = s => s.members.has('id', newUser.id);
    const servers = client.servers.filter(serverHasUser);

    for (const server of servers) {
        timelines.get(server).update(
            objectifyMember(server, newUser));
    }
});

function channelsInfo(servers) {
    const channelLine = (channel, i, tcs) =>
        ((i === tcs.length - 1) ? '\u2517' : '\u2523') +
        ` ${Emoji.CHANNEL} ${channel.name}`;
    const channelList = server =>
        server.channels.filter(c => c.type === 'text')
            .map(channelLine).join('\n');
    return servers.map(server =>
        `${Emoji.SERVER} ${server.name}\n${channelList(server)}`
    ).join('\n');
}

client.on('ready', () => {

    client.userAgent.url     = module.exports.homepage;
    client.userAgent.version = module.exports.version;
    client.setPlayingGame(config.get('settings.discordStatus') + '');

    return client.joinServer(config.get('settings.logServer') + '')
    .then(server => {
        loggy.setLogServer(server);

        const timeString = (new Date()).toLocaleString();
        loggy.log(`${Emoji.STAR} Logged on ${timeString} ${Emoji.STAR}`);
        //console.dir(client);

        const servers = client.servers;
        const timelinesReady = Promise.all([...servers.map(server => {
            const timeline = createServerTimeline(server);
            timelines.set(server, timeline);
            return timeline.gotReady;
        })]).then(() => { // Just log things
            return loggy.log(`${Emoji.UPLOAD_SERVER} Uploaded info and ` +
                `channels ${Emoji.MORE}`, channelsInfo(servers));
        }).catch(error => loggy.error(
            `Error uploading servers ${Emoji.MORE}`, error));

        const messagesCaughtUp = Promise.all([...servers.map(({channels}) => {
            const textChannels = channels.filter(c => c.type === 'text');
            return textChannels.map(c => messageSaver.catchUp(c));
        })]);

        // Text channels catching up
        Promise.all([timelinesReady, messagesCaughtUp]).then(() => {
            loggy.log(`${Emoji.WHEW} Whew, it's all over`);
        });
    })
});


process.on('uncaughtException', (error) => {
    loggy.error(`Uncaught exception ${Emoji.MORE}`, error);
});

function login() {
    client.loginWithToken(config.get('discord.token') + '');
}
client.on('disconnected', () => {
    login();
});
login();
