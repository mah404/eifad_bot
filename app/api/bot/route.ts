// Next.js / Vercel-friendly webhook handler using grammy

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { Bot, webhookCallback, Keyboard, Composer } from "grammy";
import { type NextRequest } from "next/server";

/* ─────────────────────  ENV & BOT  ───────────────────── */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN environment variable not found.");
}

const bot = new Bot(token);

const TARGET_CHANNEL = process.env.SUPPORT_GROUP_ID;
if (!TARGET_CHANNEL) {
  throw new Error("SUPPORT_GROUP_ID environment variable not found.");
}

const BALE_TOKEN = process.env.BALE_BOT_TOKEN;

if (!BALE_TOKEN) {
  throw new Error("BALE_BOT_TOKEN environment variable not found.");
}

async function sendToBale(chatId: string, text: string) {
  const res = await fetch(`https://tapi.bale.ai/bot${BALE_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  return res.json();
}

/* ─────────────────────  TYPES & STATE  ───────────────────── */
type UserState = "awaiting_file" | "awaiting_text" | "awaiting_anonymous_text";
type Lang = "fa" | "en";

const userStates = new Map<number, UserState>();
const messageMap = new Map<number, number>(); // groupMessageId -> userId
const userLangs = new Map<number, Lang>();
const anonCodes = new Map<number, string>();

function getAnonCode(userId: number) {
  let code = anonCodes.get(userId);
  if (!code) {
    code = `ANON-${userId.toString(36).toUpperCase()}`;
    anonCodes.set(userId, code);
  }
  return code;
}

/* ─────────────────────  TRANSLATIONS  ───────────────────── */
const TEXTS = {
  fa: {
    chooseLanguage: "لطفاً زبان مورد نظر خود را انتخاب نمایید.",
    languagePlaceholder: "Choose language / انتخاب زبان",
    startMessage: `با عرض سلام مجدد،

جهت برقراری ارتباط یکی از گزینه‌های موجود را انتخاب نمایید.

با تشکر`,

    knownMessageBtn: "💬 ارسال پیام به صورت شناس",
    anonymousMessageBtn: "🔒 ارسال پیام به صورت ناشناس",
    pdfBtn: "📄 ارسال فایل PDF",
    placeholder: "لطفاً یکی از گزینه های زیر را انتخاب نمایید.",

    askPdf: "لطفاً فایل PDF خود را ارسال کنید.",
    askKnown: "پیام خود را وارد نمایید.",
    askAnonymous: "پیام ناشناس خود را وارد نمایید.",

    blockedAccess: "❌ دسترسی شما به این بات مسدود شده است.",
    chooseMenuFirst:
      "❌ این پیام شما ارسال نگردید، لطفاً یکی از گزینه های زیر را انتخاب نمایید❌",

    knownSent: "پیام شما ارسال گردید.✅",
    anonymousSent: "پیام ناشناس شما ارسال گردید.✅",
    pdfSent: "فایل شما ارسال شد. متشکرم!",

    sendError: "❌ خطا در ارسال پیام. دوباره تلاش کنید.",
    anonymousSendError: "❌ خطا در ارسال پیام ناشناس. دوباره تلاش کنید.",
    fileSendError: "❌ خطا در ارسال فایل. دوباره تلاش کنید.",

    pdfOnly: "تنها فایل PDF مجاز است. لطفاً فایل خود را ارسال کنید.",
    pdfOnlyRetry: "تنها فایل PDF مجاز است. لطفاً مجدداً امتحان کنید.",

    adminReplyPrefix: "پاسخ ادمین:\n",
    adminReplySent: "پاسخ برای کاربر ارسال شد ✅",
    adminReplyError: "❌ خطا در ارسال پاسخ به کاربر.",

    useReplyForCommand:
      "❌ لطفاً این دستور را با Reply روی پیام کاربر ارسال کنید.",
    userNotFound: "❌ کاربر پیدا نشد.",

    blockListEmpty: "لیست مسدود شده‌ها خالی است ✅",
    blockListTitle: "لیست مسدود شده‌ها:",
    permanent: "دائمی",
    remaining: "باقی‌مانده",

    blockedPermanentUser: "❌امکان ارسال پیام برای شما محدود گردیده است❌",
    blocked1hUser:
      "❌امکان ارسال پیام برای شما به مدت یک ساعت محدود گردیده است❌",
    unblockedUser: "✅محدودیت امکان ارسال پیام برای شما برطرف گردیده است✅",

    blockedPermanentAdmin: "🚫 کاربر %UID% مسدود شد (دائمی).",
    blocked1hAdmin: "⏳ کاربر %UID% به مدت ۱ ساعت مسدود شد.",
    unblockedAdmin: "✅ کاربر %UID% از حالت مسدود خارج شد.",

    knownHeader: "پیام از",
    anonymousHeader: "پیام ناشناس",
    telegramId: "Telegram ID",
    noUsername: "بدون‌نام کاربری",
    userFallbackName: "کاربر",
  },

  en: {
    chooseLanguage: "Please choose your language.",
    languagePlaceholder: "Choose language / انتخاب زبان",
    startMessage: `Hello,

Please choose one of the options below to contact us.

Thank you`,

    knownMessageBtn: "💬 Send identified message",
    anonymousMessageBtn: "🔒 Send anonymous message",
    pdfBtn: "📄 Send PDF file",
    placeholder: "Please choose one of the options below.",

    askPdf: "Please send your PDF file.",
    askKnown: "Please type your message.",
    askAnonymous: "Please type your anonymous message.",

    blockedAccess: "❌ Your access to this bot has been blocked.",
    chooseMenuFirst:
      "❌ Your message was not sent. Please choose one of the options below. ❌",

    knownSent: "Your message has been sent. ✅",
    anonymousSent: "Your anonymous message has been sent. ✅",
    pdfSent: "Your file has been sent. Thank you!",

    sendError: "❌ Error sending message. Please try again.",
    anonymousSendError: "❌ Error sending anonymous message. Please try again.",
    fileSendError: "❌ Error sending file. Please try again.",

    pdfOnly: "Only PDF files are allowed. Please send your PDF file.",
    pdfOnlyRetry: "Only PDF files are allowed. Please try again.",

    adminReplyPrefix: "Admin reply:\n",
    adminReplySent: "Reply sent to the user ✅",
    adminReplyError: "❌ Error sending reply to the user.",

    useReplyForCommand:
      "❌ Please use this command by replying to the user's message.",
    userNotFound: "❌ User not found.",

    blockListEmpty: "Blocked users list is empty ✅",
    blockListTitle: "Blocked users list:",
    permanent: "Permanent",
    remaining: "Remaining",

    blockedPermanentUser:
      "❌ Your ability to send messages has been blocked. ❌",
    blocked1hUser:
      "❌ Your ability to send messages has been blocked for 1 hour. ❌",
    unblockedUser: "✅ Your messaging restriction has been removed. ✅",

    blockedPermanentAdmin: "🚫 User %UID% has been blocked permanently.",
    blocked1hAdmin: "⏳ User %UID% has been blocked for 1 hour.",
    unblockedAdmin: "✅ User %UID% has been unblocked.",

    knownHeader: "Message from",
    anonymousHeader: "Anonymous message",
    telegramId: "Telegram ID",
    noUsername: "no username",
    userFallbackName: "User",
  },
} as const;

function getUserLang(userId?: number): Lang {
  if (!userId) return "fa";
  return userLangs.get(userId) || "fa";
}

function t(userId: number | undefined, key: keyof (typeof TEXTS)["fa"]) {
  const lang = getUserLang(userId);
  return TEXTS[lang][key];
}

function buildMainKeyboard(lang: Lang) {
  return new Keyboard()
    .text(TEXTS[lang].knownMessageBtn)
    .row()
    .text(TEXTS[lang].anonymousMessageBtn)
    .row()
    .text(TEXTS[lang].pdfBtn)
    .row()
    .resized()
    .persistent(true)
    .placeholder(TEXTS[lang].placeholder);
}

function buildLanguageKeyboard() {
  return new Keyboard()
    .text("فارسی")
    .text("English")
    .resized()
    .oneTime()
    .placeholder(TEXTS.fa.languagePlaceholder);
}

function getMenuTexts(lang: Lang): Set<string> {
  return new Set<string>([
    TEXTS[lang].knownMessageBtn,
    TEXTS[lang].anonymousMessageBtn,
    TEXTS[lang].pdfBtn,
  ]);
}

/* ─────────────────────  BLOCKING  ───────────────────── */
const blockedUsers = new Map<number, number | null>();

function isBlocked(userId: number) {
  const until = blockedUsers.get(userId);
  if (until === undefined) return false;
  if (until === null) return true;

  if (Date.now() < until) return true;

  blockedUsers.delete(userId);
  return false;
}

function formatRemaining(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/* ─────────────────────  ROUTING BY CHAT  ───────────────────── */
const adminGroup = new Composer();
const privateChat = new Composer();

bot.use((ctx, next) => {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return next();

  if (chatId === TARGET_CHANNEL) {
    return adminGroup.middleware()(ctx, next);
  }

  if (ctx.chat?.type === "private") {
    return privateChat.middleware()(ctx, next);
  }

  return next();
});

/* ─────────────────────  ADMIN GROUP LOGIC  ───────────────────── */
adminGroup.on("message:text", async (ctx) => {
  const replied = ctx.message.reply_to_message;
  const txt = ctx.message.text?.trim();
  // Reply Telegram -> Bale
  if (replied && txt) {
    const replyText = replied.text || replied.caption || "";

    const baleMatch = replyText.match(/Bale Chat ID:\s*(\d+)/);

if (baleMatch) {
  const baleChatId = baleMatch[1];

  try {
    await sendToBale(baleChatId, txt);

    await ctx.reply("✅ پاسخ برای کاربر بله ارسال شد", {
      reply_to_message_id: ctx.message.message_id,
    });
  } catch (err) {
    console.error(err);

    await ctx.reply("❌ خطا در ارسال پاسخ برای کاربر بله", {
      reply_to_message_id: ctx.message.message_id,
    });
  }

  return;
}
  }
  if (txt === "/blockList") {
    if (blockedUsers.size === 0) {
      await ctx.reply(TEXTS.fa.blockListEmpty, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    const lines: string[] = [];
    for (const [uid, until] of blockedUsers.entries()) {
      const lang = getUserLang(uid);

      if (until === null) {
        lines.push(`• ${uid} — ${TEXTS[lang].permanent}`);
      } else {
        const remaining = until - Date.now();
        if (remaining > 0) {
          lines.push(
            `• ${uid} — ${TEXTS[lang].remaining} ${formatRemaining(remaining)}`,
          );
        } else {
          blockedUsers.delete(uid);
        }
      }
    }

    await ctx.reply(`${TEXTS.fa.blockListTitle}\n${lines.join("\n")}`, {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  if (txt === "/block" || txt === "/unblock" || txt === "/ban1h") {
    if (!replied) {
      await ctx.reply(TEXTS.fa.useReplyForCommand, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    let uid = messageMap.get(replied.message_id);

    if (!uid) {
      const replyText = replied.text || replied.caption;
      const match = replyText?.match(/Telegram ID:\s*(\d+)/);
      if (match) {
        uid = Number(match[1]);
      }
    }

    if (!uid) {
      await ctx.reply(TEXTS.fa.userNotFound, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    const lang = getUserLang(uid);

    if (txt === "/block") {
      blockedUsers.set(uid, null);
      userStates.delete(uid);
      try {
        await ctx.api.sendMessage(uid, TEXTS[lang].blockedPermanentUser);
      } catch {}
      await ctx.reply(
        TEXTS[lang].blockedPermanentAdmin.replace("%UID%", String(uid)),
        { reply_to_message_id: ctx.message.message_id },
      );
      return;
    }

    if (txt === "/ban1h") {
      blockedUsers.set(uid, Date.now() + 60 * 60 * 1000);
      userStates.delete(uid);
      try {
        await ctx.api.sendMessage(uid, TEXTS[lang].blocked1hUser);
      } catch {}
      await ctx.reply(
        TEXTS[lang].blocked1hAdmin.replace("%UID%", String(uid)),
        { reply_to_message_id: ctx.message.message_id },
      );
      return;
    }

    if (txt === "/unblock") {
      blockedUsers.delete(uid);
      try {
        await ctx.api.sendMessage(uid, TEXTS[lang].unblockedUser);
      } catch {}
      await ctx.reply(
        TEXTS[lang].unblockedAdmin.replace("%UID%", String(uid)),
        { reply_to_message_id: ctx.message.message_id },
      );
      return;
    }
  }

  if (!replied) return;

  const uid = messageMap.get(replied.message_id);
  if (!uid) return;

  const lang = getUserLang(uid);

  try {
    await ctx.api.sendMessage(
      uid,
      `${TEXTS[lang].adminReplyPrefix}${ctx.message.text}`,
    );
    await ctx.reply(TEXTS[lang].adminReplySent, {
      reply_to_message_id: ctx.message.message_id,
    });
  } catch {
    await ctx.reply(TEXTS[lang].adminReplyError, {
      reply_to_message_id: ctx.message.message_id,
    });
  }
});

adminGroup.on("message", () => {});

/* ─────────────────────  PRIVATE CHAT LOGIC  ───────────────────── */
privateChat.on("message:text", async (ctx) => {
  if (!ctx.from) return;

  const text = ctx.message.text.trim();

  if (isBlocked(ctx.from.id)) {
    await ctx.reply(t(ctx.from.id, "blockedAccess"));
    return;
  }

  // Handle /start HERE to avoid middleware-order problems
  if (text === "/start" || text.startsWith("/start ")) {
    userStates.delete(ctx.from.id);
    userLangs.delete(ctx.from.id);

    await ctx.reply(TEXTS.fa.chooseLanguage, {
      reply_markup: buildLanguageKeyboard(),
    });
    return;
  }

  const state = userStates.get(ctx.from.id);

  if (text === "فارسی") {
    userLangs.set(ctx.from.id, "fa");
    userStates.delete(ctx.from.id);

    await ctx.reply(TEXTS.fa.startMessage, {
      reply_markup: buildMainKeyboard("fa"),
    });
    return;
  }

  if (text === "English") {
    userLangs.set(ctx.from.id, "en");
    userStates.delete(ctx.from.id);

    await ctx.reply(TEXTS.en.startMessage, {
      reply_markup: buildMainKeyboard("en"),
    });
    return;
  }

  if (!userLangs.has(ctx.from.id)) {
    await ctx.reply(TEXTS.fa.chooseLanguage, {
      reply_markup: buildLanguageKeyboard(),
    });
    return;
  }

  const currentLang = getUserLang(ctx.from.id);
  const MENU_TEXTS = getMenuTexts(currentLang);

  if (MENU_TEXTS.has(text)) {
    if (text === TEXTS[currentLang].pdfBtn) {
      userStates.set(ctx.from.id, "awaiting_file");
      await ctx.reply(TEXTS[currentLang].askPdf, {
        reply_markup: buildMainKeyboard(currentLang),
      });
      return;
    }

    if (text === TEXTS[currentLang].knownMessageBtn) {
      userStates.set(ctx.from.id, "awaiting_text");
      await ctx.reply(TEXTS[currentLang].askKnown, {
        reply_markup: buildMainKeyboard(currentLang),
      });
      return;
    }

    if (text === TEXTS[currentLang].anonymousMessageBtn) {
      userStates.set(ctx.from.id, "awaiting_anonymous_text");
      await ctx.reply(TEXTS[currentLang].askAnonymous, {
        reply_markup: buildMainKeyboard(currentLang),
      });
      return;
    }
  }

  if (!state) {
    await ctx.reply(TEXTS[currentLang].chooseMenuFirst, {
      reply_markup: buildMainKeyboard(currentLang),
    });
    return;
  }

  if (state === "awaiting_text") {
    try {
      const displayName =
        ctx.from.first_name ?? TEXTS[currentLang].userFallbackName;
      const username = ctx.from.username
        ? `@${ctx.from.username}`
        : TEXTS[currentLang].noUsername;

      const sent = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `${TEXTS[currentLang].telegramId}: ${ctx.from.id}\n${TEXTS[currentLang].knownHeader} ${displayName} (${username}):\n${ctx.message.text}`,
      );

      messageMap.set(sent.message_id, ctx.from.id);

      await ctx.reply(TEXTS[currentLang].knownSent, {
        reply_markup: buildMainKeyboard(currentLang),
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(TEXTS[currentLang].sendError, {
        reply_markup: buildMainKeyboard(currentLang),
      });
    }
    return;
  }

  if (state === "awaiting_anonymous_text") {
    try {
      const anonCode = getAnonCode(ctx.from.id);

      const sent = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `${TEXTS[currentLang].telegramId}: ${ctx.from.id}\n${TEXTS[currentLang].anonymousHeader} (${anonCode}):\n${ctx.message.text}`,
      );

      messageMap.set(sent.message_id, ctx.from.id);

      await ctx.reply(TEXTS[currentLang].anonymousSent, {
        reply_markup: buildMainKeyboard(currentLang),
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(TEXTS[currentLang].anonymousSendError, {
        reply_markup: buildMainKeyboard(currentLang),
      });
    }
    return;
  }

  if (state === "awaiting_file") {
    await ctx.reply(TEXTS[currentLang].pdfOnly, {
      reply_markup: buildMainKeyboard(currentLang),
    });
    return;
  }
});

/* ─────────────────────  PRIVATE NON-TEXT / FILES / VOICE  ───────────────────── */
privateChat.on("message", async (ctx, next) => {
  if (!ctx.from) return;

  if ("text" in ctx.message && typeof ctx.message.text === "string") {
    return next();
  }

  if (isBlocked(ctx.from.id)) {
    await ctx.reply(t(ctx.from.id, "blockedAccess"));
    return;
  }

  const state = userStates.get(ctx.from.id);

  if (!userLangs.has(ctx.from.id)) {
    await ctx.reply(TEXTS.fa.chooseLanguage, {
      reply_markup: buildLanguageKeyboard(),
    });
    return;
  }

  const lang = getUserLang(ctx.from.id);

  if (!state && ctx.chat.type === "private") {
    await ctx.reply(TEXTS[lang].chooseMenuFirst, {
      reply_markup: buildMainKeyboard(lang),
    });
    return;
  }

  const voice = ctx.message.voice;

  if (voice && state === "awaiting_text") {
    try {
      const displayName = ctx.from.first_name ?? TEXTS[lang].userFallbackName;
      const username = ctx.from.username
        ? `@${ctx.from.username}`
        : TEXTS[lang].noUsername;

      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `${TEXTS[lang].telegramId}: ${ctx.from.id}\n${TEXTS[lang].knownHeader} ${displayName} (${username}):`,
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply(TEXTS[lang].knownSent, {
        reply_markup: buildMainKeyboard(lang),
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(TEXTS[lang].sendError, {
        reply_markup: buildMainKeyboard(lang),
      });
    }
    return;
  }

  if (voice && state === "awaiting_anonymous_text") {
    try {
      const anonCode = getAnonCode(ctx.from.id);

      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `${TEXTS[lang].telegramId}: ${ctx.from.id}\n${TEXTS[lang].anonymousHeader} (${anonCode}):`,
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply(TEXTS[lang].anonymousSent, {
        reply_markup: buildMainKeyboard(lang),
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(TEXTS[lang].anonymousSendError, {
        reply_markup: buildMainKeyboard(lang),
      });
    }
    return;
  }

  if (state === "awaiting_file") {
    const doc = ctx.message.document;

    if (doc?.mime_type === "application/pdf") {
      try {
        const sent = await ctx.api.forwardMessage(
          TARGET_CHANNEL,
          ctx.chat.id,
          ctx.message.message_id,
        );

        messageMap.set(sent.message_id, ctx.from.id);

        await ctx.reply(TEXTS[lang].pdfSent, {
          reply_markup: buildMainKeyboard(lang),
        });
        userStates.delete(ctx.from.id);
      } catch {
        await ctx.reply(TEXTS[lang].fileSendError, {
          reply_markup: buildMainKeyboard(lang),
        });
      }
      return;
    }

    await ctx.reply(TEXTS[lang].pdfOnlyRetry, {
      reply_markup: buildMainKeyboard(lang),
    });
    return;
  }

  return next();
});

/* ─────────────────────  WEBHOOK ENTRYPOINT  ───────────────────── */
export async function POST(req: NextRequest) {
  return webhookCallback(bot, "std/http")(req);
}


