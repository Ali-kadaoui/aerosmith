# 🚀 Aerosmith MEOS (Mars Exploration Operations System)

[![NASA Space Apps Challenge](https://img.shields.io/badge/NASA%20Space%20Apps-Challenge-orange.svg)](https://www.spaceappschallenge.org/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI-009688.svg)](https://fastapi.tiangolo.com/)
[![React + Vite](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61DAFB.svg)](https://vitejs.dev/)
[![Three.js](https://img.shields.io/badge/3D-Three.js-black.svg)](https://threejs.org/)

An interactive Mars exploration mission console built for the **NASA Space Apps Challenge**. Features orbital imagery, spherical A* traverse route planning over real elevation data, an interactive 3D Mars globe, and an AI mission assistant.

---

## ⚡ Quick Start (Run Locally)

### Prerequisites
- **Python 3.12+**
- **Node.js 20+** & **npm**

---

### 1. ⚙️ Backend (FastAPI)

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
> API & Swagger docs: [http://127.0.0.1:8018/docs](http://127.0.0.1:8018/docs)

---

### 2. 🖥️ Frontend (React + Vite)

In a second terminal:

```bash
cd frontend
npm install
npm run dev -- --port 5188
```
> Open in browser: [http://127.0.0.1:5188](http://127.0.0.1:5188)

---

## 🌟 Key Features

- 🪐 **Interactive 3D Mars Globe**: Oblate spheroid Mars globe with Viking, MOLA, CTX, and HRSC orbital layers in Three.js.
- 🗺️ **NASA Trek 2D Map**: Interactive equirectangular tile matrices directly from NASA PDS/Trek with real rover telemetry.
- 🧭 **Spherical A\* Pathfinding**: Multi-strategy surface traverse optimization over MOLA (~463m) and HiRISE (~1m) elevation grids.
- 🤖 **AEROSMITH AI Assistant**: Gemini-powered tactical copilot with live spatial and mission context.
- 📋 **Mission Manifest Export**: One-click export of reproducible route plans with elevation checksums.

---

## 📁 Project Structure

```
├── backend/            # FastAPI REST API & Spherical A* route engine
│   ├── app/            # Endpoints, algorithms, terrain loaders & Gemini AI
│   └── tests/          # Pytest validation suite
├── frontend/           # React 18 + TypeScript + Vite UI
│   ├── src/            # Map, 3D Globe, Itinerary & AI components
│   └── public/         # Mars textures, raster datasets & rover photos
├── data/               # Bundled MOLA & HiRISE DEM crops + NASA metadata
├── docs/               # Scientific assumptions, data sources & architecture
└── scripts/            # Planetary raster processing & launch utilities
```

---

## 📜 License
MIT © Team Aerosmith - NASA Space Apps Challenge
