import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useSerial } from '../contexts/SerialContext';
import { useMode } from '../contexts/ModeContext';
import { LayoutGrid, Move, FileBarChart2, Image, Settings, Terminal, XCircle, ChevronLeft } from 'lucide-react';
import './Sidebar.css';

const NAV_ITEMS = [
  {
    path: '/',
    label: 'Dashboard',
    icon: <LayoutGrid size={20} />,
  },
  {
    path: '/manual',
    label: 'Manual Control',
    icon: <Move size={20} />,
  },
  {
    path: '/gcode',
    label: 'G-Code Jobs',
    icon: <FileBarChart2 size={20} />,
  },
  {
    path: '/image2gcode',
    label: 'Image to G-Code',
    icon: <Image size={20} />,
  },
  {
    path: '/settings',
    label: 'Settings',
    icon: <Settings size={20} />,
  },
  {
    path: '/console',
    label: 'Console',
    icon: <Terminal size={20} />,
  },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { connected, portPath, machineState, logConsole, stopStreaming } = useSerial();
  const { modeConfig } = useMode();

  const handleEStop = (e) => {
    e.stopPropagation();
    if (!connected) return;
    logConsole('EMERGENCY STOP: Work has been stopped by the user.', 'error');
    stopStreaming();
  };

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Logo */}
      <div className="sidebar-header">
        <Settings className="sidebar-logo" size={28} />
        {!collapsed && <span className="sidebar-title">Platform Control</span>}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => {
          // Disable Image2GCode in Drill mode (not applicable)
          const isDisabled = item.path === '/image2gcode' && !modeConfig.image2gcodeEnabled;
          if (isDisabled) {
            return (
              <div
                key={item.path}
                className="nav-item nav-item-disabled"
                title={`Not available in ${modeConfig.label} Mode`}
              >
                <span className="nav-icon" style={{ opacity: 0.35 }}>{item.icon}</span>
                {!collapsed && (
                  <span className="nav-label" style={{ opacity: 0.35 }}>
                    {item.label}
                  </span>
                )}
              </div>
            );
          }
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* E-Stop Button */}
      <div style={{ padding: collapsed ? '16px 12px' : '16px', borderTop: '1px solid var(--border)' }}>
        <button
          className="btn btn-danger"
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: collapsed ? '8px 0' : '8px 16px' }}
          onClick={handleEStop}
          disabled={!connected}
          title="Emergency Stop"
        >
          <XCircle size={18} style={{ flexShrink: 0 }} />
          {!collapsed && <span>E-Stop</span>}
        </button>
      </div>

      {/* Connection Status (bottom) */}
      <div className="sidebar-footer">
        {!collapsed && (
          <div className="sidebar-connection">
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            <div className="sidebar-connection-info">
              <span className="sidebar-connection-label">
                {connected ? portPath : 'Disconnected'}
              </span>
              <span className="sidebar-connection-state">{machineState}</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="sidebar-connection-mini" title={connected ? `Connected: ${portPath}` : 'Disconnected'}>
            <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          </div>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft size={16} style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }} />
        </button>
      </div>
    </aside>
  );
}
