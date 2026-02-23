import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.join(__dirname, '..');
const srcPrompts = path.join(rootDir, 'src', 'prompts');
const distPrompts = path.join(rootDir, 'dist', 'prompts');

async function copyAssets() {
  try {
    // Copy prompts
    if (await fs.pathExists(srcPrompts)) {
      await fs.ensureDir(distPrompts);
      await fs.copy(srcPrompts, distPrompts);
      console.log('✅ Prompts copied to dist/prompts');
    } else {
      console.warn('⚠️ src/prompts directory not found');
    }
    
    // You can add more assets to copy here if needed
    
  } catch (err) {
    console.error('❌ Error copying assets:', err);
    process.exit(1);
  }
}

copyAssets();
