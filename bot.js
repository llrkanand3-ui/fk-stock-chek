const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const TOKEN = "8901855590:AAHFlMQ_LNzOrJ0noP8BPQgnkSAZ2mRo2uc";
const ADMIN_ID = 7485181331;
const MAX_TRACKS = 5;
const CHECK_INTERVAL_MS = 15000;

const bot = new TelegramBot(TOKEN, { polling: true });

const approvedUsers = new Set([ADMIN_ID]);
const pendingApprovals = new Map();
const activeTracks = new Map();
let trackCounter = 0;

// ─── Keep-alive for Render ─────────────────────────────────────────────────
const app = express();
app.get("/", (req, res) => res.send("Flipkart Stock Tracker Bot - Alive!"));
app.listen(process.env.PORT || 3000);

setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (url) axios.get(url).catch(() => {});
}, 30000);

// ─── Helpers ───────────────────────────────────────────────────────────────
const isApproved = (id) => approvedUsers.has(id);
const isAdmin = (id) => id === ADMIN_ID;
const getUserTracks = (uid) => [...activeTracks.values()].filter((t) => t.userId === uid);

function isFlipkartUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes("flipkart.com");
  } catch {
    return false;
  }
}

function mainMenu(userId) {
  const btns = [
    [{ text: "▶️ Start Track", callback_data: "start_track" }],
    [{ text: "📋 List Active", callback_data: "list_active" }],
    [{ text: "🛑 Stop All", callback_data: "stop_all" }],
  ];
  if (isAdmin(userId)) btns.push([{ text: "👥 Pending Approvals", callback_data: "pending" }]);
  return { reply_markup: { inline_keyboard: btns } };
}

// ─── Flipkart Stock Checker ────────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function checkFlipkartStock(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9,hi;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Referer": "https://www.flipkart.com/",
      },
      timeout: 12000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(data);

    // ── Product Name ──
    const productName =
      $("span.B_NuCI").text().trim() ||
      $("h1._9E25nV span").text().trim() ||
      $("h1.yhB1nd").text().trim() ||
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      "Flipkart Product";

    // ── Storage / RAM from title ──
    let variant = "";
    const ramMatch = productName.match(/(\d+\s*GB\s*RAM)/gi);
    const storageMatch = productName.match(/(\d+\s*(?:GB|TB)(?!\s*RAM))/gi);
    if (ramMatch) variant += ramMatch[0] + " ";
    if (storageMatch) variant += [...new Set(storageMatch)].join(" / ");
    if (!variant) {
      const specText = $("li._21lJbe, ._2418kt li, .RmoJbe li").text();
      const m = specText.match(/(\d+\s*(?:GB|TB))/gi);
      if (m) variant = [...new Set(m)].slice(0, 2).join(" / ");
    }

    // ── Stock Check ──
    const pageText = $("body").text();

    const soldOutSelectors = [
      "._16FRp0",      // "Sold Out" badge
      "._1dVbu9",      // out of stock text
      ".T3AFbX",       // notify me div
    ];
    const soldOut = soldOutSelectors.some((sel) => $(sel).length > 0) ||
      pageText.toLowerCase().includes("sold out") ||
      pageText.toLowerCase().includes("currently out of stock");

    const notifyMe = $("._2vXMl6, .notify-me, ._1eoSRn").length > 0 ||
      pageText.toLowerCase().includes("notify me");

    // Buy Now / Add to Cart buttons
    const buyBtn =
      $("._2KpZ6l._2U9uOA._3v1-ww").length > 0 ||   // Buy Now
      $("._2KpZ6l._2U9uOA").length > 0 ||             // Add to Cart
      $("button._2KpZ6l").length > 0;

    const inStock = buyBtn && !soldOut && !notifyMe;

    return {
      inStock,
      productName: productName.slice(0, 100).trim(),
      variant: variant.trim(),
    };
  } catch (err) {
    console.error("Flipkart check error:", err.message);
    return { inStock: false, productName: "Fetch Error", variant: "" };
  }
}

