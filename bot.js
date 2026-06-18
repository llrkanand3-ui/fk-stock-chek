const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const TOKEN = "8901855590:AAHFlMQ_LNzOrJ0noP8BPQgnkSAZ2mRo2uc";
const ADMIN_ID = 7485181331;
const MAX_TRACKS = 5;
const CHECK_INTERVAL_MS = 15000;

const bot = new TelegramBot(TOKEN, { polling: true });

// State
const approvedUsers = new Set([ADMIN_ID]);
const pendingApprovals = new Map(); // userId -> {username, firstName}
const activeTracks = new Map(); // trackId -> { userId, url, productName, interval, chatId }
let trackCounter = 0;

// ─── Keep-alive Express server for Render ──────────────────────────────────
const app = express();
app.get("/", (req, res) => res.send("Bot is alive!"));
app.listen(process.env.PORT || 3000, () =>
  console.log("Keep-alive server running")
);

// Self-ping every 30 seconds to prevent Render sleep
setInterval(() => {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (url) axios.get(url).catch(() => {});
}, 30000);

// ─── Helpers ───────────────────────────────────────────────────────────────
function isApproved(userId) {
  return approvedUsers.has(userId);
}

function isAdmin(userId) {
  return userId === ADMIN_ID;
}

function getUserTracks(userId) {
  return [...activeTracks.values()].filter((t) => t.userId === userId);
}

function mainMenu(userId) {
  const buttons = [
    [{ text: "▶️ Start Track", callback_data: "start_track" }],
    [{ text: "📋 List Active", callback_data: "list_active" }],
    [{ text: "🛑 Stop All", callback_data: "stop_all" }],
  ];
  if (isAdmin(userId)) {
    buttons.push([{ text: "👥 Pending Approvals", callback_data: "pending" }]);
  }
  return {
    reply_markup: { inline_keyboard: buttons },
  };
}

// ─── Amazon stock checker ──────────────────────────────────────────────────
async function checkAmazonStock(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-IN,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 10000,
    });

    const $ = cheerio.load(data);

    // Product name
    const productName =
      $("#productTitle").text().trim() ||
      $("h1.a-size-large").text().trim() ||
      "Unknown Product";

    // Storage / RAM (from title or variation)
    let variant = "";
    const titleLower = productName.toLowerCase();
    const storageMatch = titleLower.match(/(\d+\s*(?:gb|tb|mb))/gi);
    const ramMatch = titleLower.match(/(\d+\s*gb\s*ram)/gi);
    if (ramMatch) variant += ramMatch[0].toUpperCase() + " ";
    if (storageMatch) {
      const unique = [...new Set(storageMatch.map((s) => s.toUpperCase()))];
      variant += unique.join(" / ");
    }

    // Stock check
    const buyNowBtn = $("#buy-now-button, #buyNow_feature_div").length > 0;
    const addToCartBtn = $("#add-to-cart-button").length > 0;
    const outOfStock =
      $("#outOfStock, #availability .a-color-price")
        .text()
        .toLowerCase()
        .includes("currently unavailable") ||
      $(".a-color-price").text().toLowerCase().includes("currently unavailable");
    const availabilityText = $("#availability span").first().text().trim();

    const inStock =
      (buyNowBtn || addToCartBtn) &&
      !outOfStock &&
      !availabilityText.toLowerCase().includes("unavailable");

    return {
      inStock,
      productName: productName.slice(0, 80),
      variant: variant.trim(),
      buyNow: buyNowBtn,
    };
  } catch (err) {
    console.error("Check error:", err.message);
    return { inStock: false, productName: "Error fetching", variant: "" };
  }
}

// ─── Start tracking ────────────────────────────────────────────────────────
function startTracking(userId, chatId, url) {
  trackCounter++;
  const trackId = trackCounter;

  const intervalRef = setInterval(async () => {
    const track = activeTracks.get(trackId);
    if (!track) return;

    const result = await checkAmazonStock(url);

    if (result.inStock) {
      const variantText = result.variant ? `\n📦 *Variant:* ${result.variant}` : "";
      const msg =
        `✅ *STOCK AA GAYI HAI!*\n\n` +
        `🛍️ *Product:* ${result.productName}` +
        variantText +
        `\n🔗 [Buy Now Link](${url})\n\n` +
        `⏱️ Har 15 sec check ho raha hai...`;

      bot.sendMessage(chatId, msg, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: `🛑 Stop Track #${trackId}`, callback_data: `stop_${trackId}` }],
          ],
        },
      });

      // Update product name
      activeTracks.set(trackId, { ...track, productName: result.productName });
    }
  }, CHECK_INTERVAL_MS);

  activeTracks.set(trackId, {
    userId,
    chatId,
    url,
    productName: "Checking...",
    interval: intervalRef,
    trackId,
  });

  return trackId;
}

