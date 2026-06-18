const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

// --- 🔒 CONFIGURATION HARDLOCKED ---
const TOKEN = "8901855590:AAHFlMQ_LNzOrJ0noP8BPQgnkSAZ2mRo2uc";
const ADMIN_ID = 7485181331;
const MAX_TRACKS = 5;
const CHECK_INTERVAL_MS = 15000; // STRICT 15 SECONDS
const RENDER_URL = 'https://fk-stock-final.onrender.com'; 
// ----------------------------------------

// Render server crash se bachne ke liye standard Webhook engine use karenge polling ki jagah
const bot = new TelegramBot(TOKEN);

const approvedUsers = new Set([ADMIN_ID]);
const pendingApprovals = new Map();
const activeTracks = new Map();
let trackCounter = 0;

// ─── Render Webhook & Express Server ────────────────────────────────────────
const app = express();
app.use(express.json());

// Set Webhook route for Telegram
app.post("/secret-telegram-webhook", (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("Flipkart Stock Tracker Bot - Alive!"));

// FIXED PORT ENGINE: Render hard requirement bound to 10000 layout
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Master Stock Server listening on port ${PORT}`);
  try {
    await bot.deleteWebHook({ drop_pending_updates: true });
    await bot.setWebHook(`${RENDER_URL}/secret-telegram-webhook`, {
      drop_pending_updates: true
    });
    console.log("🎯 Webhook successfully bound to Render URL!");
  } catch (err) {
    console.log("⚠️ Webhook setup warning: ", err.message);
  }
});

// Self-ping to stop sleeping on free render instances
setInterval(() => {
  axios.get(RENDER_URL).catch(() => {});
}, 15000);

// ─── Helpers ───────────────────────────────────────────────────────────────
const isApproved = (id) => approvedUsers.has(id);
const isAdmin = (id) => id === ADMIN_ID;
const getUserTracks = (uid) => [...activeTracks.values()].filter((t) => t.userId === uid);

function isFlipkartUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("flipkart.com") || host.includes("fkrt.it");
  } catch {
    return false;
  }
}

function mainMenu(userId) {
  const btns = [
    [{ text: "🚨 Start Stock Track", callback_data: "start_track" }],
    [{ text: "📋 List Active", callback_data: "list_active" }],
    [{ text: "🛑 Stop All Operations", callback_data: "stop_all" }],
  ];
  if (isAdmin(userId)) btns.push([{ text: "👥 Pending Approvals", callback_data: "pending" }]);
  return { reply_markup: { inline_keyboard: btns } };
}

// ─── Flipkart Mobile Emulation Scraper ──────────────────────────────────────
async function checkFlipkartStock(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': 'pincode=125121; sn=125121; amsn=125121;'
      },
      timeout: 12000,
    });

    const htmlSource = response.data.toString();
    const htmlLower = htmlSource.toLowerCase();
    const $ = cheerio.load(htmlSource);

    // Dynamic Title Clean Extractor: Filters only Name + Storage/RAM
    let productName = "Flipkart Product Layout";
    let rawTitle = $('title').text().split('|')[0].trim();
    if (rawTitle) {
        let cleanMatch = rawTitle.match(/^([^\(]+)\(([^)]+)\)/i);
        if (cleanMatch) {
            productName = `${cleanMatch[1].trim()} (${cleanMatch[2].trim()})`;
        } else {
            productName = rawTitle;
        }
    }

    let isInStock = false;

    // Layer 1 Check: Schema JSON LD Application Layer Data Extraction
    const jsonLdMatch = htmlSource.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (jsonLdMatch && jsonLdMatch[1]) {
        try {
            const jsonData = JSON.parse(jsonLdMatch[1].trim());
            const itemData = Array.isArray(jsonData) ? jsonData.find(i => i.offers) : jsonData;
            if (itemData && itemData.offers) {
                let availability = String(itemData.offers.availability || itemData.offers[0]?.availability || '');
                if (availability.toLowerCase().includes('instock')) isInStock = true;
            }
        } catch(e){}
    }

    // Layer 2 Check: UI Interaction Core button validations
    if (!isInStock) {
        const hasBuyButtons = htmlLower.includes('buy now') || htmlLower.includes('add to cart') || htmlLower.includes('go to cart');
        const isOutOfStockText = htmlLower.includes('currently unavailable') || htmlLower.includes('out of stock');
        if (hasBuyButtons && !isOutOfStockText) {
            isInStock = true;
        }
    }

    return {
      inStock: isInStock,
      productName: productName.trim(),
    };
  } catch (err) {
    return { inStock: false, productName: "Fetch Error" };
  }
}

// ─── Tracking Engine Loop ───────────────────────────────────────────────────
function startTracking(userId, chatId, url) {
  trackCounter++;
  const trackId = trackCounter;

  const ref = setInterval(async () => {
    if (!activeTracks.has(trackId)) return;
    const result = await checkFlipkartStock(url);

    if (result.inStock) {
      // Re-find position array value for serial dynamic check logic
      const tracksArr = getUserTracks(userId);
      const realTimeSerial = tracksArr.findIndex(t => t.trackId === trackId) + 1;

      bot.sendMessage(
        chatId,
        `🚨 **bhai stock aagya hai** 🚨\n\n` +
        `📦 **Product:** <b>${result.productName}</b>\n\n` +
        `🔗 **Order Link:**\n${url}`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[
              { text: `🛑 Stop Checking`, callback_data: `stop_${trackId}` },
            ]],
          },
        }
      ).catch(() => {});
      
      activeTracks.set(trackId, { ...activeTracks.get(trackId), productName: result.productName });
    }
  }, CHECK_INTERVAL_MS);

  activeTracks.set(trackId, { userId, chatId, url, productName: "Fetching Details...", interval: ref, trackId });
  return trackId;
}

function stopTracking(trackId) {
  const t = activeTracks.get(trackId);
  if (t) { clearInterval(t.interval); activeTracks.delete(trackId); }
  return t || null;
}

// ─── Text / Command Flows ───────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const first_name = msg.from.first_name || "Agent";
  const username = msg.from.username || "N/A";

  if (!isApproved(userId)) {
    if (!pendingApprovals.has(userId)) {
      pendingApprovals.set(userId, { username, firstName: first_name, chatId });
      bot.sendMessage(
        ADMIN_ID,
        `🚨 **New Stock Bot Request!**\n\n👤 Name: ${first_name}\n🆔 ID: \`${userId}\`\n📛 @${username}`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[
            { text: "Approve ✅", callback_data: `approve_${userId}` },
            { text: "Decline ❌", callback_data: `reject_${userId}` },
          ]]},
        }
      ).catch(() => {});
    }
    bot.sendMessage(chatId, `🔒 **Access Denied!**\n\nAap abhi approved nahi hain.\nAapki Telegram ID: \`${userId}\`\n\nAdmin ko automatic request bhej di gayi hai.`);
    return;
  }

  bot.sendMessage(chatId, `🤖 *Welcome to New Flipkart Stock Master Pro!*`, mainMenu(userId));
});

