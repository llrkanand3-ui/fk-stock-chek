const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

// ─── CONFIG ────────────────────────────────────────────────────
const TOKEN    = process.env.BOT_TOKEN  || '8901855590:AAGGeCWXY3bxyHhcO89p0oXqQHrmT6iuAlI';
const ADMIN    = parseInt(process.env.ADMIN_ID || '7485181331', 10);
const PORT     = parseInt(process.env.PORT     || '10000',      10);
const APP_URL  = process.env.RENDER_EXTERNAL_URL || '';
const MAX_TRACKS = 20; 
const CHECK_INTERVAL = 15000; // Har link parallelly exact 15s me check hogi

// ─── STATE ─────────────────────────────────────────────────────
const approvedUsers = new Set([ADMIN]);   
const pendingUsers  = new Map();          
const userTracks    = new Map();          

// ─── EXPRESS KEEP-ALIVE ────────────────────────────────────────
const app = express();
app.get('/', (_req, res) => res.send('Flipkart Tracker Bot is running!'));
app.listen(PORT, () => console.log(`Server on port ${PORT}`));

if (APP_URL) {
  setInterval(() => {
    axios.get(APP_URL).catch(() => {});
  }, 25000);
}

// ─── BOT ───────────────────────────────────────────────────────
const bot = new TelegramBot(TOKEN, { polling: true });

function sendHTML(chatId, text) {
  return bot.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(err => {
    console.error('sendMessage error:', err.message);
  });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── ANTI-BLOCK FLIPKART PARALLEL SCRAPER ──────────────────────
async function checkFlipkart(url) {
  try {
    const chromeVersion = Math.floor(Math.random() * (126 - 120) + 120);
    const { data } = await axios.get(url, {
      timeout: 9000, // Fast timeout for parallel speed
      headers: {
        'User-Agent': `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Mobile Safari/537.36`,
        'Accept-Language': 'en-IN,en-GB;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Sec-Ch-Ua': `"Not/A)Brand";v="8", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`,
        'Sec-Ch-Ua-Mobile': '?1',
        'Sec-Ch-Ua-Platform': '"Android"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
        'Connection': 'keep-alive'
      },
    });

    const $ = cheerio.load(data);

    // Dynamic selectors targeting mobile + desktop layouts
    let productName = $('h1').text().trim()
      || $('span.VU-ZEz').first().text().trim()
      || $('h1._6EBuvT span').first().text().trim()
      || $('h1.yhB1nd').first().text().trim()
      || $('span.B_NuCI').first().text().trim()
      || $('title').text().replace('- Buy', '').replace(': Buy Online at Low Prices in India | Flipkart.com', '').trim()
      || 'Flipkart Product';

    let extra = '';
    $('div._8Cs33M a, ul._RH_-d li, div._21Ahn-').each((_, el) => {
      const t = $(el).text().trim();
      if (t && extra.length < 60) extra += ' ' + t;
    });

    const bodyText = $.root().text();
    
    // Accurate stock engine
    const hasBuyNow = /buy\s*now/i.test(bodyText) || /add\s*to\s*cart/i.test(bodyText);
    const isOutOfStock = /out\s*of\s*stock/i.test(bodyText) || /sold\s*out/i.test(bodyText) || /coming\s*soon/i.test(bodyText);
    
    const inStock = hasBuyNow && !isOutOfStock;

    return { inStock, productName: productName.slice(0, 80), extra: extra.slice(0, 60) };
  } catch (err) {
    console.error(`Fetch error on link:`, err.message);
    return { inStock: false, productName: null, extra: '', error: true };
  }
}

// ─── TRACK HELPERS ────────────────────────────────────────────
function getTracks(chatId) {
  if (!userTracks.has(chatId)) userTracks.set(chatId, []);
  return userTracks.get(chatId);
}

function stopTrack(chatId, index) {
  const tracks = getTracks(chatId);
  if (index < 0 || index >= tracks.length) return false;
  
  if (tracks[index].intervalId) {
    clearInterval(tracks[index].intervalId);
  }
  tracks.splice(index, 1);
  return true;
}

function startTracking(chatId, url) {
  const tracks = getTracks(chatId);

  if (tracks.some(t => t.url === url)) {
    sendHTML(chatId, '⚠️ Yeh link pehle se track ho raha hai!');
    return;
  }

  if (tracks.length >= MAX_TRACKS) {
    sendHTML(chatId, `❌ Max ${MAX_TRACKS} tracks allowed. Pehle koi stop karo.`);
    return;
  }

  const trackObj = { url, name: '📋 Fetching Name...', intervalId: null };
  tracks.push(trackObj);

  sendHTML(chatId, `🔍 Tracking shuru: <code>${esc(url)}</code>\n15 seconds mein pehla check hoga...`);

  const run = async () => {
    const currentTracks = getTracks(chatId);
    if (!currentTracks.includes(trackObj)) {
      if (trackObj.intervalId) clearInterval(trackObj.intervalId);
      return;
    }

    // Direct fetch (No await queue delays between other links!)
    const result = await checkFlipkart(url);
    
    if (!result.error && result.productName) {
      trackObj.name = result.productName;
    } else if (trackObj.name === '📋 Fetching Name...') {
      trackObj.name = 'Flipkart Track Link';
    }

    if (!currentTracks.includes(trackObj)) {
      if (trackObj.intervalId) clearInterval(trackObj.intervalId);
      return;
    }

    if (result.inStock) {
      const currentIdx = currentTracks.indexOf(trackObj) + 1;
      await sendHTML(chatId,
        `🔥 <b>LIVE IN STOCK! (Stop ${currentIdx})</b>\n\n` +
        `📦 <b>${esc(trackObj.name)}</b>\n` +
        (result.extra ? `💾 ${esc(result.extra)}\n` : '') +
        `🚨 <i>Bina ruke har 15s me alert chalu rahega jab tak stock hai!</i>\n\n` +
        `🔗 <a href="${url}">Flipkart Pe Dekho</a>`
      );
    }
  };

  run(); 
  // Individual thread isolated loop triggers perfectly every 15000ms
  trackObj.intervalId = setInterval(run, CHECK_INTERVAL);
}

// ─── KEYBOARD BUILDERS ────────────────────────────────────────
function mainMenuKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: '➕ Track New Link' }],
        [{ text: '📋 List Active Tracks' }, { text: '🛑 Stop a Track' }],
      ],
      resize_keyboard: true,
    },
  };
}

