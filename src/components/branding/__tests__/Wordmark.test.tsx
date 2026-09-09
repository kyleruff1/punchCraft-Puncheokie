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

  it('isolated variant swaps the punchCraft source; brand is the default', () => {
    // Policy (Kyle 2026-08-28): wordmark.png is the app's name everywhere;
    // the isolated silver version has exactly one job — the tab link.
    const brand = render(<Wordmark app="punchCraft" />)
    const isolated = render(<Wordmark app="punchCraft" variant="isolated" />)
    const src = (tree: ReactTestRenderer): unknown =>
      tree.root.findByProps({ accessibilityRole: 'image' }).props.source
    expect(src(brand)).not.toEqual(src(isolated))
    // Non-punchCraft apps ignore the variant — there is only one asset.
    const vl = render(<Wordmark app="velocityLab" />)
    const vlIsolated = render(<Wordmark app="velocityLab" variant="isolated" />)
    expect(src(vl)).toEqual(src(vlIsolated))
  })

  it('keeps the content scale ordered sm < md < lg, with the TAB deliberately largest', () => {
    const heightFor = (size: WordmarkSize): number => {
      const tree = render(<Wordmark app="punchCraft" size={size} />)
      const image = tree.root.findByProps({ accessibilityRole: 'image' })
      return (image.props.style as { height: number }).height
    }
    // The in-content scale still reads small → large.
    expect(heightFor('sm')).toBeLessThan(heightFor('md'))
    expect(heightFor('md')).toBeLessThan(heightFor('lg'))
    // `tab` is NOT part of that scale: it is the app's primary navigation
    // and was taken to 2.5x (Kyle 2026-09-06) so the bottom tabs read as
    // prominent rather than as a footer. It outsizes every content step.
    expect(heightFor('tab')).toBeGreaterThan(heightFor('lg'))
    expect(heightFor('tab')).toBeGreaterThan(heightFor('sm'))
  })
})
