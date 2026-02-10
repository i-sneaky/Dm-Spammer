const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const axios = require('axios');

console.clear();

process.removeAllListeners('warning');
process.env.NODE_NO_WARNINGS = '1';

process.title = "DM Spammer"

const colors = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    gray: "\x1b[90m",
    white: "\x1b[37m"
};

function log(status, message) {
    const timestamp = new Date().toLocaleTimeString();
    let color = colors.cyan;
    
    if (status === '+') color = colors.green;
    else if (status === '~') color = colors.yellow;
    else if (status === '-') color = colors.red;
    else if (status === '#') color = colors.gray;
    
    console.log(`${colors.gray}[${timestamp}] ${color}[${status}]${colors.reset} ${message}`);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

let tokens = [];
const chanid = '1462568079740506196';
const tokenQueue = [];
let queueRunning = false;
const connects = 40;

async function loadTokens() {
    console.clear();
    
    try {
        if (!fs.existsSync('tokens.txt')) {
            fs.writeFileSync('tokens.txt', '', 'utf8');
            tokens = [];
            return { count: 0 };
        }
        
        const fileTokens = fs.readFileSync('tokens.txt', 'utf8').split(/\r?\n/).filter(Boolean);
        const validTokens = [];
        
        log('#', `Checking ${fileTokens.length} tokens`);
        
        const promises = fileTokens.map((token, index) => {
            return axios.get('https://discord.com/api/v9/users/@me', {
                headers: { 'Authorization': `Bot ${token}` },
                timeout: 2000
            })
            .then(response => ({
                index,
                token,
                valid: response.status === 200
            }))
            .catch(() => ({
                index,
                token,
                valid: false
            }));
        });

        const results = await Promise.all(promises);
        results.sort((a, b) => a.index - b.index);
        
        for (const result of results) {
            if (result.valid) {
                validTokens.push(result.token);
                log('+', `${result.token.slice(0, 15)}... valid`);
            } else {
                log('-', `${result.token.slice(0, 15)}... invalid`);
            }
        }
        
        tokens = validTokens;
        
        log('+', `Valid: ${validTokens.length}/${fileTokens.length}`);
        return { count: validTokens.length };
        
    } catch (e) {
        log('-', 'Token load error');
        tokens = [];
        return { count: 0 };
    }
}

async function sendMessageToDM(userId, token, content) {
    try {
        const response = await axios.post(
            `https://discord.com/api/v9/users/@me/channels`,
            { recipients: [userId] },
            {
                headers: { 
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 2000
            }
        );
        
        const channelId = response.data.id;
        
        const sendResponse = await axios.post(
            `https://discord.com/api/v9/channels/${channelId}/messages`,
            { content: content },
            {
                headers: { 'Authorization': `Bot ${token}` },
                timeout: 2000
            }
        );
        
        return { success: true, sent: 1 };
        
    } catch (error) {
        const status = error.response?.status;
        
        if (status === 40007 || status === 50007 || status === 10003) {
            return { success: false, error: 'User blocked DMs', blocked: true };
        }
        
        return { success: false, error: `Error ${status || 'unknown'}` };
    }
}

async function spamWithToken(token, userId) {
    try {
        let totalSent = 0;
        let blocked = false;
        
        for (let i = 0; i < 5; i++) {
            const result = await sendMessageToDM(userId, token, `.`);
            
            if (result.success) {
                totalSent++;
            } else {
                if (result.blocked) {
                    blocked = true;
                    break;
                }
            }
            
            if (i < 2) {
                await new Promise(r => setTimeout(r, 100));
            }
        }
        
        return { sent: totalSent, blocked: blocked };
        
    } catch (e) {
        return { sent: 0, blocked: false };
    }
}

async function processQueue() {
    if (queueRunning || tokenQueue.length === 0) return;
    
    queueRunning = true;
    const task = tokenQueue[0];
    
    try {
        if (tokens.length === 0) {
            await task.statusMsg.edit('No tokens loaded');
            return;
        }

        const validTokens = [...tokens];
        
        if (validTokens.length === 0) {
            await task.statusMsg.edit('No valid tokens');
            return;
        }
        
        await task.statusMsg.edit(`Starting with ${validTokens.length} bots`);
        
        const batches = [];
        for (let i = 0; i < validTokens.length; i += connects) {
            batches.push(validTokens.slice(i, i + connects));
        }
        
        let totalSent = 0;
        let successfulBots = 0;
        let blockedCount = 0;
        
        for (const batch of batches) {
            const batchPromises = batch.map(token => spamWithToken(token, task.targetId));
            
            const results = await Promise.allSettled(batchPromises);
            
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    const { sent, blocked } = result.value;
                    totalSent += sent;
                    if (sent > 0) successfulBots++;
                    if (blocked) blockedCount++;
                }
            }
            
            if (batch !== batches[batches.length - 1]) {
                await new Promise(r => setTimeout(r, 200));
            }
        }
        
        let response = `${totalSent} messages from ${successfulBots}/${validTokens.length} bots`;
        if (blockedCount > 0) {
            response += ` (${blockedCount} DMs blocked)`;
        }
        
        await task.statusMsg.edit(response);
        
    } catch (error) {
        await task.statusMsg.edit(`Error`);
    } finally {
        tokenQueue.shift();
        queueRunning = false;
        if (tokenQueue.length > 0) {
            setTimeout(processQueue, 100);
        }
    }
}

async function findUser(message, input) {
    if (!input) return null;
    
    if (/^\d+$/.test(input)) {
        return { id: input };
    }
    
    const mention = input.match(/<@!?(\d+)>/);
    if (mention) {
        return { id: mention[1] };
    }
    
    return { id: input };
}

client.on('messageCreate', async message => {
    if (!message.content.startsWith('!') || message.author.bot || !message.guild) return;
    
    if (message.author.id !== chanid) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'xd') {
        try {
            const userInput = args.join(' ');
            if (!userInput) return message.reply('Provide user');

            const target = await findUser(message, userInput);
            if (!target) return message.reply('User not found');

            const statusMsg = await message.reply(`Queueing xd on ${target.id}`);

            tokenQueue.push({
                targetId: target.id,
                statusMsg: statusMsg
            });

            processQueue();

        } catch (error) {
            message.reply(`Error`);
        }
    }

    if (command === 'tokens') {
        const tokenStatus = await loadTokens();
        message.reply(`Tokens loaded: ${tokenStatus.count}`);
    }

    if (command === 'reload') {
        const tokenStatus = await loadTokens();
        message.reply(`Reloaded: ${tokenStatus.count} tokens`);
    }

    if (command === 'queue') {
        message.reply(`Queue length: ${tokenQueue.length}`);
    }

    if (command === 'clear') {
        tokenQueue.length = 0;
        message.reply('Queue cleared');
    }
});

client.on('ready', () => {
    console.clear();
    loadTokens();
});

client.login('');
