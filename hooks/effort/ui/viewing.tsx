import type { EngineInterface, RenderChildren, RenderInput, SiteView, Timer } from 'claude-code'
import { modelName, stripTag } from '../roles'
import { ART_COLUMNS, buttonCells, EFFORT_COLOR, frame, VIEW_BG, VIEW_EDGE, VIEW_TEXT } from './art'
import { agents, live, ui, type UiState } from '../state'
import { cells, redraw, toast } from './status'
import { t } from './text'

const errText = (err: unknown) => ({ deny: err instanceof Error ? err.message : String(err) })

export function change($: EngineInterface, patch: Partial<UiState>) {
  if (patch.tab === 'settings') {
    stopPeek()
    patch = { ...patch, peek: undefined }
  }
  ui.set(patch)
  redraw($)
}

let peekTimer: Timer | undefined

export function stopPeek() {
  peekTimer?.cancel()
  peekTimer = undefined
}

export function showPeek($: EngineInterface, agentId: string) {
  stopPeek()
  const running = () => { const r = agents.byAgentId(agentId); return !!r && live(r) }
  try {
    if (running()) {
      peekTimer = $.clock.every(2000, () => {
        if (ui.peek !== agentId || !running()) stopPeek()
        redraw($)
      })
    }
  } catch {
    // no UI or clock here (e.g. -p); never fail the hook
  }
  change($, { peek: agentId })
}

export function closePeek($: EngineInterface) {
  stopPeek()
  change($, { peek: undefined })
}

export async function openAgent($: EngineInterface, agentId: string): Promise<void> {
  const r = await $.ui.view({ agentId }).catch(errText)
  if (r.deny) {
    toast($, r.deny)
    // A peek is visible only with the docked panel; the band has no place for it, so only the reason shows.
    if (ui.docked) showPeek($, agentId)
    return
  }
  stopPeek()
  change($, { viewing: agentId, peek: undefined })
}

export async function backToMain($: EngineInterface): Promise<void> {
  const r = await $.ui.view({}).catch(errText)
  if (r.deny) toast($, r.deny)
  else change($, { viewing: undefined })
}

export function syncView($: EngineInterface, view: SiteView | undefined) {
  if (view && view.agentId !== ui.viewing) change($, { viewing: view.agentId })
}

export function renderViewing($: EngineInterface, e: RenderInput<'AbovePrompt'>, art?: () => RenderChildren): unknown | null {
  syncView($, e.props.view)
  const id = ui.viewing
  if (!id) return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const term = e.surface === 'terminal'
  const rec = agents.byAgentId(id)
  const ended = rec?.status === 'done' || rec?.status === 'error'
  const list = agents.all().filter(r => r.agentId)
  const at = list.findIndex(r => r.agentId === id)
  const go = (step: number) => () => {
    if (at < 0) return
    const to = list[(at + step + list.length) % list.length]?.agentId
    if (to) return openAgent($, to)
  }
  const name = rec ? stripTag(rec.description) : id
  const model = modelName(rec?.model)
  const effort = rec?.sent ?? undefined
  const quiet = term ? { plain: true as const } : {}
  const pic = art?.()
  const many = list.length > 1
  // Buttons share the first line only when it holds them whole (the art's 17 columns aside); else a row of their own.
  const head = [t('view.banner', { name }), '·', model, effort].filter(Boolean).reduce((sum, part) => sum + cells(part ?? '') + 1, 1)
  const room = e.props.bodyColumns - 4 - (pic ? ART_COLUMNS + 1 : 0)
  const inline = head + buttonCells(t('view.main'), false) + (many ? buttonCells(t('view.prev'), true) + buttonCells(t('view.next'), true) + 2 : 0) <= room
  const buttons = [
    <Button key="view:main" variant="primary" onPress={() => backToMain($)}>{t('view.main')}</Button>,
    many && <Button key="view:prev" {...quiet} onPress={go(-1)}>{t('view.prev')}</Button>,
    many && <Button key="view:next" {...quiet} onPress={go(1)}>{t('view.next')}</Button>,
  ]
  if (!term) {
    return (
      <Box key="viewing" flexDirection="row" flexWrap="wrap" columnGap={1}>
        <Text color="blue" bold>{t('view.banner', { name })} · {t('view.input')}</Text>
        {ended && <Text color="blue">{t('view.ended')}</Text>}
        {buttons}
        {pic}
      </Box>
    )
  }
  return (
    <Box key="viewing" flexDirection="row" columnGap={1} alignItems="flex-start" {...frame(true, VIEW_BG, VIEW_EDGE)}>
      <Box key="view:text" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
        <Box key="view:head" flexDirection="row" columnGap={1}>
          <Box flexShrink={1} minWidth={0}><Text color={VIEW_TEXT} bold wrap="truncate">{t('view.banner', { name })}</Text></Box>
          <Box flexShrink={0} flexDirection="row" columnGap={1}>
            <Text dimColor>·</Text>
            {model ? <Text dimColor>{model}</Text> : null}
            {effort ? <Text color={EFFORT_COLOR[effort]} bold>{effort}</Text> : null}
          </Box>
          {inline && <Box flexGrow={1} />}
          {inline && buttons}
        </Box>
        <Text dimColor wrap="truncate">{t('view.input')}{ended ? ` · ${t('view.ended')}` : ''}</Text>
        {!inline && <Box key="view:buttons" flexDirection="row" flexWrap="wrap" columnGap={1} justifyContent="flex-end">{buttons}</Box>}
      </Box>
      {pic}
    </Box>
  )
}
