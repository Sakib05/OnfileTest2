/**
 * Centralised file-type mapping for Onfile's visual identity.
 *
 * The database only stores a coarse `file_type` enum (video | audio | document |
 * image | archive | other). Creators usually name posts after the file
 * ("Syllabus.pdf") and sometimes a mime type is known, so we refine the enum
 * into a richer `FileKind` (PDF / Word / Excel / PowerPoint / APK …) using, in
 * order: the file-name extension, the mime type, then the coarse enum.
 * Everything unknown falls back to "other" — the UI never fails on a new type.
 *
 * Pure + dependency-free: safe on the server and in the browser, and covered by
 * unit tests. All artwork lives in src/components/ui/FileTypeArt.tsx.
 */

export const FILE_KINDS = [
  "pdf",
  "word",
  "excel",
  "powerpoint",
  "document",
  "image",
  "video",
  "audio",
  "archive",
  "apk",
  "other",
] as const;

export type FileKind = (typeof FILE_KINDS)[number];

export interface FileKindMeta {
  kind: FileKind;
  /** Short human label ("PDF", "Word", …). */
  label: string;
  /** Text printed on the artwork's label band (kinds that have one). */
  badge: string | null;
}

export const FILE_KIND_META: Record<FileKind, FileKindMeta> = {
  pdf: { kind: "pdf", label: "PDF", badge: "PDF" },
  word: { kind: "word", label: "Word", badge: "DOC" },
  excel: { kind: "excel", label: "Excel", badge: "XLS" },
  powerpoint: { kind: "powerpoint", label: "PowerPoint", badge: "PPT" },
  document: { kind: "document", label: "Document", badge: null },
  image: { kind: "image", label: "Image", badge: null },
  video: { kind: "video", label: "Video", badge: null },
  audio: { kind: "audio", label: "Audio", badge: null },
  archive: { kind: "archive", label: "Archive", badge: "ZIP" },
  apk: { kind: "apk", label: "APK", badge: null },
  other: { kind: "other", label: "File", badge: null },
};

const EXTENSIONS: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "word", docx: "word", docm: "word", dot: "word", dotx: "word", odt: "word", rtf: "word", pages: "word",
  xls: "excel", xlsx: "excel", xlsm: "excel", xlsb: "excel", csv: "excel", ods: "excel", numbers: "excel",
  ppt: "powerpoint", pptx: "powerpoint", pps: "powerpoint", ppsx: "powerpoint", odp: "powerpoint", key: "powerpoint",
  txt: "document", md: "document", epub: "document", mobi: "document", log: "document",
  jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image", bmp: "image", svg: "image", heic: "image", tif: "image", tiff: "image", raw: "image", psd: "image",
  mp4: "video", mkv: "video", mov: "video", avi: "video", webm: "video", wmv: "video", flv: "video", m4v: "video", "3gp": "video", ts: "video",
  mp3: "audio", wav: "audio", flac: "audio", aac: "audio", ogg: "audio", oga: "audio", m4a: "audio", opus: "audio", wma: "audio",
  zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", tgz: "archive", bz2: "archive", xz: "archive", iso: "archive",
  apk: "apk", xapk: "apk", apks: "apk", aab: "apk",
};

const MIME_EXACT: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.oasis.opendocument.text": "word",
  "application/rtf": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.oasis.opendocument.spreadsheet": "excel",
  "text/csv": "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
  "application/vnd.oasis.opendocument.presentation": "powerpoint",
  "application/vnd.android.package-archive": "apk",
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
  "application/vnd.rar": "archive",
  "application/x-rar-compressed": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "text/plain": "document",
  "application/epub+zip": "document",
};

const COARSE: Record<string, FileKind> = {
  video: "video",
  audio: "audio",
  document: "document",
  image: "image",
  archive: "archive",
  other: "other",
};

/** Lower-cased extension at the end of a name ("Report v2.PDF " → "pdf"), or null. */
export function extensionOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const m = /\.([a-z0-9]{1,5})\s*$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : null;
}

export interface FileKindInput {
  fileType?: string | null;
  title?: string | null;
  mimeType?: string | null;
}

/** Best-effort kind for a file. Never throws; unknown input → "other". */
export function resolveFileKind(input: FileKindInput | string | null | undefined): FileKind {
  const i: FileKindInput = typeof input === "string" ? { fileType: input } : (input ?? {});
  const coarse = i.fileType ? COARSE[i.fileType.toLowerCase()] : undefined;

  const ext = extensionOf(i.title);
  const byExt = ext ? EXTENSIONS[ext] : undefined;
  // The extension only refines — a creator who picked "Video" for "clip.zip" still sees a video
  // unless the extension is a clear, specific document/app kind.
  if (byExt && (!coarse || coarse === "other" || coarse === "document" || byExt === coarse || SPECIFIC.has(byExt))) return byExt;

  const mime = i.mimeType?.toLowerCase().split(";")[0].trim();
  if (mime) {
    const exact = MIME_EXACT[mime];
    if (exact && (!coarse || coarse === "other" || coarse === "document" || exact === coarse || SPECIFIC.has(exact))) return exact;
    if (!coarse || coarse === "other") {
      if (mime.startsWith("image/")) return "image";
      if (mime.startsWith("video/")) return "video";
      if (mime.startsWith("audio/")) return "audio";
    }
  }
  return coarse ?? "other";
}

/** Kinds specific enough that a matching extension overrides a vague creator-chosen category. */
const SPECIFIC = new Set<FileKind>(["pdf", "word", "excel", "powerpoint", "apk"]);

/** Human label for the kind of a file, e.g. "PDF". */
export function fileKindLabel(input: FileKindInput | string | null | undefined): string {
  return FILE_KIND_META[resolveFileKind(input)].label;
}
