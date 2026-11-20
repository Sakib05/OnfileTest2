import { describe, expect, it } from "vitest";
import { QR_QUIET_ZONE, buildQr, qrFileName, qrSvgPath } from "./qrCode";
import { fileShareAvailability, fileShareUrl } from "./fileShare";

describe("buildQr", () => {
  const url = "https://onfile-app.vercel.app/f/abc123XYZ";

  it("is deterministic and has the three finder patterns (dark 7×7 rings) in the corners", () => {
    const a = buildQr(url);
    const b = buildQr(url);
    expect(a.size).toBe(b.size);
    expect((a.size - 17) % 4).toBe(0); // valid QR version geometry: 17 + 4·version
    for (const [r0, c0] of [[0, 0], [0, a.size - 7], [a.size - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 7; j++) {
          const ring = i === 0 || i === 6 || j === 0 || j === 6;
          const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
          expect(a.isDark(r0 + i, c0 + j)).toBe(ring || core);
        }
      }
    }
    for (let r = 0; r < a.size; r++) for (let c = 0; c < a.size; c++) expect(a.isDark(r, c)).toBe(b.isDark(r, c));
  });

  it("a different URL gives a different symbol", () => {
    const a = buildQr(url);
    const b = buildQr(`${url}x`);
    let diff = 0;
    for (let r = 0; r < Math.min(a.size, b.size); r++) for (let c = 0; c < Math.min(a.size, b.size); c++) if (a.isDark(r, c) !== b.isDark(r, c)) diff++;
    expect(a.size !== b.size || diff > 0).toBe(true);
  });
});

describe("qrSvgPath", () => {
  it("covers exactly the dark modules inside the quiet zone", () => {
    const qr = buildQr("https://x.test/f/a");
    const { viewBox, d } = qrSvgPath(qr);
    expect(viewBox).toBe(qr.size + QR_QUIET_ZONE * 2);
    let area = 0;
    for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      const [x, y, w] = [Number(m[1]), Number(m[2]), Number(m[3])];
      expect(x).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(y).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(x + w).toBeLessThanOrEqual(QR_QUIET_ZONE + qr.size);
      area += w;
    }
    let dark = 0;
    for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (qr.isDark(r, c)) dark++;
    expect(area).toBe(dark);
  });
});

describe("qrFileName", () => {
  it("is a safe png file name derived from the title", () => {
    expect(qrFileName("My Report: Q1/2025!.pdf")).toBe("onfile-qr-my-report-q1-2025-pdf.png");
    expect(qrFileName("???")).toBe("onfile-qr-file.png");
  });
});

describe("fileShareAvailability", () => {
  it("allows only published files with a slug", () => {
    expect(fileShareAvailability({ isPublished: true, smartLinkSlug: "s1" })).toEqual({ ok: true, path: "/f/s1" });
    expect(fileShareAvailability({ isPublished: false, smartLinkSlug: "s1" })).toMatchObject({ ok: false, reason: "private" });
    expect(fileShareAvailability({ isPublished: null, smartLinkSlug: "s1" })).toMatchObject({ ok: false, reason: "private" });
    expect(fileShareAvailability({ isPublished: true, smartLinkSlug: null })).toMatchObject({ ok: false, reason: "no_link" });
    expect(fileShareAvailability({ isPublished: true, smartLinkSlug: "  " })).toMatchObject({ ok: false, reason: "no_link" });
  });
  it("builds absolute URLs without a double slash", () => {
    expect(fileShareUrl("https://a.test/", { isPublished: true, smartLinkSlug: "s1" })).toBe("https://a.test/f/s1");
  });
});
