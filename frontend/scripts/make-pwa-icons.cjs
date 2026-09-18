const { deflateSync } = require("zlib");
const { writeFileSync, mkdirSync } = require("fs");
const { dirname } = require("path");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = row + 1 + x * 4;
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
      raw[o + 3] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function fill(px, w, h, x0, y0, x1, y1, r, g, b, a = 255) {
  const xa = Math.max(0, Math.floor(x0));
  const ya = Math.max(0, Math.floor(y0));
  const xb = Math.min(w, Math.ceil(x1));
  const yb = Math.min(h, Math.ceil(y1));
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * w + x) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
    }
  }
}

function roundRect(px, w, h, x, y, rw, rh, rad, r, g, b) {
  for (let yy = 0; yy < rh; yy++) {
    for (let xx = 0; xx < rw; xx++) {
      const dx = xx < rad ? rad - xx : xx > rw - rad - 1 ? xx - (rw - rad - 1) : 0;
      const dy = yy < rad ? rad - yy : yy > rh - rad - 1 ? yy - (rh - rad - 1) : 0;
      if (dx && dy && dx * dx + dy * dy > rad * rad) continue;
      const gx = x + xx;
      const gy = y + yy;
      if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
      const i = (gy * w + gx) * 4;
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
}

function drawIN(px, w, h, pad) {
  const s = w - pad * 2;
  const x = pad;
  const y = pad;
  roundRect(px, w, h, 0, 0, w, h, Math.round(w * 0.14), 0x1b, 0x36, 0x5d);
  const unit = s / 64;
  const white = (ax, ay, bx, by) => fill(px, w, h, x + ax * unit, y + ay * unit, x + bx * unit, y + by * unit, 242, 243, 245);
  white(16, 20, 25, 44);
  white(28, 20, 35, 32);
  white(32, 28, 39, 44);
  white(42, 20, 51, 44);
  white(35, 20, 42, 24);
}

function drawMaskable(px, w, h) {
  fill(px, w, h, 0, 0, w, h, 0x1b, 0x36, 0x5d);
  const inner = Math.round(w * 0.72);
  const pad = Math.round((w - inner) / 2);
  const tmp = Buffer.alloc(inner * inner * 4);
  drawIN(tmp, inner, inner, 0);
  for (let yy = 0; yy < inner; yy++) {
    for (let xx = 0; xx < inner; xx++) {
      const si = (yy * inner + xx) * 4;
      const di = ((yy + pad) * w + (xx + pad)) * 4;
      px[di] = tmp[si];
      px[di + 1] = tmp[si + 1];
      px[di + 2] = tmp[si + 2];
      px[di + 3] = tmp[si + 3];
    }
  }
}

function save(path, w, h, maskable) {
  const px = Buffer.alloc(w * h * 4);
  if (maskable) drawMaskable(px, w, h);
  else drawIN(px, w, h, 0);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(w, h, px));
}

const root = require("path").join(__dirname, "..", "public");
save(`${root}/icons/icon-192.png`, 192, 192, false);
save(`${root}/icons/icon-512.png`, 512, 512, false);
save(`${root}/icons/icon-maskable-512.png`, 512, 512, true);
save(`${root}/apple-touch-icon.png`, 180, 180, false);
console.log("PWA icons written");
