import React, { useState, useRef, useEffect } from 'react';
import { useSerial } from '../contexts/SerialContext';
import './Image2GCodePage.css';

let savedState = {
  imageSrc: null,
  threshold: 128,
  widthMm: 100,
  resolution: 0.5,
  gcodeLines: []
};

export default function Image2GCodePage() {
  const { connected, streaming, startStreaming } = useSerial();
  const [imageSrc, _setImageSrc] = useState(savedState.imageSrc);
  const [threshold, _setThreshold] = useState(savedState.threshold);
  const [widthMm, _setWidthMm] = useState(savedState.widthMm);
  const [resolution, _setResolution] = useState(savedState.resolution);
  const [gcodeLines, _setGcodeLines] = useState(savedState.gcodeLines);
  const canvasRef = useRef(null);

  const setImageSrc = (v) => { _setImageSrc(v); savedState.imageSrc = v; };
  const setThreshold = (v) => { _setThreshold(v); savedState.threshold = v; };
  const setWidthMm = (v) => { _setWidthMm(v); savedState.widthMm = v; };
  const setResolution = (v) => { _setResolution(v); savedState.resolution = v; };
  const setGcodeLines = (v) => { _setGcodeLines(v); savedState.gcodeLines = v; };

  const handleClearWork = () => {
    setImageSrc(null);
    setThreshold(128);
    setWidthMm(100);
    setResolution(0.5);
    setGcodeLines([]);
  };

  const handleSaveGCode = () => {
    if (gcodeLines.length === 0) return;
    const blob = new Blob([gcodeLines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'image_conversion.gcode';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (imageSrc) {
      drawPreview();
    }
  }, [imageSrc, threshold, widthMm, resolution]);

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setImageSrc(event.target.result);
      setGcodeLines([]);
    };
    reader.readAsDataURL(file);
  };

  const drawPreview = () => {
    try {
      if (!imageSrc || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      const widthPx = Math.max(1, Math.floor(widthMm / resolution));
      
      const img = new Image();
      img.onload = () => {
        try {
          const scale = widthPx / img.width;
          const heightPx = Math.max(1, Math.floor(img.height * scale));
          
          canvas.width = widthPx;
          canvas.height = heightPx;
          
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, widthPx, heightPx);
          ctx.drawImage(img, 0, 0, widthPx, heightPx);
          
          const imgData = ctx.getImageData(0, 0, widthPx, heightPx);
          const data = imgData.data;
          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i+3];
            let brightness = 255; // default white
            if (alpha > 128) {
              brightness = (data[i] + data[i+1] + data[i+2]) / 3;
            }
            const color = brightness < threshold ? 0 : 255;
            data[i] = color;
            data[i+1] = color;
            data[i+2] = color;
            data[i+3] = 255;
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (e) {
          console.error("Preview drawing error:", e);
        }
      };
      img.src = imageSrc;
    } catch (e) {
      console.error("Preview setup error:", e);
    }
  };

  const processImage = () => {
    try {
      if (!imageSrc || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      const widthPx = canvas.width;
      const heightPx = canvas.height;
      
      if (widthPx === 0 || heightPx === 0) {
        setGcodeLines(["; Error: Canvas dimensions are 0"]);
        return;
      }
      
      const imgData = ctx.getImageData(0, 0, widthPx, heightPx);
      const data = imgData.data;
      
      const newGcode = [];
      newGcode.push('; Image to G-Code Generated');
      newGcode.push('G21 ; Set units to millimeters');
      newGcode.push('G90 ; Absolute positioning');
      newGcode.push('F1000 ; Set default feed rate');
      newGcode.push('M5 ; Pen up');
      
      for (let y = 0; y < heightPx; y++) {
        let drawingSegment = false;
        const reverse = y % 2 !== 0; 
        const physicalY = (y * resolution).toFixed(3);
        
        for (let xInt = 0; xInt < widthPx; xInt++) {
          const x = reverse ? widthPx - 1 - xInt : xInt;
          const i = (y * widthPx + x) * 4;
          
          const alpha = data[i+3];
          let brightness = 255;
          if (alpha > 128) {
            brightness = (data[i] + data[i+1] + data[i+2]) / 3;
          }
          const isDark = brightness < threshold;
          
          const physicalX = (x * resolution).toFixed(3);
          
          if (isDark) {
            if (!drawingSegment) {
              newGcode.push(`G0 X${physicalX} Y${physicalY}`);
              newGcode.push('M3 ; Pen down');
              drawingSegment = true;
            }
          } else {
            if (drawingSegment) {
              const prevX = reverse ? x + 1 : x - 1;
              const prevPhysicalX = (prevX * resolution).toFixed(3);
              newGcode.push(`G1 X${prevPhysicalX} Y${physicalY}`);
              newGcode.push('M5 ; Pen up');
              drawingSegment = false;
            }
          }
        }
        if (drawingSegment) {
          const lastX = reverse ? 0 : widthPx - 1;
          const physicalX = (lastX * resolution).toFixed(3);
          newGcode.push(`G1 X${physicalX} Y${physicalY}`);
          newGcode.push('M5 ; Pen up');
        }
      }
      
      newGcode.push('G0 X0 Y0 ; Return to home');
      setGcodeLines(newGcode);
    } catch (e) {
      console.error("GCode Generation Error:", e);
      setGcodeLines(["; Error generating G-code: " + e.message]);
    }
  };

  const handleStart = () => {
    if (gcodeLines.length > 0) {
      startStreaming(gcodeLines);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Image to G-Code</h1>
        <p className="page-subtitle">Convert bitmap images to plotter movements</p>
      </div>

      <div className="image2gcode-grid">
        {/* Controls Panel */}
        <div className="card controls-card">
          <h2 className="section-header">Configuration</h2>
          
          <div className="form-group">
            <label>Upload Image</label>
            <input type="file" accept="image/*" onChange={handleImageUpload} className="file-input" />
          </div>
          
          <div className="form-group">
            <label>Threshold (0-255)</label>
            <input 
              type="number" min="0" max="255" value={threshold} 
              onChange={(e) => setThreshold(Number(e.target.value))} 
              className="number-input"
            />
            <span className="help-text">Pixels darker than this will be drawn.</span>
          </div>
          
          <div className="form-group">
            <label>Target Width (mm): {widthMm}</label>
            <input 
              type="number" min="10" max="1000" value={widthMm} 
              onChange={(e) => setWidthMm(Number(e.target.value))} 
              className="number-input"
            />
          </div>
          
          <div className="form-group">
            <label>Resolution (mm/px): {resolution}</label>
            <input 
              type="number" min="0.1" max="5" step="0.1" value={resolution} 
              onChange={(e) => setResolution(Number(e.target.value))} 
              className="number-input"
            />
            <span className="help-text">Distance between plotted points.</span>
          </div>

          <button 
            className="btn btn-primary" 
            onClick={processImage} 
            disabled={!imageSrc}
            style={{ width: '100%', marginTop: '1rem' }}
          >
            Generate G-Code
          </button>
          
          <button 
            className="btn btn-secondary" 
            onClick={handleClearWork} 
            disabled={!imageSrc}
            style={{ width: '100%', marginTop: '0.5rem' }}
          >
            Clear Work
          </button>
        </div>

        {/* Preview Panel */}
        <div className="card preview-card">
          <h2 className="section-header">Image Preview</h2>
          <div className="canvas-container">
            {!imageSrc && <p className="placeholder-text">No image uploaded</p>}
            <canvas ref={canvasRef} className="image-canvas" style={{ display: imageSrc ? 'block' : 'none' }}></canvas>
          </div>
        </div>

        {/* G-Code Output Panel */}
        <div className="card output-card">
          <h2 className="section-header">G-Code Output</h2>
          <div className="gcode-preview">
            {gcodeLines.length === 0 ? (
              <div className="preview-placeholder">Generate G-code to see preview</div>
            ) : (
              gcodeLines.slice(0, 100).map((line, i) => (
                <div key={i} className="preview-line">
                  <span className="line-number">{i + 1}</span>
                  <span className="line-content">{line}</span>
                </div>
              ))
            )}
            {gcodeLines.length > 100 && (
              <div className="preview-line">
                <span className="line-content" style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>
                  ... and {gcodeLines.length - 100} more lines
                </span>
              </div>
            )}
          </div>
          <div className="button-group" style={{ marginTop: '1rem', flexDirection: 'column' }}>
            <button 
              className="btn btn-secondary full-width" 
              onClick={handleSaveGCode} 
              disabled={gcodeLines.length === 0}
            >
              Save G-Code
            </button>
            <button 
              className="btn btn-success full-width" 
              onClick={handleStart} 
              disabled={!connected || gcodeLines.length === 0 || streaming}
            >
              ▶ Run Job
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
