"use client";
import React, { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { callGate, openJoinLink, type GateResponse } from "@/lib/forceJoinClient";

/**
 * Members-only gate for ONE file (Force Join). Shown only when the server says a live force-join campaign gates this
 * file. "Join" opens the channel; "I've joined" asks the SERVER to re-check with Telegram — tapping Join never unlocks
 * anything. When the check passes the parent continues the normal Get File flow (which the server gates again).
 */
export default function ForceJoinGate({ slug, gate, onPassed, onClose }: { slug: string; gate: GateResponse; onPassed: () => void; onClose: () => void }) {
  const [current, setCurrent] = useState<GateResponse>(gate);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);

  const channel = current.channelTitle || (current.channelUsername ? `@${current.channelUsername}` : "the channel");
  const needsTelegram = current.state === "login_required";

  const onJoin = () => {
    if (!openJoinLink(current.joinUrl)) setMessage("The join link isn't available. Please contact the creator.");
  };

  const onVerify = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    const r = await callGate(slug, "verify");
    busyRef.current = false;
    setBusy(false);
    if (!r.ok) return setMessage(r.message);
    setCurrent((prev) => ({ ...prev, ...r.gate }));
    if (!r.gate.gated || r.gate.state === "passed") return onPassed();
    if (r.gate.state === "unavailable") setMessage("Telegram couldn't confirm your membership right now. Please try again in a moment.");
    else if (r.gate.state === "join_required") setMessage("We can't see you in the channel yet. Join first, then tap “I've joined”.");
  };

  return (
    <Modal open onClose={() => { if (!busy) onClose(); }} title="Join to unlock" size="sm">
      <div className="flex flex-col gap-4" data-testid="force-join-gate">
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-2xl bg-brand-10 flex items-center justify-center flex-shrink-0">
            <Send size={20} className="text-brand" aria-hidden="true" />
          </span>
          <p className="text-sm text-secondary mt-0.5 min-w-0 break-words">
            {needsTelegram
              ? "This file is for channel members. Open it inside Telegram so Onfile can confirm your membership."
              : <>This file is for members of <b className="text-primary">{channel}</b>. Join the channel, then come back and confirm.</>}
          </p>
        </div>

        {message && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20">
            <AlertCircle size={15} className="text-red-500 mt-px flex-shrink-0" aria-hidden="true" />
            <p className="text-xs text-red-600 dark:text-red-400 leading-snug">{message}</p>
          </div>
        )}

        {!needsTelegram && (
          <>
            <button type="button" className="btn-cta" onClick={onJoin} data-testid="gate-join" disabled={busy || !current.joinUrl}>
              <Send size={18} aria-hidden="true" /> Join {channel}
            </button>
            <button type="button" className="h-[48px] w-full rounded-2xl border border-app bg-secondary text-primary text-sm font-semibold inline-flex items-center justify-center gap-2" onClick={onVerify} disabled={busy} aria-busy={busy} data-testid="gate-verify">
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
              {busy ? "Checking…" : "I've joined"}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
