/**
 * Renders the membrane's immutable particulate texture:
 * assets/effects/grain.png — 1024x1024, grayscale, tileable.
 *
 * The membrane shader samples this through the displacement field and
 * darkens multiplicatively (never brightens), so the texture is a
 * bright field carrying dark suspended particulates: value ~1 means
 * "leave the backdrop alone", darker specks read as fine sediment.
 *
 * Seeded and dependency-free (own PNG encoder over zlib), so the
 * committed asset is exactly reproducible: `node tools/effects/render-grain.mjs`.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const SEED = 20260829

// --- seeded PRNG (mulberry32) ------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- tileable value noise ----------------------------------------------------
function makeLattice(n, rand) {
  const g = new Float64Array(n * n)
  for (let i = 0; i < g.length; i += 1) g[i] = rand()
  return g
}

function sampleLattice(g, n, x, y) {
  const x0 = Math.floor(x) % n
  const y0 = Math.floor(y) % n
  const x1 = (x0 + 1) % n
  const y1 = (y0 + 1) % n
  const fx = x - Math.floor(x)
  const fy = y - Math.floor(y)
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = g[y0 * n + x0]
  const b = g[y0 * n + x1]
  const c = g[y1 * n + x0]
  const d = g[y1 * n + x1]
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

// --- compose -----------------------------------------------------------------
const rand = mulberry32(SEED)
const octaves = [
  { n: 8, amp: 0.45, lattice: null },
  { n: 24, amp: 0.3, lattice: null },
  { n: 64, amp: 0.15, lattice: null },
  { n: 160, amp: 0.1, lattice: null },
]
for (const o of octaves) o.lattice = makeLattice(o.n, rand)

const px = new Float64Array(SIZE * SIZE)
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let v = 0
    for (const o of octaves) {
      v += o.amp * sampleLattice(o.lattice, o.n, (x / SIZE) * o.n, (y / SIZE) * o.n)
    }
    // Bright field with gentle undulation: 0.82..1.0 before specks.
    px[y * SIZE + x] = 0.82 + 0.18 * v
  }
}

// Suspended particulates: seeded dark specks, wrap-stamped so the tile
// stays seamless. Sizes span dust to small flecks.
const SPECKS = 52000
for (let s = 0; s < SPECKS; s += 1) {
  const cx = rand() * SIZE
  const cy = rand() * SIZE
  const r = 0.6 + rand() * 1.9
  const depth = 0.25 + rand() * 0.55
  const r2 = r * r
  const span = Math.ceil(r + 1)
  for (let dy = -span; dy <= span; dy += 1) {
    for (let dx = -span; dx <= span; dx += 1) {
      const d2 = dx * dx + dy * dy
      if (d2 > r2 * 2.25) continue
      const fall = Math.exp(-d2 / r2)
      const xx = (((Math.round(cx) + dx) % SIZE) + SIZE) % SIZE
      const yy = (((Math.round(cy) + dy) % SIZE) + SIZE) % SIZE
      px[yy * SIZE + xx] -= depth * fall
    }
  }
}

const bytes = new Uint8Array(SIZE * SIZE)
for (let i = 0; i < px.length; i += 1) {
  bytes[i] = Math.max(0, Math.min(255, Math.round(px[i] * 255)))
}

// --- PNG encode (grayscale 8-bit, filter 0) ----------------------------------
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length)
  return out
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 0 // grayscale
const raw = Buffer.alloc(SIZE * (SIZE + 1))
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE + 1)] = 0
  Buffer.from(bytes.buffer, y * SIZE, SIZE).copy(raw, y * (SIZE + 1) + 1)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', '..', 'assets', 'effects', 'grain.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out} (${png.length} bytes)`)
