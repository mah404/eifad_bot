// Next.js / Vercel-friendly webhook handler using grammy

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

import { Bot, webhookCallback, Keyboard, Composer } from "grammy";
import { type NextRequest } from "next/server";

/* ─────────────────────  ENV & BOT  ───────────────────── */
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token)
  throw new Error("TELEGRAM_BOT_TOKEN environment variable not found.");

const bot = new Bot(token);

// ⚠️ Admin group/supergroup chat id (string form, keep the minus):
const TARGET_CHANNEL = process.env.SUPPORT_GROUP_ID;
if (!TARGET_CHANNEL)
  throw new Error("TARGET_CHANNEL environment variable not found.");

/* ─────────────────────  STATE  ───────────────────── */
type UserState = "awaiting_file" | "awaiting_text" | "awaiting_anonymous_text";

const userStates = new Map<number, UserState>(); // per-user flow state (only for private chats)
const messageMap = new Map<number, number>(); // groupMessageId -> userId (for admin replies)

const anonCodes = new Map<number, string>(); // userId -> anonymous code (stable)

function getAnonCode(userId: number) {
  let code = anonCodes.get(userId);
  if (!code) {
    code = `ANON-${userId.toString(36).toUpperCase()}`;
    anonCodes.set(userId, code);
  }
  return code;
}

/* ─────────────────────  BLOCKING  ───────────────────── */
// blockedUsers: userId -> untilEpochMs (null = permanent)
const blockedUsers = new Map<number, number | null>();