// ─── Tracking Engine ───────────────────────────────────────────────────────
function startTracking(userId, chatId, url) {
  trackCounter++;
  const trackId = trackCounter;

  const ref = setInterval(async () => {
    if (!activeTracks.has(trackId)) return;
    const result = await checkFlipkartStock(url);

    if (result.inStock) {
      const v = result.variant ? `\n📦 *Storage/RAM:* \`${result.variant}\`` : "";
      bot.sendMessage(
        chatId,
        `🚨 *FLIPKART STOCK AA GAYI HAI!*\n\n` +
        `🛍️ *${result.productName}*` + v +
        `\n\n🔗 [Abhi Kharido!](${url})\n\n` +
        `⏱️ Har 15 sec alert aata rahega jab tak stock hai!`,
        {
          parse_mode: "Markdown",
          disable_web_page_preview: false,
          reply_markup: {
            inline_keyboard: [[
              { text: `🛑 Stop Track #${trackId}`, callback_data: `stop_${trackId}` },
            ]],
          },
        }
      );
      activeTracks.set(trackId, { ...activeTracks.get(trackId), productName: result.productName });
    }
  }, CHECK_INTERVAL_MS);

  activeTracks.set(trackId, { userId, chatId, url, productName: "Checking...", interval: ref, trackId });
  return trackId;
}

function stopTracking(trackId) {
  const t = activeTracks.get(trackId);
  if (t) { clearInterval(t.interval); activeTracks.delete(trackId); }
  return t || null;
}

// ─── /start ────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const { id: userId, first_name, username } = msg.from;
  const chatId = msg.chat.id;

  if (!isApproved(userId)) {
    if (!pendingApprovals.has(userId)) {
      pendingApprovals.set(userId, { username: username || "N/A", firstName: first_name, chatId });
      bot.sendMessage(
        ADMIN_ID,
        `🔔 *New Access Request*\n\n👤 Name: ${first_name}\n🆔 ID: \`${userId}\`\n📛 @${username || "N/A"}`,
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [[
            { text: "✅ Approve", callback_data: `approve_${userId}` },
            { text: "❌ Reject", callback_data: `reject_${userId}` },
          ]]},
        }
      );
    }
    bot.sendMessage(chatId, `⏳ *Access pending hai bhai.*\nAdmin ko request bhej di — thoda wait karo! 🙏`, { parse_mode: "Markdown" });
    return;
  }

  bot.sendMessage(
    chatId,
    `👋 *Welcome ${first_name}!*\n\n🛒 *Flipkart Stock Tracker Bot*\n\nFlipkart product ka link bhejo — stock aate hi turant alert milega! 🔔\n\n⚡ Har *15 seconds* pe check hoga`,
    { parse_mode: "Markdown", ...mainMenu(userId) }
  );
});

