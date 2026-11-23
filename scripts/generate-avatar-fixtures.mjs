// Regenerates the real image fixtures used by the avatar tests:  node scripts/generate-avatar-fixtures.mjs
// Images are four coloured quadrants (red TL, green TR, blue BL, yellow BR) so crops can be verified by pixel.
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "src/test/fixtures/avatar");
fs.mkdirSync(dir, { recursive: true });
const COLORS = [[220, 40, 40], [40, 200, 60], [40, 80, 230], [240, 200, 30]];
const make = (w, h) => {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = COLORS[(x < w / 2 ? 0 : 1) + (y < h / 2 ? 0 : 2)];
    const i = (y * w + x) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } });
};
const out = (n) => path.join(dir, n);
await make(1200, 800).jpeg({ quality: 88 }).toFile(out("landscape-1200x800.jpg"));
await make(800, 1200).png().toFile(out("portrait-800x1200.png"));
await make(1000, 1000).webp({ quality: 85 }).toFile(out("square-1000.webp"));
await make(600, 400).jpeg().withMetadata({ orientation: 6 }).toFile(out("exif-rotated-600x400.jpg"));
await make(512, 512).webp({ quality: 90 }).toFile(out("avatar-512.webp"));
await make(512, 512).jpeg({ quality: 90 }).toFile(out("avatar-512.jpg"));
fs.writeFileSync(out("corrupt-truncated.jpg"), fs.readFileSync(out("landscape-1200x800.jpg")).subarray(0, 700));
fs.writeFileSync(out("not-an-image.jpg"), "this is plain text pretending to be a JPEG");
fs.writeFileSync(out("fake-photo.heic"), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(40)]));
fs.writeFileSync(out("fake.gif"), Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(40)]));
fs.writeFileSync(out("empty.jpg"), Buffer.alloc(0));
console.log(fs.readdirSync(dir));
