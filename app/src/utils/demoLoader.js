/**
 * @module demoLoader
 * @description Imports pre-built demo workspace JSON files via the server API.
 *
 * Fetches the demo JSON from /demo/, then calls the workspace, claim, and
 * portfolio server APIs to persist the data in PostgreSQL.
 */

import { api } from '../services/api';

const DEMO_WORKSPACES = [
  { key: 'tata_portfolio', label: 'TATA Steel Portfolio', desc: '6 claims, 3 portfolios — full TATA arbitration portfolio', file: '/demo/workspace_tata_portfolio.json' },
  { key: 'mixed_jurisdiction', label: 'Mixed Jurisdiction', desc: '4 claims (domestic + SIAC), comparative analysis', file: '/demo/workspace_mixed_jurisdiction.json' },
  { key: 'single_deal', label: 'Single Deal — ₹2,000 Cr', desc: '1 large SIAC claim, 3 investment structures', file: '/demo/workspace_single_deal.json' },
];

export { DEMO_WORKSPACES };

/**
 * Fetch a demo workspace JSON from public directory.
 */
async function fetchDemoData(filePath) {
  const resp = await fetch(filePath);
  if (!resp.ok) throw new Error(`Failed to load demo: ${filePath}`);
  return resp.json();
}

/**
 * Import a demo workspace via server API.
 * Returns the new workspace object (with fresh IDs).
 */
export async function importDemoWorkspace(demo) {
  const demoData = await fetchDemoData(demo.file);

  // Create workspace via API
  const workspace = await api.post('/api/workspaces', {
    name: demoData.name,
    description: demoData.description,
  });

  // Create claims via API
  const idMap = {};
  for (const claim of demoData.claims) {
    const created = await api.post('/api/claims', {
      workspace_id: workspace.id,
      ...claim,
      id: undefined, // let server assign ID
    });
    idMap[claim.id] = created.id;
  }

  // Create portfolios via API
  for (const portfolio of (demoData.portfolios || [])) {
    await api.post('/api/portfolios', {
      workspace_id: workspace.id,
      name: portfolio.name,
      claim_ids: portfolio.claim_ids.map((cid) => idMap[cid] || cid),
      structure: portfolio.structure,
      structure_config: portfolio.structure_config,
      simulation_config: portfolio.simulation,
    });
  }

  return workspace;
}
