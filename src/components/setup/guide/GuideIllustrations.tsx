import React from "react";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Link2,
  Pencil,
  Search,
  Share2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Carefully recreated Telegram / Onfile screens for the Manual Connect Guide.
 *
 * These are lightweight, theme-aware React illustrations (no bitmap assets),
 * so they stay sharp on every phone, cost no extra bandwidth, follow the
 * light/dark theme, and can show the REAL Onfile bot username. Only controls
 * that actually exist in Telegram are drawn, with the exact element the user
 * must tap highlighted.
 */

export interface GuideIllustrationProps {
  step: number; // 0-based
  /** Real bot username from /api/telegram/bot-info (without "@"), if known. */
  botUsername: string | null;
  /** The link currently typed in Manual Connect (used by step 8's mock). */
  link: string;
  /** The real, working link <input> rendered inside step 7's mock screen. */
  linkInput: React.ReactNode;
}

/** Example private invite link — matches a format accepted by src/lib/inviteLink.ts. */
export const EXAMPLE_INVITE_LINK = "https://t.me/+AbCdEfGhIjKlMnOp";

const ALT_TEXT: string[] = [
  "Telegram channel screen with the channel name in the header highlighted",
  "Telegram channel info screen with the Edit button highlighted",
  "Telegram Manage Channel screen with Administrators highlighted",
  "Telegram Administrators screen with Add Administrator highlighted, followed by a search for the Onfile bot",
  "Telegram admin rights screen with the Post Messages permission switched on and highlighted",
  "Telegram Invite Links screen with Copy Link highlighted",
  "Onfile Manual Connect screen with the private channel link field highlighted",
  "Onfile Manual Connect screen with the Next button highlighted",
];

/** Pulsing outline + optional tag marking the exact element to interact with. */
function Highlight({
  children,
  label,
  className,
  rounded = "rounded-lg",
}: {
  children: React.ReactNode;
  label?: string;
  className?: string;
  rounded?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      {children}
      <span
        aria-hidden="true"
        className={cn("pointer-events-none absolute -inset-[3px] border-2 border-[#FF6115] animate-pulse-brand", rounded)}
      />
      {label && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-2.5 right-1 z-10 rounded-full bg-[#FF6115] px-1.5 py-px text-[9px] font-bold leading-tight text-white shadow"
        >
          {label}
        </span>
      )}
    </div>
  );
}

function PhoneFrame({ children, appTheme = false }: { children: React.ReactNode; appTheme?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[280px] overflow-hidden rounded-[22px] border-[3px] border-app shadow-app-md",
        appTheme ? "bg-app" : "tg-mock bg-[var(--tg-bg)]"
      )}
    >
      <div className="mx-auto my-1.5 h-1 w-10 rounded-full" style={{ background: "var(--color-border)" }} />
      {children}
    </div>
  );
}

/* ───────────────────────── Telegram building blocks ───────────────────────── */

function TgHeader({
  title,
  subtitle,
  right,
  left,
}: {
  title: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
  left?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--tg-divider)] bg-[var(--tg-bg)] px-3 py-2">
      <ArrowLeft size={14} className="flex-shrink-0 text-[var(--tg-accent)]" />
      {left}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-semibold leading-tight text-[var(--tg-text)]">{title}</p>
        {subtitle && <p className="truncate text-[10px] leading-tight text-[var(--tg-sub)]">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

function ChannelAvatar({ size = 26 }: { size?: number }) {
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full bg-[var(--tg-accent)] font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      Y
    </div>
  );
}

function TgRow({
  icon,
  label,
  value,
  chevron = true,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  chevron?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 bg-[var(--tg-bg)] px-3 py-2">
      {icon && <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--tg-accent)]">{icon}</span>}
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--tg-text)]">{label}</span>
      {value && <span className="text-[10.5px] text-[var(--tg-sub)]">{value}</span>}
      {chevron && <ChevronRight size={12} className="flex-shrink-0 text-[var(--tg-sub)]" />}
    </div>
  );
}

