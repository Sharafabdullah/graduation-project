import React, { createContext, useContext, useState, useEffect } from 'react';

const JobsContext = createContext(null);

export function useJobs() {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within JobsProvider');
  return ctx;
}

export function JobsProvider({ children }) {
  const [loadedFiles, setLoadedFiles] = useState([]);

  useEffect(() => {
    async function loadJobs() {
      const result = await window.platform.getJobs();
      if (result && result.success) {
        setLoadedFiles(prev => {
          const newFiles = [...prev];
          result.jobs.forEach(job => {
            if (!newFiles.some(f => f.path === job.path)) {
              newFiles.push(job);
            }
          });
          return newFiles;
        });
      }
    }
    loadJobs();
  }, []);

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
