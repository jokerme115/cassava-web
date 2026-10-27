# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

Cassava Desktop is a cross-platform offline desktop application for cassava disease detection using image segmentation ML models. Built with Electron + Django + React.

## Dev Commands

```bash
# Frontend (React/Vite)
cd frontend_source
npm run dev              # Vite dev server
npm run build            # Production build
npm run lint             # ESLint
npm run test             # Vitest

# E2E Tests
cd tests/e2e
npx playwright test

# Root (Electron)
npm run dev              # Dev mode (uses system Python backend directly)
npm run start            # Production mode (uses packaged backend.exe)
npm run build:frontend   # Build React → resources/frontend/
npm run build:backend    # Package Django with Nuitka (CPU slim)
npm run build            # Full build + electron-builder
```

## Architecture

```
Electron Shell (electron/)
    ├── main.js          # Main process: window mgmt, backend spawning, port mgmt
    └── preload.js       # IPC bridge: window.electronAPI

Django Backend (backend/)
    ├── predict/views.py       # REST API endpoints
    ├── predict/m6_predictor.py  # ML inference (M6BestPredictor class)
    └── predict/models.py      # SQLite models (CassavaImage, SegmentationResult, etc.)

React Frontend (frontend_source/)
    ├── src/components/CassavaApp.tsx  # Main layout + routing
    ├── src/api/                       # API client
    └── src/locales/                   # i18n (zh/en)
```

**Two backend modes:**
- Dev (`npm run dev`): Spawns `python manage.py runserver` - code changes hot reload
- Production: Uses Nuitka-compiled `dist_bin/backend.exe`

**ML Inference:** PyTorch model at `resources/models/M6_best_predict_package/models/m6_best_fold1.pth`, processes images in 512x512 patches with 256 stride.

## Key Files

| Component | Path |
|-----------|------|
| Electron main | `electron/main.js` |
| Django entry | `backend/manage.py` |
| ML predictor | `backend/predict/m6_predictor.py` |
| React root | `frontend_source/src/App.tsx` |
| Build config | `electron-builder.yml` |

## Design Notes

- **Offline-first**: SQLite database in `<userData>/runtime-data/db.sqlite3`
- **CPU/GPU**: PyTorch inference - GPU auto-detected, CPU fallback
- **Extension points**: Add new API endpoints in `predict/views.py`, new React routes in `CassavaApp.tsx`
- **i18n**: Translations in `frontend_source/src/locales/`
