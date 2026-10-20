import type { EngineInterface, RenderInput, Timer } from 'claude-code'
import { runCommand } from '../commands'
import { BAR, CARDS, CARDS_HOME, helpLines, shownRows, type Row, type Settings } from '../settings'
import { family, stripTag } from '../roles'
import { agents, live, main, ui } from '../state'
import { isEffort } from '../types'
import { saveDraft, settingRow } from './pane'
import { cells, redraw, snapshot, toast, whyText } from './status'
import {
  ART_COLUMNS, ART_FRAME_MS, ART_MIN_WIDTH, ART_ROWS, BAND_BG, BAND_TEXT, buttonCells, CARD_EDGE, EFFORT_COLOR, frame, MODEL_COLOR, MOVING, rasterFrame, svgSource,
  VIEW_TEXT, WAIT_TEXT, type ArtKind, type Critter,
} from './art'
import { took } from './row'
import { change, renderViewing } from './viewing'
import { t } from './text'

const HOVER = '#1d4f8f'
const STATE_DONE = '#6fe3a1'
const SHOWN = 4

export function barForm(): Settings['bar'] {
  const bar = main.settings.bar
  return bar === 'fold' && main.judgeDown ? 'open' : bar
}

export function press($: EngineInterface, args: string) {
  return () => void runCommand($, args).then(r => {
    if (r.failed) toast($, r.text)
    redraw($)
  })
}

const look = (term: boolean, id: string, hotkey?: string) =>
  term ? (hotkey ? { hotkey } : {}) : { hover: { scope: `pstack:${id}`, backgroundColor: HOVER } }

// One art timer; it stops on fold, hide, motion none, narrow, nothing moving, a refused blit, and session.start.
let artTimer: Timer | undefined
let artSite: string | undefined
let artFrame = 0

function stopArt() {
  artTimer?.cancel()
  artTimer = undefined
  artSite = undefined
}

export function resetArt() {
  stopArt()
  flashWord = flashAt = undefined
}

const dots = () => agents.all().filter(live).map(r => r.sent ?? r.decided?.effort).filter(isEffort).slice(0, ART_COLUMNS)
// One critter per live agent, as many as the scene holds, coloured by model.
const crew = (): Critter[] =>
  agents.all().filter(r => r.status === 'running').slice(0, 4).map(r => ({ color: MODEL_COLOR[family(r.model) ?? ''] ?? EFFORT_COLOR[r.sent ?? ''] ?? BAND_TEXT, waiting: !!r.waiting }))

function artKind(columns: number): ArtKind | undefined {
  const s = main.settings
  if (s.motion !== 'normal' || barForm() !== 'open' || columns < ART_MIN_WIDTH) return undefined
  if (ui.viewing) return 'viewing'
  if (!s.auto) return undefined
  if (main.judging || agents.all().some(r => r.status === 'judging')) return 'judging'
  return agents.all().some(live) ? 'agents' : undefined
}

function bandArt($: EngineInterface, e: RenderInput<'AbovePrompt'>, term: boolean) {
  const columns = e.props.bodyColumns
  const kind = artKind(columns)
  if (!kind) return null
  const els = $.ui.resolve(e)
  if (!term) {
    if (!('Svg' in els)) return null
    const { Box, Svg } = els
    return <Box key="art-box" flexShrink={0}><Svg source={svgSource(kind, dots())} alt="pstack" width={96} height={24} /></Box>
  }
  if (!('Raster' in els)) return null
  const { Box, Raster } = els
  if (MOVING.has(kind)) {
    artSite = e.requestId
    if (!artTimer) {
      try {
        artTimer = $.clock.every(ART_FRAME_MS, () => {
          const now = artKind(columns)
          if (!artSite || !now || !MOVING.has(now)) return stopArt()
          artFrame++
          const mine = artTimer   // so a late refusal cannot stop a newer timer
          const stopMine = () => artTimer === mine && stopArt()
          void $.ui.blit({ requestId: artSite, key: 'art', cells: rasterFrame(now, artFrame, crew()) })
            .then(r => r.deny && stopMine())
            .catch(stopMine)
        })
      } catch {
        artTimer = undefined   // no clock: show a still picture
      }
    }
  }
  return (
    <Box key="art-box" flexShrink={0}>
      <Raster key="art" columns={ART_COLUMNS} rows={ART_ROWS} cells={rasterFrame(kind, artFrame, crew())} />
    </Box>
  )
}

