import React, { createContext, useContext, useState } from 'react';

const Image2GCodeContext = createContext(null);

export function useImage2GCode() {
  const ctx = useContext(Image2GCodeContext);
  if (!ctx) throw new Error('useImage2GCode must be used within Image2GCodeProvider');
  return ctx;
}

export function Image2GCodeProvider({ children }) {
  const [previewSrc, setPreviewSrc] = useState(null);
  const [tracedSVG, setTracedSVG] = useState(null);
  const [tracerOptions, setTracerOptions] = useState({
    numberofcolors: 4,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
    blurradius: 0,
    threshold: 128,
  });
  const [compiledGCode, setCompiledGCode] = useState([]);
  const [activeTab, setActiveTab] = useState('upload');
  const [lineWidth, setLineWidth] = useState(1);
  const [fillWideStrokes, setFillWideStrokes] = useState(false);
  const [backgroundColor, setBackgroundColor] = useState(null);
  const [tracerMode, setTracerMode] = useState('outline'); // 'outline' | 'multicolor'

  // multicolorMode is derived from tracerMode — not a separate stored state
  const multicolorMode = tracerMode === 'multicolor';

  const value = {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    compiledGCode, setCompiledGCode,
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
    fillWideStrokes, setFillWideStrokes,
    multicolorMode,
    backgroundColor, setBackgroundColor,
    tracerMode, setTracerMode,
  };

  return <Image2GCodeContext.Provider value={value}>{children}</Image2GCodeContext.Provider>;
}
