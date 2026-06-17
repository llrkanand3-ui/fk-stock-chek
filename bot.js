const { Telegraf } = require('telegraf');
const axios = require('axios');
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- 🔒 CONFIGURATION ---
const BOT_TOKEN = '8956337441:AAEnebTRW9a8pzHad1HMWnJR6QR6wLN8PD0'; 
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 15000; // 🔥 STRICT 15 SECOND LOOP
const RENDER_URL = 'https://new-flipkart-tracker.onrender.com'; 
const DB_FILE = path.join(__dirname, 'database.json');
// ------------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};

let approvedUsersCache = [];

function initDatabase() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initialData = [ADMIN_CHAT_ID.toString()];
            fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
            approvedUsersCache = initialData;
            return;
        }
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        if (!fileContent.trim()) {
            approvedUsersCache = [ADMIN_CHAT_ID.toString()];
            return;
        }
        const users = JSON.parse(fileContent);
        if (!Array.isArray(users)) {
            approvedUsersCache = [ADMIN_CHAT_ID.toString()];
            return;
        }
        if (!users.includes(ADMIN_CHAT_ID.toString())) {
            users.push(ADMIN_CHAT_ID.toString());
        }
        approvedUsersCache = users.map(String);
    } catch (e) {
        approvedUsersCache = [ADMIN_CHAT_ID.toString()];
    }
}

initDatabase();

function isUserApproved(userId) {
    if (!userId) return false;
    return approvedUsersCache.includes(userId.toString());
}

const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.status(200).send('Financial Core Engine Fixed Live!'));
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Port Binding Successful on ${PORT}`));

setInterval(() => {
    axios.get(RENDER_URL).catch(() => {}); 
}, 15000); 

// --- 🛠️ NO CONTROL PANEL COMMAND-BASED SYSTEM ---

// 1. Start Command
bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (!isUserApproved(userId)) return ctx.reply("🔒 Access Denied!");
    ctx.reply("🤖 Spy Engine Live! Commands use karo:\n\n1. `/start_track <Flipkart_URL>` - Tracking chalu karne ke liye\n2. `/list_track` - Active tracking dekhne ke liye\n3. `/stop1`, `/stop2` - Specific number stop karne ke liye");
});

// 2. Start Track Command (`/start_track url`)
bot.command('start_track', async (ctx) => {
    const userId = ctx.from.id.toString();
    if (!isUserApproved(userId)) return;

    const parts = ctx.message.text.split(' ');
    if (parts.length < 2) {
        return ctx.reply("❌ Format galti hai! Aise use karo:\n`/start_track https://flipkart.com/...`");
    }

    const fkLink = parts.slice(1).join(' ').trim();
    if (!fkLink.includes('flipkart.com/')) {
        return ctx.reply("❌ Abe saaf Flipkart ka link dalo bhai!");
    }

    const chatId = ctx.chat.id.toString();
    let pid = "";
    try {
        const urlObj = new URL(fkLink);
        pid = urlObj.searchParams.get('pid');
    } catch (e) {}

    if (!pid) {
        const pidMatch = fkLink.match(/pid=([A-Z0-9]+)/i);
        if (pidMatch) pid = pidMatch[1];
    }
    if (!pid) pid = Buffer.from(fkLink).toString('base64').substring(0, 10);

    if (!activeUsers[chatId]) activeUsers[chatId] = [];
    if (activeUsers[chatId].some(item => item.id === pid)) {
        return ctx.reply("⚠️ Abe ye target pehle se hi radar par locked hai!");
    }

    // Set interval loop at exactly 15 seconds
    const intervalId = setInterval(() => { 
        checkFinancialFluctuations(ctx, chatId, pid, fkLink); 
    }, CHECK_INTERVAL);

    activeUsers[chatId].push({
        id: pid,
        url: fkLink,
        interval: intervalId
    });

    ctx.reply(`🕵️‍♂️ **Undercover Agent Active!**\n\nHar 15 second mein stock check kiya jaayega. Jaise hi stock mein aayega, non-stop khabar milegi!`);
    
    // Immediate check
    checkFinancialFluctuations(ctx, chatId, pid, fkLink);
});

