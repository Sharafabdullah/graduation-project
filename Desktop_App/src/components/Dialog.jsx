import React, { useEffect, useRef } from 'react';
import './Dialog.css';

export default function Dialog({
  open,
  mode = 'alert',
  title,
  message,
  defaultValue = '',
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) {
  const inputRef = useRef(null);
  const cardRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const previouslyFocused = document.activeElement;
    if (mode === 'prompt' && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    } else if (cardRef.current) {
      cardRef.current.focus();
    }

    return () => {
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      }
    };
  }, [open, mode]);

  if (!open) return null;

  const handleConfirm = () => {
    if (mode === 'prompt') {
      onConfirm(inputRef.current ? inputRef.current.value : '');
    } else {
      onConfirm();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="dialog-card" ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" onKeyDown={handleKeyDown}>
        {title && <h3 className="dialog-title">{title}</h3>}
        {message && <p className="dialog-message">{message}</p>}
        {mode === 'prompt' && (
          <input ref={inputRef} type="text" className="dialog-input" defaultValue={defaultValue} />
        )}
        <div className="dialog-actions">
          {mode !== 'alert' && (
            <button className="btn btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          )}
          <button className="btn btn-primary" onClick={handleConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
