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

/* ─────────────────────  TYPES & STATE  ───────────────────── */
type UserState = "awaiting_file" | "awaiting_text" | "awaiting_anonymous_text";
type Lang = "fa" | "en";

const userStates = new Map<number, UserState>();
const userLanguages = new Map<number, Lang>();
const messageMap = new Map<number, number>();
const anonCodes = new Map<number, string>();

const blockedUsers = new Map<number, number | null>();

function getAnonCode(userId: number) {
  let code = anonCodes.get(userId);
  if (!code) {
    code = `ANON-${userId.toString(36).toUpperCase()}`;
    anonCodes.set(userId, code);
  }
  return code;
}

function getUserLang(userId: number): Lang {
  return userLanguages.get(userId) || "fa";
}

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

/* ─────────────────────  I18N  ───────────────────── */
const TEXTS = {
  fa: {
    chooseLanguage: "لطفاً زبان مورد نظر خود را انتخاب نمایید:",
    welcome: `با عرض سلام مجدد،

جهت برقراری ارتباط یکی از گزینه‌های موجود را انتخاب نمایید.

با تشکر`,
    blocked: "❌ دسترسی شما به این بات مسدود شده است.",
    chooseMenuFirst:
      "❌ این پیام شما ارسال نگردید، لطفاً یکی از گزینه‌های زیر را انتخاب نمایید ❌",
    askPdf: "لطفاً فایل PDF خود را ارسال کنید.",
    askKnown: "پیام شناس‌دار خود را وارد نمایید.",
    askAnonymous: "پیام ناشناس خود را وارد نمایید.",
    onlyPdf: "تنها فایل PDF مجاز است. لطفاً فایل خود را ارسال کنید.",
    onlyPdfRetry: "تنها فایل PDF مجاز است. لطفاً مجدداً امتحان کنید.",
    sentKnown: "✅ پیام شما ارسال گردید.",
    sentAnonymous: "✅ پیام ناشناس شما ارسال گردید.",
    sentFile: "✅ فایل شما ارسال شد. متشکرم!",
    sendError: "❌ خطا در ارسال پیام. دوباره تلاش کنید.",
    sendAnonymousError: "❌ خطا در ارسال پیام ناشناس. دوباره تلاش کنید.",
    fileError: "❌ خطا در ارسال فایل. دوباره تلاش کنید.",
    adminReplyPrefix: "پاسخ ادمین:",
    languageChanged: "✅ زبان فارسی انتخاب شد.",
    placeholder: "لطفاً یکی از گزینه‌های زیر را انتخاب نمایید.",
    menuKnown: "💬 ارسال پیام به‌صورت شناس‌دار",
    menuAnonymous: "🔒 ارسال پیام به‌صورت ناشناس",
    menuPdf: "📄 ارسال فایل PDF",
    langFa: "فارسی",
    langEn: "English",
    forwardedKnownHeader: (displayName: string, username: string, userId: number) =>
      `Telegram ID: ${userId}\nپیام از ${displayName} (${username}):`,
    forwardedAnonymousHeader: (userId: number) =>
      `Telegram ID: ${userId}\nAnonymous Code: ${getAnonCode(userId)}\nپیام ناشناس:`,
  },
  en: {
    chooseLanguage: "Please choose your preferred language:",
    welcome: `Welcome back,

Please choose one of the options below to contact us.

Thank you`,
    blocked: "❌ Your access to this bot has been blocked.",
    chooseMenuFirst:
      "❌ Your message was not sent. Please choose one of the options below first. ❌",
    askPdf: "Please send your PDF file.",
    askKnown: "Please enter your identified message.",
    askAnonymous: "Please enter your anonymous message.",
    onlyPdf: "Only PDF files are allowed. Please send your file.",
    onlyPdfRetry: "Only PDF files are allowed. Please try again.",
    sentKnown: "✅ Your message has been sent.",
    sentAnonymous: "✅ Your anonymous message has been sent.",
    sentFile: "✅ Your file has been sent. Thank you!",
    sendError: "❌ Error sending message. Please try again.",
    sendAnonymousError: "❌ Error sending anonymous message. Please try again.",
    fileError: "❌ Error sending file. Please try again.",
    adminReplyPrefix: "Admin reply:",
    languageChanged: "✅ English language selected.",
    placeholder: "Please choose one of the options below.",
    menuKnown: "💬 Send identified message",
    menuAnonymous: "🔒 Send anonymous message",
    menuPdf: "📄 Send PDF file",
    langFa: "فارسی",
    langEn: "English",
    forwardedKnownHeader: (displayName: string, username: string, userId: number) =>
      `Telegram ID: ${userId}\nMessage from ${displayName} (${username}):`,
    forwardedAnonymousHeader: (userId: number) =>
      `Telegram ID: ${userId}\nAnonymous Code: ${getAnonCode(userId)}\nAnonymous message:`,
  },
} as const;

