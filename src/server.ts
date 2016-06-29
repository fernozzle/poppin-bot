import * as Discord from 'discord.js';
import * as config from 'config';
const pkginfo = require('pkginfo')(module);
const firebase = require('firebase');
const swearFilter = new (require('bad-words'))();

firebase.initializeApp(config.get('firebase.initializeParams'));
const root = firebase.database().ref();

const loggy = {
    logServer: null,
    log: function(...messages:any[]) {
        const message = messages.join(' ');
        console.log(message);
        client.sendMessage(this.logServer, '\u2139 ' + message);
    },
    error: function(...messages:any[]) {
        const mention = `<@${config.get('settings.discordGod')}>`;
        const message = messages.join(' ');
        console.error(message);
        client.sendMessage(this.logServer, mention + ' \u{1F6A8} ' + message);
    },
}


function pick(...possibilities) {
    return possibilities[Math.random() * possibilities.length >> 0];
}
function type(channel: Discord.ChannelResolvable, messageArg: (string | string[])) {
    if (messageArg.length === 0) return Promise.resolve(null);

    client.startTyping(channel);
    return new Promise(function(resolve, reject) {
        function startTyping(remaining: string[]) {
            client.stopTyping(channel);
            if (remaining.length === 0) {
                resolve();
                return;
            }
            client.startTyping(channel);
            setTimeout(function() {
                client.sendMessage(channel, remaining[0])
                startTyping(remaining.slice(1));
            }, 1500);
        }
        startTyping((typeof messageArg === 'string') ? [messageArg] : messageArg);
    });
}

