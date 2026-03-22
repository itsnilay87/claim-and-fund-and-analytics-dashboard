/**
 * @module WorkspaceCard
 * @description Summary card for a single workspace on the workspace selector page.
 *
 * Displays workspace name, claim/portfolio counts, last-modified time,
 * and open/delete action buttons.
 *
 * @prop {Object} workspace - Workspace object with id, name, updated_at.
 * @prop {number} claimCount - Number of claims in this workspace.
 * @prop {number} portfolioCount - Number of portfolios in this workspace.
 * @prop {Function} onOpen - Callback when workspace is opened.
 * @prop {Function} onDelete - Callback when delete is clicked.
 */
import { FileText, Briefcase, Trash2, Clock } from 'lucide-react';

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function WorkspaceCard({ workspace, claimCount, portfolioCount, onOpen, onDelete }) {
  return (
    <div
      className="glass-card p-5 hover:border-slate-600 transition-all cursor-pointer group"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors truncate pr-4">
          {workspace.name}
        </h3>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
          title="Delete workspace"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {workspace.description && (
        <p className="text-sm text-slate-500 mb-4 line-clamp-2">{workspace.description}</p>
      )}

      <div className="flex items-center gap-4 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" />
          {claimCount} claim{claimCount !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1.5">
          <Briefcase className="w-3.5 h-3.5" />
          {portfolioCount} portfolio{portfolioCount !== 1 ? 's' : ''}
        </span>
        <span className="flex items-center gap-1.5 ml-auto">
          <Clock className="w-3.5 h-3.5" />
          {timeAgo(workspace.updated_at || workspace.created_at)}
        </span>
      </div>
    </div>
  );
}
