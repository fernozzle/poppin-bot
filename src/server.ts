import * as Discord from 'discord.js';
import * as config from 'config';
import * as firebase from 'firebase';
import * as util from 'util';

const pkginfo = require('pkginfo')(module);
const swearFilter = new (require('bad-words'))();

import {pick, objectMap} from './Util'
import Emoji from './Emoji';
import Messager from './Messager';
import Loggy from './Loggy'

type Snap = firebase.database.DataSnapshot;
const SERVER_NOW = firebase.database.ServerValue.TIMESTAMP;
const root = firebase.initializeApp(config.get('firebase.initializeParams')).database().ref();

const Statuses = Object.freeze({
    ONLINE:    'on',
    IDLE:      'idle',
    OFFLINE:   'off',
    FOREIGN:   'not',
    UNTRACKED: 'na'
});
const getStatus = (() => {
    const mapping = {
        'online':  Statuses.ONLINE,
        'offline': Statuses.OFFLINE,
        'idle':    Statuses.IDLE,
    };
    return ({status}:Discord.User) => mapping[status] || status;
})();

const client = new Discord.Client();
const messager:Messager = new Messager(client);
const loggy = new Loggy(messager)


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

/**
 * "Normalizes" the server record's `as_of` into events
 * in `server_events` & `user_events`
 */
function convertAsOf(server) {
    const membersRef = root.child(`members/${server.id}`);
    return membersRef.once('value').then((snap:Snap) => {
        if (!snap.exists()) return; // No previous as_of, no need to convert

        const val = snap.val();
        if (val.as_of === 'now') {
            return loggy.error(`Server ${server.name} left off with as_of "now"`);
        }

        uploadUserStatus
        const update = objectMap(Object.keys(val.users),
            uid => uid,
            uid => ({from: val.users[uid], to: Statuses.UNTRACKED})
        );
        const eventId = `server_events/${server.id}/${val.as_of}`;
        return root.child(eventId).update(update);
    });
}
/**
 * Uploads server data    {`name`, `icon`, `default_channel`}
 * and their channel data {`name`, `position`}
 * and uploads their new messages.
 */
function uploadServers(...servers:Discord.Server[]) {

    const awaiting = [];

    const updateData = {};
    for (const server of servers) {
        // TODO: THIS NEEDS TO BE REVAMPED
        // Server info
        updateData[`servers/${server.id}`] = {
            name:            server.name,
            icon:            server.iconURL,
            default_channel: server.defaultChannel.id
        };

        // Server's channels with info
        const channels = server.channels.filter(c => c.type === 'text');
        objectMap(channels,
            c => `channels/${server.id}/${c.id}`,
            c => ({name: c.name, position: c.position}),
            updateData);
        awaiting.push(...channels.map(catchUp)); // Start immediately

        // TODO: THIS WILL THROW BECAUSE `as_of` "now"
        // Convert as_of to server event
        awaiting.push( convertAsOf(server));
        awaiting.push(scheduleAsOf(server));

        // Overwrite members' statuses
        const statuses = objectMap(server.members, m => m.id, getStatus);
        updateData[`members/${server.id}`] = {
            as_of: 'now',
            users: statuses
        };
    }

    // Just log things
    const channelLine = (c, i, a) => ((i === a.length - 1) ? '\u2517 ' : '\u2523 ') + Emoji.CHANNEL + ' ' + c.name;
    const channelList = server => server.channels.filter(c => c.type === 'text').map(channelLine).join('\n');
    const serverInfo = servers.map(server => Emoji.SERVER + ' ' + server.name + '\n' + channelList(server)).join('\n');

    awaiting.push(root.update(updateData).then(
        () => loggy.log(`${Emoji.UPLOAD_SERVER} Uploaded info and channels ${Emoji.MORE}`, serverInfo),
        error => loggy.error(`Error uploading servers... ${Emoji.MORE}`, serverInfo,  `... because ...${Emoji.MORE}`, error)
    ));
    return Promise.all(awaiting);
}
function buildAsOfUpdate(servers:Discord.Server[]) {
    return objectMap(servers,
        server => `${server.id}/as_of`,
        () => SERVER_NOW
    );
}
/**
 * Tell Firebase to set `as_of` so clients can know when we disconnected
 */
function scheduleAsOf(server:Discord.Server) {
    const dis = root.child(`members/${server.id}/as_of`).onDisconnect();
    return dis.cancel().then(() => dis.update(SERVER_NOW));
}
/**
 * For when we're booted from a server
 */
function flushAsOf(server:Discord.Server) {
    const asOf = root.child(`members/${server.id}/as_of`);
    asOf.onDisconnect().cancel();
    return asOf.update(SERVER_NOW);
}

