
"use strict";

const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const TOKEN    = "8901855590:AAHFlMQ_LNzOrJ0noP8BPQgnkSAZ2mRo2uc";
const ADMIN_ID = 7485181331;
const MAX_TRACKS = 5;
const CHECK_MS   = 15000;
const PORT       = process.env.PORT || 3000;

// ── Express FIRST (Render health-check) ────────────────────────────────────
const app = express();
app.get("/", (_req, res) => res.send("OK"));
app.listen(PORT, "0.0.0.0", () => console.log("HTTP server on", PORT));

// ── Bot ────────────────────────────────────────────────────────────────────
const bot = new Telegraf(TOKEN);

const approvedUsers    = new Set([ADMIN_ID]);
const pendingApprovals = new Map();
const activeTracks     = new Map();
let   trackCounter     = 0;

// ── Keep-alive ─────────────────────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL || "";
if (SELF_URL) {
  setInterval(() => axios.get(SELF_URL).catch(() => {}), 25000);
  console.log("Keep-alive:", SELF_URL);
}

// ── Helpers ────────────────────────────────────────────────────────────────
const isApproved    = (id) => approvedUsers.has(id);
const isAdmin       = (id) => id === ADMIN_ID;
const getUserTracks = (uid) => [...activeTracks.values()].filter((t) => t.userId === uid);

// Escape HTML special chars so Telegram HTML mode works safely
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isFlipkartUrl(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h.includes("flipkart.com") || h.includes("dl.flipkart.com");
  } catch { return false; }
}

function mainKb(userId) {
  const rows = [
    [Markup.button.callback("▶️ Start Track", "start_track")],
    [Markup.button.callback("📋 List Active", "list_active")],
    [Markup.button.callback("🛑 Stop All",    "stop_all")],
  ];
  if (isAdmin(userId))
    rows.push([Markup.button.callback("👥 Pending", "pending")]);
  return Markup.inlineKeyboard(rows);
}

// ── Flipkart Checker ───────────────────────────────────────────────────────
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];
const randUA = () => UAS[Math.floor(Math.random() * UAS.length)];

async function checkStock(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent":      randUA(),
        "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Cache-Control":   "no-cache",
        "Referer":         "https://www.flipkart.com/",
        "Upgrade-Insecure-Requests": "1",
      },
      timeout: 12000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(data);

    const productName = (
      $("span.B_NuCI").text().trim()     ||
      $("h1._9E25nV span").text().trim() ||
      $("h1.yhB1nd").text().trim()       ||
      $("h1").first().text().trim()      ||
      $('meta[property="og:title"]').attr("content") ||
      "Flipkart Product"
    ).slice(0, 100);

    let variant = "";
    const ramM  = productName.match(/\d+\s*GB\s*RAM/gi);
    const storM = productName.match(/\d+\s*(?:GB|TB)(?!\s*RAM)/gi);
    if (ramM)  variant += ramM[0] + " ";
    if (storM) variant += [...new Set(storM)].join(" / ");

    const body     = $("body").text().toLowerCase();
    const soldOut  = $("._16FRp0").length > 0 || body.includes("sold out") || body.includes("currently out of stock");
    const notifyMe = $("._2vXMl6").length > 0 || body.includes("notify me");
    const buyBtn   =
      $("._2KpZ6l._2U9uOA._3v1-ww").length > 0 ||
      $("._2KpZ6l._2U9uOA").length > 0 ||
      $("button._2KpZ6l").length > 0;

    return {
      inStock: buyBtn && !soldOut && !notifyMe,
      productName,
      variant: variant.trim(),
    };
  } catch (e) {
    console.error("checkStock:", e.message);
    return { inStock: false, productName: "Fetch Error", variant: "" };
  }
}

// ── Track engine ───────────────────────────────────────────────────────────
function startTracking(userId, chatId, url) {
  trackCounter++;
  const id = trackCounter;

  const timer = setInterval(async () => {
    if (!activeTracks.has(id)) return;
    const r = await checkStock(url);
    if (!r.inStock) return;

    const v = r.variant ? `\n📦 <b>Storage/RAM:</b> ${esc(r.variant)}` : "";
    bot.telegram.sendMessage(
      chatId,
      `🚨 <b>FLIPKART STOCK AA GAYI!</b>\n\n` +
      `🛍️ <b>${esc(r.productName)}</b>${v}\n\n` +
      `🔗 <a href="${esc(url)}">Abhi Kharido!</a>\n\n` +
      `⏱️ Har 15 sec alert aata rahega!`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`🛑 Stop Track #${id}`, `stop_${id}`)],
        ]).reply_markup,
      }
    ).catch(console.error);

    activeTracks.set(id, { ...activeTracks.get(id), productName: r.productName });
  }, CHECK_MS);

  activeTracks.set(id, { userId, chatId, url, productName: "Checking...", timer, trackId: id });
  return id;
}

