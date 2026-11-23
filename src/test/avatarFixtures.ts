import fs from "node:fs";
import path from "node:path";

/** Real image fixtures (regenerate with `node scripts/generate-avatar-fixtures.mjs`). */
export function fixture(name: string): Buffer {
  return fs.readFileSync(path.join(process.cwd(), "src/test/fixtures/avatar", name));
}

export function fixtureFile(name: string, type: string): File {
  const buf = fixture(name);
  return new File([new Uint8Array(buf)], name, { type });
}