// 3. List Track Command
bot.command('list_track', (ctx) => {
    const userId = ctx.from.id.toString();
    if (!isUserApproved(userId)) return;
    const chatId = ctx.chat.id.toString();

    if (!activeUsers[chatId] || activeUsers[chatId].length === 0) {
        return ctx.reply("😴 Abhi koi target radar par nahi hai, sab shant hai.");
    }

    let msg = "📋 <b>Radar Par Locked Targets Matrix:</b>\n\n";
    activeUsers[chatId].forEach((item, index) => {
        msg += `🔢 <b>Target [${index + 1}]</b>\n📦 <b>ID:</b> <code>${item.id}</code>\n🔗 <b>Link:</b> ${item.url}\n🛑 <b>Stop Command:</b> /stop${index + 1}\n\n`;
    });

    ctx.reply(msg, { parse_mode: 'HTML', disable_web_page_preview: true });
});

// 4. Dynamic Text Interceptor for /stop1, /stop2 etc.
bot.on('text', async (ctx, next) => {
    const text = ctx.message.text.trim().toLowerCase();
    
    if (text.startsWith('/stop')) {
        const userId = ctx.from.id.toString();
        if (!isUserApproved(userId)) return;
        const chatId = ctx.chat.id.toString();

        const numStr = text.replace('/stop', '').trim();
        const index = parseInt(numStr) - 1;

        if (isNaN(index) || !activeUsers[chatId] || !activeUsers[chatId][index]) {
            return ctx.reply("⚠️ Galat Target Number! `/list_track` karke check karo.");
        }

        const removedItem = activeUsers[chatId][index];
        clearInterval(removedItem.interval);
        activeUsers[chatId].splice(index, 1);

        ctx.reply(`🛑 <b>Target [${index + 1}] Permanent Stop Ho Gaya!</b>\nAb iski updates nahi aayengi bhai.`, { parse_mode: 'HTML' });
        return;
    }
    return next();
});

// --- 🔬 REAL-TIME STOCK SCRAPER ENGINE (15 SEC) ---
async function checkFinancialFluctuations(ctx, chatId, pid, originalUrl) {
    if (!activeUsers[chatId]) return;
    const itemIndex = activeUsers[chatId].findIndex(item => item.id === pid);
    if (itemIndex === -1) return;

    try {
        const response = await axios.get(originalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            timeout: 10000 
        });

        const html = response.data;
        
        // 1. Check Availability Status from HTML structure
        let isOutOfStock = html.includes('This item is currently out of stock') || 
                           html.includes('OUT OF STOCK') || 
                           html.includes('Notify Me');

        let currentPrice = "N/A";
        const jsonLdMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
        if (jsonLdMatch && jsonLdMatch[1]) {
            try {
                const jsonData = JSON.parse(jsonLdMatch[1].trim());
                const itemData = Array.isArray(jsonData) ? jsonData.find(i => i["@type"] === "Product" || i.offers) : jsonData;
                if (itemData && itemData.offers) {
                    let priceVal = Array.isArray(itemData.offers) ? itemData.offers[0].price : itemData.offers.price;
                    if (priceVal) currentPrice = String(priceVal).replace(/[^0-9]/g, '');
                    
                    // JSON check backup for stock status
                    let availability = Array.isArray(itemData.offers) ? itemData.offers[0].availability : itemData.offers.availability;
                    if (availability && availability.includes('OutOfStock')) {
                        isOutOfStock = true;
                    }
                }
            } catch (e) {}
        }

        // 🔥 LAGAATAAR ALERT IF IN STOCK (REAL-TIME ALL TIME LOOPS)
        if (!isOutOfStock) {
            let priceDisplay = currentPrice !== "N/A" ? `₹${currentPrice}` : "N/A";
            
            await bot.telegram.sendMessage(chatId, 
                `🔥 <b>Oo bhaiiii jaldi jaa STOCK MEIN AA GYA HAI!</b> 🔥\n\n💰 Live Price: <b>${priceDisplay}</b>\n\nLink par click karo aur order maaro:\n${originalUrl}`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        }

    } catch (err) {}
}

bot.telegram.deleteWebhook().then(() => {
    bot.launch().then(() => console.log("Command Spy Engine Live on 15 Sec Loops..."));
});