function stopTrack(id) {
  const t = activeTracks.get(id);
  if (!t) return null;
  clearInterval(t.timer);
  activeTracks.delete(id);
  return t;
}

// ── /start ─────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const { id: uid, first_name: name, username } = ctx.from;
  const chatId = ctx.chat.id;

  if (!isApproved(uid)) {
    if (!pendingApprovals.has(uid)) {
      pendingApprovals.set(uid, { firstName: name, username: username || "N/A", chatId });
      bot.telegram.sendMessage(
        ADMIN_ID,
        `🔔 <b>New Request</b>\n👤 ${esc(name)}\n🆔 <code>${uid}</code>\n@${esc(username || "N/A")}`,
        {
          parse_mode: "HTML",
          reply_markup: Markup.inlineKeyboard([
            [
              Markup.button.callback("✅ Approve", `approve_${uid}`),
              Markup.button.callback("❌ Reject",  `reject_${uid}`),
            ],
          ]).reply_markup,
        }
      ).catch(console.error);
    }
    return ctx.reply("⏳ Access pending hai.\nAdmin approve karega — wait karo! 🙏");
  }

  return ctx.reply(
    `👋 <b>Welcome ${esc(name)}!</b>\n\n🛒 <b>Flipkart Stock Tracker</b>\nFlipkart link bhejo — stock aate hi alert! 🔔\n⚡ Har <b>15 sec</b> check`,
    { parse_mode: "HTML", ...mainKb(uid) }
  );
});

// ── Approve / Reject ───────────────────────────────────────────────────────
bot.action(/^approve_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Admin only").catch(() => {});
  const tid = parseInt(ctx.match[1]);
  approvedUsers.add(tid);
  const info = pendingApprovals.get(tid);
  pendingApprovals.delete(tid);
  await ctx.editMessageText(`✅ User ${tid} approved!`).catch(() => {});
  if (info)
    bot.telegram.sendMessage(info.chatId, "✅ Access mil gaya! /start karo 🚀").catch(() => {});
  return ctx.answerCbQuery("Approved!").catch(() => {});
});

bot.action(/^reject_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Admin only").catch(() => {});
  const tid = parseInt(ctx.match[1]);
  const info = pendingApprovals.get(tid);
  pendingApprovals.delete(tid);
  await ctx.editMessageText(`❌ User ${tid} rejected.`).catch(() => {});
  if (info) bot.telegram.sendMessage(info.chatId, "❌ Request reject ho gayi.").catch(() => {});
  return ctx.answerCbQuery("Rejected.").catch(() => {});
});

// ── Actions ────────────────────────────────────────────────────────────────
bot.action("start_track", async (ctx) => {
  if (!isApproved(ctx.from.id)) return ctx.answerCbQuery("⛔ Access nahi.").catch(() => {});
  if (getUserTracks(ctx.from.id).length >= MAX_TRACKS) {
    ctx.answerCbQuery(`Max ${MAX_TRACKS} tracks!`).catch(() => {});
    return ctx.reply(`⚠️ Already ${MAX_TRACKS} tracks chal rahe hain! Pehle koi band karo.`);
  }
  ctx.answerCbQuery().catch(() => {});
  return ctx.reply("🔗 Flipkart product ka link bhejo:", { reply_markup: { force_reply: true } });
});

bot.action("list_active", async (ctx) => {
  if (!isApproved(ctx.from.id)) return ctx.answerCbQuery("⛔ Access nahi.").catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  const tracks = getUserTracks(ctx.from.id);
  if (!tracks.length) return ctx.reply("📭 Koi active track nahi.", mainKb(ctx.from.id));

  let txt = `📋 <b>Active Tracks (${tracks.length}/${MAX_TRACKS}):</b>\n\n`;
  const btns = [];
  tracks.forEach((t, i) => {
    txt += `<b>${i + 1}.</b> Track #${t.trackId}\n🛍️ ${esc(t.productName)}\n🔗 ${esc(t.url)}\n\n`;
    btns.push([Markup.button.callback(`🛑 Stop ${i + 1} (Track #${t.trackId})`, `stop_${t.trackId}`)]);
  });
  btns.push([Markup.button.callback("🔙 Back", "back_main")]);
  return ctx.reply(txt, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...Markup.inlineKeyboard(btns),
  });
});

