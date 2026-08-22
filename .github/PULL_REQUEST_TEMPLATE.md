## Summary

<!-- What changed and why. Link the issue. Format: Closes #123 -->

Closes #

## Milestone & epic

- Milestone: `M<nn>`
- Epic: `[EPIC] Phase <n> — …`
- Spec section(s): `§…`

## Type

- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] test
- [ ] docs
- [ ] chore

## Verification

<!-- How this was tested. Include unit test names, replay fixtures used, on-tablet steps. -->

- [ ] `npm test` (unit + fixture tests) — output attached
- [ ] Physical tablet check (if applicable) — brief description of the run

## Boundaries checklist

- [ ] Domain code does not import React Native, Expo, SQLite, or the BLE library (§15.1)
- [ ] Any BLE frames introduced by this change are persisted before parsing (§11.9, §12.4)
- [ ] Velocity language uses "tracker-reported velocity" — not force/power/energy (§4.3)
- [ ] No writes to unknown GATT characteristics (§12.1)
- [ ] No Spotify client secret is embedded (§14.2, §20.3)
- [ ] Decoder / calibration profile version bumped if the change is not backwards-compatible

## Notes for reviewers

<!-- Anything reviewers should focus on. -->