function stopTracking(trackId) {
  const track = activeTracks.get(trackId);
  if (track) {
    clearInterval(track.interval);
    activeTracks.delete(trackId);
    return track;
  }
  return null;
}

// ─── Bot /start ────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const name = msg.from.first_name || "User";

  if (!isApproved(userId)) {
    // Request approval from admin
    if (!pendingApprovals.has(userId)) {
      pendingApprovals.set(userId, {
        username: msg.from.username || "N/A",
        firstName: name,
        chatId,
      });
      bot.sendMessage(
        ADMIN_ID,
        `🔔 *New Approval Request*\n\n👤 Name: ${name}\n🆔 User ID: \`${userId}\`\n📛 Username: @${msg.from.username || "N/A"}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Approve", callback_data: `approve_${userId}` },
                { text: "❌ Reject", callback_data: `reject_${userId}` },
              ],
            ],
          },
        }
      );
    }
    bot.sendMessage(
      chatId,
      `⏳ Bhai, tumhara access abhi *pending* hai.\nAdmin ko request bhej di gayi hai. Wait karo! 🙏`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  bot.sendMessage(
    chatId,
    `👋 Welcome *${name}*!\n\n🤖 *Amazon Stock Tracker Bot*\n\nKya karna hai?`,
    { parse_mode: "Markdown", ...mainMenu(userId) }
  );
});

// ─── Callback queries ──────────────────────────────────────────────────────
bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const msgId = query.message.message_id;
  const data = query.data;

  bot.answerCallbackQuery(query.id);

  // ── Admin: Approve / Reject ──
  if (data.startsWith("approve_")) {
    if (!isAdmin(userId)) return;
    const targetId = parseInt(data.split("_")[1]);
    approvedUsers.add(targetId);
    const info = pendingApprovals.get(targetId);
    pendingApprovals.delete(targetId);
    bot.editMessageText(`✅ User ${targetId} approved!`, {
      chat_id: chatId,
      message_id: msgId,
    });
    if (info) {
      bot.sendMessage(
        info.chatId,
        `✅ *Tumhara access approve ho gaya!*\nAb /start karo aur tracking shuru karo! 🚀`,
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  if (data.startsWith("reject_")) {
    if (!isAdmin(userId)) return;
    const targetId = parseInt(data.split("_")[1]);
    const info = pendingApprovals.get(targetId);
    pendingApprovals.delete(targetId);
    bot.editMessageText(`❌ User ${targetId} rejected.`, {
      chat_id: chatId,
      message_id: msgId,
    });
    if (info) {
      bot.sendMessage(info.chatId, `❌ Tumhara access request reject kar diya gaya.`);
    }
    return;
  }

  // ── Approved users only ──
  if (!isApproved(userId)) {
    bot.sendMessage(chatId, "⛔ Tumhara access approved nahi hai abhi.");
    return;
  }

  // ── Remove user (admin) ──
  if (data.startsWith("removeuser_")) {
    if (!isAdmin(userId)) return;
    const targetId = parseInt(data.split("_")[1]);
    approvedUsers.delete(targetId);
    bot.editMessageText(`🗑️ User ${targetId} removed.`, {
      chat_id: chatId,
      message_id: msgId,
    });
    return;
  }

  // ── Start Track ──
  if (data === "start_track") {
    const myTracks = getUserTracks(userId);
    if (myTracks.length >= MAX_TRACKS) {
      bot.sendMessage(
        chatId,
        `⚠️ Bhai, already *${MAX_TRACKS}* tracks chal rahe hain!\nPehle koi band karo 📋 List Active se.`,
        { parse_mode: "Markdown" }
      );
      return;
    }
    bot.sendMessage(chatId, "🔗 *Amazon product ka link bhejo jisko track karna hai:*", {
      parse_mode: "Markdown",
      reply_markup: { force_reply: true },
    });
    return;
  }

  // ── List Active ──
  if (data === "list_active") {
    const myTracks = getUserTracks(userId);
    if (myTracks.length === 0) {
      bot.sendMessage(chatId, "📭 Koi active track nahi hai abhi.", mainMenu(userId));
      return;
    }
    let text = `📋 *Active Tracks (${myTracks.length}/${MAX_TRACKS}):*\n\n`;
    const stopButtons = [];
    myTracks.forEach((t, i) => {
      text += `*${i + 1}.* Track #${t.trackId}\n🛍️ ${t.productName}\n🔗 ${t.url}\n\n`;
      stopButtons.push([
        { text: `🛑 Stop ${i + 1} (Track #${t.trackId})`, callback_data: `stop_${t.trackId}` },
      ]);
    });
    stopButtons.push([{ text: "🔙 Back", callback_data: "back_main" }]);
    bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: stopButtons },
      disable_web_page_preview: true,
    });
    return;
  }

  // ── Stop specific track ──
  if (data.startsWith("stop_")) {
    const trackId = parseInt(data.split("_")[1]);
    const track = activeTracks.get(trackId);
    if (!track || track.userId !== userId) {
      bot.sendMessage(chatId, "⚠️ Yeh track nahi mila ya tumhara nahi hai.");
      return;
    }
    stopTracking(trackId);
    bot.sendMessage(chatId, `🛑 *Track #${trackId}* band kar diya!`, {
      parse_mode: "Markdown",
      ...mainMenu(userId),
    });
    return;
  }

  // ── Stop All ──
  if (data === "stop_all") {
    const myTracks = getUserTracks(userId);
    if (myTracks.length === 0) {
      bot.sendMessage(chatId, "📭 Koi active track nahi tha.", mainMenu(userId));
      return;
    }
    myTracks.forEach((t) => stopTracking(t.trackId));
    bot.sendMessage(
      chatId,
      `🛑 *Saare ${myTracks.length} tracks band kar diye!*`,
      { parse_mode: "Markdown", ...mainMenu(userId) }
    );
    return;
  }

  // ── Pending Approvals (admin) ──
  if (data === "pending") {
    if (!isAdmin(userId)) return;
    if (pendingApprovals.size === 0) {
      bot.sendMessage(chatId, "✅ Koi pending request nahi hai.");
      return;
    }
    let text = `⏳ *Pending Approvals (${pendingApprovals.size}):*\n\n`;
    const buttons = [];
    pendingApprovals.forEach((info, uid) => {
      text += `👤 ${info.firstName} | @${info.username} | ID: \`${uid}\`\n`;
      buttons.push([
        { text: `✅ ${info.firstName}`, callback_data: `approve_${uid}` },
        { text: `❌ Reject`, callback_data: `reject_${uid}` },
      ]);
    });
    bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  // ── Back to main ──
  if (data === "back_main") {
    bot.sendMessage(chatId, "🏠 Main Menu:", mainMenu(userId));
    return;
  }
});

