import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSerial } from '../contexts/SerialContext';
import ModeSelector from '../components/ModeSelector';
import './ConsolePage.css';

const QUICK_COMMANDS = [
  { label: 'G28 Home', cmd: 'G28' },
  { label: 'M3 Head Down', cmd: 'M3' },
  { label: 'M5 Head Up', cmd: 'M5' },
  { label: 'G90 Abs', cmd: 'G90' },
  { label: 'G91 Rel', cmd: 'G91' },
  { label: '? Status', cmd: '?' },
  { label: '$? Settings', cmd: '$?' },
];

const EVENT_ICONS = {
  connected: '✓',
  disconnected: '✕',
  job_start: '▶',
  job_done: '✓',
  job_stop: '⏹',
  paused: '⏸',
  resumed: '▶',
  estop: '⛔',
  homing_start: '⌂',
  homing_done: '⌂',
  error: '✕',
};

function formatTimestamp(ts) {
  const d = new Date(ts);
  return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function CmdTooltip({ cmd, x, y }) {
  return (
    <div className="cmd-tooltip" style={{ left: x, top: y }}>
      <div className="tooltip-cmd">{cmd.cmd}</div>
      <div className="tooltip-row"><span>Sent:</span><span>{formatTimestamp(cmd.sentAt)}</span></div>
      {cmd.ackedAt ? (
        <>
          <div className="tooltip-row"><span>Acked:</span><span>{formatTimestamp(cmd.ackedAt)}</span></div>
          <div className="tooltip-row"><span>Duration:</span><span>{cmd.duration}ms</span></div>
        </>
      ) : (
        <div className="tooltip-row"><span>Acked:</span><span className="tooltip-pending">Pending…</span></div>
      )}
      {cmd.response && cmd.response.length > 0 && (
        <div className="tooltip-row tooltip-response">
          <span>Response:</span><span>{cmd.response.join(' | ')}</span>
        </div>
      )}
    </div>
  );
}

export default function ConsolePage() {
  const {
    consoleLog, commandLog, eventLog, jobHistory,
    logConsole, clearConsole, sendCommand, connected,
  } = useSerial();

  const [searchParams] = useSearchParams();

  const [input, setInput] = useState('');
  const [showOk, setShowOk] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const [cmdTypeFilter, setCmdTypeFilter] = useState('all');
  const [cmdStatusFilter, setCmdStatusFilter] = useState('all');
  const [eventLevelFilter, setEventLevelFilter] = useState('all');
  const [jobFilter, setJobFilter] = useState('all');
  const [hoveredCmd, setHoveredCmd] = useState(null);

  // Pre-select job filter from URL param (?jobId=xxx)
  useEffect(() => {
    const jobId = searchParams.get('jobId');
    if (jobId) setJobFilter(jobId);
  }, [searchParams]);

  const terminalRef = useRef(null);
  const commandRef = useRef(null);
  const eventRef = useRef(null);
  const terminalEndRef = useRef(null);
  const inputRef = useRef(null);
  const isSyncingRef = useRef(false);

  // ── Filtered data ────────────────────────────────────────────────────────────
  const filteredConsole = useMemo(() => consoleLog.filter((e) => {
    if (!showOk && e.message.includes('< ok')) return false;
    if (!showDebug && e.message.includes('Debug:')) return false;
    if (jobFilter !== 'all' && e.jobId !== jobFilter) return false;
    return true;
  }), [consoleLog, showOk, showDebug, jobFilter]);

  const filteredCommands = useMemo(() => commandLog.filter((cmd) => {
    if (cmdTypeFilter !== 'all' && cmd.type !== cmdTypeFilter) return false;
    if (cmdStatusFilter !== 'all' && cmd.status !== cmdStatusFilter) return false;
    return true;
  }), [commandLog, cmdTypeFilter, cmdStatusFilter]);

  const filteredEvents = useMemo(() => eventLog.filter((e) => {
    if (eventLevelFilter !== 'all' && e.level !== eventLevelFilter) return false;
    return true;
  }), [eventLog, eventLevelFilter]);

  // Auto-scroll terminal to bottom on new entries
  useEffect(() => {
    if (!isSyncingRef.current && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [filteredConsole]);

  // ── Scroll sync ──────────────────────────────────────────────────────────────
  const getTimestampAtTop = (containerRef) => {
    if (!containerRef.current) return null;
    const containerRect = containerRef.current.getBoundingClientRect();
    const children = Array.from(containerRef.current.children);
    for (const child of children) {
      if (!child.dataset.ts) continue;
      const rect = child.getBoundingClientRect();
      if (rect.bottom > containerRect.top) return parseInt(child.dataset.ts, 10);
    }
    return null;
  };

  const scrollColumnToTimestamp = (containerRef, ts) => {
    if (!containerRef.current || !ts) return;
    const children = Array.from(containerRef.current.children).filter((c) => c.dataset.ts);
    let nearestEl = null;
    for (const child of children) {
      if (parseInt(child.dataset.ts, 10) <= ts) nearestEl = child;
      else break;
    }
    if (nearestEl) nearestEl.scrollIntoView({ block: 'start' });
  };

  const terminalScrollFn = useRef(null);
  terminalScrollFn.current = () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const ts = getTimestampAtTop(terminalRef);
    if (ts) {
      scrollColumnToTimestamp(commandRef, ts);
      scrollColumnToTimestamp(eventRef, ts);
    }
    setTimeout(() => { isSyncingRef.current = false; }, 100);
  };

  const commandScrollFn = useRef(null);
  commandScrollFn.current = () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const ts = getTimestampAtTop(commandRef);
    if (ts) {
      scrollColumnToTimestamp(terminalRef, ts);
      scrollColumnToTimestamp(eventRef, ts);
    }
    setTimeout(() => { isSyncingRef.current = false; }, 100);
  };

  const eventScrollFn = useRef(null);
  eventScrollFn.current = () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    const ts = getTimestampAtTop(eventRef);
    if (ts) {
      scrollColumnToTimestamp(terminalRef, ts);
      scrollColumnToTimestamp(commandRef, ts);
    }
    setTimeout(() => { isSyncingRef.current = false; }, 100);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleTerminalScroll = useCallback(debounce(() => terminalScrollFn.current?.(), 50), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleCommandScroll = useCallback(debounce(() => commandScrollFn.current?.(), 50), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleEventScroll = useCallback(debounce(() => eventScrollFn.current?.(), 50), []);

  // ── Input ────────────────────────────────────────────────────────────────────
  const handleSend = () => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    sendCommand(cmd);
    setInput('');
    inputRef.current?.focus();
  };

  const handleExport = async () => {
    const content = consoleLog.map((e) => e.message).join('\n');
    const result = await window.platform.saveLog(content);
    if (result.success) logConsole(`Log exported to: ${result.path}`, 'info');
  };

  return (
    <div className="page console-page-v2">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="page-title">Console</h1>
            <p className="page-subtitle">Serial terminal · Command queue · Event log</p>
          </div>
          <div className="console-toolbar">
            <button className="btn btn-sm btn-ghost" onClick={clearConsole}>Clear Terminal</button>
            <button className="btn btn-sm btn-ghost" onClick={handleExport}>Export</button>
            <ModeSelector />
          </div>
        </div>
      </div>

      <div className="quick-commands">
        {QUICK_COMMANDS.map((qc) => (
          <button key={qc.cmd} className="btn btn-sm btn-ghost"
            onClick={() => { if (connected) sendCommand(qc.cmd); }}
            disabled={!connected}
          >
            {qc.label}
          </button>
        ))}
      </div>

      {/* 3-column grid */}
      <div className="console-grid">

        {/* Column 1 — Serial Terminal */}
        <div className="console-col">
          <div className="col-header">
            <span className="col-title">Serial Terminal</span>
            <div className="col-filters">
              <label className="filter-toggle">
                <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} />
                <span>ok</span>
              </label>
              <label className="filter-toggle">
                <input type="checkbox" checked={showDebug} onChange={(e) => setShowDebug(e.target.checked)} />
                <span>Debug</span>
              </label>
              <select
                value={jobFilter}
                onChange={(e) => setJobFilter(e.target.value)}
                className="filter-select"
                title="Filter by job"
              >
                <option value="all">All jobs</option>
                {[...jobHistory].reverse().map((job) => (
                  <option key={job.jobId} value={job.jobId}>
                    {job.name} ({new Date(job.startedAt).toTimeString().slice(0, 8)})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="col-body" ref={terminalRef} onScroll={handleTerminalScroll}>
            {filteredConsole.map((entry) => (
              <div key={entry.id} className={`console-line ${entry.type}`} data-ts={entry.timestamp}>
                {entry.message}
              </div>
            ))}
            <div ref={terminalEndRef} />
          </div>
        </div>

        {/* Column 2 — Command Queue */}
        <div className="console-col">
          <div className="col-header">
            <span className="col-title">Command Queue</span>
            <div className="col-filters">
              <select value={cmdTypeFilter} onChange={(e) => setCmdTypeFilter(e.target.value)} className="filter-select">
                <option value="all">All types</option>
                <option value="gcode">G-code</option>
                <option value="control">Control</option>
                <option value="config">Config</option>
                <option value="query">Query</option>
              </select>
              <select value={cmdStatusFilter} onChange={(e) => setCmdStatusFilter(e.target.value)} className="filter-select">
                <option value="all">All status</option>
                <option value="executing">Executing</option>
                <option value="done">Done</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>
          <div className="col-body" ref={commandRef} onScroll={handleCommandScroll}>
            {filteredCommands.map((cmd) => (
              <div
                key={cmd.id}
                className={`cmd-entry type-${cmd.type} status-${cmd.status}`}
                data-ts={cmd.timestamp}
                onMouseEnter={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredCmd({ cmd, x: rect.right + 8, y: rect.top });
                }}
                onMouseLeave={() => setHoveredCmd(null)}
              >
                <span className={`cmd-badge badge-${cmd.status}`}>
                  {cmd.status === 'executing' ? '●' : cmd.status === 'done' ? '✓' : cmd.status === 'error' ? '✕' : '○'}
                </span>
                <span className="cmd-text">{cmd.cmd}</span>
                {cmd.duration != null && <span className="cmd-duration">{cmd.duration}ms</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Column 3 — Event Log */}
        <div className="console-col">
          <div className="col-header">
            <span className="col-title">Event Log</span>
            <div className="col-filters">
              <select value={eventLevelFilter} onChange={(e) => setEventLevelFilter(e.target.value)} className="filter-select">
                <option value="all">All levels</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div className="col-body" ref={eventRef} onScroll={handleEventScroll}>
            {filteredEvents.map((ev) => (
              <div key={ev.id} className={`event-entry level-${ev.level}`} data-ts={ev.timestamp}>
                <span className="event-icon">{EVENT_ICONS[ev.event] || '•'}</span>
                <div className="event-body">
                  <span className="event-message">{ev.message}</span>
                  <span className="event-time">{new Date(ev.timestamp).toTimeString().slice(0, 8)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {hoveredCmd && <CmdTooltip cmd={hoveredCmd.cmd} x={hoveredCmd.x} y={hoveredCmd.y} />}

      <div className="console-input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
          placeholder="Enter G-code command (e.g., G28, M3 S90, $?)"
          className="console-input"
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={!connected}>Send</button>
      </div>
    </div>
  );
}
