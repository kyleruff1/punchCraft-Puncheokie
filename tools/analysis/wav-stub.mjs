/**
 * Loader hook — stubs `.wav` / `.mp3` / image / font requires so Node
 * can import TS domain modules that reference metro-only assets
 * (see comboAnnounceManifest.ts's require('...wav') for many wavs).
 *
 * Registered via `NODE_OPTIONS='--import ./tools/analysis/wav-stub.mjs'`
 * before `npx tsx …`. Intercepts BOTH ESM imports (via register hook)
 * and CJS requires (via Module._load monkeypatch — tsx uses CJS
 * transformer under the hood).
 *
 * Any consumer that ACTUALLY plays the audio would fail, but the
 * manifest generator only reads the metadata around the stub
 * (id, text, durationMs), so the placeholder is invisible to the
 * JSON output.
 */

import { register } from 'node:module'
import Module from 'node:module'
import { pathToFileURL } from 'node:url'

const ASSET_EXTS = /\.(wav|mp3|ogg|png|jpg|jpeg|svg|ttf|otf)$/i

// ---- ESM: register the resolve/load hook ---------------------------------
register(new URL('./wav-stub-loader.mjs', import.meta.url), pathToFileURL('./'))

// ---- CJS: intercept require() calls --------------------------------------
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (typeof request === 'string' && ASSET_EXTS.test(request)) {
    return 0
  }
  return originalLoad.call(this, request, parent, isMain)
}
