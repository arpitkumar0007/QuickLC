// Builds dist/quicklc-<version>.zip, ready to upload to the Chrome Web Store.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const extensionDir = path.join(root, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));

if (!fs.existsSync(path.join(extensionDir, 'vendor', 'monaco-editor', 'min', 'vs', 'loader.js'))) {
  console.error('Monaco is missing. Run `npm install` first.');
  process.exit(1);
}

const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const zipPath = path.join(distDir, `quicklc-${version}.zip`);
fs.rmSync(zipPath, { force: true });
execFileSync('zip', ['-rq', zipPath, '.', '-x', '.*'], { cwd: extensionDir, stdio: 'inherit' });
console.log(`Created ${path.relative(root, zipPath)}`);
