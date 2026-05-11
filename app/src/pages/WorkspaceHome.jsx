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
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import WorkspaceCard from '../components/workspace/WorkspaceCard';
import { Plus, LogOut, BarChart3, X, Download, UserCircle, Settings, LayoutGrid } from 'lucide-react';
import { DEMO_WORKSPACES, importDemoWorkspace } from '../utils/demoLoader';

export default function WorkspaceHome() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const fetchWorkspaces = useWorkspaceStore((s) => s.fetchWorkspaces);
  const createWorkspace = useWorkspaceStore((s) => s.createWorkspace);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const navigate = useNavigate();

  useEffect(() => { fetchWorkspaces(); }, [fetchWorkspaces]);

  const [showModal, setShowModal] = useState(false);
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Close user menu on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) {
        setShowUserMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLoadDemo = async (demo) => {
    const ws = await importDemoWorkspace(demo);
    setActive(ws.id);
    navigate(`/workspace/${ws.id}`);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const ws = await createWorkspace(newName.trim(), newDesc.trim());
    setNewName('');
    setNewDesc('');
    setShowModal(false);
    setActive(ws.id);
    navigate(`/workspace/${ws.id}`);
  };

  const handleLogout = async () => {
    await logout();
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
            <button
              type="button"
              onClick={() => navigate('/hub')}
              className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <LayoutGrid className="w-4 h-4" /> Home
            </button>
            <button
              type="button"
              onClick={() => navigate('/account')}
              className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <Settings className="w-4 h-4" /> Account
            </button>
            {/* User menu */}
            <div className="relative" ref={userMenuRef}>
              <button
                type="button"
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                aria-label="Open user menu"
              >
                <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-sm font-semibold text-indigo-300 select-none">
                  {(user?.full_name || user?.name || 'U').charAt(0).toUpperCase()}
                </div>
                <span className="text-sm text-slate-300 hidden sm:inline">{user?.full_name || user?.name}</span>
              </button>

              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-52 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1.5 z-50">
                  <div className="px-4 py-2.5 border-b border-slate-800">
                    <p className="text-xs font-semibold text-white truncate">{user?.full_name || user?.name}</p>
                    <p className="text-xs text-slate-500 truncate">{user?.email}</p>
                  </div>
                  <button
                    onClick={() => { setShowUserMenu(false); navigate('/account'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                  >
                    <Settings className="w-4 h-4" /> Account Settings
                  </button>
                  <button
                    onClick={() => { setShowUserMenu(false); handleLogout(); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                </div>
              )}
            </div>
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
                claimCount={ws.claim_count ?? 0}
                portfolioCount={ws.portfolio_count ?? 0}
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
