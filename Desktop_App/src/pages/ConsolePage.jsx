import React, { useState, useRef, useEffect } from 'react';
import { useSerial } from '../contexts/SerialContext';
import './ConsolePage.css';

const QUICK_COMMANDS = [
  { label: 'G28 Home', cmd: 'G28' },
  { label: 'M3 Pen Down', cmd: 'M3' },
  { label: 'M5 Pen Up', cmd: 'M5' },
  { label: 'G90 Abs', cmd: 'G90' },
  { label: 'G91 Rel', cmd: 'G91' },
  { label: '? Status', cmd: '?' },
  { label: '$? Settings', cmd: '$?' },
];

export default function ConsolePage() {
  const { consoleLog, logConsole, clearConsole, sendCommand, connected } = useSerial();
  const [input, setInput] = useState('');
  const [showOk, setShowOk] = useState(false);
  const [showDebug, setShowDebug] = useState(true);
  const consoleEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLog]);

  const handleSend = () => {
    const cmd = input.trim();
    if (!cmd) return;
    if (!connected) {
      logConsole('Not connected. Cannot send command.', 'error');
      return;
    }
    sendCommand(cmd);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  const handleExport = async () => {
    const content = consoleLog
      .map(entry => entry.message)
      .join('\n');
    const result = await window.platform.saveLog(content);
    if (result.success) {
      logConsole(`Log exported to: ${result.path}`, 'info');
    }
  };

  // Filter console entries
  const filteredLog = consoleLog.filter(entry => {
    if (!showOk && entry.message.includes('< ok')) return false;
    if (!showDebug && entry.message.includes('Debug:')) return false;
    return true;
  });

  return (
    <div className="page console-page">
      <div className="page-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 className="page-title">Console</h1>
            <p className="page-subtitle">Serial terminal for direct machine communication</p>
          </div>
          <div className="console-toolbar">
            <label className="filter-toggle">
              <input type="checkbox" checked={showOk} onChange={e => setShowOk(e.target.checked)} />
              <span>Show "ok"</span>
            </label>
            <label className="filter-toggle">
              <input type="checkbox" checked={showDebug} onChange={e => setShowDebug(e.target.checked)} />
              <span>Show Debug</span>
            </label>
            <button className="btn btn-sm btn-ghost" onClick={clearConsole}>Clear</button>
            <button className="btn btn-sm btn-ghost" onClick={handleExport}>Export</button>
          </div>
        </div>
      </div>

      {/* Quick Commands */}
      <div className="quick-commands">
        {QUICK_COMMANDS.map(qc => (
          <button
            key={qc.cmd}
            className="btn btn-sm btn-ghost"
            onClick={() => { if (connected) sendCommand(qc.cmd); }}
            disabled={!connected}
          >
            {qc.label}
          </button>
        ))}
      </div>

      {/* Console Output */}
      <div className="console-output console-full">
        {filteredLog.map(entry => (
          <div key={entry.id} className={`console-line ${entry.type}`}>
            {entry.message}
          </div>
        ))}
        <div ref={consoleEndRef} />
      </div>

      {/* Input */}
      <div className="console-input-row">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter G-code command (e.g., G28, M3 S90, $?)"
          className="console-input"
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={!connected}>
          Send
        </button>
      </div>
    </div>
  );
}
