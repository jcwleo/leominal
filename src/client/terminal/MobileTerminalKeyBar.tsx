import React from 'react';
import type { MobileTerminalStandaloneKey } from './mobileTerminalKeys.js';

interface MobileTerminalKeyBarProps {
  ctrlActive: boolean;
  onCtrl: () => void;
  onStandaloneKey: (key: MobileTerminalStandaloneKey) => void;
  onPreserveFocus: () => void;
}

const standaloneKeys: Array<{ key: MobileTerminalStandaloneKey; label: string; ariaLabel: string }> = [
  { key: 'escape', label: 'Esc', ariaLabel: 'Send Escape' },
  { key: 'tab', label: 'Tab', ariaLabel: 'Send Tab' },
  { key: 'arrowLeft', label: '←', ariaLabel: 'Send Arrow Left' },
  { key: 'arrowDown', label: '↓', ariaLabel: 'Send Arrow Down' },
  { key: 'arrowUp', label: '↑', ariaLabel: 'Send Arrow Up' },
  { key: 'arrowRight', label: '→', ariaLabel: 'Send Arrow Right' }
];

export function MobileTerminalKeyBar({ ctrlActive, onCtrl, onStandaloneKey, onPreserveFocus }: MobileTerminalKeyBarProps) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement> | React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
    onPreserveFocus();
  }

  return (
    <div
      className="mobile-terminal-key-bar"
      role="toolbar"
      aria-label="Mobile terminal keys"
      onMouseDown={handlePointerDown}
      onPointerDown={handlePointerDown}
    >
      <button
        type="button"
        className="mobile-terminal-key mobile-terminal-key-ctrl"
        aria-label="Arm Control modifier"
        aria-pressed={ctrlActive}
        data-active={ctrlActive}
        onClick={onCtrl}
      >
        Ctrl
      </button>
      {standaloneKeys.map((item) => (
        <button
          type="button"
          className="mobile-terminal-key"
          aria-label={item.ariaLabel}
          key={item.key}
          onClick={() => onStandaloneKey(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
