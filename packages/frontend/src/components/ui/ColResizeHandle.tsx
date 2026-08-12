// Drag handle placed on the right edge of a resizable table header cell.
// The header cell itself needs `position: relative` and a couple px of right
// padding so this doesn't sit on top of the label text.
export function ColResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      className="col-resize-handle"
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize column"
    />
  );
}
