# Claim Analytics Platform

> Morningstar Direct-style litigation claim analytics platform for Monte Carlo valuation of arbitration claims.

## Essential Documentation

| Document | Purpose |
|----------|---------|
| **[DEPLOYMENT_WORKFLOW.md](./DEPLOYMENT_WORKFLOW.md)** | How to deploy code changes to production (CI/CD pipeline, server info, debugging) |
| **[AGENT_DEVELOPMENT_PLAYBOOK.md](./AGENT_DEVELOPMENT_PLAYBOOK.md)** | How to fix bugs and add features safely — full codebase map, data flows, gotchas |
| [deploy/README.md](./deploy/README.md) | Docker build, manual deploy, HTTPS setup, troubleshooting |

## Quick Start (Development)

```bash
cd claim-analytics-platform
npm run dev                    # Starts server (:3001) + app (:5180) + dashboard (:5173)
```

## Quick Start (Deploy to Production)

```bash
git add . && git commit -m "fix: description" && git push
# CI/CD auto-deploys to http://178.104.35.208 in ~4 minutes
gh run watch                   # monitor pipeline
```

## Implementation Guide

Built using Claude Opus 4.6 agent prompts.

**See:** [IMPLEMENTATION_PROMPTS.md](./IMPLEMENTATION_PROMPTS.md) — 25-phase sequential prompts for complete implementation.

## Phase Overview

| Phase | Description | Est. Time |
|-------|-------------|-----------|
| 0 | Project Setup & Context | 30 min |
| 1 | Python Config & Schemas | 2 hrs |
| 2 | Python Core Models | 3 hrs |
| 3 | Monte Carlo Simulation | 2 hrs |
| 4 | Analysis Modules | 3 hrs |
| 5 | Export & CLI | 2 hrs |
| 6 | Node.js Server | 2 hrs |
| 7 | Dashboard Components | 4 hrs |
| 8 | Main App Shell | 4 hrs |
| 9 | Integration & Testing | 3 hrs |
| 10 | Documentation & Deployment | 2 hrs |
| 11 | Final Polish | 2 hrs |

**Total:** ~29 hours of active development

## Project Status

- [ ] Phase 0: Project Initialization
- [ ] Phase 1: Configuration & Schemas
- [ ] Phase 2: Core Models
- [ ] Phase 3: Monte Carlo Engine
- [ ] Phase 4: Analysis Modules
- [ ] Phase 5: Export & CLI
- [ ] Phase 6: Server
- [ ] Phase 7: Dashboard
- [ ] Phase 8: App Shell
- [ ] Phase 9: Integration
- [ ] Phase 10: Documentation
- [ ] Phase 11: Final Polish

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Simulation Engine | Python 3.11+, NumPy, SciPy, Pydantic |
| API Server | Node.js, Express 4 |
| Dashboard | React 18, Vite 6, Recharts, D3 7, Plotly |
| App Shell | React 18, Vite 5, Tailwind 3, Zustand, React Router |
| Deployment | Docker, Nginx, Supervisor, GitHub Actions CI/CD → Hetzner |
