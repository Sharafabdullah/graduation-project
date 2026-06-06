import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { SerialProvider } from './contexts/SerialContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { JobsProvider } from './contexts/JobsContext';
import { Image2GCodeProvider } from './contexts/Image2GCodeContext';
import './styles/theme.css';
import './styles/components.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <SettingsProvider>
        <SerialProvider>
          <JobsProvider>
            <Image2GCodeProvider>
              <App />
            </Image2GCodeProvider>
          </JobsProvider>
        </SerialProvider>
      </SettingsProvider>
    </HashRouter>
  </React.StrictMode>
);
