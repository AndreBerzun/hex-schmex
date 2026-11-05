// Minimal PNG encoder (8-bit RGB(A) and 16-bit grayscale). The deflate step is injected so it works
// in Node (zlib) and the browser (CompressionStream).

export type Deflate = (data: Uint8Array) => Promise<Uint8Array>;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

async function encode(width: number, height: number, bitDepth: number, colorType: number, bpp: number, rows: (y: number, line: Uint8Array) => void, deflate: Deflate) {
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    rows(y, line);
    raw[y * (stride + 1)] = 0; // filter: none
    raw.set(line, y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const idat = await deflate(raw);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 16-bit grayscale PNG from normalised values 0..1. */
export function encodeGray16(width: number, height: number, values: ArrayLike<number>, deflate: Deflate) {
  return encode(width, height, 16, 0, 2, (y, line) => {
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(65535, Math.round(values[y * width + x] * 65535)));
      line[x * 2] = v >> 8;
      line[x * 2 + 1] = v & 255;
    }
  }, deflate);
}

/** 8-bit RGB PNG from RGBA bytes. */
export function encodeRGB8(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray, deflate: Deflate) {
  return encode(width, height, 8, 2, 3, (y, line) => {
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      line[x * 3] = rgba[k];
      line[x * 3 + 1] = rgba[k + 1];
      line[x * 3 + 2] = rgba[k + 2];
    }
  }, deflate);
}

export const browserDeflate: Deflate = async (data) => {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([data]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
