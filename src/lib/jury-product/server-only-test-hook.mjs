// Test-only preload: node --test has no Next.js alias for 'server-only'. Map it to
// Next's server-side variant (next/dist/compiled/server-only/empty), which is what
// Next resolves for server bundles. Covers both require() and import (Node >= 22.15).
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'server-only') return next('next/dist/compiled/server-only/empty.js', context);
    return next(specifier, context);
  },
});