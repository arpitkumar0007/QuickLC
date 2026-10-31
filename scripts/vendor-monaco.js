// Copies the Monaco Editor AMD build into extension/vendor so the popup can load it.
// Monaco is pinned to 0.52.2: newer releases changed the layout of the `min` build.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'node_modules', 'monaco-editor', 'min', 'vs');
const target = path.join(root, 'extension', 'vendor', 'monaco-editor', 'min', 'vs');

if (!fs.existsSync(path.join(source, 'loader.js'))) {
  console.error('monaco-editor is not installed. Run `npm install` first.');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
// Skip translation bundles: the popup uses the default English UI.
fs.cpSync(source, target, {
  recursive: true,
  filter: (src) => !/nls\.messages\.[\w-]+\.js$/.test(path.basename(src))
});
console.log(`Monaco copied to ${path.relative(root, target)}`);
