import * as Discord from 'discord.js';
import * as config from 'config';
import * as util from 'util';

import Messager from './Messager';
import Emoji from './Emoji';

const consoleLog   = console.log.bind(console);
const consoleError = console.error.bind(console);

const logFormat   = mess => mess;
const errorFormat = (mention, mess) => `${mention} ${Emoji.ERROR} ${mess}`;
const codeFormat  = mess => '```\n' + mess + '\n```';

export default class Loggy {

    private _messager:Messager;

    awaitLogServer:Promise<Discord.Server>;
    private _logServer:Discord.Server;
    private _logServerResolve:(server:Discord.Server) => void;

    constructor(messager:Messager) {
        this._messager = messager;
        this.awaitLogServer = new Promise(resolve => {
            this._logServerResolve = (logServer:Discord.Server) => {
                this._logServer = logServer;
                resolve(logServer);
            }
        });
    }

    setLogServer(server:Discord.Server) {
        this._logServerResolve(server);
    }
    get logServer() {
        return this._logServer;
    }

    private _logit(logFunction:(s:string) => void, chatFormat:(s:string) => string, messages:any[]) {
        return this.awaitLogServer.then((logServer) => {
            const logContent = messages.map(message => (typeof message === 'object')
                ? util.inspect(message, {colors: true})
                : message
            ).join('\n');
            const messageContent = messages.map((message, i) => (typeof message === 'object')
                ? codeFormat(util.inspect(message))
                : (i === 0 ? chatFormat(message) : message)
            ).join('\n');

            logFunction(logContent);
            return this._messager.send(logServer, messageContent);
        });
    }
    log(...messages):Promise<{}> {
        return this._logit(consoleLog, logFormat, messages);
    }
    error(...messages):Promise<{}> {
        const mention = `<@${config.get('settings.discordGod')}>`;
        return this._logit(consoleError, errorFormat.bind(null, mention), messages);
    }
}