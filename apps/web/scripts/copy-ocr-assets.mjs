// Copies the on-device text-recognition files (tesseract.js) into public/ocr so the app
// serves them itself: no CDN, works behind the hospital firewall, allowed by the CSP.
// Only the LSTM engine builds are copied; the browser downloads one of them on first use.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const out = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/ocr');
fs.mkdirSync(out, { recursive: true });

const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
const files = [
  [path.join(pkgDir('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
  ...['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']
    .map((f) => [path.join(pkgDir('tesseract.js-core'), f), f]),
  [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
];
for (const [from, name] of files) {
  const to = path.join(out, name);
  if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) fs.copyFileSync(from, to);
}
console.log(`OCR assets ready in public/ocr (${files.length} files)`);