function channelName(channel: Discord.ServerChannel) {
    return `${channel.server.name}#${channel.name}`;
}

function uploadMessages(...messages: Discord.Message[]) {
    if (messages.length === 0) return Promise.resolve();
    const messagesData = {};
    for (const message of messages) {
        const text = message.content;
        const profane = swearFilter.isProfane(text);
        const damn = profane && (text.toLowerCase().indexOf('damn') !== -1);

        const mentionsObj = objectMap(message.mentions, u => u.id, () => true);
        messagesData[message.id] = {
            // essentials
            len:  message.cleanContent.length,
            time: message.timestamp,
            user: message.author.id,
            chan: message.channel.id,

            // flags
            swear:    profane ? (damn ? 2 : 1) : null,
            mentions: mentionsObj,
            edited:   message.editedTimestamp ? message.editedTimestamp : null
        };
    }
    return root.child(`messages/${messages[0].server.id}`).update(messagesData);
}

client.on('message', message => {
    const author = message.author;

    // Log public messages
    if (message.channel instanceof Discord.TextChannel) {
        uploadMessages(message);
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

// newMessage definitely has .editedTimestamp this time
client.on('messageUpdated', (oldMessage, newMessage) => {
    if (newMessage.content === oldMessage.content) return;
    uploadMessages(newMessage);
});

// Won't be emitted if message isn't cached locally, plus the
// .validate rule on Firebase will prevent a "/deleted-only" entry
client.on('messageDeleted', message => {
    const path = `messages/${message.server.id}/${message.id}/deleted`;
    root.child(path).update(true);
});

function catchUp(channel: Discord.ServerChannel) {
    let count = 0;
    const name = channelName(channel);
    const messageQuery = root.child(`messages/${channel.server.id}`).orderByKey();
    return getDiscordMessages().then(note => {
        return loggy.log(`${Emoji.UPLOAD_MESSAGE} Done catching up in ${name}: ${note}`);
    }).catch(error => {
        return loggy.error(`Error getting logs on ${channelName(channel)} ${Emoji.MORE}`, error);
    });

    function getDiscordMessages(before?: Discord.Message) {
        // Step 1: get 100 messages from Discord
        return client.getChannelLogs(channel, 100, {before})
        .then(messages => {
            // Early out if there are no messages left
            if (messages.length === 0) return `reached beginning of time after ${count} messages`;

            const earliestMessage = messages[messages.length - 1];

            const timeString = new Date(earliestMessage.timestamp).toLocaleString();
            loggy.log(`${Emoji.LOGS} Got ${before ? 'another' : 'latest'} ${messages.length} (${count + messages.length} total) from ${name}: ${timeString}`);

            // Step 2: check Firebase for these messages
            return messageQuery.startAt(earliestMessage.id).endAt(messages[0].id)
            .once('value').then(snap => checkFirebaseMessages(messages, snap));
        });
    }
    function checkFirebaseMessages(discordMessages:Discord.Message[], onlineMessages:Snap) {
        const earliestMessage = discordMessages[discordMessages.length - 1];

        // Earliest message given by Discord is already on record
        const timeString = new Date(earliestMessage.timestamp).toLocaleString();
        const more = onlineMessages.hasChild(earliestMessage.id)
            ? `recognized a message from ${timeString} after ${count} messages`
            : getDiscordMessages(earliestMessage);

        // Don't overwrite already uploaded messages (it'd discard edits)
        const isOffline = message => !onlineMessages.hasChild(message.id);
        const offlineMessages = discordMessages.filter(isOffline);
        count += offlineMessages.length;

        // Discard uploadMessage's return value (null on success)
        const promises = [more, uploadMessages(...offlineMessages)];
        return Promise.all(promises).then(values => values[0]);
    }
}

/**
 * Uploads server-agnostic user data (name and avatar)
 */
function uploadUsers(...users: Discord.User[]) {
    const usersData = objectMap(users,
        u => u.id,
        u => ({name: u.name, avatar: u.avatarURL})
    );

    const names = users.map(user => user.name);
    return root.child('users').update(usersData).then(() => {
        loggy.log(`${Emoji.UPLOAD_USER} Uploaded user${users.length === 1 ? '' : 's'} ${Emoji.MORE}`, names);
    })
}

client.on('serverCreated', server => {
    uploadServers(server);
});
client.on('serverDeleted', server => {
    loggy.log(`${Emoji.LEAVE} Just left ${server.name}`);
    flushAsOf(server);
});
client.on('userBanned', (user, server) => {
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
});

client.on('serverUpdated', (oldServer, newServer) => {
    uploadServers(newServer); // TODO: this must be changed (don't catch up messages)
});
// TODO: store history
client.on('channelCreated', (channel:Discord.ServerChannel) => {
    if (channel.type === 'text') uploadServers(channel.server); // TODO: this must be changed
});
// TODO: store history
client.on('channelUpdated', (oldChannel, newChannel:Discord.ServerChannel) => {
    if (newChannel.type === 'text') uploadServers(newChannel.server); // TODO: this must be changed
});
// TODO: store history
client.on('channelDeleted', (channel:Discord.ServerChannel) => {
    if (channel.type === 'text') uploadServers(channel.server); // TODO: this must be changed
});

function userInOtherServersThan({id}:Discord.User, server:Discord.Server) {
    const serverIsOther = s => (s !== server) && s.members.has('id', id);
    return client.servers.find(serverIsOther) !== -1;
}
/**
 * Old - offline, new - user.status
 *   New user: update user & 1 server event
 *   Existent user: only 1 server event
 */
client.on('serverNewMember', (server, user) => {
    loggy.log(`serverNewMember: ${user.name}`);
    uploadUsers(user); // Fine to superfluously upload

    const newUser = !userInOtherServersThan(user, server);
    uploadUserStatus(
        user,
        Statuses.FOREIGN, getStatus(user),
        server, newUser
    );
});
/**
 * Old - user.status, new - offline
 *   User goodbye: update user & 1 server event
 *   User in others: only 1 server event
 */
client.on('serverMemberRemoved', (server, user) => {
    const userGoodbye = !userInOtherServersThan(user, server);
    uploadUserStatus(
        user,
        getStatus(user), Statuses.FOREIGN,
        server, userGoodbye
    );
})

// 'presence' = user changed
client.on('presence', (oldUser, newUser) => {
    if (newUser.avatarURL !== oldUser.avatarURL || newUser.name !== oldUser.name) {
        uploadUsers(newUser);
    }

    if (newUser.status === oldUser.status) return;
    uploadUserStatus(
        newUser,
        getStatus(oldUser), getStatus(newUser)
    );
});

/*function uploadUserStatus(
    {id: uid}:Discord.User, oldStatus:string, newStatus:string,
    server?:Discord.Server, includeUser = true) {

    if (newStatus === oldStatus) return Promise.resolve();

    const time = Date.now();

    const dir = `user_statuses/${uid}`;
    const update = includeUser ? {
        [`${dir}/${time}`]: oldStatus,
        [`${dir}/current`]: newStatus
    } : {};

    const serverHas = s => s.members.has('id', uid)
    const servers:Discord.Server[] = server
        ? [server]
        : client.servers.filter(serverHas);

    for (const {id: sid} of servers) {
        const dir = `server_statuses/${sid}`;
        update[`${dir}/${time}/${uid}`] = oldStatus;
        update[`${dir}/current/${uid}`] = newStatus;
    }

    console.dir(update);
    return root.update(update);
}*/
function uploadUserStatus(
    {id: uid}:Discord.User,
    oldStatus:string, newStatus:string,
    server?:Discord.Server, includeUser = true) {

    if (newStatus === oldStatus) return Promise.resolve();

    const time = Date.now();

    // Servers this user is a part of
    const servers:Discord.Server[] = server ? [server] :
        client.servers.filter(s => s.members.has('id', uid));

    // `server_events`
    const update = objectMap(servers,
        s => `server_events/${s.id}/${time}/${uid}`,
        s => ({from: oldStatus, to: newStatus})
    );
    // `members` (current server roster)
    const leaving = (newStatus === Statuses.FOREIGN);
    objectMap(servers,
        s => `members/${s.id}/users/${uid}`,
        s => leaving ? null : newStatus,
        update
    );
    if (includeUser) {
        update[`user_events/${uid}/${time}`] = oldStatus;
    }
    /*const serverHas = s => s.members.has('id', uid)
    const servers:Discord.Server[] = server
        ? [server]
        : client.servers.filter(serverHas);

    for (const {id: sid} of servers) {
        const dir = `server_statuses/${sid}`;
        update[`${dir}/${time}/${uid}`] = oldStatus;
        update[`${dir}/current/${uid}`] = newStatus;
    }

    console.dir(update);
    return root.update(update);*/
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
        console.dir(client);

        uploadServers(...client.servers).then(() => {
            loggy.log(`${Emoji.WHEW} Whew, it's all over`);
        });

        uploadUsers(...client.users);
        for (const user of client.users) {
            uploadUserStatus(user, Statuses.UNTRACKED, user.status);
        }
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
