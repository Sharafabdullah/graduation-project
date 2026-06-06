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
    numberofcolors: 2,
    ltres: 1,
    qtres: 1,
    pathomit: 8,
  });
  const [compiledGCode, setCompiledGCode] = useState([]);
  const [activeTab, setActiveTab] = useState('image');
  const [lineWidth, setLineWidth] = useState(1);

  const value = {
    previewSrc, setPreviewSrc,
    tracedSVG, setTracedSVG,
    tracerOptions, setTracerOptions,
    compiledGCode, setCompiledGCode,
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
  };

  return <Image2GCodeContext.Provider value={value}>{children}</Image2GCodeContext.Provider>;
}
