const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const cheerio = require("cheerio");
const express = require("express");

const TOKEN = "8901855590:AAHFlMQ_LNzOrJ0noP8BPQgnkSAZ2mRo2uc";
const ADMIN_ID = 7485181331;
const MAX_TRACKS = 5;
const CHECK_MS = 15000;

const bot = new Telegraf(TOKEN);

const approvedUsers = new Set([ADMIN_ID]);
const pendingApprovals = new Map();
const activeTracks = new Map();
let trackCounter = 0;

// ── Keep-alive ──────────────────────────────────────────────────────────────
const app = express();
app.get("/", (_req, res) => res.send("Flipkart Bot Alive!"));
app.listen(process.env.PORT || 3000, () =>
  console.log("Server on port", process.env.PORT || 3000)
);
setInterval(() => {
  const u = process.env.RENDER_EXTERNAL_URL;
  if (u) axios.get(u).catch(() => {});
}, 25000);

// ── Helpers ─────────────────────────────────────────────────────────────────
const isApproved = (id) => approvedUsers.has(id);
const isAdmin = (id) => id === ADMIN_ID;
const getUserTracks = (uid) =>
  [...activeTracks.values()].filter((t) => t.userId === uid);

function isFlipkartUrl(url) {
  try { return new URL(url).hostname.includes("flipkart.com"); }
  catch { return false; }
}

function mainKeyboard(userId) {
  const rows = [
    [Markup.button.callback("▶️ Start Track", "start_track")],
    [Markup.button.callback("📋 List Active", "list_active")],
    [Markup.button.callback("🛑 Stop All", "stop_all")],
  ];
  if (isAdmin(userId))
    rows.push([Markup.button.callback("👥 Pending Approvals", "pending")]);
  return Markup.inlineKeyboard(rows);
}

// ── Flipkart checker ────────────────────────────────────────────────────────
const UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
];
const randUA = () => UAS[Math.floor(Math.random() * UAS.length)];

async function checkFlipkartStock(url) {
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": randUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
        "Cache-Control": "no-cache",
        Referer: "https://www.flipkart.com/",
        "Upgrade-Insecure-Requests": "1",
      },
      timeout: 12000,
      maxRedirects: 5,
    });

    const $ = cheerio.load(data);

    const productName = (
      $("span.B_NuCI").text().trim() ||
      $("h1._9E25nV span").text().trim() ||
      $("h1.yhB1nd").text().trim() ||
      $("h1").first().text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      "Flipkart Product"
    ).slice(0, 100);

    let variant = "";
    const ramM = productName.match(/(\d+\s*GB\s*RAM)/gi);
    const storM = productName.match(/(\d+\s*(?:GB|TB)(?!\s*RAM))/gi);
    if (ramM) variant += ramM[0] + " ";
    if (storM) variant += [...new Set(storM)].join(" / ");

    const bodyText = $("body").text().toLowerCase();
    const soldOut =
      $("._16FRp0").length > 0 ||
      bodyText.includes("sold out") ||
      bodyText.includes("currently out of stock");
    const notifyMe =
      $("._2vXMl6").length > 0 ||
      bodyText.includes("notify me");
    const buyBtn =
      $("._2KpZ6l._2U9uOA._3v1-ww").length > 0 ||
      $("._2KpZ6l._2U9uOA").length > 0 ||
      $("button._2KpZ6l").length > 0;

    return {
      inStock: buyBtn && !soldOut && !notifyMe,
      productName,
      variant: variant.trim(),
    };
  } catch (e) {
    console.error("Check error:", e.message);
    return { inStock: false, productName: "Fetch Error", variant: "" };
  }
}

// ── Track engine ─────────────────────────────────────────────────────────────
function startTracking(userId, chatId, url) {
  trackCounter++;
  const trackId = trackCounter;

  const ref = setInterval(async () => {
    if (!activeTracks.has(trackId)) return;
    const r = await checkFlipkartStock(url);
    if (r.inStock) {
      const v = r.variant ? `\n📦 *Storage/RAM:* \`${r.variant}\`` : "";
      bot.telegram
        .sendMessage(
          chatId,
          `🚨 *FLIPKART STOCK AA GAYI!*\n\n🛍️ *${r.productName}*${v}\n\n🔗 [Abhi Kharido!](${url})\n\n⏱️ Har 15 sec alert aata rahega!`,
          {
            parse_mode: "Markdown",
            disable_web_page_preview: false,
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback(`🛑 Stop Track #${trackId}`, `stop_${trackId}`)],
            ]).reply_markup,
          }
        )
        .catch(console.error);
      activeTracks.set(trackId, {
        ...activeTracks.get(trackId),
        productName: r.productName,
      });
    }
  }, CHECK_MS);

  activeTracks.set(trackId, {
    userId, chatId, url,
    productName: "Checking...",
    interval: ref,
    trackId,
  });
  return trackId;
}

