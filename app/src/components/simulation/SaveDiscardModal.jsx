import { useState } from 'react';
import { Save, Trash2, X, Pencil, CheckCircle2 } from 'lucide-react';
import { api } from '../../services/api';

/**
 * SaveDiscardModal — shown after a simulation completes.
 *
 * Two modes:
 *  - Default: prompts the user to save or discard the run.
 *  - autoSaved=true: the run was already saved server-side (the user has
 *    auto-save preference enabled). Allows Rename or Delete instead.
 */
export default function SaveDiscardModal({
  runId,
  onClose,
  onSaved,
  onDiscarded,
  onRenamed,
  onDeleted,
  autoSaved = false,
}) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!runId) return null;

  const busy = saving || discarding || renaming || deleting;

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.post(`/api/runs/${encodeURIComponent(runId)}/save`, { name: name.trim() || undefined });
      onSaved?.();
    } catch (err) {
      console.error('Failed to save run:', err.message);
    } finally {
      setSaving(false);
      onClose?.();
    }
  };

  const handleDiscard = async () => {
    setDiscarding(true);
    try {
      await api.post(`/api/runs/${encodeURIComponent(runId)}/discard`);
      onDiscarded?.();
    } catch (err) {
      console.error('Failed to discard run:', err.message);
    } finally {
      setDiscarding(false);
      onClose?.();
    }
  };

  const handleRename = async () => {
    const newName = name.trim();
    if (!newName) return;
    setRenaming(true);
    try {
      // POST /api/runs/:id/save with a name updates the row's name and keeps
      // saved=TRUE — perfect for an in-place rename of an auto-saved run.
      await api.post(`/api/runs/${encodeURIComponent(runId)}/save`, { name: newName });
      onRenamed?.(newName);
    } catch (err) {
      console.error('Failed to rename run:', err.message);
    } finally {
      setRenaming(false);
      onClose?.();
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/api/runs/${encodeURIComponent(runId)}`);
      onDeleted?.();
    } catch (err) {
      console.error('Failed to delete run:', err.message);
    } finally {
      setDeleting(false);
      onClose?.();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-card w-full max-w-md p-6 mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            {autoSaved && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
            {autoSaved ? 'Run auto-saved' : 'Simulation Complete!'}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          {autoSaved
            ? 'This run is already saved per your preferences. You can rename it or delete it.'
            : 'Would you like to save this simulation run for later reference?'}
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            {autoSaved ? 'New Name' : 'Run Name (optional)'}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Full Portfolio Analysis"
            className="w-full px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500"
          />
        </div>

        <div className="flex justify-end gap-3">
          {autoSaved ? (
            <>
              <button
                onClick={handleDelete}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={handleRename}
                disabled={busy || !name.trim()}
                className="flex items-center gap-2 px-6 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors disabled:opacity-50"
              >
                <Pencil size={14} />
                {renaming ? 'Renaming...' : 'Rename'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleDiscard}
                disabled={busy}
                className="flex items-center gap-2 px-4 py-2 text-sm text-red-500 dark:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
                {discarding ? 'Discarding...' : 'Discard'}
              </button>
              <button
                onClick={handleSave}
                disabled={busy}
                className="flex items-center gap-2 px-6 py-2 text-sm font-semibold text-white bg-teal-600 hover:bg-teal-500 rounded-lg transition-colors disabled:opacity-50"
              >
                <Save size={14} />
                {saving ? 'Saving...' : 'Save Run'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
