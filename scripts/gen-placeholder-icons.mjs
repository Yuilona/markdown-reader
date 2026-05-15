// Generates placeholder PNG icons for src-tauri/icons/.
// PR-1 only needs them to satisfy Tauri bundler config; real branding lands later.
// Uses zero deps (Node built-in zlib + Buffer). Produces a solid dark-gray
// square with a white "M" letter via simple pixel painting.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, '..', 'src-tauri', 'icons');
mkdirSync(iconsDir, { recursive: true });

// CRC table for PNG.
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// Render a "M" letter shape into a size×size RGBA pixel grid.
// Background: dark gray (#2d2d2d). Letter: white.
function paintIcon(size) {
  const bgR = 45, bgG = 45, bgB = 45;
  const fgR = 255, fgG = 255, fgB = 255;
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      px[idx] = bgR;
      px[idx + 1] = bgG;
      px[idx + 2] = bgB;
      px[idx + 3] = 255;
    }
  }

  // Draw a stylized "M": two vertical strokes + a V in the middle.
  // All dimensions are fractions of size so it scales.
  const padX = Math.floor(size * 0.22);
  const padY = Math.floor(size * 0.22);
  const innerW = size - padX * 2;
  const innerH = size - padY * 2;
  const strokeW = Math.max(1, Math.floor(size * 0.10));
  const left = padX;
  const right = size - padX - strokeW;

  // Vertical strokes.
  for (let y = padY; y < padY + innerH; y++) {
    for (let dx = 0; dx < strokeW; dx++) {
      const lx = left + dx;
      const rx = right + dx;
      const i1 = (y * size + lx) * 4;
      const i2 = (y * size + rx) * 4;
      px[i1] = fgR; px[i1 + 1] = fgG; px[i1 + 2] = fgB;
      px[i2] = fgR; px[i2 + 1] = fgG; px[i2 + 2] = fgB;
    }
  }

  // The "V" middle part: two diagonals from top-corners meeting near vertical center.
  const apexY = padY + Math.floor(innerH * 0.55);
  const topY = padY;
  const slopeLen = apexY - topY;
  for (let step = 0; step <= slopeLen; step++) {
    const y = topY + step;
    const xL = left + strokeW + Math.floor((innerW - strokeW * 2) * (step / slopeLen) * 0.5);
    const xR = right - Math.floor((innerW - strokeW * 2) * (step / slopeLen) * 0.5);
    for (let dx = 0; dx < strokeW; dx++) {
      const xLp = xL + dx;
      const xRp = xR + dx;
      if (xLp >= 0 && xLp < size) {
        const i = (y * size + xLp) * 4;
        px[i] = fgR; px[i + 1] = fgG; px[i + 2] = fgB;
      }
      if (xRp >= 0 && xRp < size) {
        const i = (y * size + xRp) * 4;
        px[i] = fgR; px[i + 1] = fgG; px[i + 2] = fgB;
      }
    }
  }
  return px;
}

function encodePng(size) {
  const px = paintIcon(size);
  const stride = size * 4;
  // Apply filter byte 0 (None) per scanline.
  const filtered = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    filtered[y * (stride + 1)] = 0;
    px.subarray(y * stride, y * stride + stride).forEach((v, i) => {
      filtered[y * (stride + 1) + 1 + i] = v;
    });
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const idat = deflateSync(filtered);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Standard set Tauri/MSI bundler expects:
const targets = [
  { name: '32x32.png', size: 32 },
  { name: '128x128.png', size: 128 },
  { name: '128x128@2x.png', size: 256 },
];

for (const { name, size } of targets) {
  const png = encodePng(size);
  writeFileSync(join(iconsDir, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}

// Build a minimal .ico file that contains the 32x32 PNG (Vista+ ICO supports
// PNG-encoded entries). This is a placeholder; PR-9 will replace with proper
// multi-resolution ico.
{
  const png32 = encodePng(32);
  const ico = Buffer.alloc(6 + 16);
  ico.writeUInt16LE(0, 0); // reserved
  ico.writeUInt16LE(1, 2); // type 1 = ICO
  ico.writeUInt16LE(1, 4); // 1 image
  // Directory entry
  ico[6] = 32; // width  (0 = 256, here 32)
  ico[7] = 32; // height
  ico[8] = 0;  // color count
  ico[9] = 0;  // reserved
  ico.writeUInt16LE(1, 10);  // planes
  ico.writeUInt16LE(32, 12); // bpp
  ico.writeUInt32LE(png32.length, 14); // size
  ico.writeUInt32LE(6 + 16, 18);       // offset
  const icoFinal = Buffer.concat([ico, png32]);
  writeFileSync(join(iconsDir, 'icon.ico'), icoFinal);
  console.log(`wrote icon.ico (${icoFinal.length} bytes)`);
}
