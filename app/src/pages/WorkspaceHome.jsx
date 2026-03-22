/**
 * @module WorkspaceHome
 * @description Workspace selector and creator home page.
 *
 * Lists all workspaces as cards with claim/portfolio counts.
 * Provides "Create Workspace" dialog with name and description fields.
 * Sets activeWorkspaceId on selection and navigates to workspace dashboard.
 *
 * Route: /workspaces
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useClaimStore } from '../store/claimStore';
import { usePortfolioStore } from '../store/portfolioStore';
import WorkspaceCard from '../components/workspace/WorkspaceCard';
import { Plus, LogOut, BarChart3, X, Download } from 'lucide-react';
import { DEMO_WORKSPACES, importDemoWorkspace } from '../utils/demoLoader';

export default function WorkspaceHome() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const getClaims = useClaimStore((s) => s.getClaims);
  const getPortfolios = usePortfolioStore((s) => s.getPortfoliosByWorkspace);
  const navigate = useNavigate();

  const [showModal, setShowModal] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const handleLoadDemo = async (demo) => {
    const ws = await importDemoWorkspace(demo);
    // Force store refresh from localStorage
    window.location.href = `/workspace/${ws.id}`;
  };

  const handleCreate = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const ws = createWorkspace(newName.trim(), newDesc.trim());
    setNewName('');
    setNewDesc('');
    setShowModal(false);
    setActive(ws.id);
    navigate(`/workspace/${ws.id}`);
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Top bar */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-bold text-white">Claim Analytics</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-sm font-semibold text-indigo-300">
                {user?.name?.charAt(0) || 'U'}
              </div>
              <span className="text-sm text-slate-300 hidden sm:inline">{user?.name}</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-slate-300 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white">Workspaces</h1>
            <p className="mt-1 text-sm text-slate-400">Manage your claim analysis workspaces</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowDemoModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-indigo-300 border border-indigo-500/40 hover:bg-indigo-500/10 rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" /> Load Demo
            </button>
            <button
              onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" /> New Workspace
            </button>
          </div>
        </div>

        {workspaces.length === 0 ? (
          <div className="glass-card p-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <BarChart3 className="w-8 h-8 text-slate-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-300 mb-2">No workspaces yet</h3>
            <p className="text-sm text-slate-500 mb-6">Create your first workspace to start modelling claims.</p>
            <button
              onClick={() => setShowModal(true)}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            >
              Create Workspace
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {workspaces.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                claimCount={getClaims(ws.id).length}
                portfolioCount={getPortfolios(ws.id).length}
                onOpen={() => {
                  setActive(ws.id);
                  navigate(`/workspace/${ws.id}`);
                }}
                onDelete={() => deleteWorkspace(ws.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-md p-6 mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">New Workspace</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. TATA Steel Arbitration"
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Description</label>
                <textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                  className="w-full px-4 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Demo Workspace Modal */}
      {showDemoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card w-full max-w-lg p-6 mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white">Load Demo Workspace</h3>
              <button onClick={() => setShowDemoModal(false)} className="text-slate-500 hover:text-slate-300">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              Import a pre-built workspace with realistic claims and portfolios to explore the platform.
            </p>
            <div className="space-y-3">
              {DEMO_WORKSPACES.map((demo) => (
                <button
                  key={demo.key}
                  onClick={() => handleLoadDemo(demo)}
                  className="w-full text-left p-4 rounded-lg border border-slate-700 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all group"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors">
                        {demo.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{demo.desc}</div>
                    </div>
                    <Download className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors" />
                  </div>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setShowDemoModal(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
