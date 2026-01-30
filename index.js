const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    getContentType,
    Browsers
} = require("baileys-elite");

const fs = require("fs-extra");
const P = require("pino");
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const config = require("./config");
const { sms } = require("./lib/msg");
const { commands } = require("./command");
const { connectDB, getBotSettings } = require("./plugins/bot_db");

// Heroku specific fixes
process.removeAllListeners('warning');
process.on('unhandledRejection', (reason, promise) => {
    console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const activeSockets = new Set();
global.BOT_SESSIONS_CONFIG = {};
const PORT = process.env.PORT || 8000;

// --- 📦 MongoDB Session Schema ---
const SessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'sessions' });
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

// MongoDB Connection (Heroku compatible)
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/zanta_md";

async function connectMongoDB() {
    try {
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 30000,
            socketTimeoutMS: 45000,
        });
        console.log('✅ MongoDB Connected Successfully');
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error.message);
        // Continue without MongoDB for initial startup
    }
}

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decode = jid.split(':');
        return (decode[0] + '@' + decode[1].split('@')[1]) || jid;
    }
    return jid;
};

const app = express();

// Middleware
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'web')));

// Health check endpoint for Heroku
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        sessions: activeSockets.size 
    });
});

// Route for pairing
let codeRouter;
try {
    codeRouter = require('./pair');
    app.use('/code', codeRouter);
} catch (error) {
    console.log('Pair router not available:', error.message);
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// --- 🚀 Core Bot System ---
async function startSystem() {
    console.log('🚀 Starting ZANTA-MD System...');
    
    // Connect to MongoDB
    await connectMongoDB();
    
    // Load plugins
    const pluginsPath = path.join(__dirname, "plugins");
    if (fs.existsSync(pluginsPath)) {
        const pluginFiles = fs.readdirSync(pluginsPath).filter(file => 
            path.extname(file).toLowerCase() === ".js"
        );
        
        for (const plugin of pluginFiles) {
            try {
                require(`./plugins/${plugin}`);
                console.log(`✅ Loaded plugin: ${plugin}`);
            } catch (e) {
                console.error(`❌ Error loading plugin ${plugin}:`, e.message);
            }
        }
    }
    
    if (commands && Array.isArray(commands)) {
        console.log(`✨ Loaded: ${commands.length} Commands`);
    } else {
        console.log('⚠️ No commands loaded');
    }

    // Load existing sessions
    try {
        const allSessions = await Session.find({});
        console.log(`📂 Total sessions: ${allSessions.length}. Connecting...`);
        
        for (let sessionData of allSessions) {
            await connectToWA(sessionData);
        }
        
        // Watch for new sessions
        Session.watch().on('change', async (data) => {
            if (data.operationType === 'insert') {
                console.log("🆕 New session detected! Connecting...");
                await connectToWA(data.fullDocument);
            }
        });
    } catch (error) {
        console.error('❌ Error loading sessions:', error.message);
    }
}

async function connectToWA(sessionData) {
    try {
        const userNumber = sessionData.number.split("@")[0];
        console.log(`🔗 Connecting session: ${userNumber}`);
        
        // Initialize settings
        global.BOT_SESSIONS_CONFIG[userNumber] = await getBotSettings(userNumber) || {
            botName: config.DEFAULT_BOT_NAME || "MASTER-MD",
            prefix: config.DEFAULT_PREFIX || ".",
            connectionMsg: "true"
        };

        const authPath = path.join(__dirname, `./auth/${userNumber}/`);
        await fs.ensureDir(authPath);
        await fs.writeJSON(path.join(authPath, "creds.json"), sessionData.creds);

        const { state, saveCreds } = await useMultiFileAuthState(authPath);

        const zanta = makeWASocket({
            logger: P({ level: "silent" }),
            printQRInTerminal: false,
            browser: Browsers.ubuntu("Chrome"),
            auth: state,
            syncFullHistory: false,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
            markOnlineOnConnect: false,
            patchMessageBeforeSending: (message) => {
                const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage || message.interactiveMessage);
                if (requiresPatch) {
                    return { 
                        viewOnceMessage: { 
                            message: { 
                                messageContextInfo: { 
                                    deviceListMetadata: {}, 
                                    deviceListMetadataVersion: 2 
                                }, 
                                ...message 
                            } 
                        } 
                    };
                }
                return message;
            }
        });

        activeSockets.add(zanta);

        zanta.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === "close") {
                activeSockets.delete(zanta);
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log(`🔌 [${userNumber}] Disconnected. Reason code: ${reason}`);
                
                if (reason !== DisconnectReason.loggedOut) {
                    console.log(`🔄 [${userNumber}] Reconnecting in 5 seconds...`);
                    setTimeout(() => connectToWA(sessionData), 5000);
                } else {
                    console.log(`🗑️ [${userNumber}] Logged out. Cleaning up...`);
                    await Session.deleteOne({ number: sessionData.number });
                    await fs.remove(authPath);
                }
            } else if (connection === "open") {
                console.log(`✅ [${userNumber}] Connected via Elite Engine`);
                
                let currentSettings = global.BOT_SESSIONS_CONFIG[userNumber];
                if (currentSettings?.connectionMsg === 'true') {
                    await zanta.sendMessage(decodeJid(zanta.user.id), {
                        text: `*${currentSettings.botName || 'MASTER-MD'}* is Online 🤖\n\nPowered by ZANTA-MD Elite`,
                        ai: true 
                    });
                }
            }
        });

        zanta.ev.on("creds.update", saveCreds);

        zanta.ev.on("messages.upsert", async ({ messages }) => {
            const mek = messages[0];
            if (!mek || !mek.message) return;

            // ✅ Get user number properly
            const myNumber = zanta.user.id.split(':')[0];
            const userSettings = global.BOT_SESSIONS_CONFIG[myNumber] || {};
            
            const from = mek.key.remoteJid;
            const type = getContentType(mek.message);
            const body = (type === "conversation") ? mek.message.conversation : 
                        (mek.message[type]?.text || mek.message[type]?.caption || "");
            const prefix = userSettings?.prefix || ".";
            
            // --- 🔘 Menu Reply Logic ---
            const isReply = mek.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const isCmd = body.startsWith(prefix);

            // Handle menu replies
            if (!isCmd && isReply) {
                try {
                    const { lastMenuMessage } = require("./plugins/menu");
                    const quotedId = mek.message.extendedTextMessage.contextInfo.stanzaId;
                    
                    if (lastMenuMessage && lastMenuMessage.get(from) === quotedId) {
                        const menuCmd = commands.find(c => c.pattern === "menu");
                        if (menuCmd) {
                            return await menuCmd.function(zanta, mek, sms(zanta, mek), {
                                from, body, isCmd: true, command: "menu", args: [body.trim()],
                                reply: (text) => zanta.sendMessage(from, { text, ai: true }, { quoted: mek }),
                                prefix, userSettings
                            });
                        }
                    }
                } catch (e) {
                    console.error('Menu reply error:', e.message);
                }
            }

            // Auto status seen
            if (from === "status@broadcast" && userSettings?.autoStatusSeen === 'true') {
                await zanta.readMessages([mek.key]);
                return;
            }

            if (!isCmd) return;

            try {
                const m = sms(zanta, mek);
                const commandName = body.slice(prefix.length).trim().split(" ")[0].toLowerCase();
                const args = body.trim().split(/ +/).slice(1);
                const reply = (text) => zanta.sendMessage(from, { text, ai: true }, { quoted: mek });

                const cmd = commands.find(c => 
                    c.pattern === commandName || 
                    (c.alias && c.alias.includes(commandName))
                );
                
                if (cmd && cmd.function) {
                    await cmd.function(zanta, mek, m, {
                        from, body, isCmd, command: commandName, args, 
                        q: args.join(" "), reply, prefix, userSettings
                    });
                }
            } catch (e) { 
                console.error(`Command error [${commandName}]:`, e.message);
            }
        });

        // Error handling
        zanta.ev.on("error", (error) => {
            console.error(`[${userNumber}] Socket error:`, error.message);
        });

    } catch (error) {
        console.error(`❌ Error connecting session ${sessionData?.number}:`, error.message);
    }
}

// Start the system
startSystem().catch(error => {
    console.error('❌ Failed to start system:', error);
});

// Start Express server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ZANTA-MD Server started on port ${PORT}`);
    console.log(`🌐 Health check: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
        console.log('HTTP server closed.');
        mongoose.connection.close(false, () => {
            console.log('MongoDB connection closed.');
            process.exit(0);
        });
    });
});

// Keep-alive for Heroku
setInterval(() => {
    console.log(`🔄 Keep-alive: ${activeSockets.size} active sessions`);
}, 300000); // 5 minutes
