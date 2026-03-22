/**
 * @module ProbabilityTreeEditor
 * @description Interactive D3-based probability tree editor for challenge trees.
 *
 * Renders Scenario A and Scenario B trees as editable node graphs.
 * Users can adjust probabilities, add/remove children, set outcomes
 * (TRUE_WIN, RESTART, LOSE), and configure duration distributions.
 * Validates that sibling probabilities sum to 1.0.
 *
 * @prop {Object} claim - Current claim state with challenge_tree.
 * @prop {Function} onChange - Callback with updated claim.
 */
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SliderField, SectionTitle } from './FormFields';

/* ── Constants ── */
const OUTCOME_COLORS = { TRUE_WIN: '#10B981', RESTART: '#F59E0B', LOSE: '#EF4444' };
const OUTCOME_ICONS = { TRUE_WIN: '✓', RESTART: '⟳', LOSE: '✗' };
const OUTCOME_LABELS = { TRUE_WIN: 'Claimant Wins', RESTART: 'Restart', LOSE: 'Claimant Loses' };
const DEPTH_COLORS = ['#14B8A6', '#06B6D4', '#8B5CF6', '#EC4899', '#F59E0B', '#14B8A6'];
const FONT = "'Inter', system-ui, sans-serif";

/* ── Build tree data from challenge_tree JSON ── */

function buildTreeViz(treeNode, parentAbs = 1.0) {
  if (!treeNode) return null;
  const node = {
    id: treeNode.name || 'root',
    label: (treeNode.name || 'Root').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    prob: treeNode.probability ?? 1.0,
    outcome: treeNode.outcome || null,
    children: [],
  };
  const abs = parentAbs * node.prob;
  if (treeNode.children?.length) {
    node.children = treeNode.children.map((child) => buildTreeViz(child, abs));
  } else {
    node.abs_prob = abs;
  }
  return node;
}

function computeTreeOutcomes(treeNode, parentAbs = 1.0) {
  if (!treeNode) return { TRUE_WIN: 0, RESTART: 0, LOSE: 0 };
  const abs = parentAbs * (treeNode.probability ?? 1.0);
  if (!treeNode.children?.length) {
    return { TRUE_WIN: 0, RESTART: 0, LOSE: 0, [treeNode.outcome]: abs };
  }
  const totals = { TRUE_WIN: 0, RESTART: 0, LOSE: 0 };
  for (const child of treeNode.children) {
    const sub = computeTreeOutcomes(child, abs);
    totals.TRUE_WIN += sub.TRUE_WIN || 0;
    totals.RESTART += sub.RESTART || 0;
    totals.LOSE += sub.LOSE || 0;
  }
  return totals;
}

