// Copies the on-device text-recognition files (tesseract.js) into public/ocr so the app
// serves them itself: no CDN, works behind the hospital firewall, allowed by the CSP.
// LSTM engine + matching .wasm binaries; the browser downloads one build on first use.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/ocr');

export function copyOcrAssets() {
  fs.mkdirSync(out, { recursive: true });
  const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`));
  const cores = [
    'tesseract-core-lstm.wasm.js',
    'tesseract-core-lstm.wasm',
    'tesseract-core-simd-lstm.wasm.js',
    'tesseract-core-simd-lstm.wasm',
    'tesseract-core-relaxedsimd-lstm.wasm.js',
    'tesseract-core-relaxedsimd-lstm.wasm',
  ];
  const files = [
    [path.join(pkgDir('tesseract.js'), 'dist/worker.min.js'), 'worker.min.js'],
    ...cores.map((f) => [path.join(pkgDir('tesseract.js-core'), f), f]),
    [path.join(pkgDir('@tesseract.js-data/eng'), '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
  ];
  for (const [from, name] of files) {
    if (!fs.existsSync(from)) throw new Error(`OCR source missing: ${from}`);
    const to = path.join(out, name);
    if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) {
      fs.copyFileSync(from, to);
    }
  }
  console.log(`OCR assets ready in public/ocr (${files.length} files)`);
}

copyOcrAssets();
