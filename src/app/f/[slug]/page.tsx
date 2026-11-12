"use client";
import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { Eye, Download, Flag, SearchX, WifiOff, ShieldCheck } from "lucide-react";
import { cn, formatNumber, getFileTypeBadgeColor } from "@/lib/utils";
import { fileKindLabel } from "@/lib/fileKinds";
import type { DownloadCreatorInfo, DownloadFileInfo } from "@/lib/download";
import FileHero from "@/components/download/FileHero";
import UnlockPanel from "@/components/download/UnlockPanel";
import SuccessPanel from "@/components/download/SuccessPanel";
import CreatorRow from "@/components/download/CreatorRow";
import ReportModal from "@/components/download/ReportModal";

type LoadState = "loading" | "ready" | "not_found" | "error";

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2 min-h-10" aria-label="Onfile home">
      <span className="w-8 h-8 rounded-[10px] bg-brand flex items-center justify-center text-white text-sm font-black">O</span>
      <span className="font-bold text-primary text-base tracking-tight">Onfile</span>
    </Link>
  );
}

function PageShell({ children, onReport }: { children: React.ReactNode; onReport?: () => void }) {
  return (
    <div className="min-h-screen bg-app safe-bottom">
      <div className="mx-auto w-full max-w-md md:max-w-4xl px-4 pt-3 pb-8 flex flex-col gap-4 md:gap-6">
        <header className="flex items-center justify-between">
          <BrandMark />
          {onReport && (
            <button
              type="button"
              onClick={onReport}
              aria-label="Report this file"
              className="h-10 px-3 -mr-2 rounded-xl inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-red-500 transition-colors"
            >
              <Flag size={14} />
              Report
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="grid gap-5 md:grid-cols-2 md:gap-8 animate-pulse-brand" aria-busy="true" aria-label="Loading file">
        <div className="aspect-video rounded-3xl bg-secondary border border-app" />
        <div className="flex flex-col gap-4">
          <div className="h-7 w-3/4 rounded-lg bg-secondary" />
          <div className="h-4 w-1/2 rounded-lg bg-secondary" />
          <div className="h-52 rounded-3xl bg-secondary border border-app" />
        </div>
      </div>
    </PageShell>
  );
}

function Message({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action: React.ReactNode }) {
  return (
    <PageShell>
      <div className="flex flex-col items-center justify-center gap-4 text-center py-20 px-4">
        <div className="w-20 h-20 rounded-3xl bg-secondary border border-app flex items-center justify-center text-muted">{icon}</div>
        <div>
          <h1 className="text-xl font-bold text-primary mb-1">{title}</h1>
          <p className="text-sm text-secondary">{text}</p>
        </div>
        {action}
      </div>
    </PageShell>
  );
}

export default function SmartLinkPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [file, setFile] = useState<DownloadFileInfo | null>(null);
  const [creator, setCreator] = useState<DownloadCreatorInfo | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  /** Set only from a successful server unlock response. */
  const [unlocked, setUnlocked] = useState<{ link: string | null } | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchFile = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/link/${encodeURIComponent(slug)}`);
      if (res.ok) {
        const data = await res.json();
        setFile(data.file);
        setCreator(data.creator ?? null);
        setState("ready");
      } else if (res.status === 404) {
        setState("not_found");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }, [slug]);

  useEffect(() => {
    // Initial load of the public file info for this link.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchFile();
  }, [fetchFile]);

  if (state === "loading") return <PageSkeleton />;

  if (state === "not_found" || (state === "ready" && !file)) {
    return (
      <Message
        icon={<SearchX size={34} />}
        title="File not found"
        text="This link may have expired or been removed."
        action={<Link href="/" className="btn-primary px-6 py-3 text-sm">Go to Onfile</Link>}
      />
    );
  }

  if (state === "error" || !file) {
    return (
      <Message
        icon={<WifiOff size={34} />}
        title="Couldn’t load this file"
        text="Check your connection and try again."
        action={<button type="button" onClick={() => void fetchFile()} className="btn-primary px-6 py-3 text-sm">Try again</button>}
      />
    );
  }

  const description = file.description?.trim() || "";
  const longDescription = description.length > 160;

  return (
    <PageShell onReport={() => setShowReport(true)}>
      <main className="grid gap-5 md:grid-cols-2 md:gap-8 md:items-start">
        {/* Artwork */}
        <div className="md:sticky md:top-6">
          <FileHero file={file} />
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          {/* Title & facts */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("chip capitalize", getFileTypeBadgeColor(file.fileType))}>{fileKindLabel(file)}</span>
            </div>
            <h1 className="text-2xl font-bold text-primary leading-tight break-words">{file.title}</h1>
            <div className="flex items-center gap-4 text-xs text-secondary">
              <span className="inline-flex items-center gap-1.5"><Eye size={13} />{formatNumber(file.views ?? 0)} views</span>
              <span className="inline-flex items-center gap-1.5"><Download size={13} />{formatNumber(file.downloads ?? 0)} downloads</span>
            </div>
          </div>

          {/* Primary action */}
          {unlocked ? <SuccessPanel telegramMessageLink={unlocked.link} /> : <UnlockPanel slug={slug} file={file} onUnlocked={(link) => setUnlocked({ link })} />}

          {/* Creator */}
          <CreatorRow creator={creator} className="rounded-2xl border border-app bg-card p-3" />

          {/* About */}
          {description && (
            <div className="flex flex-col gap-1.5">
              <h2 className="text-sm font-semibold text-primary">About this file</h2>
              <p className={cn("text-sm text-secondary leading-relaxed whitespace-pre-line break-words", !expanded && longDescription && "line-clamp-3")}>
                {description}
              </p>
              {longDescription && (
                <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="self-start min-h-10 text-xs font-semibold text-brand">
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      <footer className="flex items-center justify-center gap-1.5 text-xs text-muted pt-2">
        <ShieldCheck size={13} />
        Delivered through Telegram · Onfile doesn’t store your files
      </footer>

      {showReport && <ReportModal open fileId={file.id} onClose={() => setShowReport(false)} />}
    </PageShell>
  );
}
