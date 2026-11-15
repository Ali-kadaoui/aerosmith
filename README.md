# Aerosmith MEOS (Mars Exploration Operations System)

A Mars mission planning and surface exploration dashboard created for the NASA Space Apps Challenge. The project combines real NASA orbital imagery, spherical A* traverse routing over elevation rasters, an interactive 3D Mars globe, and an AI mission assistant.

## Quick Start

### Prerequisites
- Python 3.12+
- Node.js 20+ and npm

### 1. Backend (FastAPI)

```bash
cd backend
python -m venv .venv

# Windows:
.\.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8018 --reload
```

The API and interactive docs will run at http://127.0.0.1:8018/docs.

### 2. Frontend (React + Vite)

In a separate terminal:

```bash
cd frontend
npm install
npm run dev -- --port 5188
```

Open your browser at http://127.0.0.1:5188.

## Key Features

- **Interactive 3D Mars Globe**: Oblate spheroid Mars globe built with Three.js, supporting Viking, MOLA, CTX, and HRSC orbital layers.
- **NASA Trek 2D Map**: Equirectangular tile layers directly from NASA PDS/Trek with real Curiosity and Perseverance telemetry.
- **Spherical A* Pathfinding**: Surface route planning and slope hazard evaluation using Gale Crater MOLA (~463m) and HiRISE (~1m) elevation grids.
- **Mission Assistant**: Interactive Gemini-powered copilot with live spatial and mission context.
- **Manifest Export**: Export reproducible mission plans with elevation checksums and data provenance.

## Project Structure

```
backend/       FastAPI REST API, spherical A* router, and Gemini assistant
frontend/      React + TypeScript UI, Three.js 3D globe, and OpenLayers map
data/          Bundled Gale Crater MOLA/HiRISE elevation grids and metadata
docs/          Scientific assumptions, data sources, and architecture notes
scripts/       Data conversion, contour generation, and local run scripts
```

## License
MIT - Team Aerosmith (NASA Space Apps Challenge)
