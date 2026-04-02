import React, { useState } from 'react';
import { useSerial } from '../contexts/SerialContext';
import { BUILTIN_GCODES, builtinToFile } from '../data/builtinGcodes';
import './GCodeJobsPage.css';

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

const CATEGORY_LABELS = { shapes: 'Basic Shapes', calibration: 'Calibration', demo: 'Demo' };

export default function GCodeJobsPage() {
  const {
    connected, streaming, paused, currentLine, totalLines,
    startStreaming, pauseStreaming, resumeStreaming, stopStreaming, logConsole,
  } = useSerial();

  const [tab, setTab] = useState('builtin'); // 'builtin' | 'loaded'
  const [loadedFiles, setLoadedFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewLines, setPreviewLines] = useState([]);

  const progressPct = totalLines > 0 ? Math.round((currentLine / totalLines) * 100) : 0;

  // ── File selection ──────────────────────────────────────────────────────────
  const selectFile = (file) => {
    setSelectedFile(file);
    const lines = file.content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith(';') && !l.startsWith('('));
    setPreviewLines(lines);
  };

  // ── Load external file ──────────────────────────────────────────────────────
  const loadExternalFile = async () => {
    const file = await window.platform.loadGCodeFile();
    if (!file) return;
    setLoadedFiles(prev => {
      // avoid duplicates by path
      if (prev.some(f => f.path === file.path)) return prev;
      return [...prev, file];
    });
    setTab('loaded');
    selectFile(file);
    logConsole(`Loaded: ${file.name} (${formatSize(file.size)}, ${file.lines} commands)`, 'info');
  };

  const removeLoaded = (path, e) => {
    e.stopPropagation();
    setLoadedFiles(prev => prev.filter(f => f.path !== path));
    if (selectedFile?.path === path) {
      setSelectedFile(null);
      setPreviewLines([]);
    }
  };

  // ── Streaming ───────────────────────────────────────────────────────────────
  const handleStart = () => {
    if (previewLines.length === 0) return;
    startStreaming(previewLines);
  };

  // ── Group built-in by category ──────────────────────────────────────────────
  const builtinByCategory = BUILTIN_GCODES.reduce((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">G-Code Jobs</h1>
        <p className="page-subtitle">Load, preview, and stream G-code files to the machine</p>
      </div>

      <div className="gcode-grid">
        {/* Left panel: file browser */}
        <div className="card gcode-files-card">
          {/* Tabs */}
          <div className="gcode-tabs">
            <button
              className={`gcode-tab ${tab === 'builtin' ? 'active' : ''}`}
              onClick={() => setTab('builtin')}
            >
              Built-in
              <span className="tab-count">{BUILTIN_GCODES.length}</span>
            </button>
            <button
              className={`gcode-tab ${tab === 'loaded' ? 'active' : ''}`}
              onClick={() => setTab('loaded')}
            >
              Loaded
              <span className="tab-count">{loadedFiles.length}</span>
            </button>
            <button className="btn btn-primary btn-sm" onClick={loadExternalFile} style={{ marginLeft: 'auto' }}>
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="currentColor" d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M13.5,16V19H10.5V16H8L12,12L16,16H13.5M13,9V3.5L18.5,9H13Z" />
              </svg>
              Load
            </button>
          </div>

          {/* Built-in tab */}
          {tab === 'builtin' && (
            <div className="file-list builtin-list">
              {Object.entries(builtinByCategory).map(([cat, files]) => (
                <div key={cat} className="builtin-category">
                  <div className="builtin-category-label">{CATEGORY_LABELS[cat] || cat}</div>
                  {files.map(f => {
                    const fileObj = builtinToFile(f);
                    const isSelected = selectedFile?.path === `builtin:${f.id}`;
                    return (
                      <div
                        key={f.id}
                        className={`file-item builtin-item ${isSelected ? 'selected' : ''}`}
                        onClick={() => selectFile(fileObj)}
                      >
                        <div className="builtin-item-info">
                          <span className="file-name">{f.name}</span>
                          <span className="builtin-desc">{f.description}</span>
                        </div>
                        <span className="file-size">{fileObj.lines} lines</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* Loaded tab */}
          {tab === 'loaded' && (
            <div className="file-list">
              {loadedFiles.length === 0 ? (
                <div className="file-item" style={{ justifyContent: 'center' }}>
                  <span className="file-name" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No files loaded — click Load
                  </span>
                </div>
              ) : (
                loadedFiles.map(file => {
                  const isSelected = selectedFile?.path === file.path;
                  return (
                    <div
                      key={file.path}
                      className={`file-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => selectFile(file)}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                        <span className="file-name">{file.name}</span>
                        <span className="file-size">{formatSize(file.size)} · {file.lines} lines</span>
                      </div>
                      <button className="file-remove-btn" onClick={e => removeLoaded(file.path, e)}>×</button>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Progress */}
          <div className="progress-section">
            <div className="progress-label">
              <span>Job Progress</span>
              <span>{streaming ? `${progressPct}% (${currentLine}/${totalLines})` : `${progressPct}%`}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* Controls */}
          <div className="button-group gcode-controls">
            <button className="btn btn-primary btn-sm" onClick={handleStart}
              disabled={!connected || !selectedFile || streaming}>
              ▶ Start
            </button>
            <button className="btn btn-secondary btn-sm" onClick={pauseStreaming}
              disabled={!streaming || paused}>
              ⏸ Pause
            </button>
            <button className="btn btn-secondary btn-sm" onClick={resumeStreaming}
              disabled={!streaming || !paused}>
              ▶ Resume
            </button>
            <button className="btn btn-secondary btn-sm" onClick={stopStreaming}
              disabled={!streaming}>
              ⏹ Stop
            </button>
          </div>
        </div>

        {/* Right panel: G-code preview */}
        <div className="card gcode-preview-card">
          <h2 className="section-header">
            G-Code Preview
            {selectedFile && (
              <span className="preview-filename"> — {selectedFile.name}</span>
            )}
          </h2>
          <div className="gcode-preview">
            {previewLines.length === 0 ? (
              <div className="preview-placeholder">Select a file to preview its G-code content</div>
            ) : (
              previewLines.map((line, i) => (
                <div
                  key={i}
                  className={`preview-line ${streaming && i < currentLine ? 'executed' : ''} ${streaming && i === currentLine ? 'current' : ''}`}
                >
                  <span className="line-number">{i + 1}</span>
                  <span className="line-content">{line}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
