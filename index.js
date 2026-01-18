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
const { getGroupAdmins } = require("./lib/functions");
const { commands } = require("./command");
const { connectDB, getBotSettings, updateSetting } = require("./plugins/bot_db");

const activeSockets = new Set();
global.BOT_SESSIONS_CONFIG = {};
const PORT = process.env.PORT || 8000;

// --- 📦 MongoDB Session Schema ---
const SessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: Object, required: true }
}, { collection: 'sessions' });
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema);

const decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
        const decode = jid.split(':');
        return (decode[0] + '@' + decode[1].split('@')[1]) || jid;
    }
    return jid;
};

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'web')));

let codeRouter = require('./pair'); 
app.use('/code', codeRouter);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'pair.html'));
});

// --- 🚀 Core Bot System ---
async function startSystem() {
    await connectDB();
    
    const pluginsPath = path.join(__dirname, "plugins");
    if (fs.existsSync(pluginsPath)) {
        fs.readdirSync(pluginsPath).forEach((plugin) => {
            if (path.extname(plugin).toLowerCase() === ".js") {
                try { require(`./plugins/${plugin}`); } catch (e) { console.error(`[Loader] Error ${plugin}:`, e); }
            }
        });
    }
    console.log(`✨ Loaded: ${commands.length} Commands`);

    const allSessions = await Session.find({});
    console.log(`📂 Total sessions: ${allSessions.length}. Connecting...`);
    for (let sessionData of allSessions) {
        await connectToWA(sessionData);
    }

    Session.watch().on('change', async (data) => {
        if (data.operationType === 'insert') {
            console.log("🆕 New session detected! Connecting...");
            await connectToWA(data.fullDocument);
        }
    });
}

async function connectToWA(sessionData) {
    const userNumber = sessionData.number.split("@")[0];
    global.BOT_SESSIONS_CONFIG[userNumber] = await getBotSettings(userNumber);

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
        patchMessageBeforeSending: (message) => {
            const requiresPatch = !!(message.buttonsMessage || message.templateMessage || message.listMessage || message.interactiveMessage);
            if (requiresPatch) {
                return { viewOnceMessage: { message: { messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, ...message } } };
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
            if (reason !== DisconnectReason.loggedOut) {
                setTimeout(() => connectToWA(sessionData), 5000);
            } else {
                await Session.deleteOne({ number: sessionData.number });
                await fs.remove(authPath);
            }
        } else if (connection === "open") {
            console.log(`✅ [${userNumber}] Connected via Elite Engine`);
            let currentSettings = global.BOT_SESSIONS_CONFIG[userNumber];
            if (currentSettings?.connectionMsg === 'true') {
                await zanta.sendMessage(decodeJid(zanta.user.id), {
                    text: `*${currentSettings.botName || 'ZANTA-MD'}* is Online 🤖`,
                    ai: true 
                });
            }
        }
    });

    zanta.ev.on("creds.update", saveCreds);

    zanta.ev.on("messages.upsert", async ({ messages }) => {
        const mek = messages[0];
        if (!mek || !mek.message) return;

        // ✅ User Number එක හරියට ලබා ගැනීම (Settings Load කිරීමට)
        const myNumber = zanta.user.id.split(':')[0];
        const userSettings = global.BOT_SESSIONS_CONFIG[myNumber] || {};
        
        const from = mek.key.remoteJid;
        const type = getContentType(mek.message);
        const body = (type === "conversation") ? mek.message.conversation : (mek.message[type]?.text || mek.message[type]?.caption || "");
        const prefix = userSettings?.prefix || ".";
        
        // --- 🔘 Menu Reply Logic ---
        const isReply = mek.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const isCmd = body.startsWith(prefix);

        // මැසේජ් එක Command එකක් නොවී, Reply එකක් නම් (Menu එකට අංකයෙන් Reply කිරීම)
        if (!isCmd && isReply) {
            const { lastMenuMessage } = require("./plugins/menu"); // Menu plugin එකෙන් memory එක ගන්නවා
            const quotedId = mek.message.extendedTextMessage.contextInfo.stanzaId;
            
            if (lastMenuMessage.get(from) === quotedId) {
                const menuCmd = commands.find(c => c.pattern === "menu");
                if (menuCmd) {
                    return await menuCmd.function(zanta, mek, sms(zanta, mek), {
                        from, body, isCmd: true, command: "menu", args: [body.trim()],
                        reply: (text) => zanta.sendMessage(from, { text, ai: true }, { quoted: mek }),
                        prefix, userSettings
                    });
                }
            }
        }

        if (from === "status@broadcast" && userSettings?.autoStatusSeen === 'true') {
            await zanta.readMessages([mek.key]);
            return;
        }

        if (!isCmd) return;

        const m = sms(zanta, mek);
        const commandName = body.slice(prefix.length).trim().split(" ")[0].toLowerCase();
        const args = body.trim().split(/ +/).slice(1);
        const reply = (text) => zanta.sendMessage(from, { text, ai: true }, { quoted: mek });

        const cmd = commands.find(c => c.pattern === commandName || (c.alias && c.alias.includes(commandName)));
        if (cmd) {
            try {
                await cmd.function(zanta, mek, m, {
                    from, body, isCmd, command: commandName, args, q: args.join(" "),
                    reply, prefix, userSettings
                });
            } catch (e) { console.error(e); }
        }
    });
}

startSystem();

app.listen(PORT, () => {
    console.log(`🚀 ZANTA-MD Server & Site started on port ${PORT}`);
});
