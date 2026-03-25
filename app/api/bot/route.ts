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

/* ─────────────────────  TYPES & TEMP STATE  ───────────────────── */
type UserState = "awaiting_file" | "awaiting_text" | "awaiting_anonymous_text";
type Lang = "fa" | "en";

// توجه: این‌ها روی Vercel پایدار نیستند، ولی فعلاً برای بخش ادمین نگه می‌داریم
const messageMap = new Map<number, number>();
const anonCodes = new Map<number, string>();
const blockedUsers = new Map<number, number | null>();

/* ─────────────────────  HELPERS  ───────────────────── */
function getAnonCode(userId: number) {
  let code = anonCodes.get(userId);
  if (!code) {
    code = `ANON-${userId.toString(36).toUpperCase()}`;
    anonCodes.set(userId, code);
  }
  return code;
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
    block1hNotice: "❌ امکان ارسال پیام برای شما به مدت یک ساعت محدود گردیده است ❌",
    unblockNotice: "✅ محدودیت امکان ارسال پیام برای شما برطرف گردیده است ✅",
    forwardedKnownHeader: (displayName: string, username: string, userId: number) =>
      `[LANG:fa]\nTelegram ID: ${userId}\nپیام از ${displayName} (${username}):`,
    forwardedAnonymousHeader: (userId: number) =>
      `[LANG:fa]\nTelegram ID: ${userId}\nAnonymous Code: ${getAnonCode(userId)}\nپیام ناشناس:`,
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
    block1hNotice: "❌ Your ability to send messages has been restricted for 1 hour. ❌",
    unblockNotice: "✅ Your messaging restriction has been removed. ✅",
    forwardedKnownHeader: (displayName: string, username: string, userId: number) =>
      `[LANG:en]\nTelegram ID: ${userId}\nMessage from ${displayName} (${username}):`,
    forwardedAnonymousHeader: (userId: number) =>
      `[LANG:en]\nTelegram ID: ${userId}\nAnonymous Code: ${getAnonCode(userId)}\nAnonymous message:`,
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
    .resized()
    .persistent(true);
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
    .persistent(true)
    .placeholder(tt.placeholder);
}

function getLangFromMenuText(text: string): Lang | null {
  if (
    text === TEXTS.en.menuKnown ||
    text === TEXTS.en.menuAnonymous ||
    text === TEXTS.en.menuPdf ||
    text === TEXTS.en.langEn
  ) {
    return "en";
  }

  if (
    text === TEXTS.fa.menuKnown ||
    text === TEXTS.fa.menuAnonymous ||
    text === TEXTS.fa.menuPdf ||
    text === TEXTS.fa.langFa
  ) {
    return "fa";
  }

  return null;
}

/* ─────────────────────  REPLY MARKERS  ───────────────────── */
function makePromptText(lang: Lang, state: UserState) {
  const tt = t(lang);

  let visible = "";
  if (state === "awaiting_text") visible = tt.askKnown;
  if (state === "awaiting_anonymous_text") visible = tt.askAnonymous;
  if (state === "awaiting_file") visible = tt.askPdf;

  return `${visible}\n\n#CTX:${lang}:${state}`;
}

function parseReplyContext(text?: string | null): { lang: Lang; state: UserState } | null {
  if (!text) return null;

  const match = text.match(/#CTX:(fa|en):(awaiting_file|awaiting_text|awaiting_anonymous_text)/);
  if (!match) return null;

  const lang = match[1] as Lang;
  const state = match[2] as UserState;
  return { lang, state };
}

function parseLangFromAdminMessage(text?: string | null): Lang {
  if (text?.includes("[LANG:en]")) return "en";
  return "fa";
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

/* ─────────────────────  /start & /language  ───────────────────── */
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private" || !ctx.from) return;

  if (isBlocked(ctx.from.id)) {
    await ctx.reply(TEXTS.fa.blocked);
    return;
  }

  await ctx.reply(TEXTS.fa.chooseLanguage, {
    reply_markup: getLanguageKeyboard(),
  });
});

