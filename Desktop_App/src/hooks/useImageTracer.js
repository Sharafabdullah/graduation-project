import { useState, useRef, useEffect, useCallback } from 'react';

export function useImageTracer() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const workerRef = useRef(null);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL('../workers/tracerWorker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current.onmessage = (e) => {
      setLoading(false);
      if (e.data.error) {
        setError(e.data.error);
      } else {
        setResult(e.data.svg);
        setError(null);
      }
    };
    return () => workerRef.current.terminate();
  }, []);

  const trace = useCallback((base64DataUrl, options = {}) => {
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
