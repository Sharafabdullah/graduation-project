import { useRef, useState, useCallback } from 'react';

export function useViewTransform() {
  const [vt, setVt] = useState({ x: 0, y: 0, scale: 1 });
  const panRef = useRef(null);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const rect = e.currentTarget.getBoundingClientRect();
    setVt(prev => {
      const newScale = Math.min(20, Math.max(0.05, prev.scale * factor));
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const svgX = (mx - prev.x) / prev.scale;
      const svgY = (my - prev.y) / prev.scale;
      return { scale: newScale, x: mx - svgX * newScale, y: my - svgY * newScale };
    });
  }, []);

  const startPan = useCallback((clientX, clientY) => {
    setVt(prev => {
      panRef.current = { startX: clientX, startY: clientY, tx: prev.x, ty: prev.y };
      return prev;
    });
  }, []);

  const updatePan = useCallback((clientX, clientY) => {
    if (!panRef.current) return;
    const { startX, startY, tx, ty } = panRef.current;
    setVt(prev => ({ ...prev, x: tx + (clientX - startX), y: ty + (clientY - startY) }));
  }, []);

  const endPan = useCallback(() => { panRef.current = null; }, []);

  const toSvg = useCallback((clientX, clientY, containerRect) => ({
    x: (clientX - containerRect.left - vt.x) / vt.scale,
    y: (clientY - containerRect.top  - vt.y) / vt.scale,
  }), [vt]);

  return { vt, onWheel, startPan, updatePan, endPan, toSvg };
}