bot.command("language", async (ctx) => {
  if (ctx.chat?.type !== "private" || !ctx.from) return;

  if (isBlocked(ctx.from.id)) {
    await ctx.reply(TEXTS.fa.blocked);
    return;
  }

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

    const repliedText = replied.text || replied.caption;
    const lang = parseLangFromAdminMessage(repliedText);

    if (txt === "/block") {
      blockedUsers.set(uid, null);
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
      try {
        await ctx.api.sendMessage(uid, t(lang).block1hNotice);
      } catch {}
      await ctx.reply(`⏳ کاربر ${uid} به مدت ۱ ساعت مسدود شد.`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    if (txt === "/unblock") {
      blockedUsers.delete(uid);
      try {
        await ctx.api.sendMessage(uid, t(lang).unblockNotice);
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

  const lang = parseLangFromAdminMessage(replied.text || replied.caption);

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
privateChat.on("message:text", async (ctx) => {
  if (!ctx.from) return;

  if (isBlocked(ctx.from.id)) {
    await ctx.reply(TEXTS.fa.blocked);
    return;
  }

  const text = ctx.message.text.trim();

  // language selection
  if (text === "English" || text === "فارسی") {
    const lang: Lang = text === "English" ? "en" : "fa";

    await ctx.reply(`${t(lang).languageChanged}\n\n${t(lang).welcome}`, {
      reply_markup: getMainKeyboard(lang),
    });
    return;
  }

  // menu clicks
  const menuLang = getLangFromMenuText(text);
  if (menuLang) {
    const tt = t(menuLang);

    if (text === tt.menuKnown) {
      await ctx.reply(makePromptText(menuLang, "awaiting_text"), {
        reply_markup: { force_reply: true, input_field_placeholder: tt.askKnown },
      });
      return;
    }

    if (text === tt.menuAnonymous) {
      await ctx.reply(makePromptText(menuLang, "awaiting_anonymous_text"), {
        reply_markup: { force_reply: true, input_field_placeholder: tt.askAnonymous },
      });
      return;
    }

    if (text === tt.menuPdf) {
      await ctx.reply(makePromptText(menuLang, "awaiting_file"), {
        reply_markup: { force_reply: true, input_field_placeholder: tt.askPdf },
      });
      return;
    }
  }

  // reply-based state detection
  const replyText = ctx.message.reply_to_message?.text || ctx.message.reply_to_message?.caption;
  const replyCtx = parseReplyContext(replyText);

  if (!replyCtx) {
    const guessedLang = getLangFromMenuText(text) || "fa";
    await ctx.reply(t(guessedLang).chooseMenuFirst, {
      reply_markup: getMainKeyboard(guessedLang),
    });
    return;
  }

  const { lang, state } = replyCtx;
  const tt = t(lang);

  if (state === "awaiting_text") {
    try {
      const displayName = ctx.from.first_name ?? (lang === "fa" ? "کاربر" : "User");
      const username = ctx.from.username
        ? `@${ctx.from.username}`
        : lang === "fa"
          ? "بدون‌نام کاربری"
          : "no username";

      const sent = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `${tt.forwardedKnownHeader(displayName, username, ctx.from.id)}\n${ctx.message.text}`,
      );

      messageMap.set(sent.message_id, ctx.from.id);

      await ctx.reply(tt.sentKnown, {
        reply_markup: getMainKeyboard(lang),
      });
    } catch (error) {
      console.error("Known text error:", error);
      await ctx.reply(tt.sendError, {
        reply_markup: getMainKeyboard(lang),
      });
    }
    return;
  }

  if (state === "awaiting_anonymous_text") {
    try {
      const sent = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `${tt.forwardedAnonymousHeader(ctx.from.id)}\n${ctx.message.text}`,
      );

      messageMap.set(sent.message_id, ctx.from.id);

      await ctx.reply(tt.sentAnonymous, {
        reply_markup: getMainKeyboard(lang),
      });
    } catch (error) {
      console.error("Anonymous text error:", error);
      await ctx.reply(tt.sendAnonymousError, {
        reply_markup: getMainKeyboard(lang),
      });
    }
    return;
  }

  if (state === "awaiting_file") {
    await ctx.reply(tt.onlyPdf, {
      reply_markup: getMainKeyboard(lang),
    });
    return;
  }
});

/* ─────────────────────  PRIVATE CHAT: NON-TEXT  ───────────────────── */
privateChat.on("message", async (ctx, next) => {
  if (!ctx.from || !ctx.message) return next();

  // text messages فقط در message:text
  if ("text" in ctx.message && typeof ctx.message.text === "string") {
    return next();
  }

  if (isBlocked(ctx.from.id)) {
    await ctx.reply(TEXTS.fa.blocked);
    return;
  }

  const replyText =
    ("reply_to_message" in ctx.message && ctx.message.reply_to_message
      ? ctx.message.reply_to_message.text || ctx.message.reply_to_message.caption
      : undefined);

  const replyCtx = parseReplyContext(replyText);

  if (!replyCtx && ctx.chat?.type === "private") {
    await ctx.reply(TEXTS.fa.chooseMenuFirst, {
      reply_markup: getMainKeyboard("fa"),
    });
    return;
  }

  if (!replyCtx) return next();

  const { lang, state } = replyCtx;
  const tt = t(lang);

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
    } catch (error) {
      console.error("Known voice error:", error);
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
    } catch (error) {
      console.error("Anonymous voice error:", error);
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
      } catch (error) {
        console.error("PDF error:", error);
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