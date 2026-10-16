/** Asserts the wallet build contains the service worker and web manifest (v2 §16.H). Run after `nuxt build`. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = join(import.meta.dirname, '..', '.output', 'public');
const problems: string[] = [];

for (const file of ['sw.js', 'manifest.webmanifest']) {
  if (!existsSync(join(out, file))) problems.push(`missing .output/public/${file}`);
}

if (problems.length === 0) {
  const manifest: unknown = JSON.parse(readFileSync(join(out, 'manifest.webmanifest'), 'utf8'));
  if (typeof manifest !== 'object' || manifest === null || !('icons' in manifest) || !Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    problems.push('manifest.webmanifest has no icons');
  }
  const sw = readFileSync(join(out, 'sw.js'), 'utf8');
  for (const needle of ['notificationclick', 'showNotification', '"url":"/"', '_nuxt/']) {
    if (!sw.includes(needle)) problems.push(`sw.js does not contain "${needle}"`);
  }
  for (const icon of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
    if (!existsSync(join(out, icon))) problems.push(`missing .output/public/${icon}`);
  }
}

if (problems.length > 0) {
  console.error(`wallet build check FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('wallet build check OK: sw.js (push + notificationclick + precached shell), manifest.webmanifest, icons present');
