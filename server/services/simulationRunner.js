/**
 * Simulation Runner Service
 *
 * Manages Python subprocess lifecycle for Monte Carlo simulations.
 * Tracks run status in-memory (Map) with disk persistence (status.json).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const RUNS_DIR = path.resolve(__dirname, '..', 'runs');
const ENGINE_DIR = path.resolve(__dirname, '..', '..', 'engine');
const PLATFORM_DIR = path.resolve(__dirname, '..', '..');
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Resolve the Python executable — prefer the project venv, then global.
 */
function _findPython() {
  // Check .venv in workspace root (one level above platform dir)
  const venvPaths = process.platform === 'win32'
    ? [
        path.join(WORKSPACE_ROOT, '.venv', 'Scripts', 'python.exe'),
        path.join(PLATFORM_DIR, '.venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(WORKSPACE_ROOT, '.venv', 'bin', 'python'),
        path.join(PLATFORM_DIR, '.venv', 'bin', 'python3'),
      ];

  for (const p of venvPaths) {
    if (fs.existsSync(p)) return p;
  }

  // Fallback to PATH
  return process.platform === 'win32' ? 'python' : 'python3';
}

// In-memory run status map
const runStatus = new Map();

/**
 * Start a simulation run.
 * @param {object} config - Full config object to write to disk
 * @param {string} mode - "claim" or "portfolio"
 * @returns {{ runId: string }}
 */
function startRun(config, mode = 'portfolio') {
  const runId = uuidv4();
  const runDir = path.join(RUNS_DIR, runId);
  const outputDir = path.join(runDir, 'outputs');

  fs.mkdirSync(outputDir, { recursive: true });

  // Write config to disk
  const configPath = path.join(runDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Initialize status
  const status = {
    runId,
    status: 'queued',
    mode,
    startedAt: new Date().toISOString(),
    completedAt: null,
    progress: 0,
    error: null,
  };
  runStatus.set(runId, status);
  _writeStatus(runDir, status);

  // Spawn Python process async
  setImmediate(() => _spawnPython(runId, configPath, outputDir, mode));

  return { runId };
}

/**
 * Get run status.
 * @param {string} runId
 * @returns {object|null}
 */
function getStatus(runId) {
  // Check in-memory first
  if (runStatus.has(runId)) {
    return runStatus.get(runId);
  }
  // Fall back to disk
  const statusPath = path.join(RUNS_DIR, runId, 'status.json');
  if (fs.existsSync(statusPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      runStatus.set(runId, s);
      return s;
    } catch { return null; }
  }
  return null;
}

/**
 * List available output files for a run.
 * @param {string} runId
 * @returns {Array<{name: string, path: string, type: string, size: number}>}
 */
function listRunFiles(runId) {
  const outputDir = path.join(RUNS_DIR, runId, 'outputs');
  if (!fs.existsSync(outputDir)) return [];

  const files = [];
  _walkDir(outputDir, outputDir, files);
  return files;
}

/**
 * Resolve a file path within a run's output directory (with traversal protection).
 * @param {string} runId
 * @param {string} filePath - Relative path within outputs/
 * @returns {string|null} Absolute path or null if invalid/missing
 */
function getResultFilePath(runId, filePath) {
  const outputDir = path.join(RUNS_DIR, runId, 'outputs');
  const resolved = path.resolve(outputDir, filePath);

  // Prevent directory traversal
  if (!resolved.startsWith(outputDir)) return null;
  if (!fs.existsSync(resolved)) return null;

  return resolved;
}

/**
 * List recent runs.
 * @returns {Array<object>}
 */
function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];

  const entries = fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory());

  const runs = [];
  for (const entry of entries) {
    const statusPath = path.join(RUNS_DIR, entry.name, 'status.json');
    if (fs.existsSync(statusPath)) {
      try {
        runs.push(JSON.parse(fs.readFileSync(statusPath, 'utf-8')));
      } catch { /* skip corrupt */ }
    }
  }

  // Sort newest first
  runs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  return runs;
}

// ── Internal helpers ──

