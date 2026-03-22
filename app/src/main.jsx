/**
 * @module main
 * @description React entry point — mounts the app into the DOM.
 *
 * Wraps <App> with BrowserRouter (client-side routing) and ToastProvider
 * (global notification context).  Renders into #root in strict mode.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/Toast';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
