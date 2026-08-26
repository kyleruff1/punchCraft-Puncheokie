/**
 * PickerRow tests.
 *
 * Load-bearing behaviours: closed by default, header shows the current
 * option's label (or a valuePreview override), tapping the header
 * opens the popout, tapping an option picks it AND closes the popout,
 * and the "one open at a time" rule under `PickerProvider` collapses
 * other rows when a new one opens.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

import { PickerProvider } from '../PickerContext'
import { PickerRow } from '../PickerRow'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Bravo' },
  { value: 'c', label: 'Charlie' },
] as const

const mounted: ReactTestRenderer[] = []

function render(element: React.JSX.Element): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(element)
  })
  mounted.push(tree)
  return tree
}

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount()
  })
})

function press(tree: ReactTestRenderer, testID: string): void {
  act(() => {
    tree.root.findByProps({ testID }).props.onPress()
  })
}

function textOf(root: ReactTestRenderer): string {
  const walk = (node: unknown): string => {
    if (typeof node === 'string') return node
    if (!node || typeof node !== 'object') return ''
    const anyNode = node as { children?: unknown[] }
    if (!Array.isArray(anyNode.children)) return ''
    return anyNode.children.map(walk).join('')
  }
  return walk(root.root)
}

describe('PickerRow', () => {
  it('renders collapsed by default and shows the current option label', () => {
    const tree = render(
      <PickerRow id="p" label="Pick" value="b" options={OPTIONS} onChange={() => undefined} />,
    )
    // No option row exists while collapsed.
    expect(tree.root.findAllByProps({ testID: 'picker-p-option-a' })).toHaveLength(0)
    // Header value shows the current label.
    expect(textOf(tree)).toContain('Bravo')
  })

  it('respects a valuePreview override', () => {
    const tree = render(
      <PickerRow
        id="p"
        label="Pick"
        value="b"
        options={OPTIONS}
        onChange={() => undefined}
        valuePreview="custom-preview"
      />,
    )
    expect(textOf(tree)).toContain('custom-preview')
  })

  it('opens the popout on header tap and closes on pick', () => {
    let picked: string | undefined
    const tree = render(
      <PickerRow id="p" label="Pick" value="a" options={OPTIONS} onChange={(v) => (picked = v)} />,
    )
    press(tree, 'picker-p-toggle')
    // Options mounted after open.
    expect(() => tree.root.findByProps({ testID: 'picker-p-option-a' })).not.toThrow()
    press(tree, 'picker-p-option-c')
    expect(picked).toBe('c')
    // Popout closes after pick — options no longer in the tree.
    expect(tree.root.findAllByProps({ testID: 'picker-p-option-a' })).toHaveLength(0)
  })

  it('with a PickerProvider, opening a second picker closes the first', () => {
    const tree = render(
      <PickerProvider>
        <PickerRow id="first" label="First" value="a" options={OPTIONS} onChange={() => undefined} />
        <PickerRow id="second" label="Second" value="a" options={OPTIONS} onChange={() => undefined} />
      </PickerProvider>,
    )
    press(tree, 'picker-first-toggle')
    expect(() => tree.root.findByProps({ testID: 'picker-first-option-a' })).not.toThrow()
    press(tree, 'picker-second-toggle')
    // First closes when second opens.
    expect(tree.root.findAllByProps({ testID: 'picker-first-option-a' })).toHaveLength(0)
    expect(() => tree.root.findByProps({ testID: 'picker-second-option-a' })).not.toThrow()
  })
})