function _spawnPython(runId, configPath, outputDir, mode) {
  const status = runStatus.get(runId);
  status.status = 'running';
  status.progress = 5;
  status.stage = 'Initializing...';
  _writeStatus(path.dirname(configPath), status);

  const logPath = path.join(path.dirname(configPath), 'log.txt');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });

  // Determine python executable — prefer venv, fall back to global PATH
  const pythonCmd = _findPython();
  console.log(`[SimRunner] Using Python: ${pythonCmd}`);

  const args = [
    '-m', 'engine.run_v2',
    '--config', configPath,
    '--output-dir', outputDir,
    '--mode', mode,
  ];

  const child = spawn(pythonCmd, args, {
    cwd: PLATFORM_DIR,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data) => {
    const text = data.toString();
    logStream.write(text);

    // Parse progress from V2 engine output
    if (text.includes('Simulating') && text.includes('...')) {
      status.progress = Math.min(status.progress + 5, 25);
      const match = text.match(/Simulating (\S+)/);
      status.stage = match ? `Simulating ${match[1]}...` : 'Running Monte Carlo...';
    } else if (text.includes('MC completed')) {
      status.progress = 30;
      status.stage = 'MC simulation complete';
    } else if (text.includes('Computing investment grid')) {
      status.progress = 40;
      status.stage = 'Computing investment grid...';
    } else if (text.includes('Grid analysis completed')) {
      status.progress = 50;
      status.stage = 'Investment grid complete';
    } else if (text.includes('Computing stochastic pricing')) {
      status.progress = 55;
      status.stage = 'Generating stochastic pricing grid...';
    } else if (text.includes('Stochastic grid completed')) {
      status.progress = 65;
      status.stage = 'Stochastic pricing complete';
    } else if (text.includes('probability sensitivity')) {
      status.progress = 70;
      status.stage = 'Running probability sensitivity...';
    } else if (text.includes('Dashboard JSON exported')) {
      status.progress = 80;
      status.stage = 'Exporting dashboard JSON...';
    } else if (text.includes('Excel report') || text.includes('comprehensive Excel')) {
      status.progress = 85;
      status.stage = 'Generating Excel reports...';
    } else if (text.includes('PDF report')) {
      status.progress = 90;
      status.stage = 'Generating PDF report...';
    } else if (text.includes('Pipeline status: complete') || text.includes('Total pipeline time')) {
      status.progress = 95;
      status.stage = 'Finalizing...';
    }
    _writeStatus(path.dirname(configPath), status);
  });

  child.stderr.on('data', (data) => {
    logStream.write('[STDERR] ' + data.toString());
  });

  child.on('close', (code) => {
    logStream.end();
    if (code === 0) {
      status.status = 'completed';
      status.progress = 100;
    } else {
      status.status = 'failed';
      status.error = `Python process exited with code ${code}`;
      // Try to read last lines of log for error detail
      try {
        const log = fs.readFileSync(logPath, 'utf-8');
        const lines = log.trim().split('\n');
        status.error += ': ' + lines.slice(-3).join(' | ');
      } catch { /* ignore */ }
    }
    status.completedAt = new Date().toISOString();
    runStatus.set(runId, status);
    _writeStatus(path.dirname(configPath), status);
  });

  child.on('error', (err) => {
    logStream.end();
    status.status = 'failed';
    status.error = `Failed to spawn Python: ${err.message}`;
    status.completedAt = new Date().toISOString();
    runStatus.set(runId, status);
    _writeStatus(path.dirname(configPath), status);
  });
}

function _writeStatus(runDir, status) {
  try {
    fs.writeFileSync(
      path.join(runDir, 'status.json'),
      JSON.stringify(status, null, 2),
      'utf-8'
    );
  } catch { /* non-critical */ }
}

function _walkDir(dir, baseDir, result) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      _walkDir(fullPath, baseDir, result);
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const ext = path.extname(entry.name).toLowerCase();
      const stat = fs.statSync(fullPath);
      result.push({
        name: entry.name,
        path: relPath,
        type: _categorize(ext),
        size: stat.size,
      });
    }
  }
}

function _categorize(ext) {
  const map = {
    '.json': 'data',
    '.xlsx': 'excel',
    '.pdf': 'pdf',
    '.png': 'chart',
    '.csv': 'data',
    '.txt': 'log',
  };
  return map[ext] || 'other';
}

module.exports = { startRun, getStatus, listRunFiles, getResultFilePath, listRuns };
