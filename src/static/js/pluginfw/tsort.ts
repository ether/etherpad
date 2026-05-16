// @ts-nocheck
'use strict';

/**
 * general topological sort
 * from https://gist.github.com/1232505
 * @author SHIN Suzuki (shinout310@gmail.com)
 * @param Array<Array> edges : list of edges. each edge forms Array<ID,ID> e.g. [12 , 3]
 *
 * @returns Array : topological sorted list of IDs
 **/

const tsort = (edges) => {
  const nodes = {}; // hash: stringified id of the node => { id: id, afters: lisf of ids }
  const sorted = []; // sorted list of IDs ( returned value )
  const visited = {}; // hash: id of already visited node => true

  const Node = function (id) {
    this.id = id;
    this.afters = [];
  };

  // 1. build data structures
  edges.forEach((v) => {
    const from = v[0]; const
      to = v[1];
    if (!nodes[from]) nodes[from] = new Node(from);
    if (!nodes[to]) nodes[to] = new Node(to);
    nodes[from].afters.push(to);
  });

  const visit = (idstr, ancestors) => {
    const node = nodes[idstr];
    const id = node.id;

    // if already exists, do nothing
    if (visited[idstr]) return;

    if (!Array.isArray(ancestors)) ancestors = [];

    ancestors.push(id);

    visited[idstr] = true;

    node.afters.forEach((afterID) => {
      // if already in ancestors, a closed chain exists.
      if (ancestors.indexOf(afterID) >= 0) throw new Error(`closed chain : ${afterID} is in ${id}`);

      visit(afterID.toString(), ancestors.map((v) => v)); // recursive call
    });

    sorted.unshift(id);
  };

  // 2. topological sort
  Object.keys(nodes).forEach(visit);

  return sorted;
};

export default tsort;
