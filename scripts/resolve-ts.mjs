// Node's type stripping does not resolve the extensionless imports used by
// the app's bundler. Keep that compatibility at the standalone entry point.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (!['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code)
      || !specifier.startsWith('.')) throw error
    for (const suffix of ['.ts', '/index.ts']) {
      try { return await nextResolve(specifier + suffix, context) } catch {}
    }
    throw error
  }
}
