/**
 * HTTP client for the fund simulation FastAPI sidecar.
 * All calls go to localhost:8000 (internal, no auth needed — Node handles auth).
 */

const SIDECAR_URL = process.env.FUND_SIDECAR_URL || 'http://localhost:8000';
const TIMEOUT_MS = 30_000;

async function sidecarFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${SIDECAR_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok && res.status !== 202) {
      const body = await res.text();
      throw new Error(`Sidecar ${res.status}: ${body}`);
    }

    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

const fundSidecar = {
  async startSimulation(params, userId) {
    return sidecarFetch('/fund-api/simulations', {
      method: 'POST',
      body: JSON.stringify(params),
      headers: userId ? { 'X-User-Id': userId } : {},
    });
  },

  async getStatus(celeryTaskId) {
    return sidecarFetch(`/fund-api/simulations/${celeryTaskId}/status`);
  },

  async getResults(celeryTaskId) {
    return sidecarFetch(`/fund-api/simulations/${celeryTaskId}`);
  },

  async listSimulations() {
    return sidecarFetch('/fund-api/simulations');
  },

  async submitCaseSimulation(caseParameters, userId) {
    return sidecarFetch('/fund-api/case/submit', {
      method: 'POST',
      body: JSON.stringify({ case_parameters: caseParameters }),
      headers: userId ? { 'X-User-Id': userId } : {},
    });
  },

  async getCaseHistory() {
    return sidecarFetch('/fund-api/case/history');
  },

  async listInputs() {
    return sidecarFetch('/fund-api/inputs');
  },

  async getInputContent(filePath) {
    const encoded = encodeURIComponent(filePath);
    return sidecarFetch(`/fund-api/inputs/content?file_path=${encoded}`);
  },

  async healthCheck() {
    return sidecarFetch('/fund-api/health');
  },
};

module.exports = fundSidecar;