function isBlocked(userId: number) {
  const until = blockedUsers.get(userId);
  if (until === undefined) return false;
  if (until === null) return true;

  if (Date.now() < until) return true;

  // expired
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

/* ─────────────────────  UI  ───────────────────── */
const mainKeyboard = new Keyboard()
  .text("💬 ارسال پیام به صورت شناس")
  .row()
  .text("🔒 ارسال پیام به صورت ناشناس")
  .row()
  .text("📄 ارسال فایل PDF")
  .row()
  .resized()
  .persistent(true)
  .placeholder(" لطفاً یکی از گزینه های زیر را انتخاب نمایید.");

const MENU_TEXTS = new Set([
  "💬 ارسال پیام به صورت شناس",
  "🔒 ارسال پیام به صورت ناشناس",
  "📄 ارسال فایل PDF",
]);

/* ─────────────────────  ROUTING BY CHAT  ───────────────────── */
const adminGroup = new Composer(); // messages from the admin group/supergroup
const privateChat = new Composer(); // messages from private (user) chats

bot.use((ctx, next) => {
  const chatId = ctx.chat?.id?.toString();
  if (!chatId) return next();

  if (chatId === TARGET_CHANNEL) {
    // Admin group
    return adminGroup.middleware()(ctx, next);
  }

  if (ctx.chat?.type === "private") {
    // Private DMs with users
    return privateChat.middleware()(ctx, next);
  }

  // Any other chat types (other groups, channels) → ignore
  return;
});

/* ─────────────────────  /start (private only)  ───────────────────── */
bot.command("start", async (ctx) => {
  if (ctx.chat?.type !== "private") return; // ignore /start outside private chats

  // blocked users should not use the bot
  if (ctx.from?.id && isBlocked(ctx.from.id)) {
    await ctx.reply("❌ دسترسی شما به این بات مسدود شده است.");
    return;
  }

  await ctx.reply(
    `با عرض سلام مجدد،

جهت برقراری ارتباط یکی از گزینه‌های موجود را انتخاب نمایید. 

با تشکر`,
    { reply_markup: mainKeyboard },
  );
});

/* ─────────────────────  ADMIN GROUP LOGIC  ─────────────────────
   - Only handle replies to messages that the bot posted (forwarded/sent).
   - Ignore all non-reply chatter in the group.
------------------------------------------------------------------ */
adminGroup.on("message:text", async (ctx) => {
  const replied = ctx.message.reply_to_message;

  // ---------- Admin commands ----------
  const txt = ctx.message.text?.trim();

  // /blockList can be used without reply
  if (txt === "/blockList") {
    if (blockedUsers.size === 0) {
      await ctx.reply("لیست مسدود شده‌ها خالی است ✅", {
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
          // expired, cleanup
          blockedUsers.delete(uid);
        }
      }
    }

    await ctx.reply(`لیست مسدود شده‌ها:\n${lines.join("\n")}`, {
      reply_to_message_id: ctx.message.message_id,
    });
    return;
  }

  // Commands that must be used by replying to a tracked bot message
  if (txt === "/block" || txt === "/unblock" || txt === "/ban1h") {
    if (!replied) {
      await ctx.reply(
        "❌ لطفاً این دستور را با Reply روی پیام کاربر ارسال کنید.",
        {
          reply_to_message_id: ctx.message.message_id,
        },
      );
      return;
    }

    let uid = messageMap.get(replied.message_id);

    // fallback: extract Telegram ID from message text
    if (!uid) {
      const txt = replied.text || replied.caption;
      const match = txt?.match(/Telegram ID:\s*(\d+)/);

      if (match) {
        uid = Number(match[1]);
      }
    }

    if (!uid) {
      await ctx.reply("❌ کاربر پیدا نشد.", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    if (txt === "/block") {
      blockedUsers.set(uid, null);
      userStates.delete(uid);
      try {
        await ctx.api.sendMessage(
          uid,
          "❌امکان ارسال پیام برای شما محدود گردیده است❌",
        );
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
          "❌امکان ارسال پیام برای شما به مدت یک ساعت محدود گردیده است❌",
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
          "✅محدودیت امکان ارسال پیام برای شما برطرف گردیده است✅",
        );
      } catch {}
      await ctx.reply(`✅ کاربر ${uid} از حالت مسدود خارج شد.`, {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }
  }

  // ---------- Normal admin reply-to-user flow ----------
  if (!replied) return; // ignore normal chatter

  const uid = messageMap.get(replied.message_id);
  if (!uid) return; // not a tracked bot message

  try {
    await ctx.api.sendMessage(uid, `پاسخ ادمین:\n${ctx.message.text}`);
    await ctx.reply("پاسخ برای کاربر ارسال شد ✅", {
      reply_to_message_id: ctx.message.message_id,
    });
  } catch {
    await ctx.reply("❌ خطا در ارسال پاسخ به کاربر.");
  }
});

// Ignore any other message types in admin group (stickers, photos, etc.)
adminGroup.on("message", () => {});

/* ─────────────────────  PRIVATE CHAT LOGIC  ───────────────────── */
// Menu navigation & states
privateChat.on("message:text", async (ctx) => {
  // blocked users should not use the bot
  if (ctx.from?.id && isBlocked(ctx.from.id)) {
    await ctx.reply("❌ دسترسی شما به این بات مسدود شده است.");
    return;
  }

  const text = ctx.message.text;
  const state = userStates.get(ctx.from.id);

  /* ────── Menu entries (the only way to set a state) ────── */
  if (MENU_TEXTS.has(text)) {
    if (text === "📄 ارسال فایل PDF") {
      userStates.set(ctx.from.id, "awaiting_file");
      return ctx.reply("لطفاً فایل PDF خود را ارسال کنید.", {
        reply_markup: mainKeyboard,
      });
    }
    if (text === "💬 ارسال پیام به صورت شناس") {
      userStates.set(ctx.from.id, "awaiting_text");
      return ctx.reply("پیام شناس خود را وارد نمایید.", {
        reply_markup: mainKeyboard,
      });
    }
    if (text === "🔒 ارسال پیام به صورت ناشناس") {
      userStates.set(ctx.from.id, "awaiting_anonymous_text");
      return ctx.reply("پیام ناشناس خود را وارد نمایید.", {
        reply_markup: mainKeyboard,
      });
    }

    // previous option kept, but disabled (not part of UI anymore)
    if (false && text === "ℹ️ درباره ما") {
      return ctx.reply(
        "این پیام‌رسان جهت ارتباط مستقیم با مدیران مجموعه تهیه گردیده است. پیشاپیش از حسن استفاده شما قدردانی می‌نماییم.",
        { reply_markup: mainKeyboard },
      );
    }
  }

  /* ────── If no state was chosen yet, nudge user to pick a menu item ────── */
  if (!state) {
    return ctx.reply(
      "❌ این پیام شما ارسال نگردید، لطفاً یکی از گزینه های زیر را انتخاب نمایید❌",
      {
        reply_markup: mainKeyboard,
      },
    );
  }

  /* ────── State-based processing ────── */

  // 1) Expecting a normal text message (with identity)
  if (state === "awaiting_text") {
    try {
      const displayName = ctx.from.first_name ?? "کاربر";
      const username = ctx.from.username
        ? `@${ctx.from.username}`
        : "بدون‌نام کاربری";
      const sent = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `Telegram ID: ${ctx.from.id}\nپیام از ${displayName} (${username}):\n${ctx.message.text}`,
      );
      messageMap.set(sent.message_id, ctx.from.id);
      await ctx.reply("پیام شما ارسال گردید.✅", {
        reply_markup: mainKeyboard,
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply("❌ خطا در ارسال پیام. دوباره تلاش کنید.", {
        reply_markup: mainKeyboard,
      });
    }
    return;
  }

  // 2) Expecting an anonymous text message
  if (state === "awaiting_anonymous_text") {
    try {
      const sent = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `Telegram ID: ${ctx.from.id}
پیام ناشناس:
${ctx.message.text}`,
      );
      messageMap.set(sent.message_id, ctx.from.id);
      await ctx.reply("پیام ناشناس شما ارسال گردید.✅", {
        reply_markup: mainKeyboard,
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply("❌ خطا در ارسال پیام ناشناس. دوباره تلاش کنید.", {
        reply_markup: mainKeyboard,
      });
    }
    return;
  }

  // 3) If state is awaiting_file but user typed text, remind them
  if (state === "awaiting_file") {
    return ctx.reply("تنها فایل PDF مجاز است. لطفاً فایل خود را ارسال کنید.", {
      reply_markup: mainKeyboard,
    });
  }
});

// Receiving files/photos/etc. in private chat
privateChat.on("message", async (ctx, next) => {
  // blocked users should not use the bot
  if (ctx.from?.id && isBlocked(ctx.from.id)) {
    await ctx.reply("❌ دسترسی شما به این بات مسدود شده است.");
    return;
  }

  const state = userStates.get(ctx.from.id);

  // If no state set yet, only nudge once for any non-menu input
  if (!state && ctx.chat.type === "private") {
    await ctx.reply(
      "❌ این پیام شما ارسال نگردید، لطفاً یکی از گزینه های زیر را انتخاب نمایید❌",
      {
        reply_markup: mainKeyboard,
      },
    );
    return;
  }

  // Handle VOICE messages for known/anonymous flows
  const voice = ctx.message?.voice;

  if (voice && state === "awaiting_text") {
    try {
      const displayName = ctx.from.first_name ?? "کاربر";
      const username = ctx.from.username
        ? `@${ctx.from.username}`
        : "بدون‌نام کاربری";

      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `Telegram ID: ${ctx.from.id}\nپیام از ${displayName} (${username}):`,
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply("پیام شما ارسال گردید.✅", {
        reply_markup: mainKeyboard,
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply("❌ خطا در ارسال پیام. دوباره تلاش کنید.", {
        reply_markup: mainKeyboard,
      });
    }
    return;
  }

  if (voice && state === "awaiting_anonymous_text") {
    try {
      const header = await ctx.api.sendMessage(
        TARGET_CHANNEL,
        `Telegram ID: ${ctx.from.id}\nپیام ناشناس:`,
      );

      const copied = await ctx.api.copyMessage(
        TARGET_CHANNEL,
        ctx.chat.id,
        ctx.message.message_id,
        { reply_to_message_id: header.message_id },
      );

      messageMap.set(header.message_id, ctx.from.id);
      messageMap.set(copied.message_id, ctx.from.id);

      await ctx.reply("پیام ناشناس شما ارسال گردید.✅", {
        reply_markup: mainKeyboard,
      });
      userStates.delete(ctx.from.id);
    } catch {
      await ctx.reply("❌ خطا در ارسال پیام ناشناس. دوباره تلاش کنید.", {
        reply_markup: mainKeyboard,
      });
    }
    return;
  }

  // Handle the PDF upload state
  if (state === "awaiting_file") {
    const doc = ctx.message?.document;
    if (doc?.mime_type === "application/pdf") {
      try {
        const sent = await ctx.api.forwardMessage(
          TARGET_CHANNEL,
          ctx.chat.id,
          ctx.message.message_id,
        );
        messageMap.set(sent.message_id, ctx.from.id);
        await ctx.reply("فایل شما ارسال شد. متشکرم!", {
          reply_markup: mainKeyboard,
        });
        userStates.delete(ctx.from.id);
      } catch {
        await ctx.reply("❌ خطا در ارسال فایل. دوباره تلاش کنید.", {
          reply_markup: mainKeyboard,
        });
      }
      return;
    }

    await ctx.reply("تنها فایل PDF مجاز است. لطفاً مجدداً امتحان کنید.", {
      reply_markup: mainKeyboard,
    });
    return;
  }

  return next();
});

/* ─────────────────────  WEBHOOK ENTRYPOINT  ───────────────────── */
export async function POST(req: NextRequest) {
  return webhookCallback(bot, "std/http")(req);
}
