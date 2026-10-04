import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PLUGIN = 'tui-kit-example'
const SURFACES = ['terminal', 'desktop'] as const

const pane = (title: string) => ({
  title,
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
})

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

/** The host beneath the plugin: config rows, settings, environment, panes and logs. */
function host(on: On, env: Record<string, string> = {}, settings: Record<string, boolean> = {}) {
  const opened: string[] = []
  const logged: string[] = []
  on('config.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: settings }))
  mock.env(on, env)
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.log', ($, e) => {
    logged.push(e.text)
  })
  return { opened, logged }
}

const KINDS = [
  { id: 'tui-kit-badge', title: 'Badge', shows: ['! Warning'] },
  { id: 'tui-kit-panel', title: 'Panel', shows: ['Build', '✗ Error', '3 tests failed'] },
  { id: 'tui-kit-list', title: 'Checks', shows: ['lint', 'tests', 'docs'] },
  { id: 'tui-kit-table', title: 'Table', shows: ['Check', 'lint', '✓ OK'] },
  { id: 'tui-kit-meter', title: 'Meter', shows: ['Disk', '! Warning', '80% (8/10)'] },
]

describe('every kit component mounts as a pane', () => {
  test('on the terminal and on desktop', async ($, on) => {
    host(on)
    for (const surface of SURFACES) {
      for (const kind of KINDS) {
        const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: kind.id, props: pane(kind.title) })
        for (const text of kind.shows) {
          expect((await ui.findAll({ text })).length > 0, `${surface} ${kind.id} shows ${text}`).toBe(true)
        }
        await ui.unmount()
      }
    }
  })
})

test('the status badge mounts in the band on the terminal and on desktop', async ($, on) => {
  host(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: '! Warning' })).toBeDefined()
    await ui.unmount()
  }
})

test('terminal: pressing a list item reaches the mod', async ($, on) => {
  host(on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'tui-kit-list', props: pane('Checks') })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(3)
  expect(await ui.find({ type: 'Text', text: 'Picked: none' })).toBeDefined()
  await ui.press({ key: 'item-2' })
  expect(await ui.find({ type: 'Text', text: 'Picked: tests' })).toBeDefined()
  await ui.unmount()
})

test('desktop: the list draws no live controls and says it is display-only', async ($, on) => {
  host(on)
  const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'desktop', component: 'Pane', requestId: 'tui-kit-list', props: pane('Checks') })
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
  expect(await ui.find({ key: 'display-only' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /display-only/i })).toBeDefined()
  await ui.unmount()
})

test('screen reader, panes do not draw: the panes are skipped and their plain text is logged', async ($, on) => {
  const world = host(on, { CLAUDE_AX_SCREEN_READER: '1' })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'engine band' })
  })
  const result = await $.command.run({ command: 'tui-kit-demo' })
  expect(result.text).toMatch(/skipped/)
  expect(world.opened).toHaveLength(0)
  expect(world.logged).toContain('┌ Build — ✗ Error')
  expect(world.logged).toContain('Disk ! Warning 80% (8/10)')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.find({ type: 'Text', text: 'engine band' })).toBeDefined()
    await ui.unmount()
  }
})

test('a screen reader set in settings is read through the host and skips the panes', async ($, on) => {
  const world = host(on, {}, { axScreenReader: true })
  const result = await $.command.run({ command: 'tui-kit-demo' })
  expect(result.text).toMatch(/skipped/)
  expect(world.opened).toHaveLength(0)
  expect(world.logged).toContain('! Warning')
})

test('screen reader, panes draw: every pane opens and shows each glyph and label as text', { options: { panesDrawForScreenReader: true } }, async ($, on) => {
  const world = host(on, { CLAUDE_AX_SCREEN_READER: '1' })
  const result = await $.command.run({ command: 'tui-kit-demo' })
  expect(result.text).toBe('Kit panes opened.')
  expect(world.opened).toEqual(KINDS.map(k => k.id))
  expect(world.logged).toHaveLength(0)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: 'tui-kit-meter', props: pane('Meter') })
    expect(await ui.find({ type: 'Text', text: '! Warning' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /█/ })).toBeUndefined()
    await ui.unmount()
  }
})
