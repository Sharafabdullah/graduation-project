import React from 'react';
import VectorEditor from '../../components/VectorEditor/VectorEditor';

export default function VectorDrawerTab({
  editorRef, bedW, bedH, lineWidth,
  backgroundColor, softLimitMargin, homed, homeFloor,
}) {
  return (
    <div className="tab-content drawer-tab">
      <VectorEditor
        ref={editorRef}
        bedW={bedW}
        bedH={bedH}
        lineWidth={lineWidth}
        backgroundColor={backgroundColor}
        softLimitMargin={softLimitMargin}
        homed={homed}
        homeFloor={homeFloor}
      />
    </div>
  );
}
