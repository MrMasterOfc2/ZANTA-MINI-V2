const { cmd, commands } = require("../command");
const os = require('os');
const config = require("../config");

// 🖼️ MENU Image URL (ඔයාගේ එකම පාවිච්චි කළා)
const MENU_IMAGE_URL = "https://github.com/Akashkavindu/ZANTA_MD/blob/main/images/Gemini_Generated_Image_4xcl2e4xcl2e4xcl.png?raw=true";

// 🎯 Memory Map for Reply Logic
const lastMenuMessage = new Map();

cmd({
    pattern: "menu",
    react: "📜",
    desc: "Displays the main menu or a category list.",
    category: "main",
    filename: __filename,
},
async (zanta, mek, m, { from, reply, args, userSettings }) => {
    try {
        // Database එකෙන් එන userSettings ගන්නවා, නැත්නම් config එක ගන්නවා
        const settings = userSettings || global.BOT_SESSIONS_CONFIG[m.sender.split('@')[0]] || {};

        const finalPrefix = settings.prefix || config.DEFAULT_PREFIX || '.'; 
        const botName = settings.botName || config.DEFAULT_BOT_NAME || "MASTER-MD"; 
        const ownerName = settings.ownerName || config.DEFAULT_OWNER_NAME || 'Sahan Maduwantha';
        const mode = process.env.WORK_TYPE || "Public";
        const totalCommands = commands.filter(c => c.pattern).length;

        // 1. Grouping Commands
        const groupedCommands = {};
        const customOrder = ["main", "download", "tools", "logo", "owner"];

        commands.filter(c => c.pattern && c.pattern !== "menu").forEach(cmdData => {
            let cat = cmdData.category?.toLowerCase() || "other";
            if (!groupedCommands[cat]) groupedCommands[cat] = [];
            groupedCommands[cat].push(cmdData);
        });

        const categoryKeys = Object.keys(groupedCommands).sort((a, b) => {
            let indexA = customOrder.indexOf(a);
            let indexB = customOrder.indexOf(b);
            if (indexA === -1) indexA = 99;
            if (indexB === -1) indexB = 99;
            return indexA - indexB;
        });

        const categoryMap = {}; 
        categoryKeys.forEach((cat, index) => {
            categoryMap[index + 1] = cat;
        });

        // ------------------------------------------------------------------
        // A. SELECTION LOGIC (Reply එකක් ආවොත්)
        // ------------------------------------------------------------------
        let selectedCategory;
        let selectionText = args[0]?.toLowerCase() || m.body?.toLowerCase(); 

        if (selectionText && !m.body.startsWith(finalPrefix + 'menu')) {
            const num = parseInt(selectionText);
            if (!isNaN(num) && categoryMap[num]) {
                selectedCategory = categoryMap[num];
            }
        }

        if (selectedCategory && groupedCommands[selectedCategory]) {
            let displayTitle = selectedCategory.toUpperCase();
            let emoji = { main: '🏠', download: '📥', tools: '🛠', owner: '👑', logo: '🎨' }[selectedCategory] || '📌';

            let commandList = `╭━━〔 ${emoji} ${displayTitle} 〕━━┈⊷\n`;
            commandList += `┃★ 📝 Category : ${displayTitle}\n`;
            commandList += `┃★ 📊 Available : ${groupedCommands[selectedCategory].length}\n`;
            commandList += `╰━━━━━━━━━━━━━━┈⊷\n\n`;

            groupedCommands[selectedCategory].forEach((c) => {
                commandList += `┃ ◈ ⚡ ${finalPrefix}${c.pattern}\n`;
            });

            commandList += `\n╰━━━━━━━━━━━━━━┈⊷\n`;
            commandList += `> *© ${botName} Elite Engine*`;

            return await zanta.sendMessage(from, { 
                text: commandList,
                ai: true // Elite AI Icon
            }, { quoted: mek });
        }

        // ------------------------------------------------------------------
        // B. MAIN MENU MODE
        // ------------------------------------------------------------------
        let menuText = `╭━━〔 ${botName} 〕━━┈⊷\n`;
        menuText += `┃ 👑 *Owner* : ${ownerName}\n`; 
        menuText += `┃ ⚙ *Mode* : ${mode}\n`;
        menuText += `┃ 🔣 *Prefix* : [ ${finalPrefix} ]\n`;
        menuText += `┃ 📚 *Commands* : ${totalCommands}\n`;
        menuText += `╰━━━━━━━━━━━━━━┈⊷\n\n`;

        menuText += `╭━━━〔 📜 CATEGORIES 〕━━━━┈⊷\n`;
        categoryKeys.forEach((catKey, index) => {
            let emoji = { main: '🏠', download: '📥', tools: '🛠', logo: '🎨', owner: '👑' }[catKey] || '📌';
            menuText += `┃ ${index + 1}. ${emoji} ${catKey.toUpperCase()}\n`;
        });
        menuText += `╰━━━━━━━━━━━━━━━━━━┈⊷\n\n`;
        
        menuText += `*💡 Tip:* Reply with a number to view commands.\n`;
        menuText += `> *Powered by Sahan Maduwantha*`;

        const sentMessage = await zanta.sendMessage(from, {
            image: { url: MENU_IMAGE_URL },
            caption: menuText,
            ai: true, // Elite Engine AI feature
            contextInfo: {
                forwardingScore: 999,
                isForwarded: true,
                externalAdReply: {
                    title: `${botName} - Multi Device`,
                    body: "Cyber System WhatsApp Bot",
                    thumbnailUrl: MENU_IMAGE_URL,
                    sourceUrl: "https://whatsapp.com/channel/0029VbBc42s84OmJ3V1RKd2B",
                    mediaType: 1,
                    renderLargerThumbnail: false
                }
            }
        }, { quoted: mek });

        lastMenuMessage.set(from, sentMessage.key.id);

    } catch (err) {
        console.error("Menu Error:", err);
        reply("❌ Error generating menu.");
    }
});

module.exports = { lastMenuMessage };
