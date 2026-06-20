const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

// ─── CONFIG ────────────────────────────────────────────────────
const TOKEN   = process.env.BOT_TOKEN  || '8901855590:AAH9iYDv28cQsJUE8izp_55rICNfBAGgflI';
const ADMIN   = parseInt(process.env.ADMIN_ID || '7485181331', 10);
const PORT    = parseInt(process.env.PORT     || '10000',      10);
const APP_URL = process.env.RENDER_EXTERNAL_URL || '';
const MAX_TRACKS = 20; // 👈 1. YAHAN CHANGE KIYA HAI (5 KI JGAH 20 KIYA)
const CHECK_INTERVAL = 15000; // 15s

// ─── STATE ─────────────────────────────────────────────────────
const approvedUsers = new Set([ADMIN]);   // admin always approved
const pendingUsers  = new Map();          // chatId -> {username, name}
const userTracks    = new Map();          // chatId -> [ {url, name, interval} ]

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

// Safely send HTML message
function sendHTML(chatId, text) {
  return bot.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(err => {
    console.error('sendMessage error:', err.message);
  });
}

// Escape HTML special chars
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── FLIPKART STOCK CHECK ──────────────────────────────────────
async function checkFlipkart(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-IN,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const $ = cheerio.load(data);

    // Product name
    let productName = $('span.VU-ZEz').first().text().trim()
      || $('h1._6EBuvT span').first().text().trim()
      || $('h1.yhB1nd').first().text().trim()
      || $('title').text().replace('- Buy', '').trim()
      || 'Product';

    // Extra info (storage/RAM)
    let extra = '';
    $('div._8Cs33M a, ul._RH_-d li').each((_, el) => {
      const t = $(el).text().trim();
      if (t) extra += ' ' + t;
    });

    // In-stock check — look for "Buy Now"
    const bodyText = $.root().text();
    const inStock  = /buy\s*now/i.test(bodyText);

    return { inStock, productName: productName.slice(0, 80), extra: extra.slice(0, 60) };
  } catch (err) {
    console.error('checkFlipkart error:', err.message);
    return { inStock: false, productName: 'Unknown', extra: '', error: err.message };
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
  clearInterval(tracks[index].intervalId);
  tracks.splice(index, 1);
  return true;
}

function startTracking(chatId, url) {
  const tracks = getTracks(chatId);

  // Duplicate check
  if (tracks.some(t => t.url === url)) {
    sendHTML(chatId, '⚠️ Yeh link pehle se track ho raha hai!');
    return;
  }

  if (tracks.length >= MAX_TRACKS) {
    sendHTML(chatId, `❌ Max ${MAX_TRACKS} tracks allowed. Pehle koi stop karo.`);
    return;
  }

  const trackObj = { url, name: '...', intervalId: null };
  tracks.push(trackObj);
  const idx = tracks.length - 1;

  sendHTML(chatId, `🔍 Tracking shuru: <code>${esc(url)}</code>\n15 seconds mein pehla check hoga...`);

  const run = async () => {
    const result = await checkFlipkart(url);
    trackObj.name = result.productName;

    if (result.inStock) {
      await sendHTML(chatId,
        `✅ <b>IN STOCK!</b>\n\n` +
        `📦 <b>${esc(result.productName)}</b>\n` +
        (result.extra ? `💾 ${esc(result.extra)}\n` : '') +
        `🔗 <a href="${url}">Flipkart Pe Dekho</a>`
      );
    }
  };

  run(); // immediate first check
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

// ─── DYNAMIC STOP KEYBOARD GENERATION ──────────────────────────
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

  // ── Admin commands ──
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

  // ── Access check ──
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

  // ── /start ──
  if (text === '/start') {
    return bot.sendMessage(chatId,
      '🛒 <b>Flipkart Stock Tracker</b>\n\nKoi bhi Flipkart link paste karo — main track karunga aur jab "Buy Now" aaye toh alert karunga!',
      { parse_mode: 'HTML', ...mainMenuKeyboard() }
    );
  }

  // ── Menu buttons ──
  if (text === '➕ Track New Link') {
    return sendHTML(chatId, '🔗 Flipkart product ka URL paste karo:');
  }

  if (text === '📋 List Active Tracks') {
    const tracks = getTracks(chatId);
    if (tracks.length === 0) return sendHTML(chatId, '📭 Koi active track nahi hai.');
    const lines = tracks.map((t, i) =>
      `${i + 1}. <b>${esc(t.name)}</b>\n   <code>${esc(t.url)}</code>`
    );
    // 2. IS TEXT BLOCK ME BHI MAX_TRACKS AUTOMATICALLY 20 SHOW KAREGA AB 
    return sendHTML(chatId, `<b>Active Tracks (${tracks.length}/${MAX_TRACKS}):</b>\n\n` + lines.join('\n\n'));
  }

  if (text === '🛑 Stop a Track') {
    const kb = stopKeyboard(chatId);
    if (!kb) return sendHTML(chatId, '📭 Koi active track nahi.');
    return bot.sendMessage(chatId, 'Kaunsa track stop karna hai?', kb);
  }

  if (text === '🔙 Back') {
    return bot.sendMessage(chatId, 'Main menu:', mainMenuKeyboard());
  }

  // ── Stop track by button ──
  const stopMatch = text.match(/^Stop (\d+):/);
  if (stopMatch) {
    const idx = parseInt(stopMatch[1], 10) - 1;
    const ok  = stopTrack(chatId, idx);
    if (ok) {
      const kb = stopKeyboard(chatId);
      return bot.sendMessage(chatId, `✅ Track ${idx + 1} stop kar diya!`, kb || mainMenuKeyboard());
    }
    return sendHTML(chatId, '❌ Invalid selection.');
  }

  // ── URL tracking ──
  if (text.includes('flipkart.com') || text.includes('dl.flipkart.com')) {
    return startTracking(chatId, text);
  }

  // ── Unknown ──
  sendHTML(chatId, '❓ Koi Flipkart link bhejo ya menu se option choose karo.');
});

// ─── CALLBACK QUERY (Admin approve/reject) ────────────────────
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

// ─── POLLING ERRORS ───────────────────────────────────────────
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});

console.log('🛒 Flipkart Stock Tracker Bot running!');
