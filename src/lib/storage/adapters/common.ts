import { sha256Hex } from "../http";
import type { ObjectRef, StorageAdapter, VerifyResult } from "../types";

/** Generic verification: re-download the stored bytes and compare checksum + size. */
export async function verifyByDownload(
  adapter: Pick<StorageAdapter, "downloadForMigration">,
  ref: ObjectRef,
  expected: { checksum: string; size: number }
): Promise<VerifyResult> {
  try {
    const { buffer } = await adapter.downloadForMigration(ref);
    if (buffer.length !== expected.size) {
      return { ok: false, reason: `size_mismatch (expected ${expected.size}, got ${buffer.length})` };
    }
    if (sha256Hex(buffer) !== expected.checksum) return { ok: false, reason: "checksum_mismatch" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `verify_failed: ${err instanceof Error ? err.message : "unknown"}` };
  }
}

export function basicAuth(user: string, pass: string): string {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function mimeFromContentType(h: string | null, fallback: string): string {
  return (h ?? fallback).split(";")[0].trim().toLowerCase() || fallback;
}

export function extForMime(mime: string): string {
  switch (mime) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    default:
      return "jpg";
  }
}