function t(lang: Lang) {
  return TEXTS[lang];
}

/* ─────────────────────  UI  ───────────────────── */
function getLanguageKeyboard() {
  return new Keyboard()
    .text(TEXTS.fa.langFa)
    .text(TEXTS.fa.langEn)
    .row()
    .resized();
}

function getMainKeyboard(lang: Lang) {
  const tt = t(lang);
  return new Keyboard()
    .text(tt.menuKnown)
    .row()
    .text(tt.menuAnonymous)
    .row()
    .text(tt.menuPdf)
    .row()
    .resized()
    .placeholder(tt.placeholder);
}

function getMenuTexts(lang: Lang): Set<string> {
  const tt = t(lang);
  return new Set<string>([tt.menuKnown, tt.menuAnonymous, tt.menuPdf]);
}

function isLanguageSelection(text: string) {
  return text === TEXTS.fa.langFa || text === TEXTS.fa.langEn;
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

  return;
});

/* ─────────────────────  /start  ───────────────────── */
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (!ctx.from) return;

  if (isBlocked(ctx.from.id)) {
    const lang = getUserLang(ctx.from.id);
    await ctx.reply(t(lang).blocked);
    return;
  }

  userStates.delete(ctx.from.id);

  await ctx.reply(TEXTS.fa.chooseLanguage, {
    reply_markup: getLanguageKeyboard(),
  });
});

bot.command("language", async (ctx) => {
  if (ctx.chat?.type !== "private") return;
  if (!ctx.from) return;

  if (isBlocked(ctx.from.id)) {
    const lang = getUserLang(ctx.from.id);
    await ctx.reply(t(lang).blocked);
    return;
  }

  userStates.delete(ctx.from.id);

  await ctx.reply(TEXTS.fa.chooseLanguage, {
    reply_markup: getLanguageKeyboard(),
  });
});

