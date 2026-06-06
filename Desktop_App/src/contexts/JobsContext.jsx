import React, { createContext, useContext, useState } from 'react';

const JobsContext = createContext(null);

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within JobsProvider');
  return ctx;
}

export function JobsProvider({ children }) {
  const [loadedFiles, setLoadedFiles] = useState([]);

  const addLoadedFile = (file) => {
    setLoadedFiles(prev => {
      if (prev.some(f => f.path === file.path)) return prev;
      return [...prev, file];
    });
  };

  const removeLoadedFile = (path) => {
    setLoadedFiles(prev => prev.filter(f => f.path !== path));
  };

  const value = { loadedFiles, addLoadedFile, removeLoadedFile };

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}
