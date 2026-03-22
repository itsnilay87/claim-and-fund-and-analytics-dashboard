/**
 * @module WorkspaceSidebar
 * @description Workspace-scoped navigation sidebar with claim/portfolio lists.
 *
 * Shows workspace navigation links, expandable claim and portfolio sections
 * with inline counts, and quick-add buttons.  Collapsible to icon-only mode.
 */
import { NavLink, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useClaimStore } from '../../store/claimStore';
import { usePortfolioStore } from '../../store/portfolioStore';
import {
  BarChart3,
  LayoutDashboard,
  FileText,
  Briefcase,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export default function WorkspaceSidebar() {
  const { wsId } = useParams();
  const [collapsed, setCollapsed] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(true);
  const [portfoliosOpen, setPortfoliosOpen] = useState(true);

  const claims = useClaimStore((s) => s.getClaims(wsId));
  const portfolios = usePortfolioStore((s) => s.getPortfoliosByWorkspace(wsId));

  const linkClass = (isActive) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
      isActive
        ? 'bg-indigo-500/10 text-indigo-300 font-medium'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
    } ${collapsed ? 'justify-center' : ''}`;

  return (
    <aside
      className={`${
        collapsed ? 'w-16' : 'w-60'
      } bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 transition-all duration-200`}
    >
      {/* Brand */}
      <div className={`h-14 flex items-center ${collapsed ? 'justify-center' : 'px-4 gap-3'} border-b border-slate-800`}>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shrink-0">
          <BarChart3 className="w-4 h-4 text-white" />
        </div>
        {!collapsed && <span className="text-sm font-bold text-white truncate">Claim Analytics</span>}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1">
        {/* Dashboard link */}
        <NavLink
          to={`/workspace/${wsId}`}
          end
          className={({ isActive }) => linkClass(isActive)}
          title="Dashboard"
        >
          <LayoutDashboard className="w-4 h-4 shrink-0" />
          {!collapsed && <span>Dashboard</span>}
        </NavLink>

        {/* Claims section */}
        {!collapsed ? (
          <div className="pt-3">
            <button
              onClick={() => setClaimsOpen(!claimsOpen)}
              className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-slate-500 hover:text-slate-300"
            >
              <span>Claims</span>
              {claimsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {claimsOpen && (
              <div className="space-y-0.5 mt-1">
                <NavLink
                  to={`/workspace/${wsId}/claims`}
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>All Claims</span>
                  <span className="ml-auto text-xs text-slate-600 tabular-nums">{claims.length}</span>
                </NavLink>
                <NavLink
                  to={`/workspace/${wsId}/claim/new`}
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>New Claim</span>
                </NavLink>
              </div>
            )}
          </div>
        ) : (
          <NavLink
            to={`/workspace/${wsId}/claims`}
            className={({ isActive }) => linkClass(isActive)}
            title="Claims"
          >
            <FileText className="w-4 h-4 shrink-0" />
          </NavLink>
        )}

        {/* Portfolios section */}
        {!collapsed ? (
          <div className="pt-3">
            <button
              onClick={() => setPortfoliosOpen(!portfoliosOpen)}
              className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold tracking-wider uppercase text-slate-500 hover:text-slate-300"
            >
              <span>Portfolios</span>
              {portfoliosOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {portfoliosOpen && (
              <div className="space-y-0.5 mt-1">
                <NavLink
                  to={`/workspace/${wsId}/portfolios`}
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <Briefcase className="w-4 h-4 shrink-0" />
                  <span>All Portfolios</span>
                  <span className="ml-auto text-xs text-slate-600 tabular-nums">{portfolios.length}</span>
                </NavLink>
                <NavLink
                  to={`/workspace/${wsId}/portfolio/new`}
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>New Portfolio</span>
                </NavLink>
              </div>
            )}
          </div>
        ) : (
          <NavLink
            to={`/workspace/${wsId}/portfolios`}
            className={({ isActive }) => linkClass(isActive)}
            title="Portfolios"
          >
            <Briefcase className="w-4 h-4 shrink-0" />
          </NavLink>
        )}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-slate-800 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center py-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