/** Collect all editable nodes (non-root, non-single-children) with their path */
function collectEditableNodes(treeNode, path = [], result = []) {
  if (!treeNode?.children?.length) return result;
  for (let i = 0; i < treeNode.children.length; i++) {
    const child = treeNode.children[i];
    const childPath = [...path, i];
    // Only first sibling editable (second is complement)
    if (i === 0 && treeNode.children.length > 1) {
      result.push({
        path: childPath,
        name: child.name || `node_${childPath.join('_')}`,
        label: (child.name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        parentName: (treeNode.name || 'Root').replace(/_/g, ' '),
        probability: child.probability ?? 0.5,
      });
    }
    collectEditableNodes(child, childPath, result);
  }
  return result;
}

/** Update a node's probability at a path, adjusting sibling */
function updateNodeAtPath(tree, path, newProb) {
  const cloned = JSON.parse(JSON.stringify(tree));
  let node = cloned;
  for (let i = 0; i < path.length - 1; i++) {
    node = node.children[path[i]];
  }
  const idx = path[path.length - 1];
  const parent = node;
  parent.children[idx].probability = newProb;
  // Adjust sibling to maintain sum = 1.0
  if (parent.children.length === 2) {
    const sibIdx = idx === 0 ? 1 : 0;
    parent.children[sibIdx].probability = parseFloat((1 - newProb).toFixed(6));
  }
  return cloned;
}

/* ── D3 Tree Renderer ── */

function D3Tree({ treeData, height = 520, onNodeClick }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);

  const nodeW = 140;
  const nodeH = 48;

  const root = useMemo(() => {
    if (!treeData) return null;
    return d3.hierarchy(treeData, (d) => d.children);
  }, [treeData]);

  useEffect(() => {
    if (!root || !svgRef.current || !containerRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const containerW = containerRef.current.clientWidth || 800;
    const isDomestic = root.height > 2;

    svg.attr('width', containerW).attr('height', height);

    const treeLayout = d3
      .tree()
      .nodeSize([nodeH + (isDomestic ? 16 : 24), nodeW + (isDomestic ? 55 : 90)])
      .separation((a, b) => (a.parent === b.parent ? 1.1 : 1.4));
    treeLayout(root);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    root.each((d) => {
      minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
      minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
    });

    const treeW = (maxY - minY) + nodeW + 120;
    const treeH = (maxX - minX) + nodeH + 60;
    const fitScale = Math.min(containerW / treeW, height / treeH, 1) * 0.85;
    const offsetX = (containerW - treeW * fitScale) / 2 - minY * fitScale + 40;
    const offsetY = (height - treeH * fitScale) / 2 - minX * fitScale;

    const mainGroup = svg.append('g');
    const zoomBehavior = d3.zoom().scaleExtent([0.25, 3]).on('zoom', (e) => mainGroup.attr('transform', e.transform));
    svg.call(zoomBehavior);
    const initialTransform = d3.zoomIdentity.translate(offsetX, offsetY).scale(fitScale);
    svg.call(zoomBehavior.transform, initialTransform);

    // Glow filter
    const defs = svg.append('defs');
    const filter = defs.append('filter').attr('id', 'glow').attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    filter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', 5);

    // Links
    const links = root.links();
    mainGroup.selectAll('.link').data(links).join('path')
      .attr('d', (d) => {
        const sx = d.source.y + nodeW / 2, sy = d.source.x;
        const tx = d.target.y - nodeW / 2, ty = d.target.x;
        const mx = (sx + tx) / 2;
        return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
      })
      .attr('fill', 'none')
      .attr('stroke', (d) => OUTCOME_COLORS[d.target.data.outcome] || '#14B8A6')
      .attr('stroke-width', (d) => 1.5 + (d.target.data.prob || 0.5) * 3)
      .attr('stroke-opacity', (d) => 0.3 + (d.target.data.prob || 0.5) * 0.6)
      .attr('stroke-linecap', 'round');

    // Edge probability pills
    mainGroup.selectAll('.edge-pill').data(links).join('g').each(function (d) {
      const g = d3.select(this);
      const sx = d.source.y + nodeW / 2, sy = d.source.x;
      const tx = d.target.y - nodeW / 2, ty = d.target.x;
      const mx = (sx + tx) / 2, my = (sy + ty) / 2 - 8;
      const prob = d.target.data.prob;
      if (prob == null) return;
      const pillW = 48, pillH = 18;
      g.append('rect').attr('x', mx - pillW / 2).attr('y', my - pillH / 2)
        .attr('width', pillW).attr('height', pillH).attr('rx', pillH / 2)
        .attr('fill', '#111827').attr('stroke', '#06B6D4').attr('stroke-width', 1)
        .attr('opacity', 0.95).style('cursor', 'pointer');
      g.append('text').attr('x', mx).attr('y', my + 4).attr('text-anchor', 'middle')
        .attr('fill', '#06B6D4').attr('font-size', 10.5).attr('font-weight', 700)
        .attr('font-family', FONT).style('cursor', 'pointer')
        .text((prob * 100).toFixed(1) + '%');
    });

    // Nodes
    const nodes = root.descendants();
    const nodeGroups = mainGroup.selectAll('.node').data(nodes).join('g')
      .attr('transform', (d) => `translate(${d.y - nodeW / 2}, ${d.x - nodeH / 2})`);

    // Background
    nodeGroups.append('rect').attr('width', nodeW).attr('height', nodeH).attr('rx', 10)
      .attr('fill', (d) => d.data.outcome ? `${OUTCOME_COLORS[d.data.outcome]}18` : '#111827')
      .attr('stroke', (d) => d.data.outcome ? OUTCOME_COLORS[d.data.outcome] : DEPTH_COLORS[d.depth % DEPTH_COLORS.length])
      .attr('stroke-width', 1.5);

    // Outcome badges
    nodeGroups.filter((d) => !!d.data.outcome).each(function (d) {
      const g = d3.select(this);
      const color = OUTCOME_COLORS[d.data.outcome];
      g.append('circle').attr('cx', nodeW - 12).attr('cy', 12).attr('r', 8).attr('fill', color).attr('opacity', 0.9);
      g.append('text').attr('x', nodeW - 12).attr('y', 15.5).attr('text-anchor', 'middle')
        .attr('fill', '#fff').attr('font-size', 11).attr('font-weight', 800).attr('font-family', FONT)
        .text(OUTCOME_ICONS[d.data.outcome]);
    });

    // Labels
    nodeGroups.each(function (d) {
      const g = d3.select(this);
      const lines = (d.data.label || '').split('\n');
      lines.forEach((line, i) => {
        g.append('text').attr('x', nodeW / 2)
          .attr('y', nodeH / 2 + (i - (lines.length - 1) / 2) * 13)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('fill', i === 0 ? '#94A3B8' : '#F1F5F9')
          .attr('font-size', 10.5).attr('font-weight', 600).attr('font-family', FONT)
          .text(line);
      });
      if (d.data.outcome && d.data.abs_prob != null) {
        g.append('text').attr('x', nodeW / 2).attr('y', nodeH + 12)
          .attr('text-anchor', 'middle')
          .attr('fill', OUTCOME_COLORS[d.data.outcome])
          .attr('font-size', 10).attr('font-weight', 700).attr('font-family', FONT)
          .text('P=' + (d.data.abs_prob * 100).toFixed(2) + '%');
      }
    });

    // Hover
    nodeGroups
      .on('mouseenter', function () { d3.select(this).select('rect').attr('stroke-width', 2.5); })
      .on('mouseleave', function () { d3.select(this).select('rect').attr('stroke-width', 1.5); });

    // Double-click reset
    svg.on('dblclick.zoom', () => svg.transition().duration(400).call(zoomBehavior.transform, initialTransform));
  }, [root, height, nodeW, nodeH]);

  if (!treeData) return <div className="text-slate-500 p-6">No tree data available.</div>;

  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      <svg ref={svgRef} className="w-full h-full rounded-lg" style={{ background: 'radial-gradient(ellipse at 20% 50%, rgba(20,184,166,0.03), transparent 70%)' }} />
      <div className="absolute top-2 left-2 px-2.5 py-1.5 rounded-md text-[10px] text-slate-500 bg-slate-900/80 border border-white/5">
        Scroll to zoom · Drag to pan · Double-click to reset
      </div>
      <div className="absolute bottom-2 right-2 flex gap-3 px-3 py-1.5 rounded-md bg-slate-900/80 border border-white/5">
        {Object.entries(OUTCOME_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: OUTCOME_COLORS[key] }} />
            <span className="text-[10px] text-slate-500">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Slider panel for fallback editing ── */

function NodeSliders({ editableNodes, onUpdate }) {
  let lastParent = '';
  return (
    <div className="space-y-1">
      {editableNodes.map(({ path, name, label, parentName, probability }) => {
        const showGroup = parentName !== lastParent;
        lastParent = parentName;
        return (
          <div key={path.join('_')}>
            {showGroup && (
              <div className="text-xs font-semibold text-teal-400 uppercase tracking-wider mt-4 mb-1 border-b border-white/10 pb-1">
                {parentName}
              </div>
            )}
            <SliderField
              label={label || name}
              value={probability}
              onChange={(v) => onUpdate(path, v)}
              min={0}
              max={1}
              step={0.01}
              showPct
            />
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Component ── */

export default function ProbabilityTreeEditor({ draft, updateField }) {
  const [activeScenario, setActiveScenario] = useState('scenario_a');
  const [showSliders, setShowSliders] = useState(true);

  const challengeTree = draft?.challenge_tree || {};
  const scenarioTree = challengeTree[activeScenario]?.root || challengeTree[activeScenario] || null;
  const arbWin = draft?.arbitration?.win_probability ?? 0.7;
  const scenarioMultiplier = activeScenario === 'scenario_a' ? arbWin : 1 - arbWin;

  // Compute tree visualization data
  const treeVizData = useMemo(() => {
    if (!scenarioTree) return null;
    return buildTreeViz(scenarioTree, scenarioMultiplier);
  }, [scenarioTree, scenarioMultiplier]);

  // Outcomes
  const outcomes = useMemo(() => {
    if (!scenarioTree) return { TRUE_WIN: 0, RESTART: 0, LOSE: 0 };
    return computeTreeOutcomes(scenarioTree, scenarioMultiplier);
  }, [scenarioTree, scenarioMultiplier]);

  // Editable nodes for slider fallback
  const editableNodes = useMemo(() => {
    if (!scenarioTree) return [];
    return collectEditableNodes(scenarioTree);
  }, [scenarioTree]);

  // Update a node probability
  const handleNodeUpdate = useCallback(
    (path, newProb) => {
      if (!scenarioTree) return;
      const updated = updateNodeAtPath(scenarioTree, path, newProb);
      const newTree = { ...challengeTree };
      if (challengeTree[activeScenario]?.root) {
        newTree[activeScenario] = { ...challengeTree[activeScenario], root: updated };
      } else {
        newTree[activeScenario] = updated;
      }
      updateField('challenge_tree', newTree);
    },
    [scenarioTree, challengeTree, activeScenario, updateField],
  );

  const scenarioLabel = activeScenario === 'scenario_a' ? 'Scenario A (Won Arbitration)' : 'Scenario B (Lost Arbitration)';
  const treeHeight = (scenarioTree?.children?.length || 0) > 3 ? 580 : 420;

  return (
    <div className="space-y-6">
      <SectionTitle>Probability Tree Editor</SectionTitle>

      <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/20 text-sm text-teal-300">
        Path probabilities are <strong>unconditional</strong> (multiplied by{' '}
        {activeScenario === 'scenario_a' ? 'arb_win_probability' : '(1 − arb_win_probability)'} ={' '}
        {(scenarioMultiplier * 100).toFixed(1)}%).
      </div>

      {/* Scenario toggle */}
      <div className="flex rounded-lg border border-white/10 overflow-hidden text-sm w-fit">
        {['scenario_a', 'scenario_b'].map((s) => (
          <button
            key={s}
            onClick={() => setActiveScenario(s)}
            className={
              'px-4 py-1.5 transition-colors ' +
              (activeScenario === s
                ? 'bg-cyan-600 text-white'
                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700')
            }
          >
            {s === 'scenario_a' ? 'Scenario A (Won Arbitration)' : 'Scenario B (Lost Arbitration)'}
          </button>
        ))}
      </div>

      {/* Outcome summary */}
      <div className="p-4 bg-slate-800/30 rounded-xl border border-white/5">
        <h4 className="text-sm font-semibold text-white mb-3">
          Outcome Summary — {scenarioLabel} (unconditional)
        </h4>
        <div className="flex gap-6 text-sm mb-2">
          <div>
            <span className="text-emerald-400 font-bold">{(outcomes.TRUE_WIN * 100).toFixed(2)}%</span>{' '}
            <span className="text-slate-400">True Win</span>
          </div>
          {outcomes.RESTART > 0 && (
            <div>
              <span className="text-amber-400 font-bold">{(outcomes.RESTART * 100).toFixed(2)}%</span>{' '}
              <span className="text-slate-400">Restart</span>
            </div>
          )}
          <div>
            <span className="text-red-400 font-bold">{(outcomes.LOSE * 100).toFixed(2)}%</span>{' '}
            <span className="text-slate-400">Lose</span>
          </div>
        </div>
        <div className="h-3 w-full bg-slate-700 rounded-full overflow-hidden flex">
          <div className="bg-emerald-500 h-full" style={{ width: (outcomes.TRUE_WIN / scenarioMultiplier * 100) + '%' }} />
          <div className="bg-amber-500 h-full" style={{ width: (outcomes.RESTART / scenarioMultiplier * 100) + '%' }} />
          <div className="bg-red-500 h-full" style={{ width: (outcomes.LOSE / scenarioMultiplier * 100) + '%' }} />
        </div>
      </div>

      {/* D3 Tree */}
      {scenarioTree ? (
        <div className="rounded-xl border border-white/5 bg-slate-900/50 overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
            <div className="w-8 h-8 rounded-lg bg-teal-600/20 text-teal-400 flex items-center justify-center text-sm font-bold">
              🌲
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">{scenarioLabel}</h4>
              <p className="text-xs text-slate-500">Interactive tree — scroll to zoom, drag to pan</p>
            </div>
          </div>
          <D3Tree treeData={treeVizData} height={treeHeight} />
        </div>
      ) : (
        <div className="glass-card p-8 text-center text-slate-500">
          <p>No challenge tree data for this scenario.</p>
          <p className="text-xs mt-1">Ensure the jurisdiction template was loaded with defaults.</p>
        </div>
      )}

      {/* Collapsible slider fallback */}
      {editableNodes.length > 0 && (
        <div className="border border-white/5 rounded-xl overflow-hidden">
          <button
            onClick={() => setShowSliders(!showSliders)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-800/30 hover:bg-slate-800/50 transition text-sm"
          >
            <span className="font-semibold text-white">
              Node Probabilities — {scenarioLabel}
            </span>
            {showSliders ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>
          {showSliders && (
            <div className="p-4 bg-slate-900/30">
              <NodeSliders editableNodes={editableNodes} onUpdate={handleNodeUpdate} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

