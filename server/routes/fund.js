/**
 * Fund Analytics Routes
 *
 * Simulation:
 *   POST   /simulations           — Start a fund simulation (via Celery sidecar)
 *   GET    /simulations           — List user's fund simulations
 *   GET    /simulations/:id       — Get simulation details + results
 *   GET    /simulations/:id/status — Poll simulation progress
 *   DELETE /simulations/:id       — Soft-delete a simulation
 *   POST   /simulations/:id/save  — Bookmark a simulation
 *
 * Case simulation:
 *   POST   /case/submit           — Start a case simulation
 *   GET    /case/history          — List case simulations
 *
 * Parameters:
 *   GET    /parameters            — List saved parameter sets
 *   POST   /parameters            — Save a parameter set
 *   GET    /parameters/:id        — Get a parameter set
 *   PUT    /parameters/:id        — Update a parameter set
 *   DELETE /parameters/:id        — Delete a parameter set
 *   GET    /parameters/default    — Get default fund_parameters.json
 *
 * Note: auth is applied at the router level in server.js, not per-route.
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const fundSidecar = require('../services/fundSidecarClient');
const FundSimulation = require('../db/models/FundSimulation');
const FundParameters = require('../db/models/FundParameters');

const DEFAULT_PARAMS_PATH = path.resolve(__dirname, '..', '..', 'engine_fund', 'inputs', 'fund_parameters.json');

const fundLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many fund simulation requests. Please try again later.' },
});

// ── Simulations ─────────────────────────────────────────────

router.post('/simulations', fundLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      parametersId, name, simulations, sensitivity, sensitivityDivisor,
      scenario, scenarios, allScenarios, caseMode, fundingProfile,
      customParameters,
    } = req.body;

    const dbRecord = await FundSimulation.create(userId, {
      parametersId,
      name: name || '',
      mode: 'fund',
      config: req.body,
      scenarios: scenarios || (scenario ? [scenario] : ['base']),
      sensitivity: sensitivity || false,
      numSimulations: simulations,
      fundingProfile: fundingProfile || 'UF',
    });

    const sidecarParams = {
      inputs_path: 'engine_fund/inputs/fund_parameters.json',
      simulations: simulations || null,
      sensitivity: sensitivity || false,
      sensitivity_divisor: sensitivityDivisor || null,
      scenario: scenario || 'base',
      scenarios: scenarios || null,
      all_scenarios: allScenarios || false,
      case_mode: caseMode || 'legacy',
      funding_profile: fundingProfile || 'UF',
      custom_parameters: customParameters || null,
    };

    const sidecarRes = await fundSidecar.startSimulation(sidecarParams, userId);

    await FundSimulation.updateCeleryTaskId(dbRecord.id, sidecarRes.celery_task_id);
    await FundSimulation.updateStatus(dbRecord.id, { status: 'queued' });

    res.status(202).json({
      data: {
        id: dbRecord.id,
        celeryTaskId: sidecarRes.celery_task_id,
        status: 'queued',
      },
    });
  } catch (err) {
    console.error('[fund] POST /simulations error:', err.message);
    res.status(500).json({ error: 'Failed to start fund simulation', details: err.message });
  }
});

router.get('/simulations', async (req, res) => {
  try {
    const { limit = 20, offset = 0, status, mode } = req.query;
    const result = await FundSimulation.findAllByUser(req.user.id, {
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
      status,
      mode,
    });
    res.json({ data: result });
  } catch (err) {
    console.error('[fund] GET /simulations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/simulations/:id', async (req, res) => {
  try {
    const run = await FundSimulation.findById(req.params.id, req.user.id);
    if (!run) return res.status(404).json({ error: 'Fund simulation not found' });

    let dashboardData = null;
    if (run.status === 'completed' && run.celery_task_id) {
      try {
        const sidecarRes = await fundSidecar.getResults(run.celery_task_id);
        dashboardData = sidecarRes.data;
      } catch {
        dashboardData = run.results_summary || null;
      }
    }

    res.json({ data: { ...run, dashboard_data: dashboardData } });
  } catch (err) {
    console.error('[fund] GET /simulations/:id error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/simulations/:id/status', async (req, res) => {
  try {
    const run = await FundSimulation.findById(req.params.id, req.user.id);
    if (!run) return res.status(404).json({ error: 'Fund simulation not found' });

    if (run.status === 'completed' || run.status === 'failed') {
      return res.json({
        data: {
          status: run.status,
          progress: run.status === 'completed' ? 100 : run.progress,
          stage: run.stage || '',
          message: run.error_message || '',
        },
      });
    }

    if (run.celery_task_id) {
      try {
        const sidecarStatus = await fundSidecar.getStatus(run.celery_task_id);

        if (sidecarStatus.status === 'completed' && run.status !== 'completed') {
          const sidecarResults = await fundSidecar.getResults(run.celery_task_id);
          await FundSimulation.updateStatus(run.id, {
            status: 'completed',
            progress: 100,
            completedAt: new Date().toISOString(),
            resultsSummary: sidecarResults.data?.dashboard_data || {},
          });
          sidecarStatus.progress = 100;
        } else if (sidecarStatus.status === 'running' && run.status !== 'running') {
          await FundSimulation.updateStatus(run.id, { status: 'running', progress: sidecarStatus.progress, stage: sidecarStatus.stage });
        } else if (sidecarStatus.status === 'failed' && run.status !== 'failed') {
          await FundSimulation.updateStatus(run.id, { status: 'failed', errorMessage: sidecarStatus.message });
        } else if (sidecarStatus.progress !== run.progress) {
          await FundSimulation.updateStatus(run.id, { progress: sidecarStatus.progress, stage: sidecarStatus.stage });
        }

        return res.json({ data: sidecarStatus });
      } catch {
        return res.json({
          data: { status: run.status, progress: run.progress || 0, stage: run.stage || '', message: '' },
        });
      }
    }

    res.json({
      data: { status: run.status, progress: run.progress || 0, stage: run.stage || '', message: '' },
    });
  } catch (err) {
    console.error('[fund] GET /simulations/:id/status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/simulations/:id', async (req, res) => {
  try {
    const deleted = await FundSimulation.delete(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Fund simulation not found' });
    res.json({ data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/simulations/:id/save', async (req, res) => {
  try {
    const { name } = req.body;
    const run = await FundSimulation.markSaved(req.params.id, req.user.id, name);
    if (!run) return res.status(404).json({ error: 'Fund simulation not found' });
    res.json({ data: run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Case Simulations ────────────────────────────────────────

router.post('/case/submit', fundLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const caseParameters = req.body;

    const dbRecord = await FundSimulation.create(userId, {
      name: caseParameters.case?.name || 'Case Simulation',
      mode: 'case',
      config: caseParameters,
    });

    const sidecarRes = await fundSidecar.submitCaseSimulation(caseParameters, userId);
    await FundSimulation.updateCeleryTaskId(dbRecord.id, sidecarRes.celery_task_id);

    res.status(202).json({
      data: { id: dbRecord.id, celeryTaskId: sidecarRes.celery_task_id, status: 'queued' },
    });
  } catch (err) {
    console.error('[fund] POST /case/submit error:', err.message);
    res.status(500).json({ error: 'Failed to start case simulation', details: err.message });
  }
});

router.get('/case/history', async (req, res) => {
  try {
    const result = await FundSimulation.findAllByUser(req.user.id, { mode: 'case' });
    res.json({ data: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Parameters ──────────────────────────────────────────────

router.get('/parameters', async (req, res) => {
  try {
    const params = await FundParameters.findAllByUser(req.user.id);
    res.json({ data: params });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/parameters/default', (_req, res) => {
  try {
    if (!fs.existsSync(DEFAULT_PARAMS_PATH)) {
      return res.status(404).json({ error: 'Default parameters file not found' });
    }
    const content = JSON.parse(fs.readFileSync(DEFAULT_PARAMS_PATH, 'utf-8'));
    res.json({ data: content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/parameters', async (req, res) => {
  try {
    const { name, description, parameters, isDefault } = req.body;
    const record = await FundParameters.create(req.user.id, { name, description, parameters, isDefault });
    res.status(201).json({ data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/parameters/:id', async (req, res) => {
  try {
    const record = await FundParameters.findById(req.params.id, req.user.id);
    if (!record) return res.status(404).json({ error: 'Parameter set not found' });
    res.json({ data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/parameters/:id', async (req, res) => {
  try {
    const { name, description, parameters, isDefault } = req.body;
    const record = await FundParameters.update(req.params.id, req.user.id, { name, description, parameters, isDefault });
    if (!record) return res.status(404).json({ error: 'Parameter set not found' });
    res.json({ data: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/parameters/:id', async (req, res) => {
  try {
    const deleted = await FundParameters.delete(req.params.id, req.user.id);
    if (!deleted) return res.status(404).json({ error: 'Parameter set not found' });
    res.json({ data: { deleted: true } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
