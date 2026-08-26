/**
 * Wordmark component tests.
 *
 * The load-bearing thing to prove: the wordmark reads to a screen reader
 * as the app's name even though the sighted user is looking at an image.
 * If the accessibilityLabel ever regresses to something like the file
 * path or an empty string, the tab bar becomes an unnamed icon strip for
 * anyone using a screen reader.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

import { Wordmark, type WordmarkApp, type WordmarkSize } from '../Wordmark'

const APPS: WordmarkApp[] = ['punchCraft', 'velocityLab', 'puncheokie']
const SIZES: WordmarkSize[] = ['sm', 'tab', 'md', 'lg']

const EXPECTED_LABEL: Record<WordmarkApp, string> = {
  punchCraft: 'punchCraft',
  velocityLab: 'Velocity Lab',
  puncheokie: 'Puncheokie',
}

function render(element: React.JSX.Element): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(element)
  })
  return tree
}

describe('Wordmark', () => {
  it.each(APPS)('names %s to the accessibility layer', (app) => {
    const tree = render(<Wordmark app={app} />)
    const image = tree.root.findByProps({ accessibilityRole: 'image' })
    expect(image.props.accessibilityLabel).toBe(EXPECTED_LABEL[app])
  })

  it.each(APPS)('renders a testID scoped to the app for %s', (app) => {
    const tree = render(<Wordmark app={app} />)
    expect(tree.root.findByProps({ testID: `wordmark-${app}` })).toBeTruthy()
  })

  it.each(SIZES)('renders at a positive fixed height and width for size %s', (size) => {
    const tree = render(<Wordmark app="punchCraft" size={size} />)
    const image = tree.root.findByProps({ accessibilityRole: 'image' })
    const style = image.props.style as { height: number; width: number }
    expect(style.height).toBeGreaterThan(0)
    expect(style.width).toBeGreaterThan(0)
  })

  it('keeps sizes ordered sm < tab < md < lg (so the type scale is meaningful)', () => {
    const heightFor = (size: WordmarkSize): number => {
      const tree = render(<Wordmark app="punchCraft" size={size} />)
      const image = tree.root.findByProps({ accessibilityRole: 'image' })
      return (image.props.style as { height: number }).height
    }
    expect(heightFor('sm')).toBeLessThan(heightFor('tab'))
    expect(heightFor('tab')).toBeLessThan(heightFor('md'))
    expect(heightFor('md')).toBeLessThan(heightFor('lg'))
  })
})
