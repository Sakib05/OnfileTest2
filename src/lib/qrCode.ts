/**
 * Tiny QR helper around `qrcode-generator` (MIT, zero dependencies, ships its own types).
 * Everything is computed locally in the browser: the URL never leaves the device.
 *
 * A QR code must stay dark-on-light to be scannable, so callers render it on a white tile in BOTH themes.
 */
import qrcode from "qrcode-generator";

/** Quiet zone (in modules) required around a QR symbol by the spec. */
export const QR_QUIET_ZONE = 4;

export interface QrMatrix {
  /** Modules per side (without the quiet zone). */
  size: number;
  isDark: (row: number, col: number) => boolean;
}

/** Builds the QR matrix for `text` (byte mode, error-correction M, smallest version that fits). */
export function buildQr(text: string): QrMatrix {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  return { size: qr.getModuleCount(), isDark: (r, c) => qr.isDark(r, c) };
}

/** SVG path (viewBox `0 0 N N`, N = size + 2·quiet zone) covering every dark module. */
export function qrSvgPath(qr: QrMatrix, quiet = QR_QUIET_ZONE): { viewBox: number; d: string } {
  let d = "";
  for (let r = 0; r < qr.size; r++) {
    let c = 0;
    while (c < qr.size) {
      if (!qr.isDark(r, c)) {
        c++;
        continue;
      }
      const start = c;
      while (c < qr.size && qr.isDark(r, c)) c++;
      d += `M${start + quiet} ${r + quiet}h${c - start}v1h-${c - start}z`;
    }
  }
  return { viewBox: qr.size + quiet * 2, d };
}

/** Renders a crisp PNG (white background, quiet zone included) and resolves with the Blob. Browser only. */
export function qrToPngBlob(text: string, targetPx = 1024): Promise<Blob> {
  const qr = buildQr(text);
  const total = qr.size + QR_QUIET_ZONE * 2;
  const scale = Math.max(1, Math.floor(targetPx / total));
  const px = total * scale;
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Canvas is not available"));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < qr.size; r++) {
    for (let c = 0; c < qr.size; c++) {
      if (qr.isDark(r, c)) ctx.fillRect((c + QR_QUIET_ZONE) * scale, (r + QR_QUIET_ZONE) * scale, scale, scale);
    }
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't create the image"))), "image/png"));
}

/** A safe file name for the downloaded PNG, derived from the title. */
export function qrFileName(title: string): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `onfile-qr-${base || "file"}.png`;
}
