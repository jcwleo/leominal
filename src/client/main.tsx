import React from 'react';
import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './terminal/fonts.css';
import { App } from './App.js';
import './styles.css';
import { installViewportHeightSync } from './viewportHeight.js';

installViewportHeightSync();

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
