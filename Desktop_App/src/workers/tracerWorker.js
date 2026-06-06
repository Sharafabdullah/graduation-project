import ImageTracer from 'imagetracerjs';

self.onmessage = function (e) {
  const { width, height, buffer, options } = e.data;
  const imgd = { width, height, data: new Uint8ClampedArray(buffer) };
  try {
    const svg = ImageTracer.imagedataToSVG(imgd, options);
    self.postMessage({ svg });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
