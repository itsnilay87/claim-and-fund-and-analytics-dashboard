# Claim Analytics Platform

A professional litigation finance analytics platform for modelling, simulating, and valuing arbitration claims. Think **Morningstar Direct — but for arbitration portfolios**. Users create workspaces, define claims with jurisdiction-specific challenge trees, run Monte Carlo simulations across investment structures, and explore results through rich interactive dashboards.

<!-- TODO: Replace with actual screenshot once dashboard is deployed -->
![Dashboard Screenshot](docs/screenshot_placeholder.png)

---

## Quick Start (Local Development)

### Prerequisites

| Tool | Version |
|------|---------|
| Python | 3.11+ |
| Node.js | 18+ |
| npm | 9+ |

### Step-by-step setup

```bash
# 1. Clone the repository
git clone <repo-url>
cd claim-analytics-platform

# 2. Create a Python virtual environment and install engine dependencies
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r engine/requirements.txt
```

Expected output: `Successfully installed numpy scipy pydantic ...`

```bash
# 3. Install all Node.js dependencies
npm install              # root (concurrently)
cd server && npm install && cd ..
cd app && npm install && cd ..
cd dashboard && npm install && cd ..
```

Expected output: `added XXX packages` for each directory.

```bash
# 4. Start all services (from project root)
npm run dev
```

Expected output:
```
[server]  Claim Analytics API listening on port 3001
[app]     VITE v5.x  ready in XXXms — Local: http://localhost:5180/
[dashboard] VITE v6.x  ready in XXXms — Local: http://localhost:5173/
```

**Open http://localhost:5180** in your browser to see the application.

### First-time walkthrough

1. Log in with any name (demo auth — no real credentials needed)
2. Click **"Load Demo"** → select **"TATA Steel Portfolio"**
3. Explore the 6 pre-configured claims
4. Open a claim → click **Simulate** → view single-claim results
5. Navigate to Portfolios → open **"All Claims — Upfront+Tail"** → run analysis
6. Explore the full results dashboard with 12+ visualization tabs

---

## Architecture

The platform follows a **4-tier architecture**:

