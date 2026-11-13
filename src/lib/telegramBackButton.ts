"use client";
import { getTelegramWebApp } from "@/lib/telegramWebApp";

/**
 * Single owner of Telegram's NATIVE header Back Button (`WebApp.BackButton`,
 * Bot API 6.1+; also what the Android system back gesture triggers inside a
 * Mini App).
 *
 * Why a manager instead of every screen calling `BackButton.onClick` itself:
 *   - exactly ONE click listener is ever bound to Telegram's button, no matter
 *     how many screens are mounted — no duplicate handlers firing together;
 *   - screens form a stack: only the TOPMOST registered screen handles a tap,
 *     and when it unmounts the screen below it takes over again;
 *   - the button is shown while at least one nested screen is registered and
 *     hidden when none is (root screens), instead of the first unmount hiding
 *     it for everyone;
 *   - the listener is removed (and the button hidden) when the stack empties.
 *
 * It only manages Telegram's BackButton. It never touches the Close Button,
 * and it knows nothing about a screen's internal step controls (e.g. the
 * Manual Connect guide's bottom Back / Next) — those stay local to the screen.
 */

type BackButton = NonNullable<NonNullable<ReturnType<typeof getTelegramWebApp>>["BackButton"]>;

interface Entry {
  handler: { current: () => void };
}

const stack: Entry[] = [];
let bound: { button: BackButton } | null = null;

function dispatch() {
  const top = stack[stack.length - 1];
  top?.handler.current();
}

function unbind() {
  if (!bound) return;
  try {
    bound.button.offClick(dispatch);
    bound.button.hide();
  } catch {
    /* ignore */
  }
  bound = null;
}

function sync() {
  if (stack.length === 0) {
    unbind();
    return;
  }
  const button = getTelegramWebApp()?.BackButton;
  if (!button) {
    unbind();
    return;
  }
  if (bound && bound.button !== button) unbind();
  try {
    if (!bound) {
      button.onClick(dispatch);
      bound = { button };
    }
    button.show();
  } catch {
    bound = null; // older client without BackButton support
  }
}

/**
 * Registers a screen as the current "back" target. `handler` is a ref so the
 * latest callback is always used without re-registering. Returns an
 * unregister function (call it on unmount / when the screen is no longer
 * a nested page).
 */
export function registerNativeBack(handler: { current: () => void }): () => void {
  const entry: Entry = { handler };
  stack.push(entry);
  sync();
  return () => {
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    sync();
  };
}

/** Test/diagnostic helper: how many screens are currently registered. */
export function nativeBackDepth(): number {
  return stack.length;
}
