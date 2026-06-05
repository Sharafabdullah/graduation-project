import ImageTracer from 'imagetracerjs';

self.onmessage = function (e) {
  const { imageData, options } = e.data;
  try {
    ImageTracer.imageToSVG(
      imageData,
      (svgString) => self.postMessage({ svg: svgString }),
      options
    );
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
