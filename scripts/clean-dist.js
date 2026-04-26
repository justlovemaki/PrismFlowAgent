import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

if (!distDir.startsWith(`${rootDir}${path.sep}`)) {
  console.error(`Refusing to remove dist outside repository: ${distDir}`);
  process.exit(1);
}

await fs.remove(distDir);
console.log('✅ dist cleaned');
