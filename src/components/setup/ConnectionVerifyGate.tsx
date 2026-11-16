"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck } from "lucide-react";
import { useApp } from "@/contexts/AppContext";
import { clearLaunchConnectRef } from "@/lib/botConnectClient";
import { clearPersistedConnectRequest } from "@/lib/useChannelConnect";
import { isRunningInsideTelegram, triggerHaptic } from "@/lib/telegramWebApp";
import {
  VERIFY_ERROR_COPY,
  fetchVerifyOutcome,
  submitVerification,
  verifyFailureMessage,
  type VerifyOutcome,
} from "@/lib/verifyLaunch";

/** While a verification is still running with Telegram (another tap / device), re-check the SAME request this often / this many times. */
const VERIFYING_POLL_MS = 2000;
const VERIFYING_MAX_POLLS = 8;

type GatePhase = { phase: "verifying" } | { phase: "error"; message: string };

/**
 * What the Mini App shows when it is opened by the bot's "Verify" button (`/?connect=<public request ref>`).
 * Opening it IS the user's Verify action:
 *
 *   1. make sure the Telegram user is signed in (silent `initData` exchange, as everywhere else);
 *   2. ask the backend to VERIFY the EXISTING request (POST connect-verify, `submitVerification`). The server does
 *      all the checking: the request belongs to this Telegram user and has not expired, the channel Telegram
 *      reported is private, the user is its creator/administrator, the Onfile bot is an administrator with the
 *      required permissions — and only then connects it, exactly once. Nothing (channel id, verdict) comes from
 *      this client;
 *   3. if another tap / device is already verifying, wait for that single verification with the read-only GET;
 *   4. only if the server says "verified": refresh the session user + connected channels and invalidate the
 *      Dashboard's data (`refreshDashboard`), then hand over to the Dashboard (`onVerified`);
 *   5. in every other case show a clear error with a safe retry (re-submits the same request; never creates a new
 *      one) — the Dashboard is NEVER reached as if verification had succeeded.
 *
 * The Channel Management page is deliberately not a destination of this flow; "Connect a channel" is only offered
 * on the error screen as an explicit user choice.
 */
export default function ConnectionVerifyGate({
  launchRef,
  onVerified,
  onLeave,
}: {
  launchRef: number;
  /** Called exactly once, after the connection is verified and the Dashboard data has been refreshed. */
  onVerified: () => void;
  /** The user explicitly chose to leave the verification screen after a failure. */
  onLeave: () => void;
}) {
  const { authStatus, startTelegramLogin, refreshDashboard, setActiveTab, setProfileEntry } = useApp();
  const [view, setView] = useState<GatePhase>({ phase: "verifying" });
  /** One verification run at a time (double taps, StrictMode double effects, auth-state changes). */
  const running = useRef(false);
  /** Terminal success applied once: no duplicate haptic / navigation. */
  const completed = useRef(false);
  const mounted = useRef(true);
  const loginAttempted = useRef(false);
  const onVerifiedRef = useRef(onVerified);
  useEffect(() => {
    onVerifiedRef.current = onVerified;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fail = useCallback((message: string) => {
    if (mounted.current) setView({ phase: "error", message });
  }, []);

  const run = useCallback(async () => {
    if (running.current || completed.current) return;
    running.current = true;
    try {
      if (mounted.current) setView({ phase: "verifying" });

      let outcome: VerifyOutcome = await submitVerification(launchRef);
      for (let i = 0; i < VERIFYING_MAX_POLLS && outcome.kind === "verifying"; i++) {
        await new Promise((r) => setTimeout(r, VERIFYING_POLL_MS));
        if (!mounted.current) return;
        outcome = await fetchVerifyOutcome(launchRef);
      }
      if (!mounted.current) return;

      if (outcome.kind !== "verified") {
        triggerHaptic("error");
        fail(verifyFailureMessage(outcome));
        return;
      }

      // Server-confirmed. Refresh user + channels + Dashboard data BEFORE the Dashboard is displayed.
      const ready = await refreshDashboard();
      if (!mounted.current) return;
      if (!ready) {
        triggerHaptic("error");
        fail(VERIFY_ERROR_COPY.dashboard);
        return;
      }

      completed.current = true;
      clearPersistedConnectRequest();
      clearLaunchConnectRef(); // a reload must not replay the launch
      triggerHaptic("success");
      setProfileEntry(null);
      setActiveTab("home"); // the Dashboard — never the Channel Management page
      onVerifiedRef.current();
    } finally {
      running.current = false;
    }
  }, [launchRef, refreshDashboard, fail, setActiveTab, setProfileEntry]);

  // Step 1 + 2: wait for an identity, then verify once.
  useEffect(() => {
    if (completed.current) return;
    if (authStatus === "loading") return;
    if (authStatus === "guest") {
      if (!isRunningInsideTelegram()) {
        fail(VERIFY_ERROR_COPY.notTelegram);
        return;
      }
      if (loginAttempted.current) return;
      loginAttempted.current = true;
      void startTelegramLogin().then((result) => {
        if (!result.ok) fail(result.error ?? VERIFY_ERROR_COPY.signIn);
      });
      return;
    }
    void run();
    // `run` is stable per launch ref; authStatus transitions guest → setup_required/authenticated start it.
  }, [authStatus, startTelegramLogin, run, fail]);

  const retry = () => {
    if (running.current) return;
    if (authStatus === "guest") {
      loginAttempted.current = false;
      setView({ phase: "verifying" });
      void startTelegramLogin().then((result) => {
        if (!result.ok) fail(result.error ?? VERIFY_ERROR_COPY.signIn);
      });
      return;
    }
    void run();
  };

  const leave = () => {
    clearLaunchConnectRef();
    onLeave();
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 bg-app gap-6" data-testid="connection-verify-gate">
      <div className="w-14 h-14 rounded-2xl gradient-brand flex items-center justify-center shadow-lg">
        <ShieldCheck size={26} color="white" />
      </div>
      <div className="flex flex-col items-center gap-4 text-center max-w-sm w-full">
        <h1 className="text-xl font-bold text-primary">Channel Verification</h1>
        {view.phase === "verifying" ? (
          <div className="flex items-center gap-2 text-sm text-secondary" role="status" data-testid="verify-progress">
            <Loader2 size={16} className="animate-spin" />
            Verifying your connection…
          </div>
        ) : (
          <>
            <div
              className="flex items-start gap-2 text-left text-xs text-red-500 bg-secondary rounded-xl p-3"
              role="alert"
              data-testid="verify-error"
            >
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              <span>{view.message}</span>
            </div>
            <button type="button" onClick={retry} className="btn-primary w-full py-3 text-sm font-semibold">
              Try Again
            </button>
            <button type="button" onClick={leave} className="w-full py-3 text-sm font-semibold text-secondary">
              Connect a channel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
