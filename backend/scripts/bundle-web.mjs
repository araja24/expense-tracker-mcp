/*
 * Copies the built web app into dist/public, where src/index.ts serves it from.
 *
 * The two used to deploy as separate services, which meant each had to be told
 * the other's URL — the source of a long tail of wrong-hostname bugs. Folding
 * the app into this process leaves one origin and nothing to wire up.
 *
 * cpSync rather than `cp -r` so this works the same on Windows as on the
 * Linux box that builds the deploy.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const backendDir = path.resolve(import.meta.dirname, '..');
const source = path.resolve(backendDir, '..', 'frontend', 'dist');
const target = path.join(backendDir, 'dist', 'public');

if (!existsSync(path.join(source, 'index.html'))) {
  // Not fatal: the API runs fine without it, and `npm run dev` never needs it
  // because Vite serves the app on its own port. A deploy does need it, so say
  // so loudly enough to spot in a build log.
  console.warn(
    `[bundle-web] no build at ${source} — skipping.\n` +
      '[bundle-web] the server will start API-only. Build the frontend first:\n' +
      '[bundle-web]   npm ci --prefix ../frontend && npm run build --prefix ../frontend'
  );
  process.exit(0);
}

// Stale files would otherwise survive a rebuild, and index.html would keep
// referencing hashed assets that are no longer emitted.
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });

console.log(`[bundle-web] copied ${path.relative(backendDir, source)} -> dist/public`);
