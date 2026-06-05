import React from 'react';
import VectorEditor from '../../components/VectorEditor/VectorEditor';

export default function VectorDrawerTab({ editorRef, bedW, bedH, lineWidth, injectedSVG }) {
  return (
    <div className="tab-content drawer-tab">
      <VectorEditor
        ref={editorRef}
        bedW={bedW}
        bedH={bedH}
        lineWidth={lineWidth}
        injectedSVG={injectedSVG}
      />
    </div>
  );
}
