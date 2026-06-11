import { useState, useRef, useEffect, useCallback } from 'react';
import { binarizeImageData, sampleCornerColor } from '../lib/imageBinarize';

export function useImageTracer() {
  const [result, setResult] = useState(null);
  const [backgroundColor, setBackgroundColor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const workerRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    const worker = new Worker(
      new URL('../workers/tracerWorker.js', import.meta.url),
      { type: 'module' }
    );
    worker.onmessage = (e) => {
      if (!isMounted) return;
      setLoading(false);
      if (e.data.error) {
        setError(e.data.error);
      } else {
        setResult(e.data.svg);
        setError(null);
      }
    };
    worker.onerror = (e) => {
      if (!isMounted) return;
      setLoading(false);
      setError(e.message || 'Worker error');
    };
    workerRef.current = worker;
    return () => {
      isMounted = false;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
  }, []);

  const trace = useCallback((base64DataUrl, options = {}) => {
    if (!base64DataUrl) {
      setError('No image data provided');
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    setBackgroundColor(null);

    const {
      multicolorMode = false,
      threshold = 128,
      numberofcolors = 4,
      ltres = 1,
      qtres = 1,
      pathomit = 8,
      blurradius = 0,
    } = options;

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let pixelData;
      let traceOptions;

      if (multicolorMode) {
        setBackgroundColor(sampleCornerColor(imageData));
        pixelData = imageData;
        traceOptions = { numberofcolors, ltres, qtres, pathomit, blurradius, viewbox: true };
      } else {
        pixelData = binarizeImageData(imageData, threshold);
        traceOptions = { numberofcolors: 2, ltres, qtres, pathomit, blurradius, viewbox: true };
      }

      const buffer = pixelData.data.buffer.slice(0);
      workerRef.current.postMessage(
        { width: pixelData.width, height: pixelData.height, buffer, options: traceOptions },
        [buffer]
      );
    };
    img.onerror = () => {
      setLoading(false);
      setError('Failed to load image');
    };
    img.src = base64DataUrl;
  }, []);

  return { trace, result, backgroundColor, loading, error };
}