/* ─────────────────────  ADMIN GROUP LOGIC  ───────────────────── */
adminGroup.on("message:text", async (ctx) => {
  const replied = ctx.message.reply_to_message;
  const txt = ctx.message.text?.trim();

  if (txt === "/blockList") {
    if (blockedUsers.size === 0) {
      await ctx.reply("لیست مسدودشده‌ها خالی است ✅", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    const lines: string[] = [];
    for (const [uid, until] of blockedUsers.entries()) {
      if (until === null) {
        lines.push(`• ${uid} — دائمی`);
      } else {
        const remaining = until - Date.now();
        if (remaining > 0) {
          lines.push(`• ${uid} — باقی‌مانده ${formatRemaining(remaining)}`);
        } else {
          blockedUsers.delete(uid);
        }
      }
    }

    await ctx.reply(`لیست مسدودشده‌ها:\n${lines.join("\n")}`, {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  if (txt === "/block" || txt === "/unblock" || txt === "/ban1h") {
    if (!replied) {
      await ctx.reply("❌ لطفاً این دستور را با Reply روی پیام کاربر ارسال کنید.", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    let uid = messageMap.get(replied.message_id);

    if (!uid) {
      const repliedText = replied.text || replied.caption;
      const match = repliedText?.match(/Telegram ID:\s*(\d+)/);
      if (match) uid = Number(match[1]);
    }

    if (!uid) {
      await ctx.reply("❌ کاربر پیدا نشد.", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    const lang = getUserLang(uid);

    if (txt === "/block") {
      blockedUsers.set(uid, null);
      userStates.delete(uid);
      try {
        await ctx.api.sendMessage(uid, t(lang).blocked);
      } catch {}
      await ctx.reply(`🚫 کاربر ${uid} مسدود شد (دائمی).`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    if (txt === "/ban1h") {
      blockedUsers.set(uid, Date.now() + 60 * 60 * 1000);
      userStates.delete(uid);
      try {
        await ctx.api.sendMessage(
          uid,
          lang === "fa"
            ? "❌ امکان ارسال پیام برای شما به مدت یک ساعت محدود گردیده است ❌"
            : "❌ Your ability to send messages has been restricted for 1 hour. ❌",
        );
      } catch {}
      await ctx.reply(`⏳ کاربر ${uid} به مدت ۱ ساعت مسدود شد.`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    if (txt === "/unblock") {
      blockedUsers.delete(uid);
      try {
        await ctx.api.sendMessage(
          uid,
          lang === "fa"
            ? "✅ محدودیت امکان ارسال پیام برای شما برطرف گردیده است ✅"
            : "✅ Your messaging restriction has been removed. ✅",
        );
      } catch {}
      await ctx.reply(`✅ کاربر ${uid} از حالت مسدود خارج شد.`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }
  }

  if (!replied) return;

  const uid = messageMap.get(replied.message_id);
  if (!uid) return;

  const lang = getUserLang(uid);

  try {
    await ctx.api.sendMessage(uid, `${t(lang).adminReplyPrefix}\n${ctx.message.text}`);
    await ctx.reply("پاسخ برای کاربر ارسال شد ✅", {
      reply_to_message_id: ctx.message.message_id,
    });
  } catch {
    await ctx.reply("❌ خطا در ارسال پاسخ به کاربر.");
  }
});

adminGroup.on("message", () => {});

/* ─────────────────────  PRIVATE CHAT: TEXT  ───────────────────── */
/* ─────────────────────  PRIVATE CHAT: NON-TEXT  ───────────────────── */
privateChat.on("message", async (ctx, next) => {
  if (!ctx.from || !ctx.message) return next();

  // let text messages be handled only by message:text
  if ("text" in ctx.message && typeof ctx.message.text === "string") {
    return next();
  }

  if (isBlocked(ctx.from.id)) {
    const lang = getUserLang(ctx.from.id);
    await ctx.reply(t(lang).blocked);
    return;
  }

  const lang = getUserLang(ctx.from.id);
  const tt = t(lang);
  const state = userStates.get(ctx.from.id);

  if (!state && ctx.chat?.type === "private") {
    await ctx.reply(tt.chooseMenuFirst, {
      reply_markup: getMainKeyboard(lang),
    });
    return;
  }

  const voice = "voice" in ctx.message ? ctx.message.voice : undefined;

  if (voice && state === "awaiting_text") {
    try {
      const displayName = ctx.from.first_name ?? (lang === "fa" ? "کاربر" : "User");
      const username = ctx.from.username
        ? `@${ctx.from.username}`
        : lang === "fa"
          ? "بدون‌نام کاربری"
          : "no username";

      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        tt.forwardedKnownHeader(displayName, username, ctx.from.id),
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat!.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply(tt.sentKnown, {
        reply_markup: getMainKeyboard(lang),
      });

      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(tt.sendError, {
        reply_markup: getMainKeyboard(lang),
      });
    }
    return;
  }

  if (voice && state === "awaiting_anonymous_text") {
    try {
      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        tt.forwardedAnonymousHeader(ctx.from.id),
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat!.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply(tt.sentAnonymous, {
        reply_markup: getMainKeyboard(lang),
      });

      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(tt.sendAnonymousError, {
        reply_markup: getMainKeyboard(lang),
      });
    }
    return;
  }

  if (state === "awaiting_file") {
    const doc = "document" in ctx.message ? ctx.message.document : undefined;

    if (doc?.mime_type === "application/pdf") {
      try {
        const sent = await ctx.api.forwardMessage(
          TARGET_CHANNEL,
          ctx.chat!.id,
          ctx.message.message_id,
        );

        messageMap.set(sent.message_id, ctx.from.id);

        await ctx.reply(tt.sentFile, {
          reply_markup: getMainKeyboard(lang),
        });

        userStates.delete(ctx.from.id);
      } catch {
        await ctx.reply(tt.fileError, {
          reply_markup: getMainKeyboard(lang),
        });
      }
      return;
    }

    await ctx.reply(tt.onlyPdfRetry, {
      reply_markup: getMainKeyboard(lang),
    });
    return;
  }

  return next();
});
/* ─────────────────────  PRIVATE CHAT: NON-TEXT  ───────────────────── */
privateChat.on("message", async (ctx, next) => {
  if (!ctx.from) return next();

  // let text messages be handled only by message:text
  if ("text" in ctx.message && typeof ctx.message.text === "string") {
    return next();
  }

  if (isBlocked(ctx.from.id)) {
    const lang = getUserLang(ctx.from.id);
    await ctx.reply(t(lang).blocked);
    return;
  }

  const lang = getUserLang(ctx.from.id);
  const tt = t(lang);
  const state = userStates.get(ctx.from.id);

  if (!state && ctx.chat?.type === "private") {
    await ctx.reply(tt.chooseMenuFirst, {
      reply_markup: getMainKeyboard(lang),
    });
    return;
  }

  const voice = "voice" in ctx.message ? ctx.message.voice : undefined;

  if (voice && state === "awaiting_text") {
    try {
      const displayName = ctx.from.first_name ?? (lang === "fa" ? "کاربر" : "User");
      const username = ctx.from.username
        ? `@${ctx.from.username}`
        : lang === "fa"
          ? "بدون‌نام کاربری"
          : "no username";

      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        tt.forwardedKnownHeader(displayName, username, ctx.from.id),
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat!.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply(tt.sentKnown, {
        reply_markup: getMainKeyboard(lang),
      });

      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(tt.sendError, {
        reply_markup: getMainKeyboard(lang),
      });
    }
    return;
  }

  if (voice && state === "awaiting_anonymous_text") {
    try {
      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        tt.forwardedAnonymousHeader(ctx.from.id),
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat!.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply(tt.sentAnonymous, {
        reply_markup: getMainKeyboard(lang),
      });

      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply(tt.sendAnonymousError, {
        reply_markup: getMainKeyboard(lang),
      });
    }
    return;
  }

  if (state === "awaiting_file") {
    const doc = "document" in ctx.message ? ctx.message.document : undefined;

    if (doc?.mime_type === "application/pdf") {
      try {
        const sent = await ctx.api.forwardMessage(
          TARGET_CHANNEL,
          ctx.chat!.id,
          ctx.message.message_id,
        );

        messageMap.set(sent.message_id, ctx.from.id);

        await ctx.reply(tt.sentFile, {
          reply_markup: getMainKeyboard(lang),
        });

        userStates.delete(ctx.from.id);
      } catch {
        await ctx.reply(tt.fileError, {
          reply_markup: getMainKeyboard(lang),
        });
      }
      return;
    }

    await ctx.reply(tt.onlyPdfRetry, {
      reply_markup: getMainKeyboard(lang),
    });
    return;
  }

  return next();
});

/* ─────────────────────  WEBHOOK ENTRYPOINT  ───────────────────── */
export async function POST(req: NextRequest) {
  return webhookCallback(bot, "std/http")(req);
}