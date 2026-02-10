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
    else if (status === 'i') color = colors.yellow;
    
    console.log(`${colors.gray}[${timestamp}] ${color}[${status}]${colors.reset} ${message}`);
    
    try {
        if (!fs.existsSync('logs')) fs.mkdirSync('logs');
        fs.appendFileSync('logs/activity.log', `[${timestamp}] [${status}] ${message}\n`);
    } catch {}
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
        
        if (validTokens.length !== fileTokens.length) {
            fs.writeFileSync('tokens.txt', validTokens.join('\n'), 'utf8');
        }
        
        log('+', `Valid: ${validTokens.length}/${fileTokens.length}`);
        return { count: validTokens.length };
        
    } catch (e) {
        log('-', 'Token load error');
        tokens = [];
        return { count: 0 };
    }
}

function saveTokens() {
    try {
        fs.writeFileSync('tokens.txt', tokens.join('\n'), 'utf8');
    } catch (e) {}
}

function removeInvalidToken(invalidToken) {
    const index = tokens.indexOf(invalidToken);
    if (index !== -1) {
        tokens.splice(index, 1);
        saveTokens();
    }
}

async function testTokenFast(token) {
    try {
        await axios.get('https://discord.com/api/v9/users/@me', {
            headers: { 'Authorization': `Bot ${token}` },
            timeout: 1000
        });
        return true;
    } catch {
        removeInvalidToken(token);
        return false;
    }
}

async function createChannelFast(token, userId) {
    try {
        const response = await axios.post(
            'https://discord.com/api/v9/users/@me/channels',
            { recipients: [userId] },
            {
                headers: { 
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 1500
            }
        );
        return response.data?.id;
    } catch (error) {
        if (error.response?.status === 401 || error.response?.status === 403) {
            removeInvalidToken(token);
        }
        return null;
    }
}

async function sendBurst(channelId, token, count) {
    let sent = 0;
    
    for (let i = 0; i < count; i++) {
        try {
            await axios.post(
                `https://discord.com/api/v9/channels/${channelId}/messages`,
                { content: "." },
                {
                    headers: { 'Authorization': `Bot ${token}` },
                    timeout: 1000
                }
            );
            sent++;
        } catch (error) {
            if (error.response?.status === 401 || error.response?.status === 403) {
                removeInvalidToken(token);
                break;
            }
        }
        
        if ((i + 1) % 5 === 0) {
            await new Promise(r => setTimeout(r, 50));
        }
    }
    
    return sent;
}

async function spamWithToken(token, userId) {
    try {
        const channelId = await createChannelFast(token, userId);
        if (!channelId) return 0;
        
        const sent = await sendBurst(channelId, token, 5);
        return sent;
    } catch {
        return 0;
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

        await task.statusMsg.edit(`Testing ${tokens.length} tokens...`);
        
        const testPromises = tokens.map(token => testTokenFast(token));
        const testResults = await Promise.all(testPromises);
        const validTokens = tokens.filter((_, i) => testResults[i]);
        
        if (validTokens.length === 0) {
            await task.statusMsg.edit('No valid tokens');
            return;
        }
        
        await task.statusMsg.edit(`Starting with ${validTokens.length} valid bots`);
        
        const batches = [];
        for (let i = 0; i < validTokens.length; i += connects) {
            batches.push(validTokens.slice(i, i + connects));
        }
        
        let totalSent = 0;
        let successfulBots = 0;
        
        for (const batch of batches) {
            const batchPromises = batch.map(token => 
                spamWithToken(token, task.targetId).then(sent => ({ sent, token }))
            );
            
            const results = await Promise.allSettled(batchPromises);
            
            results.forEach(result => {
                if (result.status === 'fulfilled') {
                    const { sent } = result.value;
                    totalSent += sent;
                    if (sent > 0) successfulBots++;
                }
            });
            
            if (batch !== batches[batches.length - 1]) {
                await new Promise(r => setTimeout(r, 100));
            }
        }
        
        await task.statusMsg.edit(`${totalSent} messages from ${successfulBots}/${validTokens.length} bots`);
        
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
