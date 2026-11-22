/** Structured legal/help text. Plain strings only (rendered as text, never as HTML). */
export type DocBlock =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "note"; text: string };

export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}