function stopTracking(trackId) {
  const t = activeTracks.get(trackId);
  if (t) { clearInterval(t.interval); activeTracks.delete(trackId); }
  return t || null;
}

// ── /start ───────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const name = ctx.from.first_name;
  const username = ctx.from.username || "N/A";
  const chatId = ctx.chat.id;

  if (!isApproved(userId)) {
    if (!pendingApprovals.has(userId)) {
      pendingApprovals.set(userId, { username, firstName: name, chatId });
      await bot.telegram
        .sendMessage(
          ADMIN_ID,
          `🔔 *New Access Request*\n\n👤 ${name}\n🆔 \`${userId}\`\n@${username}`,
          {
            parse_mode: "Markdown",
            reply_markup: Markup.inlineKeyboard([
              [
                Markup.button.callback("✅ Approve", `approve_${userId}`),
                Markup.button.callback("❌ Reject", `reject_${userId}`),
              ],
            ]).reply_markup,
          }
        )
        .catch(console.error);
    }
    return ctx.reply("⏳ *Access pending hai bhai.*\nAdmin ko request bhej di — wait karo! 🙏", {
      parse_mode: "Markdown",
    });
  }

  return ctx.reply(
    `👋 *Welcome ${name}!*\n\n🛒 *Flipkart Stock Tracker*\n\nFlipkart link bhejo — stock aate hi alert milega! 🔔\n⚡ Har *15 sec* pe check hoga`,
    { parse_mode: "Markdown", ...mainKeyboard(userId) }
  );
});

// ── Actions ──────────────────────────────────────────────────────────────────
bot.action(/^approve_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Admin only");
  const tid = parseInt(ctx.match[1]);
  approvedUsers.add(tid);
  const info = pendingApprovals.get(tid);
  pendingApprovals.delete(tid);
  await ctx.editMessageText(`✅ User ${tid} approved!`).catch(() => {});
  if (info)
    bot.telegram.sendMessage(info.chatId, "✅ *Access mil gaya!*\nAb /start karo 🚀", {
      parse_mode: "Markdown",
    }).catch(() => {});
  return ctx.answerCbQuery("Approved!");
});

bot.action(/^reject_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Admin only");
  const tid = parseInt(ctx.match[1]);
  const info = pendingApprovals.get(tid);
  pendingApprovals.delete(tid);
  await ctx.editMessageText(`❌ User ${tid} rejected.`).catch(() => {});
  if (info) bot.telegram.sendMessage(info.chatId, "❌ Request reject ho gayi.").catch(() => {});
  return ctx.answerCbQuery("Rejected.");
});

bot.action("start_track", async (ctx) => {
  const userId = ctx.from.id;
  if (!isApproved(userId)) return ctx.answerCbQuery("⛔ Access nahi.");
  if (getUserTracks(userId).length >= MAX_TRACKS) {
    await ctx.answerCbQuery(`Max ${MAX_TRACKS} tracks!`);
    return ctx.reply(`⚠️ Already *${MAX_TRACKS}* tracks chal rahe hain! Pehle koi band karo 📋`, {
      parse_mode: "Markdown",
    });
  }
  await ctx.answerCbQuery();
  return ctx.reply("🔗 *Flipkart product ka link bhejo:*", {
    parse_mode: "Markdown",
    reply_markup: { force_reply: true },
  });
});

bot.action("list_active", async (ctx) => {
  const userId = ctx.from.id;
  if (!isApproved(userId)) return ctx.answerCbQuery("⛔ Access nahi.");
  await ctx.answerCbQuery();
  const tracks = getUserTracks(userId);
  if (!tracks.length)
    return ctx.reply("📭 Koi active track nahi.", mainKeyboard(userId));

  let txt = `📋 *Active Tracks (${tracks.length}/${MAX_TRACKS}):*\n\n`;
  const btns = [];
  tracks.forEach((t, i) => {
    txt += `*${i + 1}.* Track #${t.trackId}\n🛍️ ${t.productName}\n🔗 ${t.url}\n\n`;
    btns.push([Markup.button.callback(`🛑 Stop ${i + 1} (Track #${t.trackId})`, `stop_${t.trackId}`)]);
  });
  btns.push([Markup.button.callback("🔙 Back", "back_main")]);
  return ctx.reply(txt, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    ...Markup.inlineKeyboard(btns),
  });
});