// ─── Callbacks Logic Handler ────────────────────────────────────────────────
bot.on("callback_query", async (q) => {
  const userId = q.from.id;
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;

  if (data.startsWith("approve_")) {
    if (!isAdmin(userId)) return;
    const tid = parseInt(data.split("_")[1]);
    approvedUsers.add(tid);
    const info = pendingApprovals.get(tid);
    pendingApprovals.delete(tid);
    bot.editMessageText(`✅ User ${tid} approved!`, { chat_id: chatId, message_id: msgId });
    if (info) bot.sendMessage(info.chatId, `🥳 **Aapka access approve ho gaya hai!**\nCommands use karne ke liye ek baar /start dabayein.`);
    return;
  }

  if (data.startsWith("reject_")) {
    if (!isAdmin(userId)) return;
    const tid = parseInt(data.split("_")[1]);
    pendingApprovals.delete(tid);
    bot.editMessageText(`❌ User ${tid} rejected.`, { chat_id: chatId, message_id: msgId });
    return;
  }

  if (!isApproved(userId)) return;

  if (data === "start_track") {
    if (getUserTracks(userId).length >= MAX_TRACKS) {
      return bot.sendMessage(chatId, `⚠️ Max ${MAX_TRACKS} tracks limit! Pehle koi band karo.`);
    }
    bot.sendMessage(chatId, "bhai link behej jb bhi naye link track krna hoto start track dbana ho");
    return;
  }

  if (data === "list_active") {
    const tracks = getUserTracks(userId);
    if (!tracks.length) { bot.sendMessage(chatId, "😴 Koyi active target stock radar par nahi hai.", mainMenu(userId)); return; }
    
    bot.sendMessage(chatId, "📋 **Radar Par Active Stock Targets Matrix:**\n\n").catch(() => {});
    tracks.forEach((t, i) => {
      let card = `🔢 <b>Target [${i + 1}]</b>\n📦 <b>Model:</b> <code>${t.productName}</code>\n🔗 <b>Link:</b> ${t.url}`;
      bot.sendMessage(chatId, card, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "🛑 Stop Checking", callback_data: `stop_${t.trackId}` }]] }
      }).catch(() => {});
    });
    return;
  }

  if (data.startsWith("stop_")) {
    const trackId = parseInt(data.split("_")[1]);
    const t = activeTracks.get(trackId);
    if (!t || t.userId !== userId) return;
    stopTracking(trackId);
    bot.sendMessage(chatId, `🛑 **Target successfully radar se permanent saaf!**`, mainMenu(userId));
    return;
  }

  if (data === "stop_all") {
    const tracks = getUserTracks(userId);
    if (!tracks.length) { bot.sendMessage(chatId, "⚠️ Koyi active operation chal hi nahi rahi.", mainMenu(userId)); return; }
    tracks.forEach((t) => stopTracking(t.trackId));
    bot.sendMessage(chatId, "🛑 Saari stock tracking band kar di gayi.", mainMenu(userId));
    return;
  }

  if (data === "pending") {
    if (!isAdmin(userId)) return;
    if (!pendingApprovals.size) { bot.sendMessage(chatId, "✅ Koyi pending request nahi."); return; }
    let txt = `⏳ *Pending Approvals (${pendingApprovals.size}):*\n\n`;
    const btns = [];
    pendingApprovals.forEach((info, uid) => {
      txt += `👤 ${info.firstName} | \`${uid}\`\n`;
      btns.push([{ text: `✅ ${info.firstName}`, callback_data: `approve_${uid}` }]);
    });
    bot.sendMessage(chatId, txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: btns } });
    return;
  }
});