// [ms since the change, share mixed toward white]; 0 is the render that saw the change.
const FLASH_STEPS = [[0, 1], [100, 0.6], [250, 0.3], [500, 0]] as const
let flashWord: string | undefined
let flashAt: number | undefined

function effortColor($: EngineInterface, word: string | undefined, judging: boolean): string | undefined {
  const base = EFFORT_COLOR[word ?? '']
  const now = Date.now()
  if (!judging && word !== flashWord) {
    if (flashWord && word && main.settings.motion !== 'none') {
      flashAt = now
      try {
        for (const [at] of FLASH_STEPS) if (at) $.clock.after(at, () => $.ui.invalidate('ui.render'))
      } catch {
        // no UI or clock here (e.g. -p); never fail the hook
      }
    }
    flashWord = word
  }
  const since = flashAt === undefined ? Infinity : now - flashAt
  const k = [...FLASH_STEPS].reverse().find(([at]) => since >= at)?.[1] ?? 0
  if (!k || !base || main.settings.motion === 'none') return base
  const ch = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(ch(base, i) + (255 - ch(base, i)) * k).toString(16).padStart(2, '0')).join('')}`
}

// Terminal look per slot (effortless's dashboard); a slot not listed is a quiet plain button.
const SLOT_LOOK: Record<string, (s: Settings) => object> = {
  auto: s => (s.auto ? { variant: 'primary' } : { plain: true, dimColor: true }),
  judge: () => ({ plain: true, dimColor: true }),
}

const isPlain = (id: string) => 'plain' in (SLOT_LOOK[id]?.(main.settings) ?? { plain: true })
// The terminal draws a plain button's hotkey as "g: Agents", so only bracketed buttons carry one; the help card lists the rest.
const keyOf = (b: { id: string; hotkey?: string }) => (isPlain(b.id) ? undefined : b.hotkey)

function visibleSlots() {
  const shown = BAR.filter(b => !b.when || b.when(main.settings))
  // "…" takes the room of one button, so with a single overflow show all and skip "…".
  const fold = shown.length > SHOWN + 1
  return { fold, list: ui.more || !fold ? shown : shown.slice(0, SHOWN) }
}

/** Cells the terminal band's buttons take, gaps included. */
function slotCells(): number {
  const { fold, list } = visibleSlots()
  const each = list.map(b => buttonCells(b.label(main.settings), isPlain(b.id), keyOf(b)))
  return [...each, ...(fold ? [1] : [])].reduce((n, w) => n + w + 1, -1)
}

function slots($: EngineInterface, e: RenderInput<'AbovePrompt'>, term: boolean) {
  const { Button } = $.ui.resolve(e)
  const s = main.settings
  const { fold, list } = visibleSlots()
  return [
    ...list.map(b => (
      <Button key={`bar:${b.id}`} {...look(term, b.id, keyOf(b))} {...(term ? SLOT_LOOK[b.id]?.(s) ?? { plain: true } : { variant: b.id === 'auto' && s.auto ? 'primary' : undefined })}
        onPress={press($, b.press)}>
        {b.label(s)}
      </Button>
    )),
    fold && <Button key="bar:more" {...look(term, 'more')} plain={term || undefined} onPress={() => change($, { more: !ui.more })}>{ui.more ? '‹' : '…'}</Button>,
  ]
}

const running = () => agents.all().filter(live)
function dotsOf($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const { Text } = $.ui.resolve(e)
  return running().map(r => <Text key={`dot:${r.toolUseId}`} color={EFFORT_COLOR[r.sent ?? r.decided?.effort ?? '']}>●</Text>)
}

/** Each live agent: its model-coloured mark, name and what it does now. */
function doingLine($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const { Text } = $.ui.resolve(e)
  return (
    <Text wrap="truncate">
      {running().map((r, i) => (
        <Text key={`doing:${r.toolUseId}`}>
          {i > 0 ? <Text dimColor> · </Text> : null}
          <Text color={r.waiting ? WAIT_TEXT : MODEL_COLOR[family(r.model) ?? ''] ?? BAND_TEXT}>{r.waiting ? '?' : '●'} </Text>
          <Text dimColor>{stripTag(r.description)} </Text>
          <Text color={r.waiting ? WAIT_TEXT : VIEW_TEXT}>{r.waiting ? 'approval' : r.doing?.verb ?? 'starting'}</Text>
        </Text>
      ))}
    </Text>
  )
}

/** Terminal: two lines (what the main effort is, then why) with the art on the right, as effortless's terminalBand. */
function terminalBand($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const { Box, Text } = $.ui.resolve(e)
  const snap = snapshot()
  const phase = snap.phase && `${snap.phase.name} ${snap.phase.index}/${snap.phase.total}`
  const where = [snap.skill, phase].filter(Boolean).join(' › ')
  const n = running().length
  const waiting = running().filter(r => r.waiting).length
  const art = bandArt($, e, true)
  const buttons = slots($, e, true)
  // Buttons share the first line only when it holds them whole; else they get a row of their own that wraps.
  // Each part and the gap after it, then the spacer's other gap.
  // The name shows only when nothing else would: the skill and the effort say whose band it is.
  const name = !where && !snap.main ? '✦ pstack' : undefined
  const head = [name, where, where && snap.main && '·', snap.model, snap.main].filter(Boolean).reduce((sum, part) => sum + cells(part ?? '') + 1, 1)
  const inline = head + slotCells() + (art ? ART_COLUMNS + 1 : 0) <= e.props.bodyColumns - 4
  return (
    // The art is two rows tall, as the text: top-align so they share rows.
    <Box key="bar" flexDirection="row" columnGap={1} alignItems="flex-start" {...frame(true)}>
      <Box key="bar:text" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box key="bar:head" flexDirection="row" columnGap={1}>
          {name ? <Box flexShrink={0}><Text color={BAND_TEXT} bold>{name}</Text></Box> : null}
          {where ? <Box flexShrink={1} minWidth={0}><Text color={BAND_TEXT} bold wrap="truncate">{where}</Text></Box> : null}
          {snap.main ? (
            <Box flexShrink={0} flexDirection="row" columnGap={1}>
              {where ? <Text dimColor>·</Text> : null}
              {snap.model ? <Text dimColor>{snap.model}</Text> : null}
              <Text color={effortColor($, snap.main, snap.auto === 'judging')} bold>{snap.main}</Text>
            </Box>
          ) : null}
          {waiting > 0 && <Box flexShrink={0}><Text color={WAIT_TEXT}>· {waiting} waiting</Text></Box>}
          {inline && <Box flexGrow={1} />}
          {inline && buttons}
        </Box>
        <Box key="bar:why" flexDirection="row">
          {n > 0 ? <Box flexShrink={1} minWidth={0}>{doingLine($, e)}</Box> : <Box flexShrink={1} minWidth={0}><Text dimColor wrap="truncate">{whyText()}</Text></Box>}
        </Box>
        {!inline && <Box key="bar:buttons" flexDirection="row" flexWrap="wrap" columnGap={1} justifyContent="flex-end">{buttons}</Box>}
      </Box>
      {art}
    </Box>
  )
}

/** Desktop and mobile keep their one-row band. */
function controlBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, term: boolean) {
  const { Box, Text } = $.ui.resolve(e)
  const snap = snapshot()
  const where = [snap.skill, snap.phase?.name].filter(Boolean).join(' › ')
  return (
    <Box key="bar" flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center" paddingX={1} borderStyle="round">
      <Box key="bar:text" flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} columnGap={1}>
        <Text bold>pstack</Text>
        {where ? <Text wrap="truncate">{where}</Text> : null}
        <Text>·{snap.model ? ` ${snap.model}` : ''}</Text>
        <Text color={effortColor($, snap.main, snap.auto === 'judging')} bold>{snap.main ?? '?'}</Text>
        {snap.auto === 'judging' && <Text dimColor>{t('band.judging')}</Text>}
        {snap.auto === 'down' && <Text color="red">{t('band.judgeDown')}</Text>}
      </Box>
      {slots($, e, term)}
      {bandArt($, e, term)}
    </Box>
  )
}

function foldBand($: EngineInterface, e: RenderInput<'AbovePrompt'>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const snap = snapshot()
  const auto = main.settings.auto
  const n = running().length
  return (
    <Box key="bar" flexDirection="row" flexWrap="wrap" columnGap={1} paddingX={1} backgroundColor={BAND_BG}>
      <Text color={BAND_TEXT} bold>✦ pstack</Text>
      {snap.model ? <Text dimColor>{snap.model.split(' ')[0]}</Text> : null}
      <Text color={effortColor($, snap.main, snap.auto === 'judging')} bold>{snap.main ?? '—'}</Text>
      <Text dimColor>·</Text>
      <Text color={auto ? BAND_TEXT : undefined} dimColor={!auto}>Auto {auto ? 'on' : 'off'}</Text>
      {n > 0 && <Text dimColor>·</Text>}
      {n > 0 && <Box key="bar:dots" flexDirection="row">{dotsOf($, e)}</Box>}
      <Button key="bar:open" plain onPress={press($, 'bar open')}>▸</Button>
    </Box>
  )
}

/** After a skill's turn: one quiet line on what ran; ▸ brings the band back. */
function restBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, rest: NonNullable<typeof ui.rest>) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const snap = snapshot()
  return (
    <Box key="bar" flexDirection="row" columnGap={1} paddingX={1} backgroundColor={BAND_BG}>
      <Text color={STATE_DONE}>✦</Text>
      <Box flexShrink={1} minWidth={0}>
        <Text color={BAND_TEXT} wrap="truncate">
          pstack · done · {rest.skill} {took(rest.ms)}{rest.agents ? ` · ${rest.agents} agent${rest.agents > 1 ? 's' : ''}` : ''}{snap.model ? ` · ${snap.model}` : ''}
        </Text>
      </Box>
      {snap.main ? <Text color={EFFORT_COLOR[snap.main]}>{snap.main}</Text> : null}
      <Box flexGrow={1} />
      <Text dimColor>Auto {main.settings.auto ? 'on' : 'off'}</Text>
      <Button key="bar:rest" plain onPress={() => change($, { rest: undefined })}>▸</Button>
    </Box>
  )
}

function hintBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, term: boolean) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box key="hint" flexDirection="row" flexWrap="wrap" columnGap={1} {...frame(term)}>
      {term && <Text color={BAND_TEXT} bold>✦ pstack</Text>}
      <Text dimColor={term}>{t('hint.text')}</Text>
      <Box flexGrow={1} />
      <Button key="hint:open" {...look(term, 'hint:open', 'g')} variant="primary" onPress={press($, 'panel')}>{t('hint.open')}</Button>
      <Button key="hint:close" {...look(term, 'hint:close')} plain={term || undefined} role="dismiss" onPress={() => change($, { hint: false })}>✕</Button>
    </Box>
  )
}

/** Settings: the overview of the cards side by side (four in a row when each gets CARD_MIN columns, else two), or one card's rows. */
const CARD_MIN = 18
function cardsBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, term: boolean) {
  const els = $.ui.resolve(e)
  const { Box, Text, Button } = els
  const s = main.settings
  const home = ui.card === CARDS_HOME
  const open = CARDS.find(c => c.id === ui.card) ?? CARDS[0]
  const save = async () => {
    if (await saveDraft($)) change($, { card: undefined })
  }
  const help = <Button key="cards:help" {...look(term, 'cards:help')} plain={term || undefined} onPress={() => change($, { help: true })}>?</Button>
  const saveButton = <Button key="cards:save" {...look(term, 'cards:save')} variant="primary" onPress={() => void save()}>{t('save')}</Button>
  const close = (
    <Button key="cards:close" {...look(term, 'cards:close')} plain={term || undefined} role="dismiss" onPress={() => change($, { card: undefined, draft: {} })}>✕</Button>
  )
  const shown = shownRows(open, s)
  const rows = shown.length ? shown.map(r => settingRow($, els, r, term ? labelWidth(shown) : undefined)) : [<Text dimColor>{open.summary(s)}</Text>]
  if (!term) {
    return (
      <Box key="cards" flexDirection="column" paddingX={1} borderStyle="round">
        <Box key="cards:row" flexDirection="row" flexWrap="wrap" columnGap={1}>
          {CARDS.map(c => (
            <Button key={`card:${c.id}`} {...look(term, `card:${c.id}`)} variant={c === open ? 'primary' : undefined} onPress={() => change($, { card: c.id })}>
              {c.icon} {t(c.title)} <Text dimColor>{c.summary(s)}</Text>
            </Button>
          ))}
          {help}
          {saveButton}
          {close}
        </Box>
        {rows}
      </Box>
    )
  }
  // Inside the frame: border and padding take 4 columns; the cards are 1 column apart.
  const room = e.props.bodyColumns - 4
  const perRow = (room - 3) / 4 >= CARD_MIN ? 4 : (room - 1) / 2 >= CARD_MIN ? 2 : 1
  const width = Math.floor((room - (perRow - 1)) / perRow)
  // Too narrow for two: one line per card, no borders, so the band stays short.
  const card = (c: (typeof CARDS)[number]) =>
    perRow === 1 ? (
      <Box key={`card:${c.id}:box`} flexDirection="row" columnGap={1}>
        <Button key={`card:${c.id}`} plain onPress={() => change($, { card: c.id })}><Text color={BAND_TEXT} bold>{c.icon} {t(c.title)}</Text></Button>
        <Box flexShrink={1} minWidth={0}><Text dimColor wrap="truncate">{c.summary(s)}</Text></Box>
      </Box>
    ) : (
      <Box key={`card:${c.id}:box`} flexDirection="column" width={width} flexGrow={1} paddingX={1} borderStyle="round" borderColor={CARD_EDGE}>
        <Button key={`card:${c.id}`} plain onPress={() => change($, { card: c.id })}>
          <Text color={BAND_TEXT} bold>{c.icon} {t(c.title)}</Text>
        </Button>
        <Text dimColor wrap="truncate">{c.summary(s)}</Text>
      </Box>
    )
  return (
    <Box key="cards" flexDirection="column" {...frame(true)}>
      <Box key="cards:head" flexDirection="row" columnGap={1}>
        {home ? <Text color={BAND_TEXT} bold>✦ pstack</Text> : <Text color={BAND_TEXT} bold>{open.icon} {t(open.title)}</Text>}
        <Box flexShrink={1} minWidth={0}><Text dimColor wrap="truncate">{home ? t('settings') : open.summary(s)}</Text></Box>
        <Box flexGrow={1} />
        {!home && <Button key="cards:back" plain onPress={() => change($, { card: CARDS_HOME })}>←</Button>}
        {help}
        {saveButton}
        {close}
      </Box>
      {home ? (
        <Box key="cards:row" flexDirection={perRow === 1 ? 'column' : 'row'} flexWrap="wrap" columnGap={1}>{CARDS.map(card)}</Box>
      ) : rows}
    </Box>
  )
}

const labelWidth = (rows: readonly Row[]) => Math.max(...rows.map(r => t(r.label).length)) + 3   // room for " *"

function helpCard($: EngineInterface, e: RenderInput<'AbovePrompt'>, term: boolean) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box key="help" flexDirection="column" {...frame(term)}>
      <Box key="help:head" flexDirection="row" columnGap={1}>
        <Text color={term ? BAND_TEXT : undefined} bold>? {t('help.title')}</Text>
        <Box flexGrow={1} />
        <Button key="help:close" {...look(term, 'help:close')} plain={term || undefined} role="dismiss" onPress={() => change($, { help: false })}>✕</Button>
      </Box>
      {helpLines(main.settings).map(l => (
        <Text wrap="truncate">
          <Text color={term ? BAND_TEXT : undefined}>{l.command}</Text>
          <Text dimColor>{'  '}{l.button ? `${l.button}${term && l.key ? ` · ${l.key}` : ''} — ` : ''}{l.what}</Text>
        </Text>
      ))}
    </Box>
  )
}

// Priority: viewing > card/help > hint > control band; a hidden band still shows the viewing band and opened cards.
export function renderBar($: EngineInterface, e: RenderInput<'AbovePrompt'>): unknown | null {
  // 'Raster' in els is true on the test kit's desktop too, so branch on surface.
  const term = e.surface === 'terminal'
  // A terminal render that drew no moving art stops the timer; renders for other surfaces leave it alone.
  if (term) artSite = undefined
  const tree = band($, e, term)
  if (term && !artSite) stopArt()
  return tree
}

function band($: EngineInterface, e: RenderInput<'AbovePrompt'>, term: boolean): unknown | null {
  const viewing = renderViewing($, e, () => bandArt($, e, term))
  if (viewing) return viewing
  if (ui.help) return helpCard($, e, term)
  if (ui.card) return cardsBand($, e, term)
  const form = barForm()
  if (form === 'hide' || (form === 'fold' && !term)) return null
  if (ui.hint) return hintBand($, e, term)
  if (form === 'open' && term && ui.rest && !running().length) return restBand($, e, ui.rest)
  return form === 'fold' ? foldBand($, e) : term ? terminalBand($, e) : controlBand($, e, term)
}
