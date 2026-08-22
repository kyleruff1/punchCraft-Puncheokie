# Build artifacts

Debug/release APKs are archived here after a clean gradle build. The APKs
themselves stay git-ignored per `.gitignore` — only this manifest is
committed so the SHA-256 history is auditable.

## Log

| Date | Branch | Git SHA | APK | Size | SHA-256 | Notes |
|---|---|---|---|---|---|---|
| 2026-08-22 | feat/M02-scaffolding | f19f5eb | punchlab-debug-2026-08-22.apk | 244M | e877eab0e249e8026ecdfff19e63c5c8584e6511dde341bf4215bdbb44f15df8 | First clean assembleDebug: 8m 40s, 511 tasks; Expo SDK 57.0.15 + RN 0.86.2 + @sfourdrinier/react-native-ble-plx 3.9.3. Untested on-device (tablet not yet attached). |
