import ImageTracer from 'imagetracerjs';

self.onmessage = function (e) {
  const { width, height, buffer, options } = e.data;
  try {
    const imageData = { width, height, data: new Uint8ClampedArray(buffer) };
    const svg = ImageTracer.imagedataToSVG(imageData, options);
    self.postMessage({ svg });
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
