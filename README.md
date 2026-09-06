# Personal Knowledge Graph

A specialized second-brain app that links a marketer's real-world experiences, client wins, and contrarian opinions — captured as `[[Wiki-Linked]]` notes and visualized as an interactive knowledge network you can export as "fact-sheets" to prime AI models for authentic writing.

It attacks the **Expertise Illusion**: your authority isn't what you know in isolation, it's the unexpected connections between experiences, ideas, and contrarian views.

## Features

- **Capture** — paste a note; `[[Wiki-Links]]` are auto-extracted into graph edges
- **Interactive network** — D3 force-directed graph with drag, pan, and zoom
- **Community detection** — deterministic Louvain clustering colors hidden knowledge clusters
- **God-nodes** — hubs with the most connections get a dashed orbit ring
- **Path tracing** — shortest path between any two nodes, gold-highlighted
- **Surprising connections** — cross-community links ranked and surfaced as outliers
- **AI edge inference** — Groq (free tier) suggests hidden connections between your existing notes, with one-click add
- **Search** — full-text search on names and content
- **Delete** — remove nodes (cascades their relationships)
- **Export** — download the whole graph as JSON or CSV

## Stack

| Layer | Tech |
| --- | --- |
| Database | Neo4j (Desktop) |
| Backend | FastAPI (Python 3.14) |
| Frontend | React + Vite + Tailwind CSS v4 |
| Graph viz | D3 (`d3-force`, `d3-drag`, `d3-selection`) |
| AI insights | Groq API (`llama-3.3-70b-versatile`) |

## Setup

### 1. Prerequisites

- Neo4j Desktop running on `bolt://localhost:7687` (default `neo4j` DB)
- Python 3.14 with a virtual environment
- Node.js (for the Vite frontend)

### 2. Environment

```bash
cp .env.example .env
```

Fill in `NEO4J_PASSWORD`. For AI insights, add your free Groq key (no credit card) from https://console.groq.com:

```
GROQ_API_KEY=gsk_...
GROQ_MODEL=llama-3.3-70b-versatile   # optional
```

### 3. Backend

```bash
python -m venv venv
venv\Scripts\activate              # Windows
pip install -r requirements.txt    # fastapi uvicorn neo4j python-dotenv
uvicorn main:app --reload          # http://127.0.0.1:8000
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

## API

| Method | Route | Description |
| --- | --- | --- |
| GET | `/` | Health check |
| POST | `/nodes` | Create/update a node; auto-links `[[Wiki-Links]]` |
| GET | `/nodes/{name}` | Node content + outgoing links |
| POST | `/links` | Create a relationship between two nodes |
| GET | `/graph` | All edges (source, relationship, target) |
| GET | `/graph/viz` | Nodes + links for the visualization |
| GET | `/search?q=` | Full-text search over names and content |
| GET | `/path?start=&end=` | Shortest path between two nodes |
| POST | `/insights/suggest` | Groq-powered hidden-connection suggestions |
| DELETE | `/nodes/{name}` | Delete a node and its relationships |
| GET | `/export` | Full graph as JSON (nodes + links) |

Interactive docs: http://127.0.0.1:8000/docs