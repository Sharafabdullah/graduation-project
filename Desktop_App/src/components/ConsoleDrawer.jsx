import React, { useState, useRef, useEffect } from 'react';
import { useSerial } from '../contexts/SerialContext';
import './ConsoleDrawer.css';

export default function ConsoleDrawer() {
  const { consoleLog, clearConsole, sendCommand, connected } = useSerial();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll when new lines arrive (only while open)
  useEffect(() => {
    if (open && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [consoleLog, open]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  const handleSend = () => {
    const cmd = input.trim();
    if (!cmd || !connected) return;
    sendCommand(cmd);
    setInput('');
    inputRef.current?.focus();
  };

  const recentLog = consoleLog.slice(-300);

  return (
    <div className={`console-drawer-wrapper ${open ? 'is-open' : ''}`}>
      {/* Tab / header — always visible, acts as toggle when closed */}
      <div className="console-drawer-tab" onClick={() => setOpen(o => !o)}>
        <span className="console-drawer-tab-left">
          <svg viewBox="0 0 24 24" width="14" height="14" style={{ flexShrink: 0 }}>
            <path fill="currentColor" d="M20,19V7H4V19H20M20,3A2,2 0 0,1 22,5V19A2,2 0 0,1 20,21H4A2,2 0 0,1 2,19V5C2,3.89 2.9,3 4,3H20M13,17V15H18V17H13M9.58,13L5.57,9L7,7.59L12,12.59L7,17.59L5.57,16.17L9.58,13Z" />
          </svg>
          <span>Console</span>
          {!open && consoleLog.length > 0 && (
            <span className="console-badge">{consoleLog.length > 99 ? '99+' : consoleLog.length}</span>
          )}
        </span>

        <span className="console-drawer-tab-right">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} style={{ width: '7px', height: '7px' }} />
          <span className="console-drawer-conn-label">{connected ? 'Connected' : 'Disconnected'}</span>
          {open && (
            <button
              className="console-clear-btn"
              onClick={e => { e.stopPropagation(); clearConsole(); }}
              title="Clear console"
            >
              Clear
            </button>
          )}
          <svg
            viewBox="0 0 24 24" width="13" height="13"
            style={{ transform: open ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 0.2s', flexShrink: 0 }}
          >
            <path fill="currentColor" d="M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z" />
          </svg>
        </span>
      </div>

      {/* Console body — only rendered/interactive when open */}
      <div className="console-drawer-body">
        <div className="console-drawer-output">
          {recentLog.map(entry => (
            <div key={entry.id} className={`console-line ${entry.type}`}>
              {entry.message}
            </div>
          ))}
          <div ref={endRef} />
        </div>

        <div className="console-drawer-input-row">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={connected ? 'Enter G-code command...' : 'Not connected'}
            disabled={!connected}
          />
          <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={!connected}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