// ─── Incoming Message Parsing ───────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isApproved(userId)) return;

  const text = msg.text.trim();
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);

  if (urlMatch) {
    const url = urlMatch[0];

    if (!isFlipkartUrl(url)) {
      bot.sendMessage(chatId, "⚠️ *bhai link behej jb bhi new link track krna hoto start track dbana ho*", { parse_mode: "Markdown" });
      return;
    }

    // 🔥 STRICT DUPLICATE CHECK
    const dup = [...activeTracks.values()].find((t) => t.userId === userId && t.url === url);
    if (dup) {
      bot.sendMessage(chatId, "⚠️ **bhai ye link already track hora hai!** New link ke liye firse click karein.");
      return;
    }

    if (getUserTracks(userId).length >= MAX_TRACKS) {
      bot.sendMessage(chatId, `⚠️ Max ${MAX_TRACKS} links tracking allowed.`);
      return;
    }

    // Single sleek message creation fallback
    const trackId = startTracking(userId, chatId, url);
    
    // First immediate title check for locked screen confirmation
    const metadata = await checkFlipkartStock(url);
    
    bot.sendMessage(chatId, 
      `🕵️‍♂️ **Undercover Agent Radar Par Lock!**\n\n📦 **Model:** <code>${metadata.productName}</code>\n\n15 second mein strict check locked hai boss!`, 
      { 
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "🛑 Stop Checking", callback_data: `stop_${trackId}` }]] }
      }
    );
    return;
  }
});

console.log("🛒 Flipkart Stock Tracker Master Bot Running perfectly...");
