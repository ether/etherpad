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

/**
 * TEST
 **/
const tsortTest = () => {
  // example 1: success
  let edges = [
    [1, 2],
    [1, 3],
    [2, 4],
    [3, 4],
  ];

  let sorted = tsort(edges);

  // example 2: failure ( A > B > C > A )
  edges = [
    ['A', 'B'],
    ['B', 'C'],
    ['C', 'A'],
  ];

  try {
    sorted = tsort(edges);
    console.log('succeeded', sorted);
  } catch (e) {
    console.log(e.message);
  }

  // example 3: generate random edges
  const max = 100;
  const iteration = 30;
  const randomInt = (max) => Math.floor(Math.random() * max) + 1;

  edges = (() => {
    const ret = [];
    let i = 0;
    while (i++ < iteration) ret.push([randomInt(max), randomInt(max)]);
    return ret;
  })();

  try {
    sorted = tsort(edges);
    console.log('succeeded', sorted);
  } catch (e) {
    console.log('failed', e.message);
  }
};

// for node.js
if (typeof exports === 'object' && exports === this) {
  module.exports = tsort;
  if (process.argv[1] === __filename) tsortTest();
}
