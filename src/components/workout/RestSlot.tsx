/**
 * Rest slot — a bar position the athlete does NOT throw (GH #305).
 *
 * A bar is four slots wide. A motif that cannot tile it evenly (`1-1-2`)
 * is padded with rests so every bar reads the same width and the eye lands
 * in the same four places each time. Kyle, 2026-08-31: *"filling everything
 * with 4 nodes and spaces to make combos and single hits easier to
 * predict."*
 *
 * ## Why it is not just an unlit PunchToken
 *
 * A rest must read as *deliberately empty*, not as a punch that has not
 * come up yet or one that was missed. So it carries no number, no marker
 * and no `ActiveRing` — it is the faintest element on the row, and its only
 * job is to hold width. Giving it a border at all (rather than rendering
 * nothing) is the point: the gap has to be visible for the bar's shape to
 * be readable.
 *
 * It is display-only, never scored, and never voiced.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'

import { STATE_VISUALS, TOKEN_DIAMETER, type TokenSize } from './tokenVisuals'

export interface RestSlotProps {
  size?: TokenSize
}

export function RestSlot(props: RestSlotProps): React.JSX.Element {
  const { size = 'stage' } = props
  const visual = STATE_VISUALS.empty
  const diameter = TOKEN_DIAMETER[size]

  return (
    <View
      accessibilityLabel="rest"
      accessibilityRole="image"
      style={styles.root}
      testID="rest-slot"
    >
      <View
        style={[
          styles.shape,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            borderWidth: visual.borderWidth,
            borderColor: visual.borderColor,
            backgroundColor: visual.backgroundColor,
          },
        ]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  shape: {
    alignItems: 'center',
    justifyContent: 'center',
    // Dashed so it reads as "nothing goes here" rather than as an empty
    // container waiting to be filled.
    borderStyle: 'dashed',
  },
})
