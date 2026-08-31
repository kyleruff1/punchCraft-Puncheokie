/**
 * ESM loader — intercepts .wav/.mp3/.png/.jpg imports (metro assets)
 * and returns a placeholder numeric export. Paired with wav-stub.mjs.
 */

const ASSET_EXTS = /\.(wav|mp3|ogg|png|jpg|jpeg|svg|ttf|otf)$/i

export async function resolve(specifier, context, nextResolve) {
  if (ASSET_EXTS.test(specifier)) {
    return {
      shortCircuit: true,
      url: `data:text/javascript,export default 0;`,
      format: 'module',
    }
  }
  return nextResolve(specifier, context)
}
