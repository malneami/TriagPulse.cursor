import { transactionNoFromText } from '@triagepulse/clinical';

/**
 * On-device reading of the "Transaction No." printed on the visit ticket.
 * The text reader (tesseract.js) and its English model are served by the app itself
 * (public/ocr) and loaded only the first time a nurse taps "Read number". Camera frames
 * are read on the tablet and discarded; only the number is kept, after the nurse confirms.
 */

let workerPromise = null;
let progressListener = null;

function assetUrl(file = '') {
  const base = `${import.meta.env.BASE_URL || '/'}ocr/`.replace(/\/{2,}/g, '/');
  return new URL(base + file, window.location.href).href;
}

export function getTicketReader(onProgress) {
  progressListener = onProgress || null;
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: assetUrl('worker.min.js'),
        corePath: assetUrl(),
        langPath: assetUrl(),
        workerBlobURL: false,
        gzip: true,
        logger: (m) => progressListener?.(m),
      });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
      return worker;
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Grey, contrast-stretched copy of the current video frame (thermal print reads better). */
export function frameToCanvas(video, maxWidth = 1600) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const scale = Math.min(1, maxWidth / w) * (w < 1000 ? 1.5 : 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = g;
    if (g < lo) lo = g;
    if (g > hi) hi = g;
  }
  const span = Math.max(1, hi - lo);
  for (let i = 0; i < px.length; i += 4) {
    const v = Math.max(0, Math.min(255, ((px[i] - lo) * 255) / span));
    px[i] = v; px[i + 1] = v; px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Reads one frame; returns the Transaction No. or null. */
export async function readTransactionNo(video, pattern) {
  const canvas = frameToCanvas(video);
  if (!canvas) return null;
  const worker = await getTicketReader(progressListener);
  const { data } = await worker.recognize(canvas);
  return transactionNoFromText(data.text, pattern);
}
