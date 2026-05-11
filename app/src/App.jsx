/**
 * @module App
 * @description Root routing component for the Claim Analytics Platform app shell.
 *
 * Defines all client-side routes using React Router 6:
 *   - Public: Landing (/), Login (/login)
 *   - Protected (auth required): Workspaces, Claims, Portfolios, Results
 *
 * Route guards: ProtectedRoute redirects to /login, GuestRoute redirects to /workspaces.
 * Layout: DashboardLayout wraps all authenticated routes with TopBar + WorkspaceSidebar.
 */
import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import DashboardLayout from './layouts/DashboardLayout';
import PublicLayout from './layouts/PublicLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import WorkspaceHome from './pages/WorkspaceHome';
import WorkspaceDashboard from './pages/WorkspaceDashboard';
import Home from './pages/Home';
import Profile from './pages/Profile';
import History from './pages/History';
import ClaimList from './pages/ClaimList';
import ClaimEditor from './pages/ClaimEditor';
import ClaimResults from './pages/ClaimResults';
import PortfolioList from './pages/PortfolioList';
import PortfolioBuilder from './pages/PortfolioBuilder';
import PortfolioResults from './pages/PortfolioResults';
import { ArrowLeft, BarChart3 } from 'lucide-react';

const FundAnalyticsLayout = lazy(() => import('./layouts/FundAnalyticsLayout'));
const FundDashboard = lazy(() => import('./pages/fund/FundDashboard'));
const FundParameterEditor = lazy(() => import('./pages/fund/FundParameterEditor'));
const FundSimulate = lazy(() => import('./pages/fund/FundSimulate'));
const FundHistory = lazy(() => import('./pages/fund/FundHistory'));
const FundResults = lazy(() => import('./pages/fund/FundResults'));
const FundCaseEditor = lazy(() => import('./pages/fund/FundCaseEditor'));
const FundCaseHistory = lazy(() => import('./pages/fund/FundCaseHistory'));
const FundCaseResults = lazy(() => import('./pages/fund/FundCaseResults'));

function LazyFallback() {
  return <div className="min-h-screen flex items-center justify-center bg-slate-950"><div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" /></div>;
}

function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-950"><div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" /></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

/** Minimal layout for the standalone /account page */
function AccountLayout() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/workspaces')}
            className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Workspaces
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-bold text-white hidden sm:inline">Claim Analytics</span>
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-10">
        <Profile />
      </main>
    </div>
  );
}

function GuestRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  if (isLoading) return <div className="min-h-screen flex items-center justify-center bg-slate-950"><div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" /></div>;
  if (isAuthenticated) return <Navigate to="/workspaces" replace />;
  return children;
}

export default function App() {
  const initAuth = useAuthStore((s) => s.initAuth);

  useEffect(() => { initAuth(); }, [initAuth]);
  return (
    <Routes>
      {/* Public routes wrapped in PublicLayout */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<GuestRoute><Landing /></GuestRoute>} />
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />
        <Route path="/forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
        <Route path="/reset-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
        <Route path="/forgot" element={<GuestRoute><ForgotPassword /></GuestRoute>} />
      </Route>

      {/* Workspace list */}
      <Route
        path="/workspaces"
        element={<ProtectedRoute><WorkspaceHome /></ProtectedRoute>}
      />

      {/* Standalone account settings page */}
      <Route
        path="/account"
        element={<ProtectedRoute><AccountLayout /></ProtectedRoute>}
      />

      {/* Fund Analytics */}
      <Route
        path="/fund-analytics"
        element={<ProtectedRoute><Suspense fallback={<LazyFallback />}><FundAnalyticsLayout /></Suspense></ProtectedRoute>}
      >
        <Route index element={<FundDashboard />} />
        <Route path="parameters" element={<FundParameterEditor />} />
        <Route path="parameters/:id" element={<FundParameterEditor />} />
        <Route path="simulate" element={<FundSimulate />} />
        <Route path="history" element={<FundHistory />} />
        <Route path="results/:id" element={<FundResults />} />
        <Route path="case/new" element={<FundCaseEditor />} />
        <Route path="case/history" element={<FundCaseHistory />} />
        <Route path="case/:id/results" element={<FundCaseResults />} />
      </Route>

      {/* Inside a workspace */}
      <Route
        path="/workspace/:wsId"
        element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}
      >
        <Route index element={<WorkspaceDashboard />} />
        <Route path="home" element={<Home />} />
        <Route path="profile" element={<Profile />} />
        <Route path="history" element={<History />} />
        <Route path="claims" element={<ClaimList />} />
        <Route path="claim/new" element={<ClaimEditor />} />
        <Route path="claim/:id" element={<ClaimEditor />} />
        <Route path="claim/:id/results" element={<ClaimResults />} />
        <Route path="portfolios" element={<PortfolioList />} />
        <Route path="portfolio/new" element={<PortfolioBuilder />} />
        <Route path="portfolio/:id" element={<PortfolioBuilder />} />
        <Route path="portfolio/:id/results" element={<PortfolioResults />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
