"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { useApp } from "@/contexts/AppContext";
import type { FieldErrors } from "@/lib/publishing/validation";
import type { PublishMode } from "@/lib/publishing/constants";
import { useKeyboardAwareViewport } from "./useKeyboardAwareViewport";
import StepIndicator from "./StepIndicator";
import LinkStep from "./LinkStep";
import DetailsStep from "./DetailsStep";
import MonetizationStep from "./MonetizationStep";
import PreviewStep from "./PreviewStep";
import type { PlaylistOption } from "./PlaylistPicker";
import { EMPTY_DRAFT, clearDraft, loadDraft, saveDraft, type PublishDraft, type StepIndex } from "./draft";

interface PublishResponse {
  file?: { title?: string; smartLinkSlug?: string | null };
  published?: boolean;
  error?: string;
  reason?: string;
  fieldErrors?: FieldErrors;
}

const DETAIL_FIELDS: (keyof FieldErrors)[] = ["title", "description", "category", "fileType", "password", "playlistId", "thumbnail"];

export default function PublishWizard({ onFinished }: { onFinished?: () => void }) {
  const { toast } = useToast();
  const { refreshUser, refreshChannels } = useApp();

  // Lazy init is safe: this component only renders after client-side auth.
  const [restored] = useState(() => loadDraft());
  const [draft, setDraft] = useState<PublishDraft>(restored?.draft ?? EMPTY_DRAFT);
  const [step, setStep] = useState<StepIndex>(restored?.step ?? 0);
  const [maxReached, setMaxReached] = useState<StepIndex>(restored?.step ?? 0);
  const [playlists, setPlaylists] = useState<PlaylistOption[]>([]);
  const [playlistsLoaded, setPlaylistsLoaded] = useState(false);
  const [paidAvailable, setPaidAvailable] = useState<boolean | null>(null);
  const [publishing, setPublishing] = useState<PublishMode | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [done, setDone] = useState<{ published: boolean; title: string } | null>(null);
  const publishGuard = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Keeps the focused field above the on-screen keyboard (active only while this wizard is mounted).
  const keyboardInset = useKeyboardAwareViewport(rootRef);

  const addCreatedPlaylist = useCallback((created: PlaylistOption) => {
    setPlaylists((prev) => (prev.some((p) => p.id === created.id) ? prev : [created, ...prev]));
    setPlaylistsLoaded(true);
  }, []);

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch("/api/playlists");
      if (res.ok) {
        const data = await res.json();
        setPlaylists(Array.isArray(data.playlists) ? data.playlists : []);
        setPlaylistsLoaded(true);
      }
    } catch {
      /* playlists are optional; leave list empty */
    }
  }, []);

  // A playlist that no longer exists (deleted elsewhere) must not stay selected.
  useEffect(() => {
    if (!playlistsLoaded) return;
    setDraft((d) => (d.playlistId && !playlists.some((p) => String(p.id) === d.playlistId) ? { ...d, playlistId: "" } : d));
  }, [playlists, playlistsLoaded]);

  useEffect(() => {
    void fetchPlaylists();
    void (async () => {
      try {
        const res = await fetch("/api/publish/capabilities");
        const data = res.ok ? await res.json() : null;
        setPaidAvailable(data ? data.paidPublishing === true : false);
      } catch {
        setPaidAvailable(false);
      }
    })();
  }, [fetchPlaylists]);

  // Persist form values (never the password) so work survives a refresh.
  useEffect(() => {
    if (!done) saveDraft(step, draft);
  }, [step, draft, done]);

  const patch = useCallback((p: Partial<PublishDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setServerErrors({});
    setPublishError(null);
  }, []);

  const goTo = useCallback((s: StepIndex) => {
    setStep(s);
    setMaxReached((m) => (s > m ? s : m));
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const reset = () => {
    clearDraft();
    setDraft(EMPTY_DRAFT);
    setServerErrors({});
    setPublishError(null);
    setDone(null);
    setStep(0);
    setMaxReached(0);
  };

  const publish = async (mode: PublishMode) => {
    if (publishGuard.current) return; // blocks double-taps before state updates
    if (!draft.verified) {
      goTo(0);
      return;
    }
    publishGuard.current = true;
    setPublishing(mode);
    setPublishError(null);
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramMessageLink: draft.link.trim(),
          title: draft.title,
          description: draft.description,
          category: draft.category,
          fileType: draft.fileType,
          playlistId: draft.playlistId || null,
          thumbnailRef: draft.thumbnail?.ref ?? null,
          password: draft.password,
          monetization: draft.monetization,
          starsPrice: draft.monetization === "paid" ? draft.starsPrice : 0,
          mode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as PublishResponse;

      if (res.status === 201) {
        clearDraft();
        setDone({ published: data.published !== false, title: data.file?.title ?? draft.title });
        void refreshUser();
        return;
      }

      const message = data.error || "Couldn't publish. Please try again.";
      switch (data.reason) {
        case "validation_failed": {
          const fe = data.fieldErrors ?? {};
          setServerErrors(fe);
          // The staged thumbnail expired or was rejected: drop it so the creator can re-upload.
          if (fe.thumbnail) setDraft((d) => ({ ...d, thumbnail: null }));
          const keys = Object.keys(fe) as (keyof FieldErrors)[];
          goTo(keys.some((k) => DETAIL_FIELDS.includes(k)) ? 1 : 2);
          toast(message, "error");
          break;
        }
        case "channel_required":
          setPublishError(message);
          void refreshChannels(); // routes into the existing channel-connect flow
          break;
        case "channel_mismatch":
        case "verification_unavailable":
        case "invalid_message_id":
          // Link is no longer acceptable: send the creator back to re-verify.
          setDraft((d) => ({ ...d, verified: null }));
          goTo(0);
          toast(message, "error");
          break;
        default:
          setPublishError(res.status === 401 ? "Your session has expired. Please reopen Onfile from Telegram." : message);
      }
    } catch {
      setPublishError("Network problem. Check your connection and try again.");
    } finally {
      publishGuard.current = false;
      setPublishing(null);
    }
  };

  if (done) {
    return (
      <div className="flex flex-col items-center text-center gap-4 pt-10 animate-scale-in">
        <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
          <CheckCircle2 size={36} className="text-green-500" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-primary">{done.published ? "Published!" : "Draft saved"}</h2>
          <p className="text-sm text-secondary mt-1.5 max-w-xs">
            {done.published
              ? `“${done.title}” is live. Your file stays in your private Telegram channel.`
              : `“${done.title}” was saved as an unpublished draft. It isn't visible to anyone yet.`}
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full max-w-xs pt-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onFinished?.();
            }}
            className="btn-primary min-h-12 text-sm font-semibold"
          >
            View my library
          </button>
          <button type="button" onClick={reset} className="btn-secondary min-h-12 text-sm font-semibold flex items-center justify-center gap-1.5">
            <Plus size={16} />
            Add another post
          </button>
        </div>
      </div>
    );
  }

  const playlistTitle = draft.playlistId ? (playlists.find((p) => String(p.id) === draft.playlistId)?.title ?? null) : null;

  return (
    <div ref={rootRef} className="flex flex-col gap-6" style={keyboardInset ? { paddingBottom: keyboardInset } : undefined}>
      <div ref={topRef} className="scroll-mt-4">
        <StepIndicator current={step} maxReached={draft.verified ? maxReached : 0} onSelect={goTo} />
      </div>

      <div key={step} className="animate-slide-up">
        {step === 0 && <LinkStep draft={draft} onChange={patch} onContinue={() => goTo(1)} />}
        {step === 1 && (
          <DetailsStep
            draft={draft}
            onChange={patch}
            playlists={playlists}
            onPlaylistCreated={async (created) => {
              addCreatedPlaylist(created); // visible immediately; the refetch below confirms it from the database
              await fetchPlaylists();
            }}
            onBack={() => goTo(0)}
            onContinue={() => goTo(2)}
            serverErrors={serverErrors}
          />
        )}
        {step === 2 && (
          <MonetizationStep
            draft={draft}
            onChange={patch}
            paidPublishingAvailable={paidAvailable}
            onBack={() => goTo(1)}
            onContinue={() => goTo(3)}
            serverErrors={serverErrors}
          />
        )}
        {step === 3 && (
          <PreviewStep
            draft={draft}
            playlistTitle={playlistTitle}
            paidPublishingAvailable={paidAvailable}
            publishing={publishing}
            error={publishError}
            onBack={() => goTo(2)}
            onEdit={goTo}
            onPublish={publish}
            onSwitchToFree={() => patch({ monetization: "free", starsPrice: "" })}
          />
        )}
      </div>
    </div>
  );
}
