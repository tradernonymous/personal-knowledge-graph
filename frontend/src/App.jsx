import React, { useState, useEffect, useMemo } from 'react';
import ForceGraph from './ForceGraph.jsx';
import louvain from './clustering.js';

// Rank cross-cluster links: bridging two ideas that both have many connections
// is more "surprising" than a link between two isolated nodes.
const computeSurprises = (nodes, links) => {
  if (!nodes || nodes.length < 2 || !links || links.length < 2) return [];
  const ids = nodes.map((n) => n.id);
  const comm = louvain(ids.map((id) => ({ id })), links);
  const commOf = new Map(ids.map((id, i) => [id, comm[i]]));
  const degree = {};
  links.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    degree[s] = (degree[s] || 0) + 1;
    degree[t] = (degree[t] || 0) + 1;
  });
  const crossed = [];
  const seen = new Set();
  links.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    const key = [s, t].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const cs = commOf.get(s);
    const ct = commOf.get(t);
    if (cs !== undefined && ct !== undefined && cs !== ct) {
      crossed.push({
        source: s,
        target: t,
        cs,
        ct,
        score: (1 + (degree[s] || 0)) * (1 + (degree[t] || 0)),
      });
    }
  });
  return crossed.sort((a, b) => b.score - a.score).slice(0, 10);
};

const GradientButton = ({ onClick, children, className = '' }) => (
  <button
    onClick={onClick}
    className={`group relative inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-6 py-3 font-semibold text-white shadow-lg shadow-cyan-500/30 transition-all duration-300 hover:shadow-cyan-400/50 hover:-translate-y-0.5 active:translate-y-0 ${className}`}
  >
    {children}
  </button>
);

const GlassCard = ({ children, className = '' }) => (
  <div
    className={`relative rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md transition-all duration-300 hover:border-cyan-400/40 hover:bg-white/[0.05] ${className}`}
  >
    {children}
  </div>
);

