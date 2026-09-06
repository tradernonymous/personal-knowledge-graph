from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from neo4j import GraphDatabase
from dotenv import load_dotenv
import os
import json
import urllib.request
import urllib.error

# Load environment variables
load_dotenv()

# Neo4j Configuration
URI = os.getenv("NEO4J_URI")
USER = os.getenv("NEO4J_USER")
PASSWORD = os.getenv("NEO4J_PASSWORD")

# Groq Configuration (AI edge inference)
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
# Groq's model catalog varies per account/date; fall through until one is usable.
GROQ_MODEL_FALLBACKS = [
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "qwen/qwen3.6-27b",
    "meta-llama/llama-3.3-70b-versatile",
    "llama-3.3-70b-versatile",
]

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Personal Knowledge Graph API")
# Allow the React dev server to talk to the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
driver = GraphDatabase.driver(URI, auth=(USER, PASSWORD))

# Models
class NodeCreate(BaseModel):
    name: str
    content: str = ""
    label: str = "Note"

class LinkCreate(BaseModel):
    source: str
    target: str
    relationship: str = "RELATED_TO"

@app.get("/")
def read_root():
    return {"status": "PKG API is running"}

@app.post("/nodes")
def create_node(node: NodeCreate):
    with driver.session() as session:
        # 1. Create/Update the main node
        query = f"MERGE (n:{node.label} {{name: $name}}) SET n.content = $content RETURN n"
        session.run(query, name=node.name, content=node.content)
        
        # 2. Extract [[Links]] and create relationships
        import re
        links = re.findall(r'\[\[(.*?)\]\]', node.content)
        
        for link_name in links:
            # Create the linked node if it doesn't exist
            session.run(f"MERGE (l:Note {{name: $name}})", name=link_name)
            # Create the relationship
            session.run(
                "MATCH (a:Note {name: $source}), (b:Note {name: $target}) "
                "MERGE (a)-[:RELATED_TO]->(b)",
                source=node.name, target=link_name
            )
            
        return {"message": f"Node {node.name} and {len(links)} links processed"}

@app.post("/links")
def create_link(link: LinkCreate):
    with driver.session() as session:
        query = (
            "MATCH (a:Note {name: $source}), (b:Note {name: $target}) "
            f"MERGE (a)-[r:{link.relationship}]->(b) "
            "RETURN a, r, b"
        )
        session.run(query, source=link.source, target=link.target)
        return {"message": f"Link created between {link.source} and {link.target}"}

@app.get("/nodes/{name}")
def get_node(name: str):
    with driver.session() as session:
        # Get node content
        node_res = session.run("MATCH (n:Note {name: $name}) RETURN n.content AS content", name=name)
        node_record = node_res.single()
        if not node_record:
            raise HTTPException(status_code=404, detail="Node not found")
        content = node_record["content"]
        # Get outgoing links
        links_res = session.run(
            "MATCH (n:Note {name: $name})-[:RELATED_TO]->(m:Note) RETURN m.name AS target",
            name=name,
        )
        links = [rec["target"] for rec in links_res]
        return {"name": name, "content": content, "links": links}


@app.get("/graph")
def get_graph():
    with driver.session() as session:
        query = "MATCH (n)-[r]->(m) RETURN n.name as source, type(r) as relationship, m.name as target"
        result = session.run(query)
        return [record.data() for record in result]

@app.get("/graph/viz")
def get_graph_viz():
    with driver.session() as session:
        nodes_query = "MATCH (n:Note) RETURN n.name AS id, n.content AS content"
        nodes_res = session.run(nodes_query)
        nodes = []
        for rec in nodes_res:
            nodes.append({
                "id": rec["id"],
                "content": rec["content"],
            })
        links_query = "MATCH (a:Note)-[r:RELATED_TO]->(b:Note) RETURN a.name AS source, b.name AS target"
        links_res = session.run(links_query)
        links = [{"source": rec["source"], "target": rec["target"]} for rec in links_res]
        return {"nodes": nodes, "links": links}

@app.get("/search")
def search(q: str):
    with driver.session() as session:
        query = """
        MATCH (n:Note)
        WHERE toLower(n.name) CONTAINS toLower($q) OR toLower(n.content) CONTAINS toLower($q)
        RETURN n.name AS name, n.content AS content
        """
        result = session.run(query, q=q)
        return [record.data() for record in result]

