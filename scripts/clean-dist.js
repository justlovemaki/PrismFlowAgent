import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

async function cleanDist() {
  try {
    if (await fs.pathExists(distDir)) {
      await fs.emptyDir(distDir);
      console.log('✅ dist directory cleaned');
    }
  } catch (err) {
    console.error('❌ Error cleaning dist directory:', err);
    process.exit(1);
  }
}

cleanDist();
