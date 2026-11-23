"use client";
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { AvatarError } from "@/lib/profile/avatarErrors";
import { drawCrop, exportCrop, type CropImage } from "@/lib/profile/avatarImage";
import { clampZoom, cropRect, initialCrop, MAX_ZOOM, MIN_ZOOM, panBy, zoomAt, type CropState } from "@/lib/profile/cropMath";
import { useTelegramBackButton } from "@/lib/useTelegramBackButton";

const PREVIEW_PX = 56;
const ZOOM_STEP = 1.25;
const MAX_STAGE = 440;
const DEFAULT_STAGE = 280;

interface Props {
  image: CropImage;
  onCancel: () => void;
  /** Receives the validated, square (≤ 512 px) WebP/JPEG file. Nothing is uploaded here. */
  onApply: (file: File) => void;
}

/**
 * Full-screen 1:1 crop editor. The stage IS the exported square: the circle shows how the avatar will look and
 * the dimmed corners are the part a circular avatar hides (the stored file stays square). The stage, the round
 * preview and the export all render through the same `drawCrop(cropRect(...))`, so what you see is what you get.
 *
 * Gestures: one-finger / mouse drag = move, two-finger pinch = zoom (around the fingers), wheel = zoom,
 * buttons + slider = zoom, arrow keys / +/- on the focused stage. The crop maths keep the photo covering the
 * whole square, so no empty area can ever enter the crop.
 */
