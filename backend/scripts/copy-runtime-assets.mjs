import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptsDir, '..');

const assetCopies = [
  {
    src: resolve(projectRoot, 'src/lib/blitzortungProvider.js'),
    dst: resolve(projectRoot, 'dist/lib/blitzortungProvider.js'),
  },
];

for (const { src, dst } of assetCopies) {
  if (!existsSync(src)) {
    throw new Error(`Missing runtime asset: ${src}`);
  }

  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst);
}

console.log('Copied runtime assets to dist/');
