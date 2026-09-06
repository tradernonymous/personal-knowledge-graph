import React, { useRef, useEffect, useState, useCallback } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import { drag } from 'd3-drag';
import { select } from 'd3-selection';
import louvain from './clustering.js';

const ForceGraph = ({ data, onSelect, height = 520, path = null, highlightKeys = null }) => {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const simulationRef = useRef(null);
  const [hovered, setHovered] = useState(null);

  const { nodes, links } = data || { nodes: [], links: [] };

  // Pre-compute degree (number of connections) per node
  const degreeMap = useCallback(() => {
    const map = {};
    (links || []).forEach((l) => {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      map[s] = (map[s] || 0) + 1;
      map[t] = (map[t] || 0) + 1;
    });
    return map;
  }, [links]);

  // Detect "god nodes": top ~25% most-connected, min degree 2
  const hubIds = useCallback(() => {
    const degrees = degreeMap();
    const arr = Object.entries(degrees).sort((a, b) => b[1] - a[1]);
    if (arr.length === 0) return new Set();
    const cutoff = Math.max(2, Math.floor((arr.length - 1) * 0.25));
    const minHubDegree = arr[cutoff][1];
    return new Set(
      arr
        .filter(([, d]) => d >= Math.max(2, minHubDegree))
        .map(([id]) => id),
    );
  }, [degreeMap]);

  // Communities via Louvain
  const communities = useCallback(() => {
    if (!nodes || nodes.length === 0) return new Map();
    const ids = nodes.map((n) => n.id);
    const comm = louvain(ids.map((id) => ({ id })), links || []);
    const map = new Map();
    ids.forEach((id, i) => map.set(id, comm[i]));
    return map;
  }, [nodes, links]);

  useEffect(() => {
    if (!links || links.length === 0 || !svgRef.current) return;

    const width = containerRef.current.clientWidth;
    const h = height;

    const degrees = degreeMap();
    const maxDegree = Math.max(1, ...Object.values(degrees));
    const hubs = hubIds();
    const commMap = communities();

    // Assign one hue per community (golden angle for visual separation).
    const numComms = new Set(commMap.values()).size || 1;
    const hueByComm = new Map();
    [...new Set(commMap.values())].forEach((c, i) => {
      hueByComm.set(c, (i * 360) / numComms);
    });

    const nodeColor = (d) => {
      const c = commMap.get(d.id) ?? 0;
      const hue = hueByComm.get(c) ?? 0;
      const light = 42 + (d.degree / maxDegree) * 28;
      return `hsl(${hue} ${75}% ${light}%)`;
    };

    // Node structure expected by d3-force
    const vNodes = nodes.map((n) => ({
      ...n,
      degree: degrees[n.id] || 0,
      isHub: hubs.has(n.id),
      x: width / 2 + (Math.random() - 0.5) * 100,
      y: h / 2 + (Math.random() - 0.5) * 100,
    }));
    const nodeById = new Map(vNodes.map((n) => [n.id, n]));

    const vLinks = links.map((l) => ({
      source: nodeById.get(typeof l.source === 'object' ? l.source.id : l.source) || vNodes[0],
      target: nodeById.get(typeof l.target === 'object' ? l.target.id : l.target) || vNodes[0],
    })).filter((l) => l.source && l.target);

    // Highlight set contains BOTH node ids AND normalized edge keys, e.g. "A|B"
    const highlightSet = highlightKeys || new Set();
    const linkHighlighted = (l) => {
      const a = l.source.id;
      const b = l.target.id;
      return highlightSet.has(`${a}|${b}`) || highlightSet.has(`${b}|${a}`);
    };

    const simulation = forceSimulation(vNodes)
      .force('link', forceLink(vLinks).id((d) => d.id).distance(90).strength(0.5))
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(width / 2, h / 2))
      .force('collide', forceCollide().radius((d) => 18 + (d.degree / maxDegree) * 20))
      .alpha(1)
      .alphaDecay(0.028);

    simulationRef.current = simulation;

    const svg = select(svgRef.current);
    svg.selectAll('*').remove();

    // Group transform for pan/zoom
    const group = svg.append('g').attr('class', 'viewport');

    // Link rendering
    const linkEls = group
      .selectAll('line')
      .data(vLinks)
      .join('line')
      .attr('stroke', (l) => (linkHighlighted(l) ? '#fbbf24' : 'rgba(120, 160, 255, 0.28)'))
      .attr('stroke-width', (l) => (linkHighlighted(l) ? 3 : 1.2))
      .attr('stroke-opacity', (l) => (linkHighlighted(l) ? 0.95 : 0.5))
      .attr('stroke-dasharray', (l) => (linkHighlighted(l) ? '6 3' : null));

    // Node rendering
    const nodeEls = group
      .selectAll('.node')
      .data(vNodes)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    nodeEls
      .append('circle')
      .attr('r', (d) => 10 + (d.degree / maxDegree) * 12)
      .attr('fill', nodeColor)
      .attr('fill-opacity', (d) => (highlightSet.has(d.id) ? 1 : 0.85))
      .attr('stroke', (d) => (highlightSet.has(d.id) ? '#fbbf24' : nodeColor(d)))
      .attr('stroke-width', (d) => (highlightSet.has(d.id) ? 3 : d.isHub ? 2.5 : 1.5))
      .attr('stroke-opacity', 0.9)
      .style('filter', (d) =>
        highlightSet.has(d.id)
          ? 'drop-shadow(0 0 10px rgba(251,191,36,0.9))'
          : 'drop-shadow(0 0 6px rgba(120,160,255,0.4))',
      );

    // Hub marker ring (god nodes get a subtle outer ring)
    nodeEls
      .filter((d) => d.isHub && !highlightSet.has(d.id))
      .append('circle')
      .attr('r', (d) => 16 + (d.degree / maxDegree) * 12)
      .attr('fill', 'none')
      .attr('stroke', nodeColor)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-dasharray', '3 3')
      .attr('stroke-width', 1.2);

    nodeEls
      .append('text')
      .text((d) => d.id)
      .attr('x', (d) => (12 + (d.degree / maxDegree) * 12) + 6)
      .attr('y', 4)
      .attr('fill', '#cbd5e1')
      .attr('font-size', 11)
      .attr('font-weight', (d) => (d.isHub ? 700 : 400))
      .attr('font-family', 'Poppins, sans-serif');

    const tick = () => {
      linkEls
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

      nodeEls.attr('transform', (d) => `translate(${d.x},${d.y})`);
    };

    simulation.on('tick', tick);

    // Hover to highlight connected nodes + neighbors links
    const highlight = (d) => {
      const neighborIds = new Set();
      vLinks.forEach((l) => {
        const si = l.source.id;
        const ti = l.target.id;
        if (si === d.id) neighborIds.add(ti);
        if (ti === d.id) neighborIds.add(si);
      });
      neighborIds.add(d.id);

      nodeEls
        .select('circle')
        .transition()
        .duration(150)
        .attr('opacity', (n) => (neighborIds.has(n.id) ? 1 : 0.12));
      linkEls
        .transition()
        .duration(150)
        .attr('opacity', (l) =>
          (l.source.id === d.id || l.target.id === d.id || linkHighlighted(l)) ? 0.9 : 0.06,
        );
    };

    const clearHighlight = () => {
      nodeEls.select('circle').transition().duration(150).attr('opacity', (d) =>
        highlightSet.has(d.id) ? 1 : 0.85,
      );
      linkEls.transition().duration(150).attr('opacity', (l) =>
        linkHighlighted(l) ? 0.95 : 0.5,
      );
    };

    nodeEls.on('mouseover', (event, d) => {
      setHovered(d.id);
      highlight(d);
    });
    nodeEls.on('mouseleave', () => {
      setHovered(null);
      clearHighlight();
    });
    nodeEls.on('click', (event, d) => {
      event.stopPropagation();
      if (onSelect) onSelect(d);
    });

    // Drag behavior
    const dragBehavior = drag()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeEls.call(dragBehavior);

    // Pan, zoom, and wheel handlers share this mutable transform state
    const transformRef = { current: { x: 0, y: 0, k: 1 } };

    const groupTransform = () =>
      group.attr('transform', `translate(${transformRef.current.x},${transformRef.current.y}) scale(${transformRef.current.k})`);

    // Pan & zoom
    let startX = 0;
    let startY = 0;
    let tx = 0;
    let ty = 0;
    let k = 1;

    svg.on('mousedown.pan', (event) => {
      if (event.target.__data__) return;
      startX = event.x;
      startY = event.y;
      tx = transformRef.current.x;
      ty = transformRef.current.y;
      k = transformRef.current.k;
    });
    svg.on('mousemove.pan', (event) => {
      if (event.buttons === 0) return;
      const dx = event.x - startX;
      const dy = event.y - startY;
      transformRef.current = { x: tx + dx, y: ty + dy, k };
      groupTransform();
    });
    svg.on('dblclick.pan', () => {
      transformRef.current = { x: 0, y: 0, k: 1 };
      groupTransform();
    });

    // Wheel zoom
    svg.on('wheel.zoom', (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      transformRef.current = {
        ...transformRef.current,
        k: Math.min(3, Math.max(0.3, transformRef.current.k * factor)),
      };
      groupTransform();
    });

    return () => {
      svg.on('.pan', null);
      svg.on('.zoom', null);
      simulation.stop();
    };
  }, [links, nodes, height, onSelect, degreeMap, hubIds, communities, highlightKeys]);

  // Build community legend
  const legend = useCallback(() => {
    if (!nodes || nodes.length === 0) return [];
    const commMap = communities();
    const counts = new Map();
    nodes.forEach((n) => {
      const c = commMap.get(n.id) ?? 0;
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    const numComms = counts.size || 1;
    const hues = {};
    [...counts.keys()].forEach((c, i) => {
      hues[c] = (i * 360) / numComms;
    });
    return [...counts.entries()].map(([c, count]) => ({
      hue: hues[c],
      count,
    }));
  }, [nodes, communities]);

  return (
    <div ref={containerRef} className="relative h-[520px] w-full overflow-hidden rounded-xl border border-white/10 bg-white/[0.02]">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="h-full w-full"
        style={{ touchAction: 'none' }}
      />
      {(!nodes || nodes.length === 0) && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-slate-500 italic">
          No nodes yet — add your first insight!
        </div>
      )}
      {legend().length > 1 && (
        <div className="pointer-events-none absolute right-3 top-3 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-[#0a0e22]/85 px-3 py-2 backdrop-blur">
          {legend().map((l, i) => (
            <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: `hsl(${l.hue} 75% 55%)` }}
              />
              <span>Community {i + 1}</span>
              <span className="text-slate-500">· {l.count}</span>
            </div>
          ))}
        </div>
      )}
      {path && path.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-amber-400/30 bg-[#0a0e22]/90 px-3 py-1.5 text-xs text-amber-300 backdrop-blur">
          Path: {path.join(' → ')}
        </div>
      )}
      {hovered && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-lg border border-cyan-400/30 bg-[#0a0e22]/90 px-3 py-1.5 text-xs text-cyan-300 backdrop-blur">
          {hovered}
        </div>
      )}
    </div>
  );
};

export default ForceGraph;