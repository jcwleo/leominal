/* Pane tree renderer + drag-resize for Leominal Minimal prototype */

const { useState, useRef, useEffect, useCallback } = React;

/* A pane tree is either a leaf (terminal pane) or a split with [a, b, ratio, dir]
 * Leaf:  { type: 'pane', id, cwd, branch, state, lines }
 * Split: { type: 'split', dir: 'h' | 'v', ratio: 0..1, children: [PaneNode, PaneNode] }
 *   dir 'h' = children laid out horizontally (left/right) → divider is vertical, draggable left/right
 *   dir 'v' = children laid out vertically (top/bottom)   → divider is horizontal, draggable up/down
 */

function PaneTree({ node, path = [], activePaneId, paneCount, onSelectPane, onClosePane, onUpdateRatio, promptStyle, accent }) {
  if (node.type === 'pane') {
    return (
      <Pane
        node={node}
        active={node.id === activePaneId}
        canClose={paneCount > 1}
        onSelect={() => onSelectPane(node.id)}
        onClose={() => onClosePane(node.id)}
        promptStyle={promptStyle}
        accent={accent}
      />
    );
  }
  // split
  const dirClass = node.dir === 'h' ? 'mn-split-h' : 'mn-split-v';
  const aSize = `${node.ratio * 100}%`;
  const bSize = `${(1 - node.ratio) * 100}%`;
  const gridTemplate = node.dir === 'h'
    ? { gridTemplateColumns: `${aSize} 1px ${bSize}` }
    : { gridTemplateRows: `${aSize} 1px ${bSize}` };

  return (
    <div className={`mn-split ${dirClass}`} style={gridTemplate}>
      <div className="mn-split-cell">
        <PaneTree
          node={node.children[0]}
          path={[...path, 0]}
          activePaneId={activePaneId}
          paneCount={paneCount}
          onSelectPane={onSelectPane}
          onClosePane={onClosePane}
          onUpdateRatio={onUpdateRatio}
          promptStyle={promptStyle}
          accent={accent}
        />
      </div>
      <SplitDivider dir={node.dir} path={path} onUpdateRatio={onUpdateRatio} />
      <div className="mn-split-cell">
        <PaneTree
          node={node.children[1]}
          path={[...path, 1]}
          activePaneId={activePaneId}
          paneCount={paneCount}
          onSelectPane={onSelectPane}
          onClosePane={onClosePane}
          onUpdateRatio={onUpdateRatio}
          promptStyle={promptStyle}
          accent={accent}
        />
      </div>
    </div>
  );
}

function SplitDivider({ dir, path, onUpdateRatio }) {
  const onPointerDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    // The parent that owns this divider's ratio is the .mn-split wrapping it.
    const splitEl = target.closest('.mn-split');
    if (!splitEl) return;
    const rect = splitEl.getBoundingClientRect();

    function onMove(ev) {
      let ratio;
      if (dir === 'h') {
        ratio = (ev.clientX - rect.left) / rect.width;
      } else {
        ratio = (ev.clientY - rect.top) / rect.height;
      }
      ratio = Math.max(0.1, Math.min(0.9, ratio));
      onUpdateRatio(path, ratio);
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      target.classList.remove('is-dragging');
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = dir === 'h' ? 'col-resize' : 'row-resize';
    target.classList.add('is-dragging');
  }, [dir, path, onUpdateRatio]);

  return (
    <div
      className={`mn-divider mn-divider-${dir}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={dir === 'h' ? 'vertical' : 'horizontal'}
    >
      <div className="mn-divider-handle" />
    </div>
  );
}

function Pane({ node, active, canClose, onSelect, onClose, promptStyle, accent }) {
  return (
    <div className={`mn-pane ${active ? 'active' : ''}`} onClick={onSelect}>
      <div className="mn-pane-head">
        <span className={`mn-dot ${active ? 'on' : ''}`} />
        <span className="mn-pane-cwd">{node.cwd}</span>
        <span className="mn-pane-sep">·</span>
        <span className="mn-pane-branch">{node.branch}</span>
        <span className="mn-pane-spacer" />
        <span className={`mn-pane-state ${node.state}`}>{node.state}</span>
        {canClose && (
          <button
            className="mn-pane-x"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close pane"
            aria-label="Close pane"
          >
            <Icon.X size={11} />
          </button>
        )}
      </div>
      <div className="mn-pane-body">
        <TermLines lines={node.lines} promptStyle={promptStyle} accent={accent} />
      </div>
    </div>
  );
}

/* Find a node at path and replace ratio (immutable) */
function setRatioAtPath(root, path, ratio) {
  if (path.length === 0) {
    return { ...root, ratio };
  }
  const [head, ...rest] = path;
  const next = setRatioAtPath(root.children[head], rest, ratio);
  return {
    ...root,
    children: head === 0 ? [next, root.children[1]] : [root.children[0], next],
  };
}

/* Collect all pane leaves in tree order */
function collectPanes(root, out = []) {
  if (root.type === 'pane') { out.push(root); return out; }
  collectPanes(root.children[0], out);
  collectPanes(root.children[1], out);
  return out;
}

Object.assign(window, { PaneTree, setRatioAtPath, collectPanes });
