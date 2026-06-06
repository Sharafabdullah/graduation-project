import React, { useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSerial } from '../contexts/SerialContext';
import { useSettings } from '../contexts/SettingsContext';
import { useImage2GCode } from '../contexts/Image2GCodeContext';
import { useJobs } from '../contexts/JobsContext';
import ImageToGCodeTab from './tabs/ImageToGCodeTab';
import VectorDrawerTab from './tabs/VectorDrawerTab';
import GCodePreview from '../components/GCodePreview';
import { compileSVGToGCode } from '../lib/gcodeCompiler';
import { scanGCodeBounds } from '../lib/softLimits';
import { Play, Save, Zap, SendToBack } from 'lucide-react';
import './Image2GCodePage.css';

export default function Image2GCodePage() {
  const { connected, streaming, startStreaming } = useSerial();
  const { settings } = useSettings();
  const { addLoadedFile } = useJobs();
  const navigate = useNavigate();
  const bedW = settings?.bedMaxX || 200;
  const bedH = settings?.bedMaxY || 200;

  const {
    activeTab, setActiveTab,
    lineWidth, setLineWidth,
    tracedSVG, setTracedSVG,
    compiledGCode, setCompiledGCode,
  } = useImage2GCode();

  const [injectedSVG, setInjectedSVG] = React.useState(null);
  const [compileError, setCompileError] = React.useState('');
  const [compileWarning, setCompileWarning] = React.useState(null); // null | number (violation count)
  const editorRef = useRef(null);

  const handleSendToDrawer = useCallback((svgString) => {
    setTracedSVG(svgString);
    setInjectedSVG(svgString);
    setActiveTab('drawer');
    setCompileWarning(null);
  }, [setTracedSVG, setActiveTab]);

  const handleCompile = useCallback(() => {
    let svgSource = '';
    if (activeTab === 'drawer' && editorRef.current) {
      svgSource = editorRef.current.toSVG();
    } else if (tracedSVG) {
      svgSource = tracedSVG;
    }
    if (!svgSource) {
      setCompileError('Nothing to compile. Draw something or trace an image first.');
      return;
    }
    setCompileError('');
    try {
      const lines = compileSVGToGCode(svgSource, {
        maxFeedrate: settings?.maxFeedrate || 1000,
        servoPenDown: settings?.servoPenDown || 30,
        servoPenUp: settings?.servoPenUp || 75,
        bedH,
      });
      if (!lines.some(l => l.startsWith('G1'))) {
        setCompileError('No drawable paths found. Add shapes or trace an image first.');
        return;
      }
      setCompiledGCode(lines);
      setCompileError('');
      const violations = scanGCodeBounds(lines, {
        bedMaxX: settings.bedMaxX,
        bedMaxY: settings.bedMaxY,
        softLimitMargin: settings.softLimitMargin,
      });
      setCompileWarning(violations.length > 0 ? violations.length : null);
    } catch (err) {
      setCompileError(`Compile error: ${err.message}`);
    }
  }, [activeTab, tracedSVG, settings, bedH, setCompiledGCode]);

  const handleSave = useCallback(async () => {
    if (compiledGCode.length === 0) return;
    const result = await window.platform.saveGCode(compiledGCode);
    if (result && !result.success && result.error !== 'Save canceled') {
      console.error('Save .gcode failed:', result.error);
    }
  }, [compiledGCode]);

  const handleSendToJobs = useCallback(() => {
    if (compiledGCode.length === 0) return;
    const name = `Image Job ${new Date().toTimeString().slice(0, 8)}`;
    const content = compiledGCode.join('\n');
    addLoadedFile({
      name,
      content,
      path: `image2gcode:${Date.now()}`,
      size: content.length,
      lines: compiledGCode.length,
    });
    navigate('/gcode');
  }, [compiledGCode, addLoadedFile, navigate]);

  const handleStart = useCallback(() => {
    if (compiledGCode.length > 0) startStreaming(compiledGCode, 'Image Job');
  }, [compiledGCode, startStreaming]);

  const canCompile = activeTab === 'drawer' || !!tracedSVG;

  return (
    <div className="page i2g-page">
      <div className="page-header">
        <h1 className="page-title">Image to G-Code</h1>
        <p className="page-subtitle">Trace images or draw vectors, then compile and run</p>
      </div>

      <div className="i2g-layout">
        {/* ── Tab bar ─────────────────────────────────────── */}
        <div className="i2g-tabs">
          <button
            className={`i2g-tab${activeTab === 'image' ? ' active' : ''}`}
            onClick={() => setActiveTab('image')}
          >
            Image to G-Code
          </button>
          <button
            className={`i2g-tab${activeTab === 'drawer' ? ' active' : ''}`}
            onClick={() => setActiveTab('drawer')}
          >
            Vector Drawer
          </button>
        </div>

        {/* ── Tab content ─────────────────────────────────── */}
        <div className="i2g-tab-body">
          <div style={{ display: activeTab === 'image' ? 'flex' : 'none', height: '100%' }}>
            <ImageToGCodeTab onSendToDrawer={handleSendToDrawer} />
          </div>
          <div style={{ display: activeTab === 'drawer' ? 'flex' : 'none', height: '100%' }}>
            <VectorDrawerTab
              editorRef={editorRef}
              bedW={bedW}
              bedH={bedH}
              lineWidth={lineWidth}
              injectedSVG={injectedSVG}
            />
          </div>
        </div>

        {/* ── Shared bottom bar ────────────────────────────── */}
        <div className="i2g-bottom-bar card">
          <div className="bottom-bar-left">
            <label className="bottom-label">Line Width (mm)</label>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={lineWidth}
              onChange={(e) => setLineWidth(Number(e.target.value))}
              className="number-input line-width-input"
            />
            <button
              className="btn btn-primary"
              onClick={handleCompile}
              disabled={!canCompile}
            >
              <Zap size={14} style={{ marginRight: 6 }} />
              Compile Job
            </button>
            {compileError && <span className="error-text" style={{ marginLeft: 8 }}>{compileError}</span>}
            {compileWarning && (
              <span style={{ color: 'rgba(255, 200, 0, 0.9)', fontSize: '11px' }}>
                ⚠ {compileWarning} line{compileWarning !== 1 ? 's' : ''} outside safe margin
              </span>
            )}
          </div>

          <div className="bottom-bar-preview">
            <GCodePreview lines={compiledGCode} bedW={bedW} bedH={bedH} />
          </div>

          <div className="bottom-bar-right">
            <span className="gcode-line-count">
              {compiledGCode.length > 0 ? `${compiledGCode.length} lines` : 'No G-Code'}
            </span>
            <button
              className="btn btn-secondary"
              onClick={handleSave}
              disabled={compiledGCode.length === 0}
            >
              <Save size={14} style={{ marginRight: 6 }} />
              Save .gcode
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleSendToJobs}
              disabled={compiledGCode.length === 0}
              title="Add to G-Code Jobs loaded list"
            >
              <SendToBack size={14} style={{ marginRight: 6 }} />
              Send to Jobs
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
    </div>
  );
}
