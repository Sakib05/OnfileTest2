import React from "react";
import { FILE_KIND_META, resolveFileKind, type FileKind, type FileKindInput } from "@/lib/fileKinds";

/**
 * Onfile's file-type artwork: one coherent system instead of emojis.
 *
 * Every type shares the same language — a saturated brand-family gradient tile
 * (colour comes from the `.ft-tile[data-kind]` rules in globals.css, which also
 * deepen it in the dark theme), a white glyph with a soft shadow, and a deep
 * accent colour (`--ft-b`) for details. Documents are a folded page with a
 * coloured label band (PDF / DOC / XLS / PPT / ZIP); media types get their own
 * scene (photo, play screen, waveform); APKs a robot head; unknown types a
 * neutral page. Pure inline SVG: no network, no external assets.
 *
 * The component fills its positioned parent (`absolute inset-0`) like an <img>,
 * so it can replace a thumbnail at any size or aspect ratio.
 */

const PAGE = "M12 5h16l10 10v25a3 3 0 0 1-3 3H12a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z";
const FOLD = "M28 5v7a3 3 0 0 0 3 3h7z";

function Page({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <path d={PAGE} fill="#fff" />
      <path d={FOLD} fill="var(--ft-b)" opacity="0.28" />
      {children}
    </>
  );
}

function Band({ text }: { text: string }) {
  return (
    <>
      <rect x="4" y="24" width="28" height="13" rx="3.5" fill="var(--ft-b)" />
      <text
        x="18"
        y="33.4"
        textAnchor="middle"
        fontSize="8.6"
        fontWeight="800"
        letterSpacing="0.4"
        fill="#fff"
        style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
      >
        {text}
      </text>
    </>
  );
}

const line = (x: number, y: number, w: number, o = 0.5) => (
  <rect key={`${x}-${y}`} x={x} y={y} width={w} height="2.6" rx="1.3" fill="var(--ft-b)" opacity={o} />
);

function Glyph({ kind }: { kind: FileKind }) {
  switch (kind) {
    case "pdf":
      return (
        <>
          <Page>
            {line(15, 12, 15)}
            {line(15, 17.5, 10, 0.35)}
          </Page>
          <Band text="PDF" />
        </>
      );
    case "word":
      return (
        <>
          <Page>
            {line(15, 11, 17)}
            {line(15, 15.5, 17, 0.4)}
            {line(15, 20, 11, 0.4)}
          </Page>
          <Band text="DOC" />
        </>
      );
    case "excel":
      return (
        <>
          <Page>
            <g fill="none" stroke="var(--ft-b)" strokeWidth="1.6" opacity="0.6" strokeLinejoin="round">
              <rect x="15" y="10.5" width="17" height="10.5" rx="1.5" />
              <path d="M23.5 10.5V21M15 15.75h17" />
            </g>
          </Page>
          <Band text="XLS" />
        </>
      );
    case "powerpoint":
      return (
        <>
          <Page>
            <circle cx="22.5" cy="16" r="5.4" fill="var(--ft-b)" opacity="0.3" />
            <path d="M22.5 16V10.6a5.4 5.4 0 0 1 5.4 5.4z" fill="var(--ft-b)" opacity="0.85" />
          </Page>
          <Band text="PPT" />
        </>
      );
    case "document":
      return (
        <Page>
          {line(15, 17, 18, 0.7)}
          {line(15, 22.5, 18, 0.35)}
          {line(15, 27.5, 18, 0.35)}
          {line(15, 32.5, 11, 0.35)}
        </Page>
      );
    case "archive":
      return (
        <>
          <Page>
            {[8, 12.4, 16.8, 21.2].map((y, i) => (
              <rect key={y} x={i % 2 ? 22 : 18.4} y={y} width="3.6" height="2.6" rx="0.8" fill="var(--ft-b)" opacity="0.75" />
            ))}
            <rect x="17.4" y="26" width="8.6" height="9.5" rx="3" fill="none" stroke="var(--ft-b)" strokeWidth="2.2" />
            <rect x="20.4" y="29.5" width="2.6" height="3.4" rx="1.1" fill="var(--ft-b)" />
          </Page>
        </>
      );
    case "image":
      return (
        <>
          <rect x="5" y="8" width="38" height="32" rx="6" fill="#fff" />
          <circle cx="34" cy="17" r="4" fill="var(--ft-a)" />
          <path d="M5 33.5l11-10.5 8 8 6-5.5 13 12v.5a6 6 0 0 1-6 6H11a6 6 0 0 1-6-6z" fill="var(--ft-b)" opacity="0.9" transform="translate(0 -4)" />
        </>
      );
    case "video":
      return (
        <>
          <rect x="5" y="9" width="38" height="30" rx="8" fill="#fff" />
          <path d="M20.5 17.5l11 6.5-11 6.5z" fill="var(--ft-b)" stroke="var(--ft-b)" strokeWidth="2.6" strokeLinejoin="round" />
        </>
      );
    case "audio":
      return (
        <>
          {[
            [7.5, 16],
            [14.5, 28],
            [21.5, 36],
            [28.5, 24],
            [35.5, 14],
          ].map(([x, h]) => (
            <rect key={x} x={x} y={24 - h / 2} width="5" height={h} rx="2.5" fill="#fff" />
          ))}
        </>
      );
    case "apk":
      return (
        <>
          <path d="M14.5 10.5l-2.6-3.6M33.5 10.5l2.6-3.6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M10 26a14 14 0 0 1 28 0z" fill="#fff" />
          <circle cx="18.5" cy="20.5" r="1.9" fill="var(--ft-b)" />
          <circle cx="29.5" cy="20.5" r="1.9" fill="var(--ft-b)" />
          <rect x="10" y="28.5" width="28" height="12.5" rx="4.5" fill="#fff" />
          <text
            x="24"
            y="38"
            textAnchor="middle"
            fontSize="8"
            fontWeight="800"
            letterSpacing="0.4"
            fill="var(--ft-b)"
            style={{ fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }}
          >
            APK
          </text>
        </>
      );
    case "other":
    default:
      return (
        <Page>
          <circle cx="23.5" cy="21" r="4.6" fill="var(--ft-b)" opacity="0.75" />
          {line(16, 30, 15, 0.4)}
          {line(16, 35, 9, 0.3)}
        </Page>
      );
  }
}

interface FileTypeArtProps extends FileKindInput {
  /** Explicit kind (skips detection). */
  kind?: FileKind;
  className?: string;
  /** Accessible name; decorative (aria-hidden) when omitted. */
  label?: string;
}

export default function FileTypeArt({ kind, fileType, title, mimeType, className = "", label }: FileTypeArtProps) {
  const k = kind ?? resolveFileKind({ fileType, title, mimeType });
  const meta = FILE_KIND_META[k];
  return (
    <span
      className={`ft-tile absolute inset-0 flex items-center justify-center overflow-hidden ${className}`}
      data-kind={k}
      data-testid="file-type-art"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <svg
        viewBox="0 0 48 48"
        className="ft-glyph relative h-[66%] max-h-[72px] w-auto"
        focusable="false"
        aria-hidden="true"
        data-kind-label={meta.label}
      >
        <Glyph kind={k} />
      </svg>
    </span>
  );
}
