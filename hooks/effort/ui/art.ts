import type { RasterProps } from 'claude-code'
import type { Effort } from '../types'

// Terminal: a `▀` Raster (two pixels per cell). Desktop and mobile: an Svg animated by CSS.

export const ART_COLUMNS = 24
export const ART_ROWS = 3
export const ART_MIN_WIDTH = 90
export const ART_FRAME_MS = 100

export type ArtKind = 'still' | 'judging' | 'agents' | 'viewing'
export type RasterCells = RasterProps['cells']

export const MOVING: ReadonlySet<ArtKind> = new Set(['judging', 'agents', 'viewing'])

export const EFFORT_COLOR: Record<string, string> = { low: '#8b948c', medium: '#4fb5a5', high: '#6fa0ff', xhigh: '#b38cff', max: '#ff8a5c' }
// The band's frame and text on the terminal (effortless's dashboard colors), and its blue form while viewing an agent.
export const BAND_BG = '#11376b'
export const BAND_EDGE = '#3a78c4'
export const BAND_TEXT = '#e6f0fb'
export const VIEW_BG = '#0f1a22'
export const VIEW_EDGE = '#2f5a7a'
export const VIEW_TEXT = '#8fb4ff'
export const CARD_EDGE = '#3a3a40'
export const WAIT_BG = '#4a3d12'
export const WAIT_TEXT = '#ffd166'
export const MODEL_COLOR: Record<string, string> = { opus: '#c4a3ff', fable: '#ff9f6e', sonnet: '#5fd4c0', haiku: '#9ad1ff' }
export const STATE_COLOR: Record<string, string> = { running: '#f2c14e', done: '#5cc779', error: '#ff6b7a' }
const GROUND = BAND_BG
// The scene: a night sky shading down to the horizon, a lit edge, then the ground.
const SKY_TOP = '#071a3a'
const SKY_LOW = '#2a7fd4'
const HORIZON = '#7cc4ff'
export type Critter = { color: string; waiting: boolean }

/** Cells a terminal Button takes: `[ label ]`, or `k: label` for a plain one with a hotkey. */
export const buttonCells = (label: string, plain: boolean, hotkey?: string) => [...label].length + (plain ? (hotkey ? 3 : 0) : 4)

/** A band's frame: on the terminal the dashboard's dark box, elsewhere the plain round border it always had. */
export const frame = (term: boolean, bg = BAND_BG, edge = BAND_EDGE) =>
  term ? { paddingX: 1, borderStyle: 'round', backgroundColor: bg, borderColor: edge } : { paddingX: 1, borderStyle: 'round' }
const LIGHT = '#e8f0ff'
const BLUE = '#2f6fd0'
const H = ART_ROWS * 2

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const mix = (a: string, b: string, k: number) => {
  const [x, y] = [rgb(a), rgb(b)]
  return x.map((v, i) => Math.round(v + (y[i] - v) * k)).reduce((n, v) => (n << 8) | v, 0) >>> 0
}
const pack = (h: string) => mix(h, h, 0)

// A 5x4 critter standing on the horizon; it walks right swapping legs, and a waiting one stops with an arm up.
const BODY = ['.bbb.', 'bebeb', 'bbbbb']
const LEGS = ['b.b.b', '.b.b.']
const SLOT = 6

function sky(y: number) {
  return y === H - 1 ? pack(GROUND) : y === H - 2 ? pack(HORIZON) : mix(SKY_TOP, SKY_LOW, y / (H - 3))
}

function critterAt(t: number, x: number, y: number, crew: readonly Critter[]): number | undefined {
  for (let i = 0; i < crew.length; i++) {
    const c = crew[i]!
    const step = c.waiting ? 0 : Math.floor(t / 3)
    const left = (i * SLOT + step) % ART_COLUMNS
    const dx = (x - left + ART_COLUMNS) % ART_COLUMNS
    const dy = y - (H - 2 - 4)
    if (dx > 4 || dy < 0 || dy > 3) continue
    const row = dy === 0 && c.waiting ? '.bbbb' : dy < 3 ? BODY[dy]! : LEGS[step % 2]!
    const ch = row[dx]
    if (ch === 'b') return pack(c.color)
    if (ch === 'e') return pack(c.waiting ? '#ffd166' : '#ffffff')
  }
  return undefined
}

function pixel(kind: ArtKind, t: number, x: number, y: number, crew: readonly Critter[]): number {
  if (kind === 'viewing') return mix(GROUND, BLUE, 0.55 + 0.35 * Math.sin(t / 10))
  if (kind === 'judging') {
    for (let i = 0; i < 3; i++) {
      const head = (t + i * 6) % (ART_COLUMNS + 3)
      const lane = (i * 3) % (H - 2)
      if (y === lane && x <= head && head - x < 3) return mix(SKY_TOP, LIGHT, 1 - (head - x) / 3)
    }
  }
  if (kind === 'agents') return critterAt(t, x, y, crew) ?? sky(y)
  return sky(y)
}

/** One frame as Raster cells: base64 of u32 `[codePoint, top, bottom]` triples, row by row. */
export function rasterFrame(kind: ArtKind, frame: number, crew: readonly Critter[]): RasterCells {
  const words = new Uint32Array(ART_COLUMNS * ART_ROWS * 3)
  for (let row = 0; row < ART_ROWS; row++)
    for (let x = 0; x < ART_COLUMNS; x++) {
      const i = (row * ART_COLUMNS + x) * 3
      words[i] = 0x2580 // ▀: foreground is the top pixel, background the bottom
      words[i + 1] = pixel(kind, frame, x, row * 2, crew)
      words[i + 2] = pixel(kind, frame, x, row * 2 + 1, crew)
    }
  return (new Uint8Array(words.buffer) as Uint8Array & { toBase64(): string }).toBase64()
}

export function svgSource(kind: ArtKind, dots: Effort[]): string {
  const run = (c: string, y: number, s: number, delay: number) =>
    `<circle class="run" cx="0" cy="${y + 0.5}" r="0.5" fill="${c}" style="animation-duration:${s}s;animation-delay:${delay}s"/>`
  const body =
    kind === 'viewing' ? `<rect class="pulse" width="16" height="4" fill="${BLUE}"/>`
    : kind === 'judging' ? [0, 1, 2].map(i => run(LIGHT, (i * 3) % H, 1.6, i * 0.5)).join('')
    : kind === 'agents' ? dots.map((d, i) => run(EFFORT_COLOR[d], i % 4, 3, -i * 0.7)).join('')
    : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="24" viewBox="0 0 16 4" preserveAspectRatio="none">` +
    `<style>.run{animation:run linear infinite}@keyframes run{from{transform:translateX(-1px)}to{transform:translateX(17px)}}` +
    `.pulse{animation:pulse 2.4s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:.55}50%{opacity:.9}}</style>` +
    `<rect width="16" height="4" rx="0.6" fill="${GROUND}"/>${body}</svg>`
  )
}
