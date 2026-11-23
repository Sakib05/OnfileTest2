/**
 * Telegram Bot API access for advertising (official API only). Server-side; the bot token never leaves the server
 * and is never logged. `fetchImpl` is injectable for tests.
 *
 * Membership truth table (getChatMember):
 *   creator | administrator | member                → member
 *   restricted && is_member === true                → member (restricted but still in the chat)
 *   restricted && is_member === false | left | kicked → not a member
 * For a channel, Telegram only answers getChatMember about ARBITRARY users when the bot is an administrator of that
 * channel. Without that we say "unavailable" — we never guess and never claim a join was verified.
 */
const API = "https://api.telegram.org";
const TIMEOUT_MS = 8000;

export interface TgChatMember {
  status: string;
  is_member?: boolean;
  can_invite_users?: boolean;
}

export interface TgChat {
  id: number | string;
  type: string;
  title?: string;
  username?: string;
}

type Fetch = typeof fetch;
type CallResult<T> = { ok: true; result: T } | { ok: false; description: string; errorCode?: number };

async function call<T>(method: string, params: Record<string, unknown>, fetchImpl: Fetch = fetch): Promise<CallResult<T>> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, description: "missing_bot_token" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null;
    if (!data || !data.ok || data.result === undefined) {
      // Telegram's description never contains the token; the request URL is deliberately not logged.
      console.error("ads_telegram_api_error", { method, errorCode: data?.error_code });
      return { ok: false, description: data?.description ?? "bad_response", errorCode: data?.error_code };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    console.error("ads_telegram_network_error", { method, timedOut: err instanceof Error && err.name === "AbortError" });
    return { ok: false, description: "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

export function isActiveMember(member: TgChatMember | null | undefined): boolean {
  if (!member) return false;
  if (member.status === "creator" || member.status === "administrator" || member.status === "member") return true;
  if (member.status === "restricted") return member.is_member === true;
  return false;
}

export type MembershipResult = "member" | "not_member" | "unavailable";

/** Is `telegramUserId` currently a member of `chatId`? Unknown/forbidden answers are "unavailable", never "not_member". */
export async function getMembership(chatId: string, telegramUserId: number, fetchImpl?: Fetch): Promise<MembershipResult> {
  const res = await call<TgChatMember>("getChatMember", { chat_id: chatId, user_id: telegramUserId }, fetchImpl);
  if (res.ok) return isActiveMember(res.result) ? "member" : "not_member";
  // "user not found" is Telegram's way of saying this user was never a participant.
  if (res.errorCode === 400 && /participant_id_invalid|user not found/i.test(res.description)) return "not_member";
  return "unavailable";
}

let cachedBotId: number | null = null;
async function botId(fetchImpl?: Fetch): Promise<number | null> {
  if (cachedBotId) return cachedBotId;
  const me = await call<{ id: number }>("getMe", {}, fetchImpl);
  if (!me.ok) return null;
  cachedBotId = me.result.id;
  return cachedBotId;
}

/** Can Onfile's bot read membership in this channel? True only when it is an administrator there. */
export async function botCanVerifyMembership(chatId: string, fetchImpl?: Fetch): Promise<"yes" | "no" | "unavailable"> {
  const id = await botId(fetchImpl);
  if (!id) return "unavailable";
  const res = await call<TgChatMember>("getChatMember", { chat_id: chatId, user_id: id }, fetchImpl);
  if (!res.ok) return res.errorCode === 400 || res.errorCode === 403 ? "no" : "unavailable";
  return res.result.status === "administrator" || res.result.status === "creator" ? "yes" : "no";
}

export type ChatLookup = { ok: true; chat: TgChat } | { ok: false; reason: "not_found" | "unavailable" };

export async function lookupChat(identifier: string, fetchImpl?: Fetch): Promise<ChatLookup> {
  const res = await call<TgChat>("getChat", { chat_id: identifier }, fetchImpl);
  if (res.ok) return { ok: true, chat: res.result };
  if (res.errorCode === 400 && /chat not found/i.test(res.description)) return { ok: false, reason: "not_found" };
  return { ok: false, reason: "unavailable" };
}