@app.get("/path")
def get_path(start: str, end: str):
    with driver.session() as session:
        result = session.run(
            """
            MATCH (a:Note {name: $start}), (b:Note {name: $end}),
                  p = shortestPath((a)-[*..15]-(b))
            RETURN [n IN nodes(p) | n.name] AS nodes,
                   [rel IN relationships(p) | {
                     source: startNode(rel).name,
                     target: endNode(rel).name
                   }] AS edges
            """,
            start=start,
            end=end,
        )
        record = result.single()
        if not record:
            return {"path": None, "message": "No path found between those nodes."}
        return {
            "path": {
                "nodes": record["nodes"],
                "edges": record["edges"],
            }
        }

@app.delete("/nodes/{name}")
def delete_node(name: str):
    with driver.session() as session:
        session.run("MATCH (n:Note {name: $name}) DETACH DELETE n", name=name)
        return {"message": f"Node {name} deleted"}

@app.get("/export")
def export_graph():
    with driver.session() as session:
        nodes_res = session.run("MATCH (n:Note) RETURN n.name AS name, n.content AS content")
        nodes = [{"name": rec["name"], "content": rec["content"]} for rec in nodes_res]
        links_res = session.run(
            "MATCH (a:Note)-[r:RELATED_TO]->(b:Note) "
            "RETURN a.name AS source, type(r) AS relationship, b.name AS target"
        )
        links = [
            {
                "source": rec["source"],
                "relationship": rec["relationship"],
                "target": rec["target"],
            }
            for rec in links_res
        ]
        return {"nodes": nodes, "links": links}

def _groq_chat(user_content: str) -> str:
    """Call Groq's OpenAI-compatible chat completions API using stdlib only."""
    candidate_models = []
    if GROQ_MODEL:
        candidate_models.append(GROQ_MODEL)
    for m in GROQ_MODEL_FALLBACKS:
        if m not in candidate_models:
            candidate_models.append(m)

    last_err = None
    for model in candidate_models:
        body = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": "You curate a personal knowledge graph. Output ONLY valid JSON with no markdown."},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.4,
            "max_tokens": 4000,
        }).encode("utf-8")

        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=body,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "User-Agent": "authority-graph/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            return payload["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")
            if e.code == 404 and "does not exist" in detail:
                last_err = f"{model}: {detail[:160]}"
                continue
            raise HTTPException(status_code=502, detail=f"Groq API error {e.code} ({model}): {detail[:300]}")
        except Exception as e:
            last_err = str(e)
            continue

    raise HTTPException(status_code=502, detail=f"Groq model unavailable: {last_err}")

@app.post("/insights/suggest")
def suggest_connections():
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="GROQ_API_KEY not set. Add your key to .env (get one free at console.groq.com).",
        )

    with driver.session() as session:
        nodes_res = session.run("MATCH (n:Note) RETURN n.name AS name, n.content AS content")
        nodes = [{"name": rec["name"], "content": rec["content"]} for rec in nodes_res]
        links_res = session.run(
            "MATCH (a:Note)-[r:RELATED_TO]->(b:Note) RETURN a.name AS source, b.name AS target"
        )
        links = [{"source": rec["source"], "target": rec["target"]} for rec in links_res]

    if not nodes:
        return {"suggestions": [], "message": "Add a few notes first so hidden connections can be found."}

    node_names = {n["name"] for n in nodes}
    existing = {(l["source"], l["target"]) for l in links} | {(l["target"], l["source"]) for l in links}

    node_lines = "\n".join(f'- "{n["name"]}": {n["content"] or "(no content)"}' for n in nodes)
    link_lines = "\n".join(f'- {l["source"]} -> {l["target"]}' for l in links) or "- (none yet)"
    prompt = f"""Here is a personal knowledge graph for a personal-brand marketer.

NODES:
{node_lines}

EXISTING CONNECTIONS:
{link_lines}

Suggest up to 5 NEW connections that reveal valuable, non-obvious relationships.
Rules:
- source and target MUST be copied EXACTLY from the NODES list (case-sensitive).
- Never reuse an existing connection or its reverse.
- Never connect a node to itself.
- One short reason per suggestion capturing the insight.

Return ONLY a JSON array (no markdown), exactly this shape:
[{{"source": "...", "target": "...", "reason": "..."}}]"""

    raw = _groq_chat(prompt).strip()
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()

    try:
        parsed = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=502, detail="Groq returned non-JSON output. Try again.")

    suggestions = []
    seen = set()
    for s in parsed:
        if not isinstance(s, dict):
            continue
        src, tgt, reason = s.get("source"), s.get("target"), s.get("reason", "")
        if not src or not tgt or src not in node_names or tgt not in node_names:
            continue
        if src == tgt or (src, tgt) in existing or (tgt, src) in existing:
            continue
        key = tuple(sorted((src, tgt)))
        if key in seen:
            continue
        seen.add(key)
        suggestions.append({"source": src, "target": tgt, "reason": reason})

    return {"suggestions": suggestions, "model": GROQ_MODEL}