bot.action(/^stop_(\d+)$/, async (ctx) => {
  if (!isApproved(ctx.from.id)) return ctx.answerCbQuery("⛔ Access nahi.").catch(() => {});
  const id = parseInt(ctx.match[1]);
  const t  = activeTracks.get(id);
  if (!t || t.userId !== ctx.from.id) return ctx.answerCbQuery("⚠️ Track nahi mila.").catch(() => {});
  stopTrack(id);
  ctx.answerCbQuery(`Track #${id} band!`).catch(() => {});
  return ctx.reply(`🛑 Track #${id} band kar diya!`, mainKb(ctx.from.id));
});

bot.action("stop_all", async (ctx) => {
  if (!isApproved(ctx.from.id)) return ctx.answerCbQuery("⛔ Access nahi.").catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  const tracks = getUserTracks(ctx.from.id);
  if (!tracks.length) return ctx.reply("📭 Koi track nahi tha.", mainKb(ctx.from.id));
  tracks.forEach((t) => stopTrack(t.trackId));
  return ctx.reply(`🛑 Saare ${tracks.length} tracks band!`, mainKb(ctx.from.id));
});

bot.action("pending", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Admin only").catch(() => {});
  ctx.answerCbQuery().catch(() => {});
  if (!pendingApprovals.size) return ctx.reply("✅ Koi pending nahi.");
  let txt = `⏳ <b>Pending (${pendingApprovals.size}):</b>\n\n`;
  const btns = [];
  pendingApprovals.forEach((info, uid) => {
    txt += `👤 ${esc(info.firstName)} | @${esc(info.username)} | <code>${uid}</code>\n`;
    btns.push([
      Markup.button.callback(`✅ ${info.firstName}`, `approve_${uid}`),
      Markup.button.callback("❌ Reject", `reject_${uid}`),
    ]);
  });
  return ctx.reply(txt, { parse_mode: "HTML", ...Markup.inlineKeyboard(btns) });
});

bot.action("back_main", async (ctx) => {
  ctx.answerCbQuery().catch(() => {});
  return ctx.reply("🏠 Main Menu:", mainKb(ctx.from.id));
});

// ── Text / URL handler ─────────────────────────────────────────────────────
bot.on("text", async (ctx) => {
  const uid    = ctx.from.id;
  const chatId = ctx.chat.id;
  if (!isApproved(uid)) return;

  const text     = ctx.message.text.trim();
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch)
    return ctx.reply("👋 Flipkart product link bhejo ya button use karo 👇", mainKb(uid));

  const url = urlMatch[0];

  if (!isFlipkartUrl(url))
    return ctx.reply("⚠️ Sirf Flipkart links allowed hain!\nflipkart.com ka link bhejo 🛒");

  const dup = [...activeTracks.values()].find((t) => t.userId === uid && t.url === url);
  if (dup)
    return ctx.reply(`⚠️ Yeh link already track ho raha hai!\nTrack #${dup.trackId} chal raha hai.`, mainKb(uid));

  if (getUserTracks(uid).length >= MAX_TRACKS)
    return ctx.reply(`⚠️ Max ${MAX_TRACKS} limit! Pehle koi band karo.`);

  // Plain text message — NO parse_mode to avoid URL entity errors
  const sent = await ctx.reply(
    `⏳ Track shuru ho raha hai...\nLink: ${url}`,
    { disable_web_page_preview: true }
  );

  const trackId = startTracking(uid, chatId, url);

  // Edit with HTML (URL in href — safe)
  await bot.telegram.editMessageText(
    chatId, sent.message_id, undefined,
    `✅ <b>Track #${trackId} Start!</b>\n\n` +
    `🔗 <a href="${esc(url)}">Product Link</a>\n\n` +
    `⏱️ Har <b>15 sec</b> check ho raha hai\n📢 Stock aane pe non-stop alert!`,
    {
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(`🛑 Stop Track #${trackId}`, `stop_${trackId}`)],
        [Markup.button.callback("📋 List Active", "list_active")],
      ]).reply_markup,
    }
  ).catch(console.error);
});

// ── Launch ─────────────────────────────────────────────────────────────────
bot.launch()
  .then(() => console.log("🛒 Flipkart Bot running!"))
  .catch((e) => { console.error("Launch failed:", e.message); process.exit(1); });

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
process.on("uncaughtException",  (e) => console.error("uncaughtException:", e.message));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));
