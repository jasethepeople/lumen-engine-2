import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { installBufferGlobal } from './platform/node-shims/buffer';

// Buffer global for @lumen/build's hashing/gzip helpers (browser publish).
installBufferGlobal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
