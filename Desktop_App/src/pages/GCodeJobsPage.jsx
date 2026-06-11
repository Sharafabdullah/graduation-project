import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSerial } from '../contexts/SerialContext';
import { useJobs } from '../contexts/JobsContext';
import { getBuiltinsForMode, builtinToFile } from '../data/builtinGcodes';
import { useMode } from '../contexts/ModeContext';
import { FileUp, FolderOpen } from 'lucide-react';
import ModeSelector from '../components/ModeSelector';
import GCodePreview from '../components/GCodePreview';
import './GCodeJobsPage.css';
import { useSettings } from '../contexts/SettingsContext';
import { scanGCodeBounds } from '../lib/softLimits';

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s % 60}s`;
}

const CATEGORY_LABELS = { shapes: 'Basic Shapes', calibration: 'Calibration', demo: 'Demo' };

export default function GCodeJobsPage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const {
    connected, streaming, paused, currentLine, totalLines,
    startStreaming, pauseStreaming, resumeStreaming, stopStreaming, logConsole,
    commandLog, jobHistory, homed, homeFloor,
  } = useSerial();

  const { loadedFiles, addLoadedFile, removeLoadedFile } = useJobs();
  const { mode } = useMode();

  const [tab, setTab] = useState('builtin');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewLines, setPreviewLines] = useState([]);
  const [hoveredCmd, setHoveredCmd] = useState(null);
  const [boundsWarning, setBoundsWarning] = useState(null); // null | { count: number, violations: array }
  const previewRef = useRef(null);
  const [leftWidth, setLeftWidth] = useState(360);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const handleResizeStart = useCallback((e) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = leftWidth;
    e.preventDefault();
  }, [leftWidth]);

  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      setLeftWidth(Math.max(220, Math.min(600, dragStartWidth.current + delta)));
    };
    const onMouseUp = () => { isDragging.current = false; };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const progressPct = totalLines > 0 ? Math.round((currentLine / totalLines) * 100) : 0;

  // Map lineNum → commandEntry for O(1) status lookups during streaming
  const streamCommandMap = useMemo(() => {
    const map = new Map();
    commandLog.forEach((cmd) => {
      if (cmd.source === 'stream' && cmd.lineNum != null) {
        map.set(cmd.lineNum, cmd);
      }
    });
    return map;
  }, [commandLog]);

  const getLineStatus = (i) => {
    const cmd = streamCommandMap.get(i);
    if (!cmd) return streaming ? 'queued' : '';
    return cmd.status;
  };

  const scrollToExecuting = () => {
    let execIdx = null;
    streamCommandMap.forEach((cmd, idx) => { if (cmd.status === 'executing') execIdx = idx; });
    if (execIdx == null) return;
    previewRef.current?.querySelector(`[data-line="${execIdx}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const scrollToLastDone = () => {
    let lastIdx = -1;
    streamCommandMap.forEach((cmd, idx) => { if (cmd.status === 'done' && idx > lastIdx) lastIdx = idx; });
    if (lastIdx === -1) return;
    previewRef.current?.querySelector(`[data-line="${lastIdx}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ── File selection ──────────────────────────────────────────────────────────
  const selectFile = (file) => {
    setSelectedFile(file);
    const lines = file.content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith(';') && !l.startsWith('('));
    setPreviewLines(lines);
    const violations = scanGCodeBounds(lines, {
      bedMaxX: settings.bedMaxX ?? 200,
      bedMaxY: settings.bedMaxY ?? 200,
      softLimitMargin: settings.softLimitMargin ?? 10,
    });
    setBoundsWarning(violations.length > 0 ? { count: violations.length, violations } : null);
  };

  const loadExternalFile = async () => {
    const file = await window.platform.loadGCodeFile();
    if (!file) return;
    addLoadedFile(file);
    setTab('loaded');
    selectFile(file);
    logConsole(`Loaded: ${file.name} (${formatSize(file.size)}, ${file.lines} commands)`, 'info');
  };

  const removeLoaded = (path, e) => {
    e.stopPropagation();
    removeLoadedFile(path);
    if (selectedFile?.path === path) {
      setSelectedFile(null);
      setPreviewLines([]);
      setBoundsWarning(null);
    }
  };

  const handleStart = () => {
    if (previewLines.length === 0) return;
    startStreaming(previewLines, selectedFile?.name || 'Job');
  };

  const modeBuiltins = getBuiltinsForMode(mode);

  const builtinByCategory = modeBuiltins.reduce((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="page gcode-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">G-Code Jobs</h1>
          <p className="page-subtitle">Load, preview, and stream G-code files to the machine</p>
        </div>
        <ModeSelector />
      </div>

      <div className="gcode-grid">
        {/* Left panel: file browser */}
        <div className="card gcode-files-card" style={{ width: leftWidth }}>
          <div className="gcode-tabs">
            <button
              className={`gcode-tab ${tab === 'builtin' ? 'active' : ''}`}
              onClick={() => { setTab('builtin'); setBoundsWarning(null); }}
            >
              Built-in
              <span className="tab-count">{modeBuiltins.length}</span>
            </button>
            <button
              className={`gcode-tab ${tab === 'loaded' ? 'active' : ''}`}
              onClick={() => { setTab('loaded'); setBoundsWarning(null); }}
            >
              Loaded
              <span className="tab-count">{loadedFiles.length}</span>
            </button>
            <button
              className={`gcode-tab ${tab === 'history' ? 'active' : ''}`}
              onClick={() => { setTab('history'); setBoundsWarning(null); }}
            >
              History
              <span className="tab-count">{jobHistory.length}</span>
            </button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => window.platform.openJobsFolder()} 
                title="Open Jobs Folder"
              >
                <FolderOpen size={14} />
              </button>
              <button className="btn btn-primary btn-sm" onClick={loadExternalFile}>
                <FileUp size={14} />
                Load
              </button>
            </div>
          </div>

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

          {tab === 'history' && (
            <div className="file-list">
              {jobHistory.length === 0 ? (
                <div className="file-item" style={{ justifyContent: 'center' }}>
                  <span className="file-name" style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    No jobs run yet
                  </span>
                </div>
              ) : (
                [...jobHistory].reverse().map(job => (
                  <div key={job.id} className="file-item history-item">
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1, gap: 2 }}>
                      <span className="file-name">{job.name}</span>
                      <span className="file-size">
                        {new Date(job.startedAt).toTimeString().slice(0, 8)}
                        {' · '}
                        {formatDuration(job.duration)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span className={`history-status-pill status-${job.status}`}>
                        {job.status === 'completed' ? 'Done' : 'Stopped'}
                      </span>
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => navigate(`/console?jobId=${job.jobId}`)}
                        title="View console log for this job"
                      >
                        Log
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="progress-section">
            <div className="progress-label">
              <span>Job Progress</span>
              <span>{streaming ? `${progressPct}% (${currentLine}/${totalLines})` : `${progressPct}%`}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

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

        {/* Drag handle */}
        <div className="resize-handle" onMouseDown={handleResizeStart} />

        {/* Right panel: G-code preview */}
        <div className="card gcode-preview-card">
          <div className="preview-header">
            <h2 className="section-header" style={{ margin: 0 }}>
              G-Code Preview
              {selectedFile && <span className="preview-filename"> — {selectedFile.name}</span>}
            </h2>
            {streaming && (
              <div className="preview-nav-buttons">
                <button className="btn btn-sm btn-ghost" onClick={scrollToExecuting}>
                  ↑ Executing
                </button>
                <button className="btn btn-sm btn-ghost" onClick={scrollToLastDone}>
                  ↑ Last Done
                </button>
              </div>
            )}
          </div>
          {boundsWarning && (
            <div style={{
              background: 'rgba(255, 200, 0, 0.12)',
              border: '1px solid rgba(255, 200, 0, 0.4)',
              borderRadius: '6px',
              padding: '8px 12px',
              marginBottom: '8px',
              fontSize: '12px',
              color: 'var(--text-secondary)',
            }}>
              ⚠ {boundsWarning.count} line{boundsWarning.count !== 1 ? 's' : ''} outside safe working margin — out-of-bounds moves will be skipped at runtime
            </div>
          )}

          <div className="gcode-preview-canvas-wrapper">
            <GCodePreview 
              lines={previewLines} 
              bedW={settings.bedMaxX ?? 200} 
              bedH={settings.bedMaxY ?? 200} 
              softLimitMargin={settings.softLimitMargin ?? 10} 
              homeFloor={homed ? homeFloor : null} 
            />
          </div>

          <div className="gcode-preview" ref={previewRef}>
            {previewLines.length === 0 ? (
              <div className="preview-placeholder">Select a file to preview its G-code content</div>
            ) : (
              previewLines.map((line, i) => {
                const status = getLineStatus(i);
                const cmd = streamCommandMap.get(i);
                return (
                  <div
                    key={i}
                    data-line={i}
                    className={`preview-line${status ? ` status-${status}` : ''}`}
                    onMouseEnter={(e) => {
                      if (!cmd || cmd.status === 'queued') return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      setHoveredCmd({ cmd, x: rect.right + 8, y: rect.top });
                    }}
                    onMouseLeave={() => setHoveredCmd(null)}
                  >
                    <span className="line-number">{i + 1}</span>
                    <span className="line-content">{line}</span>
                  </div>
                );
              })
            )}
          </div>

          {hoveredCmd && (
            <div
              className="preview-tooltip"
              style={{ position: 'fixed', left: hoveredCmd.x, top: hoveredCmd.y, zIndex: 1000 }}
            >
              <div className="tooltip-cmd">{hoveredCmd.cmd.cmd}</div>
              <div className="tooltip-row">
                <span>Sent:</span><span>{formatTimestamp(hoveredCmd.cmd.sentAt)}</span>
              </div>
              {hoveredCmd.cmd.ackedAt ? (
                <>
                  <div className="tooltip-row">
                    <span>Acked:</span><span>{formatTimestamp(hoveredCmd.cmd.ackedAt)}</span>
                  </div>
                  <div className="tooltip-row">
                    <span>Duration:</span><span>{hoveredCmd.cmd.duration}ms</span>
                  </div>
                </>
              ) : (
                <div className="tooltip-row">
                  <span>Acked:</span><span className="tooltip-pending">Pending…</span>
                </div>
              )}
              {hoveredCmd.cmd.response && hoveredCmd.cmd.response.length > 0 && (
                <div className="tooltip-row">
                  <span>Response:</span>
                  <span>{hoveredCmd.cmd.response.join(' | ')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