bot.action(/^stop_(\d+)$/, async (ctx) => {
  const userId = ctx.from.id;
  if (!isApproved(userId)) return ctx.answerCbQuery("⛔ Access nahi.");
  const trackId = parseInt(ctx.match[1]);
  const t = activeTracks.get(trackId);
  if (!t || t.userId !== userId) {
    return ctx.answerCbQuery("⚠️ Track nahi mila.");
  }
  stopTracking(trackId);
  await ctx.answerCbQuery(`Track #${trackId} band!`);
  return ctx.reply(`🛑 *Track #${trackId} band kar diya!*`, {
    parse_mode: "Markdown",
    ...mainKeyboard(userId),
  });
});

bot.action("stop_all", async (ctx) => {
  const userId = ctx.from.id;
  if (!isApproved(userId)) return ctx.answerCbQuery("⛔ Access nahi.");
  await ctx.answerCbQuery();
  const tracks = getUserTracks(userId);
  if (!tracks.length)
    return ctx.reply("📭 Koi track nahi tha.", mainKeyboard(userId));
  tracks.forEach((t) => stopTracking(t.trackId));
  return ctx.reply(`🛑 *Saare ${tracks.length} tracks band!*`, {
    parse_mode: "Markdown",
    ...mainKeyboard(userId),
  });
});

bot.action("pending", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Admin only");
  await ctx.answerCbQuery();
  if (!pendingApprovals.size)
    return ctx.reply("✅ Koi pending request nahi.");
  let txt = `⏳ *Pending (${pendingApprovals.size}):*\n\n`;
  const btns = [];
  pendingApprovals.forEach((info, uid) => {
    txt += `👤 ${info.firstName} | @${info.username} | \`${uid}\`\n`;
    btns.push([
      Markup.button.callback(`✅ ${info.firstName}`, `approve_${uid}`),
      Markup.button.callback("❌ Reject", `reject_${uid}`),
    ]);
  });
  return ctx.reply(txt, { parse_mode: "Markdown", ...Markup.inlineKeyboard(btns) });
});

bot.action("back_main", async (ctx) => {
  const userId = ctx.from.id;
  await ctx.answerCbQuery();
  return ctx.reply("🏠 Main Menu:", mainKeyboard(userId));
});

// ── Text messages ─────────────────────────────────────────────────────────────
bot.on("text", async (ctx) => {
  const userId = ctx.from.id;
  const chatId = ctx.chat.id;
  if (!isApproved(userId)) return;

  const text = ctx.message.text.trim();
  const urlMatch = text.match(/https?:\/\/[^\s]+/i);
  if (!urlMatch)
    return ctx.reply("👋 Flipkart product link bhejo ya button use karo 👇", mainKeyboard(userId));

  const url = urlMatch[0];

  if (!isFlipkartUrl(url)) {
    return ctx.reply("⚠️ *Sirf Flipkart links allowed hain!*\nflipkart.com ka link bhejo 🛒", {
      parse_mode: "Markdown",
    });
  }

  const dup = [...activeTracks.values()].find(
    (t) => t.userId === userId && t.url === url
  );
  if (dup) {
    return ctx.reply(
      `⚠️ *Yeh link already track ho raha hai!*\nTrack #${dup.trackId} chal raha hai.`,
      { parse_mode: "Markdown", ...mainKeyboard(userId) }
    );
  }

  if (getUserTracks(userId).length >= MAX_TRACKS) {
    return ctx.reply(`⚠️ *Max ${MAX_TRACKS} limit!* Pehle koi band karo.`, {
      parse_mode: "Markdown",
    });
  }

  const sent = await ctx.reply(`⏳ *Track shuru ho raha hai...*\n🔗 ${url}`, {
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  });

  const trackId = startTracking(userId, chatId, url);

  await bot.telegram
    .editMessageText(
      chatId,
      sent.message_id,
      undefined,
      `✅ *Track #${trackId} Start!*\n\n🔗 ${url}\n\n⏱️ Har *15 sec* check ho raha hai\n📢 Stock aane pe non-stop alert!`,
      {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback(`🛑 Stop Track #${trackId}`, `stop_${trackId}`)],
          [Markup.button.callback("📋 List Active", "list_active")],
        ]).reply_markup,
      }
    )
    .catch(console.error);
});

// ── Launch ───────────────────────────────────────────────────────────────────
bot.launch().then(() => console.log("🛒 Flipkart Stock Tracker Bot running!"));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
