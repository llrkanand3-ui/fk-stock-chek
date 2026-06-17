const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio'); 
const express = require('express');

// --- 🔒 FINAL SECURE CONFIGURATION ---
const BOT_TOKEN = '8956337441:AAEnebTRW9a8pzHad1HMWnJR6QR6wLN8PD0'; // 🔥 Aapka absolute correct token
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 15000; // 15 Seconds Stock Check Loop
const RENDER_URL = 'https://fk-stock-chek.onrender.com'; // 🔥 Aapka naya Render URL bina aakhiri slash ke
// ----------------------------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};

global.approvedList = global.approvedList || [ADMIN_CHAT_ID.toString()];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/605.1.15'
];

const app = express();
const PORT = process.env.PORT || 10000;

// 🔥 TELEGRAF WEBHOOK MIDDLEWARE (Conflict 409 ko jad se khatam karne ke liye)
app.use(bot.webhookCallback('/telegram-webhook'));

app.get('/', (req, res) => res.status(200).send('Flipkart Webhook Engine Online!'));

app.listen(PORT, '0.0.0.0', async () => {
    console.log(`🚀 Webhook Server listening on port ${PORT}`);
    try {
        // Automatically sets the webhook on Telegram side during boot
        await bot.telegram.setWebhook(`${RENDER_URL}/telegram-webhook`, {
            drop_pending_updates: true
        });
        console.log("🎯 Telegram Webhook successfully binded and flushed!");
    } catch (err) {
        console.log("⚠️ Webhook binding error: ", err.message);
    }
});

// SELF-PING ENGINE (Keeps Render alive)
setInterval(() => {
    axios.get(RENDER_URL).catch(() => {}); 
}, 30000); 

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat.id.toString();
    
    if (data.startsWith('stop_url_')) {
        const index = parseInt(data.split('_')[2]);
        if (activeUsers[chatId] && activeUsers[chatId][index]) {
            const removedItem = activeUsers[chatId][index];
            clearInterval(removedItem.interval);
            activeUsers[chatId].splice(index, 1);
            await ctx.answerCbQuery("Tracking band ho gayi! 🛑").catch(() => {});
            return ctx.reply(`🛑 Tracking stopped for:\n${removedItem.url}`, { disable_web_page_preview: true });
        } else {
            return ctx.answerCbQuery("⚠️ Already stopped.").catch(() => {});
        }
    }
});

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    if (global.approvedList.includes(userId)) {
        return ctx.reply("🤖 New Flipkart Tracker Bot Active!\n\n🔹 `/start_track <URL>`\n🔹 `/list_track`\n🔹 `/stop_all`");
    }
    ctx.reply(`🔒 **Access Denied!**\n\nAapki Telegram ID: \`${userId}\``);
});

bot.command('start_track', async (ctx) => {
    const userId = ctx.from.id.toString();
    if (!global.approvedList.includes(userId)) return ctx.reply("❌ Unapproved!");
    
    const chatId = ctx.chat.id.toString();
    const args = ctx.message.text.replace(/\n/g, ' ').split(' ').filter(arg => arg.trim() !== '');
    const flipkartLink = args.find(arg => arg.includes('flipkart.com') || arg.includes('fkrt.it'));
    
    if (!flipkartLink) return ctx.reply("❌ Valid Flipkart link bhejo!");
    if (!activeUsers[chatId]) activeUsers[chatId] = [];
    if (activeUsers[chatId].some(item => item.url === flipkartLink)) return ctx.reply("⚠️ Yeh pehle se track ho raha hai!");
    
    const intervalId = setInterval(() => { checkFlipkartStock(ctx, chatId, flipkartLink); }, CHECK_INTERVAL);
    activeUsers[chatId].push({ url: flipkartLink, interval: intervalId });
    ctx.reply("🚀 Tracking chalu ho gayi hai...");
    
    checkFlipkartStock(ctx, chatId, flipkartLink);
});

bot.command('list_track', (ctx) => {
    const userId = ctx.from.id.toString();
    if (!global.approvedList.includes(userId)) return ctx.reply("❌ Unapproved!");
    
    const chatId = ctx.chat.id.toString();
    if (!activeUsers[chatId] || activeUsers[chatId].length === 0) return ctx.reply("😴 Koyi active tracking nahi hai.");
    let msg = "📋 **Active Tracking Links:**\n\n";
    activeUsers[chatId].forEach((item, i) => { msg += `${i + 1}. ${item.url}\n\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

bot.command('stop_all', (ctx) => {
    const userId = ctx.from.id.toString();
    if (!global.approvedList.includes(userId)) return ctx.reply("❌ Unapproved!");
    
    const chatId = ctx.chat.id.toString();
    if (activeUsers[chatId] && activeUsers[chatId].length > 0) {
        activeUsers[chatId].forEach(item => clearInterval(item.interval));
        delete activeUsers[chatId];
        ctx.reply("🛑 Saari tracking band kar di gayi.");
    } else { ctx.reply("⚠️ Koyi active tracking nahi mili."); }
});

// --- 🔬 REAL-TIME STOCK ALERTS ---
async function checkFlipkartStock(ctx, chatId, targetUrl) {
    if (!activeUsers[chatId]) return;
    const itemIndex = activeUsers[chatId].findIndex(item => item.url === targetUrl);
    if (itemIndex === -1) return;

    const randomAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
        const response = await axios.get(targetUrl, { 
            headers: { 
                'User-Agent': randomAgent, 
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }, 
            timeout: 10000 
        });
        
        const htmlLower = response.data.toString().toLowerCase();
        
        // Asli buy/cart buttons ki presence check karega
        const hasBuyNowButton = htmlLower.includes('buy now') || htmlLower.includes('add to cart');
        const isOutOfStockText = htmlLower.includes('currently unavailable') || htmlLower.includes('this item is currently out of stock');

        if (hasBuyNowButton && !isOutOfStockText) {
            await bot.telegram.sendMessage(chatId, `🚨 **STOCK AAGYA HAII LGA JAKE FASTTT** 🚨\n\nLink:\n${targetUrl}`,
                Markup.inlineKeyboard([[Markup.button.callback('Stop Tracking 🛑', `stop_url_${itemIndex}`)]])
            ).catch(() => {});
        }
    } catch (e) {
        // Anti-crash silence
    }
}
