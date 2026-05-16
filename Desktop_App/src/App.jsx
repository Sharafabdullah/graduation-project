import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ConsoleDrawer from './components/ConsoleDrawer';
import DashboardPage from './pages/DashboardPage';
import ManualControlPage from './pages/ManualControlPage';
import GCodeJobsPage from './pages/GCodeJobsPage';
import Image2GCodePage from './pages/Image2GCodePage';
import SettingsPage from './pages/SettingsPage';
import ConsolePage from './pages/ConsolePage';
import './App.css';

function AppContent() {
  const location = useLocation();
  // Don't show the drawer on the dedicated Console page (redundant)
  const showDrawer = location.pathname !== '/console';

  return (
    <main className="app-content">
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/manual" element={<ManualControlPage />} />
        <Route path="/gcode" element={<GCodeJobsPage />} />
        <Route path="/image2gcode" element={<Image2GCodePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/console" element={<ConsolePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {showDrawer && <ConsoleDrawer />}
    </main>
  );
}

export default function App() {
  return (
    <div className="app-layout">
      <Sidebar />
      <AppContent />
    </div>
  );
}
