// Louvain community detection (Newman 2006 modularity greedy algorithm).
// Pure JS, no dependencies. Assigns every node a community id.

const louvain = (nodes, links) => {
  const ids = nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // adjacency: Map<nodeIndex, Map<neighborIndex, weight>>
  const adj = new Map();
  for (let i = 0; i < n; i++) adj.set(i, new Map());

  let m = 0; // total edge weight (each undirected edge counted once)
  const degrees = new Array(n).fill(0);

  links.forEach((l) => {
    const s = typeof l.source === 'object' ? l.source.id : l.source;
    const t = typeof l.target === 'object' ? l.target.id : l.target;
    const si = index.get(s);
    const ti = index.get(t);
    if (si === undefined || ti === undefined || si === ti) return;
    adj.get(si).set(ti, (adj.get(si).get(ti) || 0) + 1);
    adj.get(ti).set(si, (adj.get(ti).get(si) || 0) + 1);
    m += 1;
  });

  m = m * 2; // 2m = total degree sum
  for (const [i, neighbors] of adj) {
    for (const w of neighbors.values()) degrees[i] += w;
  }

  // initialize each node in its own community
  let community = ids.map((_, i) => i);
  // community -> total degree sum
  let communityDeg = degrees.slice();
  // community -> sum of internal edge weights
  let communityInternal = new Array(n).fill(0);
  for (const [i, neighbors] of adj) {
    for (const [j, w] of neighbors) {
      if (j > i) communityInternal[community[i]] += w;
    }
  }

  const deltaModularity = (node, targetComm) => {
    // k_i,in: weight of edges from node to targetComm (exclude self-loop)
    let kIn = 0;
    const neighbors = adj.get(node) || new Map();
    for (const [j, w] of neighbors) {
      if (community[j] === targetComm) kIn += w;
    }
    const kI = degrees[node];
    const sumTot = communityDeg[targetComm];
    // ΔQ = (k_i,in / 2m) - (sumTot * k_i) / (2m^2)
    return kIn / m - (sumTot * kI) / (m * m);
  };

  const moveNode = (node, newComm) => {
    const oldComm = community[node];
    if (oldComm === newComm) return;
    community[node] = newComm;
    communityDeg[oldComm] -= degrees[node];
    communityDeg[newComm] += degrees[node];
    // internal edges: subtract edges node had inside old comm, add inside new comm
    const neighbors = adj.get(node) || new Map();
    let removedInternal = 0;
    let addedInternal = 0;
    for (const [j, w] of neighbors) {
      if (community[j] === oldComm) removedInternal += w;
      if (community[j] === newComm) addedInternal += w;
    }
    communityInternal[oldComm] -= removedInternal;
    communityInternal[newComm] += addedInternal;
  };

  // iterative greedy optimization (multiple passes over all nodes)
  let pass = 0;
  const MAX_PASSES = 30;
  let globalImproved = true;
  while (globalImproved && pass < MAX_PASSES) {
    globalImproved = false;
    pass++;
    // deterministic pass order so results are reproducible
    const order = Array.from({ length: n }, (_, i) => i);

    for (const i of order) {
      // candidate communities: node's own + neighbors'
      const candidates = new Set([community[i]]);
      const neighbors = adj.get(i) || new Map();
      for (const j of neighbors.keys()) candidates.add(community[j]);

      let best = community[i];
      let bestGain = 0;
      for (const c of candidates) {
        const gain = deltaModularity(i, c);
        if (gain > bestGain + 1e-9) {
          bestGain = gain;
          best = c;
        }
      }
      if (best !== community[i]) {
        moveNode(i, best);
        globalImproved = true;
      }
    }
  }

  // remap community ids to compact 0..k-1
  const remap = new Map();
  return community.map((c) => {
    if (!remap.has(c)) remap.set(c, remap.size);
    return remap.get(c);
  });
};

export default louvain;