```
┌─────────────────────────────────────────────────┐
│            App Shell (React, port 5180)          │
│   Workspace • Claim Editor • Portfolio Builder   │
├──────────────┬──────────────────────────────────┤
│  API Server  │   Dashboard Shell (port 5173)     │
│ (Express,    │   12+ visualization tabs          │
│  port 3001)  │   Recharts, D3, Plotly            │
├──────────────┴──────────────────────────────────┤
│         Python Simulation Engine                 │
│   Monte Carlo • Probability Trees • Analysis     │
│   Investment Grid • Risk Metrics • Export        │
└─────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed module maps, data flow diagrams, and component relationships.

---

## Tech Stack

| Component | Technology | Port |
|-----------|-----------|------|
| **Simulation Engine** | Python 3.11+, NumPy, SciPy, Pydantic v2 | — |
| **API Server** | Node.js 18+, Express, AJV, CORS | 3001 |
| **App Shell** | React 18, Vite 5, React Router 6, Zustand, Tailwind CSS 3 | 5180 |
| **Results Dashboard** | React 18, Vite 6, Recharts, D3.js, Plotly.js | 5173 |
| **Deployment** | Docker, Docker Compose, Nginx, Supervisor | 80 |

---

## Project Structure

```
claim-analytics-platform/
├── engine/                   # Python simulation engine
│   ├── config/               #   Pydantic schemas, defaults, config loader
│   ├── models/               #   Probability tree, quantum, timeline, legal costs
│   ├── simulation/           #   Monte Carlo loop, cashflow builder, metrics
│   ├── analysis/             #   Investment grid, pricing surface, risk, sensitivity
│   ├── export/               #   JSON exporters (claim + portfolio)
│   ├── jurisdictions/        #   Jurisdiction templates (indian_domestic, siac)
│   ├── tests/                #   pytest unit tests
│   └── run.py                #   CLI orchestrator
├── server/                   # Express API server
│   ├── routes/               #   simulate, results, jurisdictions, claims, templates
│   ├── services/             #   simulationRunner, configService, storageService
│   └── server.js             #   Entry point
├── app/                      # React application shell
│   └── src/
│       ├── pages/            #   Landing, Login, WorkspaceHome, ClaimEditor, etc.
│       ├── components/       #   claim/, portfolio/, workspace/, layout/
│       ├── store/            #   Zustand stores (auth, workspace, claim, portfolio)
│       └── hooks/            #   Custom hooks (useClaims, useSimulation, etc.)
├── dashboard/                # React results dashboard
│   └── src/components/       #   18 visualization components
├── demo/                     # Pre-built demo workspaces (importable JSON)
├── docs/                     # Documentation
│   ├── ARCHITECTURE.md       #   System architecture & module maps
│   ├── API_CONTRACTS.md      #   API endpoint specifications
│   ├── DESIGN_DECISIONS.md   #   Architectural rationale
│   ├── JURISDICTION_GUIDE.md #   How to add new jurisdictions
│   └── SCHEMA_REFERENCE.md   #   Auto-generated Pydantic model reference
├── scripts/                  # Tooling
│   ├── benchmark.py          #   Performance benchmarks
│   ├── e2e_test.sh           #   End-to-end integration test
│   └── update_docs.py        #   Auto-update generated docs
├── deploy/                   # Deployment
│   ├── Dockerfile            #   Multi-stage Docker build
│   ├── docker-compose.yml    #   Compose config
│   ├── nginx.conf            #   Nginx reverse proxy config
│   └── README.md             #   Deployment guide
└── package.json              # Root convenience scripts
```

---

## Development Workflow

### Modifying the Engine

1. Edit Python files in `engine/` (models, simulation, analysis, export)
2. Run unit tests: `python -m pytest engine/tests/ -v`
3. The engine is invoked by the Express server via `engine/run.py`
4. Configuration schemas live in `engine/config/schema.py` (21 Pydantic models)
5. After schema changes, run `python scripts/update_docs.py` to regenerate docs

### Adding a Dashboard Tab

1. Create a new component in `dashboard/src/components/YourTab.jsx`
2. Register it in `dashboard/src/App.jsx` under the appropriate structure category
3. The dashboard receives data via the JSON contract defined in [docs/API_CONTRACTS.md](docs/API_CONTRACTS.md)

### Adding a New Jurisdiction

Follow the step-by-step guide in [docs/JURISDICTION_GUIDE.md](docs/JURISDICTION_GUIDE.md) (includes a worked ICC Paris example):

1. Create `engine/jurisdictions/your_jurisdiction.json` with challenge tree templates
2. The registry auto-discovers JSON files at startup
3. Add default timeline, legal cost, and tree parameters
4. Update `engine/config/defaults.py` with jurisdiction defaults

### Adding a New Investment Structure

1. Define the Pydantic model in `engine/config/schema.py` (params + validation)
2. Add analysis logic in `engine/analysis/` (grid evaluation, cashflow computation)
3. Add cashflow generation in `engine/simulation/cashflow_builder.py`
4. Add JSON export handling in `engine/export/`
5. Create dashboard visualization in `dashboard/src/components/`
6. Register the tab in `dashboard/src/App.jsx`

---

## Deployment

### Docker

```bash
# Build the Docker image
npm run docker:build
# or directly:
docker build -t claim-analytics -f deploy/Dockerfile .

# Run locally
npm run docker:run
# or directly:
docker run -p 8080:80 claim-analytics

# Open http://localhost:8080
```

### Production (Hetzner / VPS)

1. SSH into the server
2. Clone the repo and `cd claim-analytics-platform`
3. Copy `deploy/.env.example` to `deploy/.env` and configure
4. Run `docker compose -f deploy/docker-compose.yml up -d`
5. Nginx serves the frontend on port 80, proxies API requests to the Express server

See [deploy/README.md](deploy/README.md) for detailed deployment instructions, SSL setup, and monitoring.

---

## Running Tests

### Python Engine Tests

```bash
# Run all tests with verbose output
python -m pytest engine/tests/ -v

# Run a specific test module
python -m pytest engine/tests/test_monte_carlo.py -v

# Run with coverage
python -m pytest engine/tests/ -v --cov=engine --cov-report=term-missing
```

### End-to-End Integration Test

```bash
# Runs server, simulates claims/portfolios via API, verifies outputs
bash scripts/e2e_test.sh
```

### Performance Benchmarks

```bash
# Times 1K, 6K, and 60K path simulations
python scripts/benchmark.py
```

---

## Contributing

### Code Style

- **Python**: Follow PEP 8. Use type hints. Pydantic v2 for all data models.
- **JavaScript/React**: Functional components, hooks, Zustand for state. Tailwind for styling.
- **Commits**: Use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`).

### Pull Request Process

1. Create a feature branch from `main`
2. Ensure all tests pass: `python -m pytest engine/tests/ -v`
3. Run the E2E test if touching server/engine: `bash scripts/e2e_test.sh`
4. Update documentation if adding new models, routes, or components
5. Submit PR with a clear description of changes

### Documentation

After structural changes (new routes, models, jurisdictions), update auto-generated docs:

```bash
python scripts/update_docs.py
```

---

## License

Proprietary — 5 Rivers Capital. All rights reserved.
