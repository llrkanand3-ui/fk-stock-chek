const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio'); 
const express = require('express');

// --- 🔒 FINAL CORRECTED CONFIGURATION ---
const BOT_TOKEN = '8956337441:AAEnebTRW9a8pzHad1HMWnJR6QR6wLN8PD0'; // 🔥 TOKENS LOCHA RESOLVED PERMANENTLY!
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 15000; // 15 Seconds Stock Check
const RENDER_URL = 'https://new-flipkart-tracker.onrender.com/'; 
// ----------------------------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};

global.approvedList = global.approvedList || [ADMIN_CHAT_ID.toString()];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

// 🔥 EXPRESS ENVIRONMENT FOR PORT BINDING
const app = express();
const PORT = process.env.PORT || 10000; 
app.get('/', (req, res) => res.status(200).send('Flipkart Engine Online!'));
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Strict Port Binding Successful on ${PORT}`));

// 🔥 SELF-PING ENGINE
setInterval(() => {
    axios.get(RENDER_URL).catch(() => {}); 
}, 30000); 

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id.toString();
    
    if (data.startsWith('stop_url_')) {
        const index = parseInt(data.split('_')[2]);
        const chatId = ctx.chat.id.toString();
        
        if (activeUsers[chatId] && activeUsers[chatId][index]) {
            const removedItem = activeUsers[chatId][index];
            clearInterval(removedItem.interval);
            activeUsers[chatId].splice(index, 1);
            await ctx.answerCbQuery("Tracking band kar di gayi hai! 🛑").catch(() => {});
            return ctx.reply(`🛑 Tracking stopped for:\n${removedItem.url}`, { disable_web_page_preview: true });
        } else {
            return ctx.answerCbQuery("⚠️ Already stopped.").catch(() => {});
        }
    }

    if (userId !== ADMIN_CHAT_ID.toString()) return ctx.answerCbQuery("Unauthorized!").catch(() => {});
    const targetUserId = data.split('_')[1];
    
    if (data.startsWith('approve_')) {
        if (!global.approvedList.includes(targetUserId.toString())) {
            global.approvedList.push(targetUserId.toString());
        }
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n✅ **Status: Approved!**`).catch(() => {});
        bot.telegram.sendMessage(targetUserId, "🥳 Approved! Use: `/start_track <Flipkart_URL>`").catch(() => {});
    } else if (data.startsWith('decline_')) {
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n❌ **Status: Declined!**`).catch(() => {});
    }
    await ctx.answerCbQuery().catch(() => {});
});

bot.start((ctx) => {
    const userId = ctx.from.id.toString();
    const name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'No Name';
    
    if (global.approvedList.includes(userId)) {
        return ctx.reply("🤖 New Flipkart Tracker Bot Active!\n\n🔹 `/start_track <URL>`\n🔹 `/list_track`\n🔹 `/stop_all`");
    }
    
    ctx.reply(`🔒 **Access Denied!**\n\nAap abhi approved nahi hain.\nAapki Telegram ID: \`${userId}\`\n\nAdmin ko apni ID send karein approval ke liye.`);
    
    bot.telegram.sendMessage(ADMIN_CHAT_ID, 
        `🚨 **New Flipkart Bot Request!**\n\n👤 Name: ${name}\n🆔 ID: \`${userId}\`\n\n👉 Approve manually:\n\`/approve ${userId}\``,
        Markup.inlineKeyboard([[Markup.button.callback('Approve ✅', `approve_${userId}`), Markup.button.callback('Decline ❌', `decline_${userId}`)]])
    ).catch(() => {});
});

bot.command('approve', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Admin Only!");
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 2) return ctx.reply("⚠️ Format: `/approve <User_ID>`");
    
    const targetUserId = args[1].trim();
    if (!global.approvedList.includes(targetUserId)) {
        global.approvedList.push(targetUserId);
        ctx.reply(`✅ User ID \`${targetUserId}\` ko successfully approve kar diya gaya hai.`);
        bot.telegram.sendMessage(targetUserId, "🥳 Approved! Use: `/start_track <Flipkart_URL>`").catch(() => {});
    } else {
        ctx.reply("⚠️ Yeh user pehle se approved hai.");
    }
});

bot.command('list_users', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Admin Only!");
    if (global.approvedList.length <= 1) return ctx.reply("👥 Koyi approved user nahi hai.");
    let msg = "👥 **Flipkart Bot Approved Users List:**\n\n";
    let count = 1;
    global.approvedList.forEach((userId) => {
        if (userId !== ADMIN_CHAT_ID.toString()) {
            msg += `${count}. 🆔 User ID: \`${userId}\`\n\n`;
            count++;
        }
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('remove_user', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Admin Only!");
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 2) return ctx.reply("⚠️ Format: `/remove_user <User_ID>`");
    const targetUserId = args[1].trim();
    
    const index = global.approvedList.indexOf(targetUserId);
    if (index > -1) {
        global.approvedList.splice(index, 1);
        if (activeUsers[targetUserId]) {
            activeUsers[targetUserId].forEach(item => clearInterval(item.interval));
            delete activeUsers[targetUserId];
        }
        ctx.reply(`✅ User ID ${targetUserId} remove ho gaya.`);
        bot.telegram.sendMessage(targetUserId, "🔒 Admin ne aapka access remove kar diya hai.").catch(() => {});
    } else { ctx.reply("⚠️ ID nahi mili."); }
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

async function checkFlipkartStock(ctx, chatId, targetUrl) {
    if (!activeUsers[chatId]) return;
    const itemIndex = activeUsers[chatId].findIndex(item => item.url === targetUrl);
    if (itemIndex === -1) return;

    const randomAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
        const response = await axios.get(targetUrl, { headers: { 'User-Agent': randomAgent, 'Accept-Language': 'en-US,en;q=0.9' }, timeout: 10000 });
        const $ = cheerio.load(response.data);
        const pageText = $('body').text().toLowerCase();
        
        const isOutOfStock = pageText.includes('currently unavailable') || 
                             pageText.includes('this item is currently out of stock') || 
                             pageText.includes('notify me');
                             
        const hasBuyButtons = pageText.includes('buy now') || pageText.includes('add to cart');
        
        if (!isOutOfStock && hasBuyButtons) {
            await bot.telegram.sendMessage(chatId, `🚨 STOCK AAGYA 🚨\n\n🔥 bhai flipkart pr stock aagya jaldi lga jake 🔥\n\nLink:\n${targetUrl}`,
                Markup.inlineKeyboard([[Markup.button.callback('Stop Tracking 🛑', `stop_url_${itemIndex}`)]])
            ).catch(() => {});
        }
    } catch (e) {}
}

bot.launch().then(() => console.log("New Flipkart Bot Engine Connected..."));
