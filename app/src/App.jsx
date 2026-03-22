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
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import DashboardLayout from './layouts/DashboardLayout';
import PublicLayout from './layouts/PublicLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
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

function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

function GuestRoute({ children }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  if (isAuthenticated) return <Navigate to="/workspaces" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Public routes wrapped in PublicLayout */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<GuestRoute><Landing /></GuestRoute>} />
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/signup" element={<GuestRoute><Signup /></GuestRoute>} />
      </Route>

      {/* Workspace list */}
      <Route
        path="/workspaces"
        element={<ProtectedRoute><WorkspaceHome /></ProtectedRoute>}
      />

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