function Divider() {
  return <div className="mx-3 h-px bg-[var(--tg-divider)]" />;
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className="relative inline-block h-[15px] w-[26px] flex-shrink-0 rounded-full"
      style={{ background: on ? "var(--tg-accent)" : "var(--tg-toggle-off)" }}
    >
      <span
        className="absolute top-[2px] h-[11px] w-[11px] rounded-full bg-white shadow-sm transition-all"
        style={{ left: on ? 13 : 2 }}
      />
    </span>
  );
}

/* ─────────────────────────────── The 8 screens ─────────────────────────────── */

/** Step 1 — channel conversation screen, channel name/header highlighted. */
function Step1() {
  return (
    <PhoneFrame>
      <div className="px-2 pb-1 pt-1">
        <Highlight label="Tap the channel name" rounded="rounded-xl" className="mt-2">
          <div className="flex items-center gap-2 rounded-xl bg-[var(--tg-bg)] px-2 py-1.5">
            <ArrowLeft size={14} className="flex-shrink-0 text-[var(--tg-accent)]" />
            <ChannelAvatar />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold leading-tight text-[var(--tg-text)]">Your Private Channel</p>
              <p className="truncate text-[10px] leading-tight text-[var(--tg-sub)]">128 subscribers</p>
            </div>
            <Search size={13} className="flex-shrink-0 text-[var(--tg-sub)]" />
            <EllipsisVertical size={13} className="flex-shrink-0 text-[var(--tg-sub)]" />
          </div>
        </Highlight>
      </div>
      <div className="flex min-h-[120px] flex-col gap-2 bg-[var(--tg-section)] px-3 py-3">
        {[70, 52].map((w) => (
          <div key={w} className="rounded-xl rounded-tl-sm bg-[var(--tg-bg)] px-2.5 py-2" style={{ width: `${w}%` }}>
            <div className="h-1.5 w-full rounded-full bg-[var(--tg-divider)]" />
            <div className="mt-1.5 h-1.5 w-2/3 rounded-full bg-[var(--tg-divider)]" />
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--tg-divider)] bg-[var(--tg-bg)] px-3 py-2 text-[11px] text-[var(--tg-sub)]">Broadcast…</div>
    </PhoneFrame>
  );
}

/** Step 2 — channel info screen, Edit highlighted. */
function Step2() {
  return (
    <PhoneFrame>
      <div className="flex items-center justify-between bg-[var(--tg-bg)] px-3 pb-1 pt-2">
        <ArrowLeft size={14} className="text-[var(--tg-accent)]" />
        <Highlight label="Edit / Manage" rounded="rounded-full" className="mt-1">
          <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold text-[var(--tg-accent)]">
            <Pencil size={11} />
            Edit
          </span>
        </Highlight>
      </div>
      <div className="flex flex-col items-center gap-1 bg-[var(--tg-bg)] px-3 pb-3 pt-1">
        <ChannelAvatar size={52} />
        <p className="text-[13px] font-semibold text-[var(--tg-text)]">Your Private Channel</p>
        <p className="text-[10.5px] text-[var(--tg-sub)]">128 subscribers</p>
      </div>
      <div className="min-h-[88px] bg-[var(--tg-section)] px-3 py-3">
        <div className="rounded-xl bg-[var(--tg-bg)] px-3 py-2.5">
          <p className="text-[10px] text-[var(--tg-sub)]">Description</p>
          <div className="mt-1.5 h-1.5 w-4/5 rounded-full bg-[var(--tg-divider)]" />
          <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-[var(--tg-divider)]" />
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Step 3 — Manage Channel, Administrators highlighted. */
function Step3() {
  return (
    <PhoneFrame>
      <TgHeader title="Manage Channel" />
      <div className="bg-[var(--tg-section)] px-2 py-2">
        <div className="overflow-visible rounded-xl bg-[var(--tg-bg)] py-0.5">
          <TgRow label="Channel Type" value="Private" />
          <Divider />
          <TgRow label="Discussion" value="Add" />
          <Divider />
          <TgRow label="Invite Links" value="1" />
          <Divider />
          <div className="px-1.5 py-0.5">
            <Highlight label="Tap here" rounded="rounded-lg">
              <TgRow label="Administrators" value="1" />
            </Highlight>
          </div>
          <Divider />
          <TgRow label="Subscribers" value="128" />
          <Divider />
          <TgRow label="Recent Actions" />
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Step 4 — Administrators screen with Add Administrator, then bot search. */
function Step4({ botUsername }: { botUsername: string | null }) {
  const handle = botUsername ? `@${botUsername}` : null;
  return (
    <PhoneFrame>
      <TgHeader title="Administrators" />
      <div className="bg-[var(--tg-section)] px-2 py-2">
        <div className="rounded-xl bg-[var(--tg-bg)] px-1.5 py-1.5">
          <Highlight label="1. Tap" rounded="rounded-lg">
            <div className="flex items-center gap-2.5 px-1.5 py-1.5">
              <span className="flex h-5 w-5 items-center justify-center text-[var(--tg-accent)]">
                <UserPlus size={14} />
              </span>
              <span className="text-[11.5px] font-medium text-[var(--tg-accent)]">Add Administrator</span>
            </div>
          </Highlight>
          <div className="mt-1 flex items-center gap-2.5 px-1.5 py-1.5">
            <ChannelAvatar size={22} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium leading-tight text-[var(--tg-text)]">You</p>
              <p className="truncate text-[9.5px] leading-tight text-[var(--tg-sub)]">Owner</p>
            </div>
          </div>
        </div>

        <p className="mb-1 mt-2.5 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--tg-sub)]">2. Search and select</p>
        <div className="rounded-xl bg-[var(--tg-bg)] px-1.5 py-1.5">
          <div className="mb-1.5 flex items-center gap-1.5 rounded-lg bg-[var(--tg-section)] px-2 py-1.5">
            <Search size={11} className="flex-shrink-0 text-[var(--tg-sub)]" />
            <span className="truncate text-[11px] text-[var(--tg-text)]">{handle ?? "Search"}</span>
          </div>
          <Highlight label="Onfile Bot" rounded="rounded-lg" className="mt-3">
            <div className="flex items-center gap-2.5 px-1.5 py-1">
              <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-[#FF6115] text-[10px] font-bold text-white">O</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium leading-tight text-[var(--tg-text)]">Onfile</p>
                <p className="truncate text-[9.5px] leading-tight text-[var(--tg-sub)]">{handle ? `${handle} · bot` : "bot"}</p>
              </div>
            </div>
          </Highlight>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Step 5 — admin rights; only "Post Messages" (the backend's required right) is on. */
function Step5() {
  const off = [
    "Change Channel Info",
    "Edit Messages of Others",
    "Delete Messages of Others",
    "Add Subscribers",
    "Add New Admins",
  ];
  return (
    <PhoneFrame>
      <div className="flex items-center gap-2 border-b border-[var(--tg-divider)] bg-[var(--tg-bg)] px-3 py-2">
        <ArrowLeft size={14} className="flex-shrink-0 text-[var(--tg-accent)]" />
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--tg-text)]">Admin Rights</p>
        <Highlight label="Then confirm" rounded="rounded-full" className="mt-1.5">
          <span className="flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold text-[var(--tg-accent)]">
            <Check size={11} />
            Done
          </span>
        </Highlight>
      </div>
      <div className="bg-[var(--tg-section)] px-2 py-2">
        <p className="mb-1 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--tg-sub)]">What can this admin do?</p>
        <div className="rounded-xl bg-[var(--tg-bg)] py-0.5">
          <div className="flex items-center gap-2 px-3 py-2 opacity-90">
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--tg-text)]">{off[0]}</span>
            <Toggle on={false} />
          </div>
          <Divider />
          <div className="px-1.5 py-0.5">
            <Highlight label="Turn ON" rounded="rounded-lg">
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-[var(--tg-text)]">Post Messages</span>
                <Toggle on />
              </div>
            </Highlight>
          </div>
          {off.slice(1).map((label) => (
            <React.Fragment key={label}>
              <Divider />
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--tg-text)]">{label}</span>
                <Toggle on={false} />
              </div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Step 6 — Invite Links screen, Copy Link highlighted. */
function Step6() {
  return (
    <PhoneFrame>
      <TgHeader title="Invite Links" />
      <div className="bg-[var(--tg-section)] px-2 py-2">
        <p className="mb-1 px-1 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--tg-sub)]">Invite Link</p>
        <div className="rounded-xl bg-[var(--tg-bg)] px-3 py-2.5">
          <div className="flex items-center gap-2 rounded-lg bg-[var(--tg-section)] px-2 py-2">
            <Link2 size={12} className="flex-shrink-0 text-[var(--tg-accent)]" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--tg-text)]">t.me/+AbCdEfGhIjKlMnOp</span>
          </div>
          <p className="mt-2 text-[9.5px] leading-snug text-[var(--tg-sub)]">
            People can join your channel by following this link. You can revoke the link at any time.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <Highlight label="Tap to copy" rounded="rounded-lg">
              <div className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--tg-accent)] px-3 py-2 text-[11.5px] font-semibold text-white">
                <Copy size={12} />
                Copy Link
              </div>
            </Highlight>
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--tg-section)] px-3 py-2 text-[11.5px] font-semibold text-[var(--tg-accent)]">
              <Share2 size={12} />
              Share Link
            </div>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Onfile Manual Connect mock (steps 7 & 8). Uses the app's own theme. */
function OnfileConnectMock({
  highlight,
  input,
  filled,
}: {
  highlight: "input" | "next";
  input: React.ReactNode;
  filled: boolean;
}) {
  const nextBtn = (
    <div
      className={cn(
        "flex w-full items-center justify-center rounded-xl py-2 text-[11.5px] font-semibold",
        filled ? "gradient-brand text-white" : "bg-secondary text-muted border border-app"
      )}
    >
      Next
    </div>
  );
  return (
    <PhoneFrame appTheme>
      <div className="flex items-center justify-between border-b border-app bg-card px-3 py-2">
        <span className="text-[12px] font-semibold text-primary">Onfile</span>
        <span className="text-[10px] text-muted">Mini App</span>
      </div>
      <div className="flex flex-col gap-2.5 px-3 py-3">
        <p className="text-center text-[12.5px] font-bold text-primary">Connect Your Telegram Channel</p>
        <div className="flex items-center justify-center rounded-xl bg-secondary py-2 text-[11px] font-semibold text-secondary border border-app">
          Connect channel via bot
        </div>
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-[var(--color-border)]" />
          <span className="text-[9.5px] font-semibold text-muted">OR</span>
          <div className="h-px flex-1 bg-[var(--color-border)]" />
        </div>
        <div>
          <p className="mb-1 flex items-center gap-1 text-[10.5px] font-medium text-secondary">
            <Link2 size={10} className="text-brand" />
            Private channel link
          </p>
          {highlight === "input" ? (
            <Highlight label="Paste here" rounded="rounded-xl" className="mt-3">
              {input}
            </Highlight>
          ) : (
            input
          )}
        </div>
        {highlight === "next" ? (
          <Highlight label="Tap Next" rounded="rounded-xl" className="mt-1.5">
            {nextBtn}
          </Highlight>
        ) : (
          nextBtn
        )}
      </div>
    </PhoneFrame>
  );
}

/** Static, non-interactive copy of the link field for step 8's mock. */
function StaticLinkField({ value }: { value: string }) {
  return (
    <div className="flex items-center rounded-xl border border-app bg-secondary px-3 py-2 text-[11px] text-primary">
      <span className="min-w-0 flex-1 truncate">{value}</span>
    </div>
  );
}

export default function GuideIllustration({ step, botUsername, link, linkInput }: GuideIllustrationProps) {
  const trimmed = link.trim();

  let body: React.ReactNode;
  switch (step) {
    case 0:
      body = <Step1 />;
      break;
    case 1:
      body = <Step2 />;
      break;
    case 2:
      body = <Step3 />;
      break;
    case 3:
      body = <Step4 botUsername={botUsername} />;
      break;
    case 4:
      body = <Step5 />;
      break;
    case 5:
      body = <Step6 />;
      break;
    case 6:
      // Contains the REAL input, so it is not wrapped in an aria-hidden/img container.
      return (
        <div>
          <OnfileConnectMock highlight="input" input={linkInput} filled={!!trimmed} />
        </div>
      );
    default:
      body = <OnfileConnectMock highlight="next" input={<StaticLinkField value={trimmed || EXAMPLE_INVITE_LINK} />} filled />;
  }

  return (
    <div role="img" aria-label={ALT_TEXT[step]} className="pointer-events-none select-none">
      {body}
    </div>
  );
}