export default function AvatarCropper({ image, onCancel, onApply }: Props) {
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const iw = image.width;
  const ih = image.height;

  const [crop, setCrop] = useState<CropState>(initialCrop);
  const cropRef = useRef<CropState>(crop);
  const [size, setSize] = useState(DEFAULT_STAGE);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applyingRef = useRef(false);

  const areaRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageCanvas = useRef<HTMLCanvasElement>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const update = useCallback(
    (fn: (s: CropState) => CropState) => {
      const next = fn(cropRef.current);
      cropRef.current = next;
      setCrop(next);
    },
    []
  );

  // Native Back (Telegram header arrow / Android back gesture) closes the cropper only, not Edit Profile.
  const cancel = useCallback(() => {
    if (!applyingRef.current) onCancel();
  }, [onCancel]);
  useTelegramBackButton(cancel, true);

  // Esc closes; lock page scroll behind the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [cancel]);

  // Stage = the largest square that fits the free area (small phones shrink it; desktop caps at MAX_STAGE).
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setSize(Math.max(160, Math.min(MAX_STAGE, Math.floor(Math.min(w - 32, h - 16)))));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mounted]);

  // Paint stage + circular preview from the SAME crop rectangle.
  useEffect(() => {
    const rect = cropRect(crop, iw, ih);
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const paint = (canvas: HTMLCanvasElement | null, css: number) => {
      if (!canvas) return;
      const px = Math.round(css * dpr);
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) drawCrop(ctx, image.canvas, rect, px);
    };
    paint(stageCanvas.current, size);
    paint(previewCanvas.current, PREVIEW_PX);
  }, [crop, size, iw, ih, image, mounted]);

  // Wheel zoom needs a non-passive listener (React's onWheel is passive).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left - size / 2) / size;
      const fy = (e.clientY - r.top - size / 2) / size;
      update((s) => zoomAt(s, s.zoom * Math.exp(-e.deltaY * 0.002), fx, fy, iw, ih));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [size, iw, ih, update, mounted]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not supported (e.g. jsdom) */
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.current.size === 1) {
      update((s) => panBy(s, (cur.x - prev.x) / size, (cur.y - prev.y) / size, iw, ih));
    } else if (pointers.current.size === 2) {
      const other = Array.from(pointers.current.entries()).find(([id]) => id !== e.pointerId)![1];
      const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
      const curDist = Math.hypot(cur.x - other.x, cur.y - other.y);
      const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
      const curMid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
      const r = stageRef.current?.getBoundingClientRect();
      const fx = ((prevMid.x - (r?.left ?? 0)) - size / 2) / size;
      const fy = ((prevMid.y - (r?.top ?? 0)) - size / 2) / size;
      update((s) => {
        // Scale around where the fingers WERE, then follow the fingers' movement.
        const zoomed = prevDist > 0 && curDist > 0 ? zoomAt(s, s.zoom * (curDist / prevDist), fx, fy, iw, ih) : s;
        return panBy(zoomed, (curMid.x - prevMid.x) / size, (curMid.y - prevMid.y) / size, iw, ih);
      });
    }
    pointers.current.set(e.pointerId, cur);
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const zoomBy = (factor: number) => update((s) => zoomAt(s, s.zoom * factor, 0, 0, iw, ih));
  const reset = () => update(() => initialCrop());

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = 0.03;
    // Arrow keys move the photo (key names are matched by suffix: "Arrow" + Left|Right|Up|Down).
    const dir = e.key.startsWith("Arrow") ? e.key.slice(5) : "";
    if (dir === "Left") update((s) => panBy(s, step, 0, iw, ih));
    else if (dir === "Right") update((s) => panBy(s, -step, 0, iw, ih));
    else if (dir === "Up") update((s) => panBy(s, 0, step, iw, ih));
    else if (dir === "Down") update((s) => panBy(s, 0, -step, iw, ih));
    else if (e.key === "+" || e.key === "=") zoomBy(ZOOM_STEP);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / ZOOM_STEP);
    else return;
    e.preventDefault();
  };

  const onApplyClick = async () => {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(true);
    setError(null);
    try {
      const file = await exportCrop(image, cropRect(cropRef.current, iw, ih));
      onApply(file);
    } catch (err) {
      setError(err instanceof AvatarError ? err.message : "We couldn't prepare the cropped picture. Please try again.");
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  };

  if (!mounted) return null;

  const atMin = crop.zoom <= MIN_ZOOM + 0.001;
  const atMax = crop.zoom >= MAX_ZOOM - 0.001;
  const canReset = crop.zoom !== MIN_ZOOM || crop.nx !== 0 || crop.ny !== 0;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop profile picture"
      data-testid="avatar-cropper"
      className="fixed inset-0 z-[90] flex flex-col text-primary"
      style={{ background: "var(--color-bg)", height: "100dvh" }}
    >
      <div className="px-4 pt-4 text-center">
        <h2 className="text-base font-bold">Crop photo</h2>
        <p className="mt-0.5 text-xs text-muted">Drag to move · pinch or scroll to zoom</p>
      </div>

      <div ref={areaRef} className="flex min-h-0 flex-1 items-center justify-center px-4 py-2">
        <div
          ref={stageRef}
          data-testid="crop-stage"
          tabIndex={0}
          aria-label="Crop area. Drag to move the photo, pinch or use plus and minus to zoom."
          className="relative touch-none select-none overflow-hidden rounded-xl bg-white outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          style={{ width: size, height: size, touchAction: "none", cursor: "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onKeyDown={onKeyDown}
        >
          <canvas ref={stageCanvas} data-testid="crop-canvas" className="block h-full w-full" />
          {/* Circular mask: dims what a round avatar will hide. The circle is the inscribed circle of the square. */}
          <div
            aria-hidden="true"
            data-testid="crop-mask"
            className="pointer-events-none absolute inset-0"
            style={{ background: "radial-gradient(circle closest-side, transparent 99.4%, rgba(0,0,0,0.55) 100%)" }}
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.25)]" />
        </div>
      </div>

      <div className="flex flex-col gap-3 px-4 pt-2" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}>
        <div role="alert" className="min-h-0">
          {error && (
            <p className="rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400" data-testid="crop-error">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div
            className="flex-shrink-0 overflow-hidden rounded-full border border-app bg-white"
            style={{ width: PREVIEW_PX, height: PREVIEW_PX }}
            data-testid="crop-preview"
            role="img"
            aria-label="Avatar preview"
          >
            <canvas ref={previewCanvas} className="block h-full w-full" />
          </div>
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            disabled={atMin || applying}
            aria-label="Zoom out"
            data-testid="zoom-out"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary disabled:opacity-40"
          >
            <ZoomOut size={20} aria-hidden="true" />
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => update((s) => zoomAt(s, clampZoom(Number(e.target.value)), 0, 0, iw, ih))}
            disabled={applying}
            aria-label="Zoom"
            data-testid="zoom-slider"
            className="h-11 min-w-0 flex-1 accent-[var(--color-primary)]"
          />
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_STEP)}
            disabled={atMax || applying}
            aria-label="Zoom in"
            data-testid="zoom-in"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-secondary text-primary disabled:opacity-40"
          >
            <ZoomIn size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={cancel}
            disabled={applying}
            data-testid="crop-cancel"
            className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-secondary px-3 text-sm font-semibold text-secondary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={!canReset || applying}
            data-testid="crop-reset"
            className="inline-flex min-h-12 flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 text-sm font-semibold text-secondary disabled:opacity-50"
          >
            <RotateCcw size={16} aria-hidden="true" />
            Reset
          </button>
          <button
            type="button"
            onClick={onApplyClick}
            disabled={applying}
            data-testid="crop-apply"
            className="btn-primary min-h-12 flex-[1.4] px-3 text-sm disabled:opacity-60"
          >
            {applying ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                Applying…
              </span>
            ) : (
              "Apply Crop"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
