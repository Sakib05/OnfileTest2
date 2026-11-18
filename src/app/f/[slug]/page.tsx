"use client";
import React, { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchX, WifiOff } from "lucide-react";
import type { DownloadCreatorInfo, DownloadFileInfo } from "@/lib/download";
import FileViewer from "@/components/viewer/FileViewer";
import { ViewerMessage, ViewerSkeleton } from "@/components/viewer/ViewerMessage";
import { parseListParam, type PublicPlaylistPayload } from "@/lib/playlistSharing";
import { selectionUrl } from "@/lib/viewer";

type LoadState = "loading" | "ready" | "not_found" | "error";

/**
 * Standalone public file page (/f/<slug>): the same viewer as the playlist route, in single-file mode.
 *
 * Old playlist links of the form /f/<slug>?list=<token> are forwarded to the unified playlist page
 * (/p/<token>?f=<slug>) — but ONLY when the public playlist endpoint confirms that this file is one of the items the
 * visitor may see. Anything else (unknown token, private/locked playlist, file not in it) simply stays a standalone file.
 */
export default function SmartLinkPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ list?: string | string[] }> }) {
  const { slug } = use(params);
  const listSlug = parseListParam(searchParams ? use(searchParams).list : undefined);
  const router = useRouter();
  const [file, setFile] = useState<DownloadFileInfo | null>(null);
  const [creator, setCreator] = useState<DownloadCreatorInfo | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  /** The playlist token whose membership check has finished (null until then). */
  const [checkedList, setCheckedList] = useState<string | null>(null);

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

  useEffect(() => {
    if (!listSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/p/${encodeURIComponent(listSlug)}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as PublicPlaylistPayload;
          if (!cancelled && data.items?.some((i) => i.slug === slug)) {
            router.replace(selectionUrl(listSlug, slug));
            return;
          }
        }
      } catch {
        /* stay standalone */
      }
      if (!cancelled) setCheckedList(listSlug);
    })();
    return () => {
      cancelled = true;
    };
  }, [listSlug, slug, router]);

  if (state === "loading" || (listSlug && checkedList !== listSlug)) return <ViewerSkeleton label="Loading file" />;

  if (state === "not_found" || (state === "ready" && !file)) {
    return (
      <ViewerMessage
        icon={<SearchX size={34} />}
        title="File not found"
        text="This link may have expired or been removed."
        action={<Link href="/" className="btn-primary px-6 py-3 text-sm">Go to Onfile</Link>}
      />
    );
  }

  if (state === "error" || !file) {
    return (
      <ViewerMessage
        icon={<WifiOff size={34} />}
        title="Couldn’t load this file"
        text="Check your connection and try again."
        action={<button type="button" onClick={() => void fetchFile()} className="btn-primary px-6 py-3 text-sm">Try again</button>}
      />
    );
  }

  return <FileViewer file={file} creator={creator} />;
}