function userCan(user:Discord.User, server?:Discord.Server, permission?:string) {
    // Yes if it's me
    if (config.get('settings.discordGod') === user.id) return true;

    // No if no server specified
    if (!server) return false;

    // Yes if it's the server's owner
    if (server.owner === user) return true;

    // Yes if the user's role in the server can "manage server"
    const roles = server.rolesOf(user);
    return roles.findIndex(role => role.hasPermission(permission)) != -1;
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
            if (ids.length > 1) reject(`There are ${ids.length} servers named ` + query);
            resolve({id: ids[0], name: query});
        // Try by ID
        }).catch(() => root.child('servers/' + query).once('value'))
        .then(serverSnap => {
            if (serverSnap.exists()) {
                resolve({id: query, name: serverSnap.val().name});
            } else {
                reject(`Couldn't find a server with name or ID ` + query);
            }
        });
    })
}
function selectServer(query:string, message:Discord.Message, {permission, missing, unprivileged}):Promise<Discord.Server> {
    return new Promise((resolve, reject) => {
        // PM, no server specified
        if (!message.server && !query) {
            throw type(message, missing);
        }

        // Find specified server, with message's server as default
        const foundServer:Discord.Server = message.server || client.servers.find(server => {
            const serve = server as Discord.Server;
            return serve.id === query || serve.name.toLowerCase() === query.toLowerCase();
        });

        // Server not found
        if (!foundServer) {
            throw type(message, `I'm not watching any servers with the name or ID \`${query}\``);
        }

        // Insufficient permissions
        if (!userCan(message.author, foundServer, permission)) {
            throw type(message, unprivileged(foundServer));
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
                `You could also type \`@${client.user.name} stop\` on any channel in the server itself.`,
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
            if (!message.server) type(message.author, lines); // PM? Tell em
            const leave = () => server.leave();
            return (announce ? type(server, lines) : Promise.resolve(null)).then(leave);
        }).catch(error => {
            loggy.error(`Error leaving a server: `, error)
        });
    },
    'silently-leave': function(tail:string, message:Discord.Message) {
        return this['leave'](tail, message, {announce: false});
    },

    // throwIfUnable is true for command-less callings, gives a dumb response on catch
    'join': function(tail:string, message:Discord.Message, {throwIfUnable = false, announce = true} = {}) {
        if (!tail) {
            if (throwIfUnable) return Promise.reject(`No invite URL given`);
            return type(message, `Repeat that with an invite URL after it!`);
        }
        
        const serversOld = client.servers.slice();
        const name = message.author.name;
        return new Promise((resolve, reject) => (/^http/.test(tail) ? resolve : reject)())
        .then(() => client.joinServer(tail))
        .then(server => { // It's an invite!
            if (serversOld.indexOf(server) !== -1) {
                return type(message, [
                    `Thanks for the invite ${name}`,
                    `It was very good and it worked`,
                    `But I'm already on ${server.name}!`,
                    `Check it out: ${getLiveUrl(server.id)}`
                ]);
            }
            loggy.log(`Used invite ${tail} to join server ${server.name}, which has ${server.members.length} members`);
            const thank = type(message, pick(
                `Dam ${name} you just got me into ${server.name} imma check out whats poppin in there`,
                `O shingle waddup ${name} its ${server.name} thanks for the invite`,
                `Woah is this ${server.name}? Thank you so much for the invite ${name}`
            ));
            root.child('invites/' + server.id).push(tail);
            if (!announce) return thank;

            const serverRef = root.child(`servers/` + server.id);
            return thank.then(() => serverRef.once('value'))
            .then(serverSnap => {
                uploadServers(server);
                return type(server, !serverSnap.exists() ? [
                    `Hi I'm ${client.user.name}, and ${message.author} sent me here`,
                    `I make live dot plots of your server's activity stats so you can always see which channels are POPPIN.`,
                    `Here's the graph for ${server.name}: ${getLiveUrl(server.id)}`
                ] : [
                    `Hi I'm ${client.user.name} and ${message.author} has brought me back`,
                    `Once again, my live dot plot of ${server.name} is at ${getLiveUrl(server.id)}`
                ])
            });
        }, () => {
            if (throwIfUnable) throw `Couldn't join invite`;
            loggy.error(`Couldn't join server from the invite ${tail}`);
            return type(message, [
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
            return type(message, `You don't have permission to do list em off`);
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
            return type(message, [
                `I'm connected to ${onlineIdNames.length} servers:`,
                onlineIdNames.map(({id, name}) => `${name} (${id})`).join('\n'),
                `I'm not connected to ${offlineIdNames.length} servers:`,
                offlineIdNames.map(({id, name}) => `${name} (${id})`).join('\n')
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
        return selectServer(tail, message, options).then((server) => {
            return type(message, [
                `${server.name} has ${server.members.length} members:`,
                server.members.join('\n')
            ])
        }).catch(() => {});
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
        return selectServer(tail, message, options).then((server) => {
            const cs = server.channels.filter(c => c.type === 'text');
            return type(message, [
                `${server.name} has ${cs.length} channel${cs.length === 1 ? '' : 's'}:`,
                cs.join('\n')
            ])
        }).catch(() => {});
    },
    'clear': function(tail:string, message:Discord.Message) {
        if (!userCan(message.author)) {
            return type(message, `You don't have permission to clear all knowledge of ` + tail);
        }
        if (!tail && !message.server) return type(message, [
            `Could you repeat that with a server name or ID?`
        ]);

        function clearServer({id, name}) {
            if (id === loggy.logServer.id) return;
            const server = client.servers.find(server => server.id === id);
            if (server) server.leave().then(() => loggy.log(`Left ${name} to clear`));
            const updateObj = {
                ['servers/'  + id]: null,
                ['channels/' + id]: null,
                ['messages/' + id]: null
            };
            return root.update(updateObj)
            .then(() => type(message, `Cleared messages on ` + name));
        }

        if (tail === 'all') {
            return root.child('servers').once('value')
            .then(serversSnap => {
                const serversObj = serversSnap.val();
                const ids = Object.keys(serversObj);
                const idNames = ids.map(id => ({id, name: serversObj[id].name}));
                return Promise.all(idNames.map(clearServer))
                .catch(error => loggy.error(`Error clearing all servers:`, error));
            });
        }

        return findServerId(tail || message.server.id)
        .then(clearServer)
        .catch(error => loggy.error(`Error clearing server ${tail}:`, error));
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
        return type(message, `Here's my live dot plot of ${message.server}: ${getLiveUrl(message.server.id)}`);
    }
    return type(message, pick(
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
function uploadServers(...servers:Discord.Server[]) {
    const updateData = {};
    for (const server of servers) {
        updateData['servers/' + server.id] = {
            name:           server.name,
            icon:           server.iconURL,
            defaultChannel: server.defaultChannel.id
        };

        const channels = {};
        for (const channel of server.channels) {
            if (channel.type !== 'text') continue;

            catchUp(server, channel, channel);
            channels[channel.id] = {
                name:     channel.name,
                position: channel.position
            }
        }
        updateData['channels/' + server.id] = channels;
    }
    const serverNames = servers.map(server => server.name);
    root.update(updateData).then(
        () => loggy.log('Uploaded servers & channels:', serverNames),
        error => loggy.error(`Error uploading ${serverNames}:`, error)
    );
}
function channelName(channel: Discord.ServerChannel) {
    return `${channel.server.name}#${channel.name}`;
}

const client = new Discord.Client();

function uploadMessages(...messages: Discord.Message[]) {
    const messagesData = {};
    for (const message of messages) {
        const mentionsObj = {};
        message.mentions.forEach(user => mentionsObj[user.id] = true)
        const swears = swearFilter.isProfane(message.content);
        messagesData[message.id] = {
            //text: message.content,
            len:  message.cleanContent.length,
            time: message.timestamp,
            user: message.author.id,
            chan: message.channel.id,
            mentions: mentionsObj,
            swears: swears ? true : null
        };
    }
    root.child(`messages/${messages[0].server.id}`).update(messagesData);
}

client.on('message', function(message: Discord.Message) {
    const author = message.author;

    // It's a public chat message
    if (message.channel instanceof Discord.TextChannel) {
        const textChannelName = channelName(message.channel as Discord.TextChannel);
        //loggy.log(`Message on ${textChannelName} by ${author.name}:`, message.cleanContent);
        uploadMessages(message);

    } else { // It's a PM
        loggy.log(`PM from ${author.name}:`, message.cleanContent);
    }

    if (author === client.user) return;
    Promise.resolve().then(() => takeCommand(message)).catch((error) => {
        console.error(`Couldn't take command "${message.cleanContent}":`, error)
    });
});

function catchUp(server: Discord.Server, channel: Discord.ServerChannel,
    before: Discord.ServerChannel | Discord.Message) {

    client.getChannelLogs(channel, 100, {before}, function(error, messages) {
        if (error) {
            loggy.error(`Error getting logs on ${channelName(channel)}:`, error);
            return;
        }
        if (messages.length === 0) {
            loggy.log(`Gotten every last message from ${channelName(channel)}`)
            return;
        }

        if (before instanceof Discord.ServerChannel) {
            loggy.log(`Got latest ${messages.length} messages from ${channelName(channel)}`);
        } else {
            loggy.log(`Got another ${messages.length} messages from ${channelName(channel)}`);
        }

        // Check if Firebase already has the earliest of 100 messages
        const earliestMessage = messages[messages.length - 1];
        const earliestId = `messages/${server.id}/${earliestMessage.id}`;
        root.child(earliestId).once('value', function(snap) {
            if (snap.exists()) {
                loggy.log(`All caught up in ${channelName(channel)}!`)
            } else {
                catchUp(server, channel, earliestMessage);
            }
            uploadMessages(...messages); // Upload 100 messages either way
        });
    });
}
function uploadUsers(...users: Discord.User[]) {
    const usersData = {};
    for (const {id, name, avatarURL: avatar} of users) {
        usersData[id] = {name, avatar};
    }
    root.child('users').update(usersData).then(() => {
        loggy.log(`Uploaded user${users.length === 1 ? '' : 's'}`, users.map(user => user.name))
    })
}
client.on('serverCreated', (server) => {
})
client.on('serverDeleted', (server) => {
    loggy.log(`Just left`, server.name);
});
client.on('userBanned', (user, server) => {
    if (user !== client.user) return;
    loggy.error(`Daaang I just got banned from ${server.name}!`);
});

client.on('serverUpdated', (oldServer, newServer) => {
    uploadServers(newServer);
});
client.on('channelCreated', (channel:Discord.ServerChannel) => {
    if (channel.type === 'text') uploadServers(channel.server);
});
client.on('channelUpdated', (oldChannel, newChannel:Discord.ServerChannel) => {
    if (newChannel.type === 'text') uploadServers(newChannel.server);
});
client.on('channelDeleted', (channel:Discord.ServerChannel) => {
    if (channel.type === 'text') uploadServers(channel.server);
});

client.on('serverNewMember', (server, user) => uploadUsers(user));
client.on('serverMemberUpdated', (server, old, newUser) => uploadUsers(newUser));

client.on('ready', () => {
    client.joinServer(config.get('settings.logServer') as string)
    .then(server => {
        loggy.logServer = server;
        
        loggy.log('\u2B50 Logged on \u2B50');
        console.dir(client);

        uploadServers(...client.servers);
        uploadUsers(...client.users);
    })
    client.userAgent.url     = module.exports.homepage;
    client.userAgent.version = module.exports.version;
    client.setPlayingGame(config.get('settings.discordStatus') as string);
})

function login() {
    client.loginWithToken(config.get('discord.token') + '');
}
client.on('disconnected', () => {
    login();
})
login();

process.on('uncaughtException', (error) => {
    console.log('Uncaught exception vvv');
    console.dir(error);
});