// ─── Callbacks ─────────────────────────────────────────────────────────────
bot.on("callback_query", async (q) => {
  const userId = q.from.id;
  const chatId = q.message.chat.id;
  const msgId = q.message.message_id;
  const data = q.data;
  bot.answerCallbackQuery(q.id);

  // Admin approve/reject
  if (data.startsWith("approve_")) {
    if (!isAdmin(userId)) return;
    const tid = parseInt(data.split("_")[1]);
    approvedUsers.add(tid);
    const info = pendingApprovals.get(tid);
    pendingApprovals.delete(tid);
    bot.editMessageText(`✅ User ${tid} approved!`, { chat_id: chatId, message_id: msgId });
    if (info) bot.sendMessage(info.chatId, `✅ *Access mil gaya!*\nAb /start karo aur Flipkart link bhejo 🚀`, { parse_mode: "Markdown" });
    return;
  }

  if (data.startsWith("reject_")) {
    if (!isAdmin(userId)) return;
    const tid = parseInt(data.split("_")[1]);
    const info = pendingApprovals.get(tid);
    pendingApprovals.delete(tid);
    bot.editMessageText(`❌ User ${tid} rejected.`, { chat_id: chatId, message_id: msgId });
    if (info) bot.sendMessage(info.chatId, `❌ Tumhari request reject ho gayi.`);
    return;
  }

  if (!isApproved(userId)) { bot.sendMessage(chatId, "⛔ Access nahi hai."); return; }

  if (data === "start_track") {
    if (getUserTracks(userId).length >= MAX_TRACKS) {
      bot.sendMessage(chatId, `⚠️ Already *${MAX_TRACKS}* tracks chal rahe hain!\nPehle koi band karo 📋`, { parse_mode: "Markdown" });
      return;
    }
    bot.sendMessage(chatId, "🔗 *Flipkart product ka link bhejo:*", {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true },
    });
    return;
  }

  if (data === "list_active") {
    const tracks = getUserTracks(userId);
    if (!tracks.length) { bot.sendMessage(chatId, "📭 Koi active track nahi hai.", mainMenu(userId)); return; }
    let txt = `📋 *Active Tracks (${tracks.length}/${MAX_TRACKS}):*\n\n`;
    const btns = [];
    tracks.forEach((t, i) => {
      txt += `*${i + 1}.* Track #${t.trackId}\n🛍️ ${t.productName}\n🔗 ${t.url}\n\n`;
      btns.push([{ text: `🛑 Stop ${i + 1} (Track #${t.trackId})`, callback_data: `stop_${t.trackId}` }]);
    });
    btns.push([{ text: "🔙 Back", callback_data: "back_main" }]);
    bot.sendMessage(chatId, txt, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: btns },
    });
    return;
  }

  if (data.startsWith("stop_")) {
    const trackId = parseInt(data.split("_")[1]);
    const t = activeTracks.get(trackId);
    if (!t || t.userId !== userId) { bot.sendMessage(chatId, "⚠️ Track nahi mila."); return; }
    stopTracking(trackId);
    bot.sendMessage(chatId, `🛑 *Track #${trackId} band kar diya!*`, { parse_mode: "Markdown", ...mainMenu(userId) });
    return;
  }

  if (data === "stop_all") {
    const tracks = getUserTracks(userId);
    if (!tracks.length) { bot.sendMessage(chatId, "📭 Koi track nahi tha.", mainMenu(userId)); return; }
    tracks.forEach((t) => stopTracking(t.trackId));
    bot.sendMessage(chatId, `🛑 *Saare ${tracks.length} tracks band!*`, { parse_mode: "Markdown", ...mainMenu(userId) });
    return;
  }

  if (data === "pending") {
    if (!isAdmin(userId)) return;
    if (!pendingApprovals.size) { bot.sendMessage(chatId, "✅ Koi pending request nahi."); return; }
    let txt = `⏳ *Pending Approvals (${pendingApprovals.size}):*\n\n`;
    const btns = [];
    pendingApprovals.forEach((info, uid) => {
      txt += `👤 ${info.firstName} | @${info.username} | \`${uid}\`\n`;
      btns.push([
        { text: `✅ ${info.firstName}`, callback_data: `approve_${uid}` },
        { text: "❌ Reject", callback_data: `reject_${uid}` },
      ]);
    });
    bot.sendMessage(chatId, txt, { parse_mode: "Markdown", reply_markup: { inline_keyboard: btns } });
    return;
  }

  if (data === "back_main") {
    bot.sendMessage(chatId, "🏠 Main Menu:", mainMenu(userId));
  }
});

// ─── Message Handler ───────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  if (!isApproved(userId)) return;

  const text = msg.text.trim();
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);

  if (urlMatch) {
    const url = urlMatch[0];

    // ── Flipkart only check ──
    if (!isFlipkartUrl(url)) {
      bot.sendMessage(
        chatId,
        `⚠️ *Sirf Flipkart links allowed hain!*\n\nFlipkart.com ka product link bhejo. 🛒`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    // Duplicate check
    const dup = [...activeTracks.values()].find((t) => t.userId === userId && t.url === url);
    if (dup) {
      bot.sendMessage(
        chatId,
        `⚠️ *Yeh link already track ho raha hai!*\nTrack #${dup.trackId} pehle se chal raha hai.`,
        { parse_mode: "Markdown", ...mainMenu(userId) }
      );
      return;
    }

    if (getUserTracks(userId).length >= MAX_TRACKS) {
      bot.sendMessage(chatId, `⚠️ *Max ${MAX_TRACKS} tracks limit!*\nPehle koi band karo.`, { parse_mode: "Markdown" });
      return;
    }

    const sent = await bot.sendMessage(chatId,
      `⏳ *Track shuru ho raha hai...*\n🔗 ${url}`,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );

    const trackId = startTracking(userId, chatId, url);

    bot.editMessageText(
      `✅ *Track #${trackId} Start!*\n\n🔗 ${url}\n\n⏱️ Har *15 sec* Flipkart check ho raha hai\n📢 Stock aane pe non-stop alert aayega!`,
      {
        chat_id: chatId,
        message_id: sent.message_id,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [
          [{ text: `🛑 Stop Track #${trackId}`, callback_data: `stop_${trackId}` }],
          [{ text: "📋 List Active", callback_data: "list_active" }],
        ]},
      }
    );
    return;
  }

  bot.sendMessage(chatId, "👋 Kya karna hai?\n\nFlipkart product link bhejo ya button use karo 👇", mainMenu(userId));
});

console.log("🛒 Flipkart Stock Tracker Bot running...");
