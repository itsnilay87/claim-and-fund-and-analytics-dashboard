/**
 * @module demoLoader
 * @description Imports pre-built demo workspace JSON files into localStorage stores.
 *
 * Generates fresh UUIDs for all entities to avoid collisions, then writes
 * workspace, claims, and portfolios into the same localStorage keys used
 * by workspaceStore, claimStore, and portfolioStore.
 */

import { generateUUID } from './uuid';

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
 * Import a demo workspace into localStorage.
 * Returns the new workspace object (with fresh IDs).
 */
export async function importDemoWorkspace(demo) {
  const demoData = await fetchDemoData(demo.file);
  const wsId = generateUUID();
  const now = new Date().toISOString();

  // Build ID mapping: old demo ID → new UUID
  const idMap = {};
  for (const claim of demoData.claims) {
    idMap[claim.id] = generateUUID();
  }

  // Create workspace
  const workspace = {
    id: wsId,
    name: demoData.name,
    description: demoData.description,
    created_at: now,
    updated_at: now,
  };

  // Map claims with new IDs
  const claims = demoData.claims.map((c) => ({
    ...c,
    id: idMap[c.id],
    workspace_id: wsId,
    created_at: now,
    updated_at: now,
  }));

  // Map portfolios with new IDs and remapped claim_ids
  const portfolios = (demoData.portfolios || []).map((p) => ({
    ...p,
    id: generateUUID(),
    workspace_id: wsId,
    claim_ids: p.claim_ids.map((cid) => idMap[cid] || cid),
    run_id: null,
    created_at: now,
    updated_at: now,
  }));

  // Write to localStorage — same keys as the stores
  const existingWs = JSON.parse(localStorage.getItem('cap_workspaces') || '{"workspaces":[],"activeWorkspaceId":null}');
  existingWs.workspaces.push(workspace);
  existingWs.activeWorkspaceId = wsId;
  localStorage.setItem('cap_workspaces', JSON.stringify(existingWs));

  // Claim store: cap_ws_{wsId}_claims
  localStorage.setItem(`cap_ws_${wsId}_claims`, JSON.stringify(claims));

  // Portfolio store: cap_ws_{wsId}_portfolios
  localStorage.setItem(`cap_ws_${wsId}_portfolios`, JSON.stringify(portfolios));

  return workspace;
}