// ─── Handle URL replies ────────────────────────────────────────────────────
bot.on("message", async (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  if (!isApproved(userId)) return;

  const text = msg.text.trim();

  // Check if Amazon URL
  if (text.includes("amazon.in") || text.includes("amazon.com") || text.includes("amzn")) {
    // Normalize URL - remove extra params but keep ASIN
    let url = text;
    try {
      const u = new URL(text);
      // Keep only essential parts
      const asin = u.pathname.match(/\/dp\/([A-Z0-9]{10})/);
      if (asin) {
        url = `https://www.amazon.in/dp/${asin[1]}`;
      }
    } catch {}

    // Check duplicate
    const alreadyTracking = [...activeTracks.values()].find(
      (t) => t.userId === userId && t.url === url
    );
    if (alreadyTracking) {
      bot.sendMessage(
        chatId,
        `⚠️ *Yeh link already track ho raha hai!*\nTrack #${alreadyTracking.trackId} chal raha hai is URL ke liye.`,
        { parse_mode: "Markdown", ...mainMenu(userId) }
      );
      return;
    }

    // Check max
    const myTracks = getUserTracks(userId);
    if (myTracks.length >= MAX_TRACKS) {
      bot.sendMessage(
        chatId,
        `⚠️ *Max ${MAX_TRACKS} tracks limit!*\nPehle koi band karo.`,
        { parse_mode: "Markdown", ...mainMenu(userId) }
      );
      return;
    }

    const confirmMsg = await bot.sendMessage(
      chatId,
      `⏳ *Track shuru ho raha hai...*\n🔗 ${url}\n\nHar *15 seconds* pe check hoga. Stock aane pe immediately notify karunga! 📢`,
      { parse_mode: "Markdown", disable_web_page_preview: true }
    );

    const trackId = startTracking(userId, chatId, url);

    bot.editMessageText(
      `✅ *Track #${trackId} shuru!*\n🔗 ${url}\n\n⏱️ Har 15 sec pe check ho raha hai...\nStock aane pe message aayega 🔔`,
      {
        chat_id: chatId,
        message_id: confirmMsg.message_id,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: `🛑 Stop Track #${trackId}`, callback_data: `stop_${trackId}` }],
            [{ text: "📋 List Active", callback_data: "list_active" }],
          ],
        },
      }
    );
    return;
  }

  // Not a URL — show menu
  bot.sendMessage(chatId, "👋 Kya karna hai?", mainMenu(userId));
});

console.log("🤖 Amazon Stock Tracker Bot chal raha hai...");
