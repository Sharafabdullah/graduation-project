import ImageTracer from 'imagetracerjs';

self.onmessage = function (e) {
  const { imageData, options } = e.data;
  try {
    ImageTracer.imageToSVG(
      imageData,
      (svgString) => {
        try {
          self.postMessage({ svg: svgString });
        } catch (err) {
          self.postMessage({ error: err.message });
        }
      },
      options
    );
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};