const SectionHeading = ({ title, accent, sub }) => (
  <div className="mb-6">
    <h2 className="text-2xl font-bold tracking-tight">
      {title}
      {accent && (
        <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent"> {accent}</span>
      )}
    </h2>
    {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
  </div>
);

const App = () => {
  const [nodeName, setNodeName] = useState('');
  const [nodeContent, setNodeContent] = useState('');
  const [loadedNode, setLoadedNode] = useState(null);
  const [status, setStatus] = useState('');
  const [graphData, setGraphData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [stats, setStats] = useState({ nodes: 0, links: 0 });
  const [vizData, setVizData] = useState({ nodes: [], links: [] });
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [pathNodes, setPathNodes] = useState([]);
  const [highlightKeys, setHighlightKeys] = useState(new Set());
  const [pathMessage, setPathMessage] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  // Cross-cluster links worth calling out, recomputed when the graph changes
  const surprises = useMemo(
    () => computeSurprises(vizData.nodes, vizData.links),
    [vizData],
  );

  const findPath = async () => {
    if (!pathFrom.trim() || !pathTo.trim()) {
      setPathMessage('Enter both node names.');
      return;
    }
    try {
      const url = `http://127.0.0.1:8000/path?start=${encodeURIComponent(pathFrom)}&end=${encodeURIComponent(pathTo)}`;
      const response = await fetch(url);
      const data = await response.json();
      if (!data.path) {
        setPathNodes([]);
        setHighlightKeys(new Set());
        setPathMessage(data.message || 'No path found between those nodes.');
        return;
      }
      const keys = new Set();
      data.path.edges.forEach((e) => {
        keys.add(`${e.source}|${e.target}`);
        keys.add(`${e.target}|${e.source}`);
      });
      data.path.nodes.forEach((n) => keys.add(n));
      setPathNodes(data.path.nodes);
      setHighlightKeys(keys);
      setPathMessage(`Path found: ${data.path.nodes.length} node(s), ${data.path.edges.length} hop(s)`);
    } catch (e) {
      setPathMessage('Path query error. Is the backend running?');
      console.error(e);
    }
  };

  const clearPath = () => {
    setPathNodes([]);
    setHighlightKeys(new Set());
    setPathMessage('Path selection cleared.');
  };

  // Highlight a single cross-cluster connection on the graph
  const focusConnection = (source, target) => {
    setPathNodes([]);
    setPathMessage('');
    setHighlightKeys(new Set([source, target, `${source}|${target}`, `${target}|${source}`]));
  };

  const fetchGraphViz = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/graph/viz');
      const data = await response.json();
      setVizData(data);
    } catch (error) {
      console.error('Error fetching viz graph:', error);
    }
  };

  const fetchAllLinks = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/graph');
      const data = await response.json();
      setGraphData(data);
      const nodes = new Set();
      data.forEach((l) => {
        nodes.add(l.source);
        nodes.add(l.target);
      });
      setStats({ nodes: nodes.size, links: data.length });
      fetchGraphViz();
    } catch (error) {
      console.error('Error fetching graph:', error);
    }
  };

  const fetchNode = async (name) => {
    try {
      const response = await fetch(`http://127.0.0.1:8000/nodes/${encodeURIComponent(name)}`);
      if (!response.ok) throw new Error('Node not found');
      const data = await response.json();
      setNodeName(data.name);
      setNodeContent(data.content || '');
      setLoadedNode(data.name);
      setStatus(`Loaded "${data.name}" with ${data.links.length} link(s)`);
    } catch (e) {
      setStatus(e.message);
    }
  };

  const deleteNode = async () => {
    if (!loadedNode) return;
    if (!window.confirm(`Delete node "${loadedNode}" and all its connections?`)) return;
    try {
      const response = await fetch(`http://127.0.0.1:8000/nodes/${encodeURIComponent(loadedNode)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setStatus(`Node "${loadedNode}" deleted.`);
        setNodeName('');
        setNodeContent('');
        setLoadedNode(null);
        fetchAllLinks();
      } else {
        setStatus('Error deleting node.');
      }
    } catch (e) {
      setStatus('Delete error. Is the backend running?');
      console.error(e);
    }
  };

  const exportGraph = async (format) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/export');
      if (!response.ok) throw new Error('Export failed');
      const data = await response.json();
      const stamp = new Date().toISOString().slice(0, 10);
      let blob;
      let filename;
      if (format === 'csv') {
        const esc = (v) => {
          const s = v == null ? '' : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const nodeRows = data.nodes.map((n) => [esc(n.name), esc(n.content)].join(',')).join('\n');
        const linkRows = data.links.map((l) => [esc(l.source), esc(l.relationship), esc(l.target)].join(',')).join('\n');
        blob = new Blob(
          [`name,content\n${nodeRows}\n\nsource,relationship,target\n${linkRows}`],
          { type: 'text/csv;charset=utf-8' },
        );
        filename = `authoritygraph_${stamp}.csv`;
      } else {
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `authoritygraph_${stamp}.json`;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${data.nodes.length} node(s) & ${data.links.length} link(s) as ${format.toUpperCase()}.`);
    } catch (e) {
      setStatus('Export error. Is the backend running?');
      console.error(e);
    }
  };

  const searchNodes = async (term) => {
    if (!term.trim()) {
      setSearchResults([]);
      return;
    }
    try {
      const response = await fetch(`http://127.0.0.1:8000/search?q=${encodeURIComponent(term)}`);
      const data = await response.json();
      setSearchResults(data);
      setStatus(`Found ${data.length} result(s)`);
    } catch (e) {
      setStatus('Search error');
      console.error(e);
    }
  };

  useEffect(() => {
    fetchAllLinks();
  }, []);

  const createNode = async () => {
    setStatus('Saving...');
    try {
      const response = await fetch('http://127.0.0.1:8000/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nodeName, content: nodeContent, label: 'Note' }),
      });

      if (response.ok) {
        setStatus('Node and links created successfully!');
        setNodeName('');
        setNodeContent('');
        setLoadedNode(null);
        fetchAllLinks();
      } else {
        setStatus('Error creating node.');
      }
    } catch (error) {
      setStatus('Network error. Is the backend running?');
    }
  };

  const generateSuggestions = async () => {
    setInsightsLoading(true);
    setStatus('Asking Groq to scan your graph for hidden connections...');
    try {
      const response = await fetch('http://127.0.0.1:8000/insights/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Suggestions failed');
      setSuggestions(data.suggestions);
      setStatus(
        data.suggestions.length
          ? `Groq found ${data.suggestions.length} hidden connection(s).`
          : data.message || 'No suggestions returned.',
      );
    } catch (e) {
      setStatus(e.message.length > 160 ? `${e.message.slice(0, 160)}...` : e.message);
    } finally {
      setInsightsLoading(false);
    }
  };

  const addSuggestedLink = async (source, target) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, target, relationship: 'RELATED_TO' }),
      });
      if (!response.ok) throw new Error('Failed to add connection');
      setSuggestions((prev) => prev.filter((s) => !(s.source === source && s.target === target)));
      setStatus(`Connection added: ${source} → ${target}`);
      fetchAllLinks();
    } catch (e) {
      setStatus('Failed to add connection. Is the backend running?');
      console.error(e);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#06081a] text-slate-200 font-sans">
      {/* Ambient background orbs */}
      <div className="bg-orb top-[-10%] left-[-5%] h-[500px] w-[500px] bg-cyan-500/30 animate-float" />
      <div className="bg-orb top-[30%] right-[-10%] h-[600px] w-[600px] bg-blue-700/30" />
      <div className="bg-orb bottom-[-10%] left-[30%] h-[500px] w-[500px] bg-purple-700/20 animate-float" />

      {/* Nav */}
      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 sm:px-10">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg shadow-cyan-500/40">
            <span className="text-sm font-black text-white">A</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">
            Authority<span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">Graph</span>
          </span>
        </div>
        <div className="hidden items-center gap-6 text-sm font-medium text-slate-400 sm:flex">
          <a href="#capture" className="transition-colors hover:text-cyan-300">Capture</a>
          <a href="#network" className="transition-colors hover:text-cyan-300">Network</a>
          <a href="#network-viz" className="transition-colors hover:text-cyan-300">Visualize</a>
          <a href="#search" className="transition-colors hover:text-cyan-300">Search</a>
          <a href="#export" className="transition-colors hover:text-cyan-300">Export</a>
          <a href="#insights" className="text-cyan-300 transition-colors hover:text-violet-300">AI Insights</a>
        </div>
      </nav>

      {/* Hero */}
      <header className="relative z-10 mx-auto max-w-4xl px-6 pb-12 pt-10 text-center sm:pt-16">
        <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-1.5 text-xs font-medium text-cyan-300">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
          </span>
          Personal Knowledge Graph
        </div>
        <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
          Capture insights,{' '}
          <span className="bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">
            link your knowledge.
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-slate-400 sm:text-lg">
          Every note you save becomes a node in your knowledge network. Use{' '}
          <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-cyan-300">[[Wiki Links]]</code>{' '}
          to automatically connect ideas and see how they relate.
        </p>

        {/* Stats row */}
        <div className="mx-auto mt-10 grid max-w-md grid-cols-2 gap-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
            <div className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-3xl font-bold text-transparent">
              {stats.nodes}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Nodes</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
            <div className="bg-gradient-to-r from-purple-400 to-pink-500 bg-clip-text text-3xl font-bold text-transparent">
              {stats.links}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">Links</div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 pb-20 sm:px-10 lg:grid-cols-2">
        {/* Capture Section */}
        <section id="capture">
          <GlassCard>
            <SectionHeading title="Capture" accent="Insight" sub="Save ideas and link them together automatically." />
            <div className="flex flex-col gap-5">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Idea Name</label>
                <input
                  type="text"
                  value={nodeName}
                  onChange={(e) => setNodeName(e.target.value)}
                  placeholder="e.g., The Psychology of Fear"
                  className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">
                  Insight <span className="text-slate-500">— use [[Link]] for connections</span>
                </label>
                <textarea
                  value={nodeContent}
                  onChange={(e) => setNodeContent(e.target.value)}
                  placeholder="Example: This connects to [[Customer Trust]] and [[Authority]]..."
                  className="h-40 w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-white placeholder-slate-500 outline-none transition-colors focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-400/20"
                />
              </div>

              <div className="flex gap-3">
                <GradientButton onClick={createNode} className="flex-1">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
                  </svg>
                  Save to Graph
                </GradientButton>
                {loadedNode && (
                  <button
                    onClick={deleteNode}
                    className="group inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 font-semibold text-red-300 transition-all duration-300 hover:border-red-400/50 hover:bg-red-500/20"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete &quot;{loadedNode}&quot;
                  </button>
                )}
              </div>

              {status && (
                <div className="flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm font-medium text-cyan-300">
                  <svg className="h-4 w-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {status}
                </div>
              )}
            </div>
          </GlassCard>
        </section>

        {/* Network Section */}
        <section id="network">
          <GlassCard className="h-full">
            <div className="flex items-start justify-between">
              <SectionHeading title="Current" accent="Connections" sub="The live map of your knowledge network." />
              <button
                onClick={fetchAllLinks}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-400 transition-colors hover:text-cyan-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
            <div className="max-h-[26rem] overflow-y-auto pr-1">
              {graphData.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-3 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]">
                    <svg className="h-6 w-6 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <p className="italic text-slate-500">No connections yet. Start linking notes!</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {graphData.map((link, index) => (
                    <div
                      key={index}
                      className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 transition-all duration-200 hover:border-cyan-400/40 hover:bg-white/[0.05]"
                    >
                      <span className="flex-1 truncate text-sm font-medium text-cyan-300">{link.source}</span>
                      <svg className="h-4 w-4 flex-shrink-0 text-slate-600 transition-colors group-hover:text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                      <span className="rounded bg-white/5 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-500">
                        {link.relationship}
                      </span>
                      <svg className="h-4 w-4 flex-shrink-0 text-slate-600 transition-colors group-hover:text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                      <span className="flex-1 truncate text-right text-sm font-medium text-purple-300">{link.target}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </GlassCard>
        </section>
      </div>

      {/* Graph Visualization Section */}
      <section id="network-viz" className="relative z-10 mx-auto max-w-7xl px-6 pb-20 sm:px-10">
        <GlassCard>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <SectionHeading
              title="Interactive"
              accent="Network"
              sub="Communities are color-coded. Drag, zoom & pan, hover to reveal connections, click a node to load it."
            />
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Drag</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Scroll to zoom</span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">Double-click reset</span>
            </div>
          </div>

          {/* Path Query */}
          <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
            <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-amber-300">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 20l4-16m2 16l4-16" />
              </svg>
              Find the shortest path between two ideas
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <input
                type="text"
                value={pathFrom}
                onChange={(e) => setPathFrom(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') findPath(); }}
                placeholder="Start node"
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
              />
              <span className="hidden select-none text-amber-300/60 sm:block">&rarr;</span>
              <input
                type="text"
                value={pathTo}
                onChange={(e) => setPathTo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') findPath(); }}
                placeholder="End node"
                className="flex-1 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-amber-400/50 focus:ring-2 focus:ring-amber-400/20"
              />
              <div className="flex gap-2">
                <GradientButton onClick={findPath} className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2 shadow-amber-500/30 hover:shadow-amber-400/50">
                  Trace Path
                </GradientButton>
                <button
                  onClick={clearPath}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-200"
                >
                  Clear
                </button>
              </div>
            </div>
            {pathNodes.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
                {pathNodes.map((n, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <button
                      onClick={() => fetchNode(n)}
                      className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 font-medium text-amber-300 transition-colors hover:bg-amber-400/20"
                    >
                      {n}
                    </button>
                    {i < pathNodes.length - 1 && <span className="text-amber-300/50">&rarr;</span>}
                  </span>
                ))}
              </div>
            )}
            {pathMessage && !pathNodes.length && (
              <p className="mt-2 text-sm text-slate-400">{pathMessage}</p>
            )}
          </div>

          {/* Surprising Connections */}
          {surprises.length > 0 && (
            <div className="mb-4 rounded-xl border border-violet-400/20 bg-violet-400/[0.05] p-4">
              <div className="mb-2.5 flex items-center gap-2 text-sm font-medium text-violet-300">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Surprising connections — links bridging separate knowledge clusters
              </div>
              <div className="flex flex-col gap-2">
                {surprises.map((sc, i) => (
                  <button
                    key={i}
                    onClick={() => focusConnection(sc.source, sc.target)}
                    className="group flex items-center gap-2 rounded-lg border border-violet-400/20 bg-violet-400/10 px-3 py-2 text-left text-sm transition-all duration-200 hover:border-violet-400/40 hover:bg-violet-400/20"
                  >
                    <span className="font-medium text-violet-200">{sc.source}</span>
                    <span className="text-violet-400/60">&harr;</span>
                    <span className="font-medium text-violet-200">{sc.target}</span>
                    <span className="ml-auto text-xs text-violet-300/70">
                      bridges Community {sc.cs + 1} &harr; Community {sc.ct + 1} &middot; score {sc.score}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ForceGraph
            data={vizData}
            onSelect={(node) => fetchNode(node.id)}
            path={pathNodes}
            highlightKeys={highlightKeys}
          />
        </GlassCard>
      </section>

      {/* Search Section */}
      <section id="search" className="relative z-10 mx-auto max-w-7xl px-6 pb-20 sm:px-10">
        <GlassCard>
          <SectionHeading
            title="Search"
            accent="Your Graph"
            sub="Find any node by name or content. Click a result to load it."
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <svg className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') searchNodes(searchTerm); }}
                placeholder="Search nodes by name or content..."
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3 pl-12 pr-4 text-white placeholder-slate-500 outline-none transition-colors focus:border-green-400/50 focus:ring-2 focus:ring-green-400/20"
              />
            </div>
            <GradientButton onClick={() => searchNodes(searchTerm)} className="bg-gradient-to-r from-green-600 to-emerald-500 shadow-emerald-500/30 hover:shadow-emerald-400/50">
              Search
            </GradientButton>
          </div>
          {searchResults.length > 0 && (
            <div className="mt-5 flex flex-col gap-2.5">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  onClick={() => fetchNode(result.name)}
                  className="cursor-pointer rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 transition-all duration-200 hover:border-green-400/40 hover:bg-white/[0.05]"
                >
                  <span className="font-medium text-green-300">{result.name}</span>
                  <p className="mt-1 truncate text-sm text-slate-400">
                    {result.content.substring(0, 120)}...
                  </p>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </section>

      {/* Export Section */}
      <section id="export" className="relative z-10 mx-auto max-w-7xl px-6 pb-20 sm:px-10">
        <GlassCard>
          <SectionHeading
            title="Export"
            accent="Your Graph"
            sub="Download a portable copy of your knowledge network — great for backups or sharing."
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => exportGraph('json')}
              className="group inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3 font-semibold text-slate-200 transition-all duration-300 hover:border-cyan-400/40 hover:bg-white/[0.06]"
            >
              <svg className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download as JSON
            </button>
            <button
              onClick={() => exportGraph('csv')}
              className="group inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-6 py-3 font-semibold text-slate-200 transition-all duration-300 hover:border-green-400/40 hover:bg-white/[0.06]"
            >
              <svg className="h-4 w-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6m0 0h-2m2 0h1M14 17l2-4m-2 0v4m0-4l-1 2m-1-2h2M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1" />
              </svg>
              Download as CSV
            </button>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            JSON keeps full fidelity (nodes + relationships). CSV gives you two sheets (nodes & links) for spreadsheets.
          </p>
        </GlassCard>
      </section>

      {/* AI Insights */}
      <section id="insights" className="relative z-10 mx-auto max-w-7xl px-6 pb-20 sm:px-10">
        <GlassCard className="border-violet-400/20 hover:border-violet-400/40">
          <SectionHeading
            title="AI"
            accent="Insights"
            sub="Groq-scanned edge inference — connections your knowledge graph is missing but your brain already suspects."
          />
          <button
            onClick={generateSuggestions}
            disabled={insightsLoading}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition-all duration-300 hover:shadow-violet-500/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {insightsLoading ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Thinking...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Find Hidden Connections
              </>
            )}
          </button>
          <p className="mt-3 text-xs text-slate-500">
            Free tier, no credit card. Powered by Groq ({'llama-3.3-70b-versatile'}). Only existing node names are ever suggested.
          </p>

          {suggestions.length > 0 && (
            <ul className="mt-6 space-y-3">
              {suggestions.map((s) => (
                <li
                  key={`${s.source}|${s.target}`}
                  className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-slate-100">
                      <span className="text-violet-300">{s.source}</span>
                      <span className="mx-2 text-slate-500">→</span>
                      <span className="text-fuchsia-300">{s.target}</span>
                    </p>
                    <p className="mt-1 text-sm text-slate-400">{s.reason}</p>
                  </div>
                  <button
                    onClick={() => addSuggestedLink(s.source, s.target)}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-4 py-2 text-sm font-semibold text-violet-200 transition-all duration-300 hover:border-violet-400/60 hover:bg-violet-500/20"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
                    </svg>
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
          {suggestions.length === 0 && !insightsLoading && (
            <p className="mt-6 text-sm text-slate-500">
              No suggestions yet. Click above to let Groq find connections between your existing notes.
            </p>
          )}
        </GlassCard>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 bg-white/[0.02] py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-6 sm:flex-row sm:px-10">
          <span className="text-sm font-semibold text-white">AuthorityGraph</span>
          <span className="text-xs text-slate-500">Your personal knowledge graph, organically grown.</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
