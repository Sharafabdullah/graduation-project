import React, { useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSerial } from '../contexts/SerialContext';
import { useSettings } from '../contexts/SettingsContext';
import { useImage2GCode } from '../contexts/Image2GCodeContext';
import { useJobs } from '../contexts/JobsContext';
import { useMode } from '../contexts/ModeContext';
import ImageToGCodeTab from './tabs/ImageToGCodeTab';
import VectorDrawerTab from './tabs/VectorDrawerTab';
import GCodePreview from '../components/GCodePreview';
import Dialog from '../components/Dialog';
import { compileSVGToGCode } from '../lib/gcodeCompiler';
import { scanGCodeBounds } from '../lib/softLimits';
import { Play, Save, Zap } from 'lucide-react';
import './Image2GCodePage.css';

export default function Image2GCodePage() {
  const { connected, streaming, startStreaming, homed, homeFloor } = useSerial();
  const { settings } = useSettings();
  const { addLoadedFile } = useJobs();
  const { mode } = useMode();
  const navigate = useNavigate();
  const bedW = settings?.bedMaxX || 200;
  const bedH = settings?.bedMaxY || 200;

  const {
    activeTab, setActiveTab,
    lineWidth,
    fillWideStrokes,
    tracedSVG, setTracedSVG,
    compiledGCode, setCompiledGCode,
    multicolorMode,
    backgroundColor,
  } = useImage2GCode();

  const [compileError, setCompileError] = React.useState('');
  const [compileWarning, setCompileWarning] = React.useState(null);
  const editorRef = useRef(null);

  // Add traced SVG to the canvas without clearing existing content, then switch to canvas tab
  const handleAddToCanvas = useCallback((svgString) => {
    setTracedSVG(svgString);
    if (editorRef.current) {
      editorRef.current.addSVG(svgString);
    }
    setActiveTab('canvas');
    setCompileWarning(null);
  }, [setTracedSVG, setActiveTab]);

  useEffect(() => {
    setCompileWarning(null);
  }, [tracedSVG]);

  const handleCompile = useCallback(() => {
    setCompileWarning(null);
    let svgSource = '';
    if (activeTab === 'canvas' && editorRef.current) {
      svgSource = editorRef.current.toSVG();
    } else if (tracedSVG) {
      svgSource = tracedSVG;
    }
    if (!svgSource) {
      setCompileError('Nothing to compile. Trace an image or draw on the canvas first.');
      return;
    }
    setCompileError('');
    try {
      const lines = compileSVGToGCode(svgSource, {
        maxFeedrate: settings?.maxFeedrate || 1000,
        servoPenDown: settings?.servoPenDown || 30,
        servoPenUp: settings?.servoPenUp || 75,
        bedH,
        multicolorMode,
        backgroundColor: multicolorMode ? backgroundColor : null,
        lineWidth,
        fillWideStrokes,
      });
      if (!lines.some(l => l.startsWith('G1'))) {
        setCompileError('No drawable paths found. Add shapes or trace an image first.');
        return;
      }
      setCompiledGCode(lines);
      setCompileError('');
      const violations = scanGCodeBounds(lines, {
        bedMaxX: settings.bedMaxX ?? 200,
        bedMaxY: settings.bedMaxY ?? 200,
        softLimitMargin: settings.softLimitMargin ?? 10,
      });
      setCompileWarning(violations.length > 0 ? violations.length : null);
    } catch (err) {
      setCompileError(`Compile error: ${err.message}`);
    }
  }, [activeTab, tracedSVG, settings, bedH, multicolorMode, backgroundColor, lineWidth, fillWideStrokes, setCompiledGCode]);

  const [dialog, setDialog] = React.useState({ open: false });
  const closeDialog = useCallback(() => setDialog({ open: false }), []);

  const performSaveJob = useCallback(async (name) => {
    const result = await window.platform.saveJob(name, compiledGCode);
    if (result && result.success) {
      addLoadedFile(result.job);
      navigate('/gcode');
    } else {
      setDialog({
        open: true, mode: 'alert', title: 'Save Failed',
        message: `Failed to save job: ${result?.error || 'Unknown error'}`,
        confirmLabel: 'OK', onConfirm: closeDialog, onCancel: closeDialog,
      });
    }
  }, [compiledGCode, addLoadedFile, navigate, closeDialog]);

  const handleSaveJob = useCallback(() => {
    if (compiledGCode.length === 0) return;
    const defaultName = `Image Job ${new Date().toTimeString().slice(0, 8)}`;
    setDialog({
      open: true, mode: 'prompt', title: 'Save Job',
      message: 'Enter a name for this job:',
      defaultValue: defaultName, confirmLabel: 'Save',
      onConfirm: (name) => { closeDialog(); if (name?.trim()) performSaveJob(name.trim()); },
      onCancel: closeDialog,
    });
  }, [compiledGCode, closeDialog, performSaveJob]);

  const handleStart = useCallback(() => {
    if (compiledGCode.length > 0) startStreaming(compiledGCode, 'Image Job');
  }, [compiledGCode, startStreaming]);

  const canCompile = activeTab === 'canvas' || !!tracedSVG;

  return (
    <div className="page i2g-page">
      <div className="page-header">
        <h1 className="page-title">Image to G-Code</h1>
        <p className="page-subtitle">Trace images or draw vectors, then compile and run</p>
      </div>

      {mode === 'drill' ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
          <h2>Image to G-Code is not supported in Drill Mode</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Switch to Pen or Laser mode to use this feature.
          </p>
        </div>
      ) : (
        <div className="i2g-layout">
          {/* ── Tab bar ─────────────────────────────────────── */}
          <div className="i2g-tabs">
            <button
              className={`i2g-tab${activeTab === 'upload' ? ' active' : ''}`}
              onClick={() => setActiveTab('upload')}
            >
              Upload &amp; Transform
            </button>
            <button
              className={`i2g-tab${activeTab === 'canvas' ? ' active' : ''}`}
              onClick={() => setActiveTab('canvas')}
            >
              Canvas
            </button>
            <button
              className={`i2g-tab${activeTab === 'gcode' ? ' active' : ''}`}
              onClick={() => setActiveTab('gcode')}
            >
              G-Code Preview
            </button>
          </div>

          {/* ── Tab content ─────────────────────────────────── */}
          <div className="i2g-tab-body">
            <div style={{ display: activeTab === 'upload' ? 'flex' : 'none', height: '100%' }}>
              <ImageToGCodeTab onAddToCanvas={handleAddToCanvas} />
            </div>

            {/* Canvas tab: always mounted so the Fabric.js state survives tab switches */}
            <div style={{ display: activeTab === 'canvas' ? 'flex' : 'none', height: '100%' }}>
              <VectorDrawerTab
                editorRef={editorRef}
                bedW={bedW}
                bedH={bedH}
                lineWidth={lineWidth}
                backgroundColor={multicolorMode ? backgroundColor : null}
                softLimitMargin={settings?.softLimitMargin ?? 10}
                homed={homed}
                homeFloor={homed ? homeFloor : null}
              />
            </div>

            <div style={{ display: activeTab === 'gcode' ? 'flex' : 'none', height: '100%' }}>
              <div className="tab-content gcode-preview-tab">
                <div className="outline-tab-info">
                  <span className="gcode-line-count">
                    {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code — compile a job first'}
                  </span>
                  {compileWarning && (
                    <span style={{ color: 'rgba(255, 200, 0, 0.9)', fontSize: '12px' }}>
                      ⚠ {compileWarning} line{compileWarning !== 1 ? 's' : ''} outside safe margin
                    </span>
                  )}
                </div>
                <div className="outline-tab-preview">
                  <GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} softLimitMargin={settings.softLimitMargin ?? 10} homeFloor={homed ? homeFloor : null} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Shared bottom bar ────────────────────────────── */}
          <div className="i2g-bottom-bar card">
            <div className="bottom-bar-left">
              <button
                className="btn btn-primary"
                onClick={handleCompile}
                disabled={!canCompile}
              >
                <Zap size={14} style={{ marginRight: 6 }} />
                Compile Job
              </button>
              {compileError && <span className="error-text" style={{ marginLeft: 8 }}>{compileError}</span>}
            </div>

            <div className="bottom-bar-right">
              <span className="gcode-line-count">
                {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code'}
              </span>
              <button
                className="btn btn-secondary"
                onClick={handleSaveJob}
                disabled={compiledGCode.length === 0}
                title="Save G-code and send to jobs"
              >
                <Save size={14} style={{ marginRight: 6 }} />
                Save Job
              </button>
              <button
                className="btn btn-success"
                onClick={handleStart}
                disabled={!connected || compiledGCode.length === 0 || streaming}
              >
                <Play size={14} style={{ marginRight: 6 }} />
                Run Job
              </button>
            </div>
          </div>
        </div>
      )}

      <Dialog {...dialog} />
    </div>
  );
}
