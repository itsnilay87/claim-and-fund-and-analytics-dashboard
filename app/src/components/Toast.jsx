/**
 * @module Toast
 * @description Global toast notification system via React Context.
 *
 * Exports:
 *   ToastProvider — Wraps the app, manages toast queue with auto-dismiss (5s).
 *   useToast()    — Hook returning { showToast(type, message) }.
 *
 * Toast types: 'error' (red), 'success' (green), 'info' (blue).
 */
import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { X, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { generateUUID } from '../utils/uuid';

const ToastContext = createContext(null);

const ICON_MAP = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

const COLOR_MAP = {
  error: { bg: 'bg-red-500/10', border: 'border-red-500/30', icon: 'text-red-400', text: 'text-red-300' },
  success: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: 'text-emerald-400', text: 'text-emerald-300' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: 'text-blue-400', text: 'text-blue-300' },
};

function ToastItem({ id, type, message, onDismiss }) {
  const Icon = ICON_MAP[type] || Info;
  const colors = COLOR_MAP[type] || COLOR_MAP.info;

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), 5000);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${colors.bg} ${colors.border} shadow-lg backdrop-blur-sm animate-slide-in max-w-sm`}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${colors.icon}`} />
      <p className={`text-sm font-medium ${colors.text} flex-1`}>{message}</p>
      <button onClick={() => onDismiss(id)} className="text-slate-500 hover:text-slate-300 shrink-0">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((type, message) => {
    const id = generateUUID();
    setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
  }, []);

  const toast = {
    error: (msg) => addToast('error', msg),
    success: (msg) => addToast('success', msg),
    info: (msg) => addToast('info', msg),
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
