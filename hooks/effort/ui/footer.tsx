import type { EngineInterface, RenderInput } from 'claude-code'
import { main } from '../state'
import { EFFORT_COLOR } from './art'
import { barForm, press } from './bar'
import { snapshot } from './status'

export function renderFooter($: EngineInterface, e: RenderInput<'SessionMode'>): unknown | null {
  if (e.surface !== 'desktop' || barForm() === 'open') return null
  const { Box, Text, Button } = $.ui.resolve(e)
  const effort = snapshot().main
  const auto = main.settings.auto
  return (
    <Box key="pstack:footer" flexDirection="row" gap={1} alignItems="center">
      {e.props.modes.length > 0 ? <Text dimColor>{e.props.modes.join(' & ')}</Text> : null}
      <Text color={EFFORT_COLOR[effort ?? '']} bold>pstack · {effort ?? '?'}</Text>
      <Button key="footer:auto" plain dimColor={!auto} label={auto ? ' Auto ' : ' Auto off '} onPress={press($, 'auto')} />
    </Box>
  )
}
