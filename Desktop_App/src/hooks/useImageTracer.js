import { useState, useRef, useEffect, useCallback } from 'react';

export function useImageTracer() {
  const [result, setResult] = useState(null);
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

    const defaultOptions = {
      numberofcolors: 2,
      colorquantcycles: 1,
      ltres: 1,
      qtres: 1,
      pathomit: 8,
      blurradius: 0,
    };

    // Decode the image on the main thread (DOM available here) so the
    // worker receives raw RGBA pixels instead of a data URL — workers
    // cannot call new Image() because they have no DOM access.
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const buffer = imageData.data.buffer.slice(0);
      workerRef.current.postMessage(
        { width: canvas.width, height: canvas.height, buffer, options: { ...defaultOptions, ...options } },
        [buffer]
      );
    };
    img.onerror = () => {
      setLoading(false);
      setError('Failed to load image');
    };
    img.src = base64DataUrl;
  }, []);

  return { trace, result, loading, error };
}