function stopKeyboard(chatId) {
  const tracks = getTracks(chatId);
  if (tracks.length === 0) return null;
  const buttons = tracks.map((t, i) => [{ text: `Stop ${i + 1}: ${t.name.slice(0, 30)}` }]);
  buttons.push([{ text: '🔙 Back' }]);
  return { reply_markup: { keyboard: buttons, resize_keyboard: true } };
}

// ─── ADMIN HELPERS ────────────────────────────────────────────
function notifyAdmin(chatId, username, name) {
  const kb = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `approve_${chatId}` },
      { text: '❌ Reject',  callback_data: `reject_${chatId}`  },
    ]],
  };
  bot.sendMessage(ADMIN,
    `🔔 New user request:\n👤 ${esc(name)}\n🆔 ${chatId}\n@${esc(username || 'no_username')}`,
    { parse_mode: 'HTML', reply_markup: kb }
  ).catch(() => {});
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text   = (msg.text || '').trim();

  if (chatId === ADMIN) {
    if (text === '/users') {
      const lines = [`<b>Approved users (${approvedUsers.size}):</b>`];
      approvedUsers.forEach(id => lines.push(`• ${id}`));
      if (pendingUsers.size > 0) {
        lines.push(`\n<b>Pending (${pendingUsers.size}):</b>`);
        pendingUsers.forEach((info, id) => lines.push(`• ${id} — ${esc(info.name)}`));
      }
      return sendHTML(ADMIN, lines.join('\n'));
    }
    if (text.startsWith('/remove ')) {
      const id = parseInt(text.split(' ')[1], 10);
      approvedUsers.delete(id);
      return sendHTML(ADMIN, `✅ User ${id} removed.`);
    }
  }

  if (!approvedUsers.has(chatId)) {
    if (pendingUsers.has(chatId)) {
      return sendHTML(chatId, '⏳ Aapki request pending hai. Admin approve karega.');
    }
    const name     = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim();
    const username = msg.from.username || '';
    pendingUsers.set(chatId, { name, username });
    notifyAdmin(chatId, username, name);
    return sendHTML(chatId, '👋 Access request bhej di! Admin approve karega.');
  }

  if (text === '/start') {
    return bot.sendMessage(chatId,
      '🛒 <b>Flipkart Stock Tracker</b>\n\nKoi bhi Flipkart link paste karo — main track karunga aur jab "Buy Now" aaye toh alert karunga!',
      { parse_mode: 'HTML', ...mainMenuKeyboard() }
    );
  }

  if (text.includes('Track New Link')) {
    return sendHTML(chatId, '🔗 Flipkart product ka URL paste karo:');
  }

  if (text.includes('List Active Tracks')) {
    const tracks = getTracks(chatId);
    if (tracks.length === 0) return sendHTML(chatId, '📭 Koi active track nahi hai.');
    const lines = tracks.map((t, i) =>
      `${i + 1}. <b>${esc(t.name)}</b>\n   <code>${esc(t.url)}</code>`
    );
    return sendHTML(chatId, `<b>Active Tracks (${tracks.length}/${MAX_TRACKS}):</b>\n\n` + lines.join('\n\n'));
  }

  if (text.includes('Stop a Track')) {
    const kb = stopKeyboard(chatId);
    if (!kb) return sendHTML(chatId, '📭 Koi active track nahi.');
    return bot.sendMessage(chatId, 'Kaunsa track stop karna hai?', kb);
  }

  if (text.includes('Back')) {
    return bot.sendMessage(chatId, 'Main menu:', mainMenuKeyboard());
  }

  const stopMatch = text.match(/Stop (\d+):/);
  if (stopMatch) {
    const idx = parseInt(stopMatch[1], 10) - 1;
    const ok  = stopTrack(chatId, idx);
    if (ok) {
      const kb = stopKeyboard(chatId);
      return bot.sendMessage(chatId, `✅ Track ${idx + 1} stop kar diya!`, kb || mainMenuKeyboard());
    }
    return sendHTML(chatId, '❌ Invalid selection.');
  }

  if (text.includes('flipkart.com') || text.includes('dl.flipkart.com')) {
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const cleanUrl = urlMatch[0];
      return startTracking(chatId, cleanUrl);
    }
  }

  sendHTML(chatId, '❓ Koi Flipkart link bhejo ya menu se option choose karo.');
});

// ─── CALLBACK QUERY ───────────────────────────────────────────
bot.on('callback_query', (query) => {
  const data   = query.data || '';
  const fromId = query.from.id;

  bot.answerCallbackQuery(query.id).catch(() => {});

  if (fromId !== ADMIN) return;

  if (data.startsWith('approve_')) {
    const userId = parseInt(data.split('_')[1], 10);
    approvedUsers.add(userId);
    pendingUsers.delete(userId);
    sendHTML(userId, '✅ Access mil gaya! /start bhejo.');
    bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
      chat_id: ADMIN, message_id: query.message.message_id,
    }).catch(() => {});
    sendHTML(ADMIN, `✅ User ${userId} approved.`);
  }

  if (data.startsWith('reject_')) {
    const userId = parseInt(data.split('_')[1], 10);
    pendingUsers.delete(userId);
    sendHTML(userId, '❌ Aapka access request reject ho gaya.');
    sendHTML(ADMIN, `❌ User ${userId} rejected.`);
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('🛒 Flipkart Stock Tracker Bot running!');
