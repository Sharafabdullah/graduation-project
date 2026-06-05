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
    workerRef.current.postMessage({
      imageData: base64DataUrl,
      options: { ...defaultOptions, ...options },
    });
  }, []);

  return { trace, result, loading, error };
}
