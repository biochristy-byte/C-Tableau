/* Neurons unit tests: the layout maths, the settings schema and the colour
 * floor, with no browser. Run: node test/run.js
 *
 * Every section declares the minimum number of subjects it must examine and
 * goes RED below it, so a gate that silently examined nothing cannot pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { load, csv, root } = require('./load.js');

const ctx = load(['src/js/settings.js', 'src/js/palettes.js', 'src/js/layout.js']);
const NX = ctx.NX;
const L = NX.layout, S = NX.schema, P = NX.palettes;

let fails = 0, passes = 0;
const sections = [];
function section(name, minSubjects, fn) {
  const rec = { name, subjects: 0, fails: [] };
  const t = {
    ok(cond, msg) { rec.subjects++; if (cond) passes++; else { fails++; rec.fails.push(msg); } },
    near(a, b, tol, msg) { t.ok(Math.abs(a - b) <= tol, msg + ' (got ' + a + ', want ' + b + ' +-' + tol + ')'); }
  };
  try { fn(t); } catch (e) { fails++; rec.fails.push('threw: ' + (e && e.stack || e)); }
  if (rec.subjects < minSubjects) { fails++; rec.fails.push('RED: examined ' + rec.subjects + ' subjects, minimum is ' + minSubjects); }
  sections.push(rec);
  console.log((rec.fails.length ? 'RED  ' : 'ok   ') + name + '  (' + rec.subjects + ' subjects)');
  rec.fails.slice(0, 6).forEach(f => console.log('       - ' + f));
}

const data = csv(path.join(root, 'data', 'celegans-connectome.csv'));
const rows = data.map(r => ({ group: r.Group, source: r.Source, target: r.Target, weight: r.Synapses, targetGroup: r.TargetGroup }));
const graph = L.buildGraph(rows);
const measure = (t, px) => t.length * px * 0.56;
const baseSettings = S.resolve({});

/* ---- 1. graph from the shipped example, counted independently from the CSV */
section('graph: example data', 8, t => {
  const names = new Set(), pairs = new Set();
  data.forEach(r => { names.add(r.Source); names.add(r.Target); pairs.add(r.Source + '>' + r.Target); });
  t.ok(data.length >= 300, 'example has at least 300 rows (has ' + data.length + ')');
  t.ok(graph.nodes.length === names.size, 'node count ' + graph.nodes.length + ' equals distinct names ' + names.size);
  t.ok(graph.links.length === pairs.size, 'link count ' + graph.links.length + ' equals distinct pairs ' + pairs.size);
  t.ok(graph.hasWeight === true, 'weight column detected');
  const wsum = data.reduce((a, r) => a + Number(r.Synapses), 0);
  t.near(graph.links.reduce((a, l) => a + l.weight, 0), wsum, 1e-9, 'weights sum to the CSV total');
  const groups = new Set(graph.nodes.map(n => n.group));
  t.ok(groups.size === 4, 'four groups (got ' + groups.size + ')');
  graph.nodes.forEach(n => t.ok(n.group !== L.UNGROUPED, 'node ' + n.id + ' has a real group'));
  t.ok(graph.dropped.self === 0 && graph.dropped.empty === 0, 'nothing dropped from clean data');
});

/* ---- 2. graph edge cases */
section('graph: blanks, self links, duplicates, target-only nodes', 10, t => {
  const g = L.buildGraph([
    { group: 'A', source: 'x', target: 'y', weight: 2, targetGroup: 'B' },
    { group: 'A', source: 'x', target: 'y', weight: 3, targetGroup: 'B' },
    { group: 'A', source: 'z', target: 'z', weight: 9 },
    { group: 'A', source: '', target: 'y', weight: 1 },
    { group: 'A', source: 'x', target: '  ', weight: 1 },
    { group: '', source: 'q', target: 'y', weight: -4, targetGroup: 'B' },
    { group: 'B', source: 'y', target: 'w', weight: 'oops', targetGroup: 'C' },
    { group: 'B', source: 'y', target: 'x', weight: 1 }
  ]);
  t.ok(g.dropped.self === 1, 'one self link dropped');
  t.ok(g.dropped.empty === 2, 'two empty-endpoint rows dropped');
  const xy = g.links.find(l => l.s === 'x' && l.t === 'y');
  t.ok(xy && xy.weight === 5 && xy.rows.length === 2, 'duplicate x>y merged to weight 5 from 2 rows');
  t.ok(g.byId.y.group === 'B', 'y takes its Source-row group B');
  t.ok(g.byId.w.group === 'C', 'target-only w takes targetGroup C');
  t.ok(g.byId.q.group === L.UNGROUPED, 'q with no group anywhere is "(no group)"');
  t.ok(g.links.find(l => l.s === 'q').weight === 0, 'negative weight clamps to 0');
  t.ok(g.links.find(l => l.t === 'w').weight === 0, 'non-numeric weight becomes 0');
  t.ok(!g.byId.z, 'self-only node z is not created');
  t.ok(g.byId.x.out === 1 && g.byId.x.inn === 1, 'x has 1 out, 1 in');
  const g2 = L.buildGraph([{ group: 'A', source: 'a', target: 'b' }]);
  t.ok(g2.hasWeight === false && g2.links[0].weight === 1, 'no weight column: weight 1, hasWeight false');
});

/* ---- 3. radial cluster layout */
section('layout: d3.cluster radial', 150, t => {
  const R = 300;
  const lay = L.layout(graph, { R, beta: 0.85, gap: 2.5, rotation: 0, groupOrder: 'data', nodeSort: 'alpha' });
  t.ok(lay.leaves.length === graph.nodes.length, 'one leaf per node');
  lay.leaves.forEach(l => t.near(l.y, R, 1e-6, 'leaf ' + l.id + ' sits at radius R'));
  lay.root.children.forEach(g => t.near(g.y, R / 2, 1e-6, 'hub ' + g.data.name + ' at R/2'));
  t.near(lay.root.y, 0, 1e-6, 'root at the centre');
  /* order and arcs */
  const ord = L.orderGroups(graph, { groupOrder: 'data', nodeSort: 'alpha' });
  t.ok(lay.arcs.length === ord.length, 'one arc per group');
  const step = lay.unit;
  lay.arcs.forEach((a, i) => {
    const gl = lay.root.children[i].leaves();
    gl.forEach(l => t.ok(l.x >= a.a0 - 1e-9 && l.x <= a.a1 + 1e-9, 'leaf ' + l.id + ' inside its arc'));
    for (let k = 1; k < gl.length; k++) t.near(gl[k].x - gl[k - 1].x, step, 1e-9, 'within-group step is one slot');
    if (i > 0) t.ok(a.a0 > lay.arcs[i - 1].a1 - 1e-9, 'arc ' + a.name + ' starts after the previous ends');
  });
  const lastLeaf = lay.leaves[lay.leaves.length - 1], firstLeaf = lay.leaves[0];
  const wrap = (firstLeaf.x + L.TAU) - lastLeaf.x;
  t.near(wrap, step * 3.5, 1e-6, 'wrap-around gap is one slot plus the 2.5 group gap');
  const g1 = lay.root.children[0].leaves(), g2 = lay.root.children[1].leaves();
  t.near(g2[0].x - g1[g1.length - 1].x, step * 3.5, 1e-6, 'gap between groups is 3.5 slots');
  t.ok(lay.arcs[lay.arcs.length - 1].a1 < firstLeaf.x + L.TAU, 'last arc ends before the first begins');
  /* rotation shifts everything by exactly the angle */
  const lay2 = L.layout(graph, { R, beta: 0.85, gap: 2.5, rotation: 0.5, groupOrder: 'data', nodeSort: 'alpha' });
  t.near(lay2.leaves[7].x - lay.leaves[7].x, 0.5, 1e-9, 'rotation adds its angle');
  /* determinism */
  const lay3 = L.layout(graph, { R, beta: 0.85, gap: 2.5, rotation: 0, groupOrder: 'data', nodeSort: 'alpha' });
  t.ok(lay3.links.every((k, i) => k.d === lay.links[i].d), 'same input gives the same path strings');
  /* orders */
  const alpha = L.orderGroups(graph, { groupOrder: 'alpha', nodeSort: 'alpha' }).map(g => g.name);
  t.ok(alpha.join() === alpha.slice().sort().join(), 'groupOrder alpha sorts the groups');
  const size = L.orderGroups(graph, { groupOrder: 'size', nodeSort: 'degree' });
  t.ok(size[0].nodes.length >= size[1].nodes.length, 'groupOrder size puts the biggest first');
  t.ok(size[0].nodes[0].outW + size[0].nodes[0].inW >= size[0].nodes[1].outW + size[0].nodes[1].inW, 'nodeSort degree puts the heaviest first');
});

/* ---- 4. bundling stays inside the circle and ends on the nodes */
section('bundling: curves inside the circle, ending on their nodes', 4000, t => {
  const R = 300;
  [0, 0.25, 0.5, 0.85, 1].forEach(beta => {
    const lay = L.layout(graph, { R, beta, gap: 2.5, rotation: 0.3, groupOrder: 'data', nodeSort: 'alpha' });
    lay.links.forEach(lk => {
      const pts = L.curveSamples(lk.nodes, beta, 12);
      const maxR = Math.max.apply(null, pts.map(p => Math.hypot(p[0], p[1])));
      t.ok(maxR <= R + 1e-6, 'beta ' + beta + ' ' + lk.link.s + '>' + lk.link.t + ' max radius ' + maxR.toFixed(3) + ' <= ' + R);
      const a = L.polar(lk.a.x, R), b = L.polar(lk.b.x, R);
      const p0 = pts[0], p1 = pts[pts.length - 1];
      if (Math.hypot(p0[0] - a[0], p0[1] - a[1]) > 1e-6 || Math.hypot(p1[0] - b[0], p1[1] - b[1]) > 1e-6) t.ok(false, 'endpoints off their nodes for ' + lk.link.s + '>' + lk.link.t);
      else t.ok(true, '');
    });
  });
});

/* ---- 5. beta is wired: more beta, more bend */
section('bundling: beta controls the bend', 5, t => {
  const R = 300;
  const dev = beta => {
    const lay = L.layout(graph, { R, beta, gap: 2.5, rotation: 0, groupOrder: 'data', nodeSort: 'alpha' });
    let sum = 0, n = 0;
    lay.links.forEach(lk => {
      const pts = L.curveSamples(lk.nodes, beta, 20);
      const a = pts[0], b = pts[pts.length - 1], m = pts[Math.floor(pts.length / 2)];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
      sum += Math.abs((m[0] - a[0]) * dy - (m[1] - a[1]) * dx) / len; n++;
    });
    return sum / n;
  };
  const d0 = dev(0), d5 = dev(0.5), d85 = dev(0.85), d1 = dev(1);
  t.ok(d0 < 0.5, 'beta 0 is straight chords (mean bend ' + d0.toFixed(3) + 'px)');
  t.ok(d5 > d0 + 5, 'beta 0.5 bends more than 0 (' + d5.toFixed(1) + 'px)');
  t.ok(d85 > d5, 'beta 0.85 bends more than 0.5 (' + d85.toFixed(1) + 'px)');
  t.ok(d1 > d85, 'beta 1 bends more than 0.85 (' + d1.toFixed(1) + 'px)');
  t.ok(d1 > 20, 'beta 1 is visibly bundled (' + d1.toFixed(1) + 'px)');
});

/* ---- 6. label selection: no two kept labels overlap, and the set is maximal */
function rectOf(angle, r0, len, h) {
  const u = [Math.sin(angle), -Math.cos(angle)], v = [Math.cos(angle), Math.sin(angle)];
  const c = [];
  [[r0, -h / 2], [r0 + len, -h / 2], [r0 + len, h / 2], [r0, h / 2]].forEach(q => c.push([u[0] * q[0] + v[0] * q[1], u[1] * q[0] + v[1] * q[1]]));
  return { c, axes: [u, v] };
}
function overlap(a, b) {
  const axes = a.axes.concat(b.axes);
  for (const ax of axes) {
    const pa = a.c.map(p => p[0] * ax[0] + p[1] * ax[1]), pb = b.c.map(p => p[0] * ax[0] + p[1] * ax[1]);
    if (Math.max.apply(null, pa) <= Math.min.apply(null, pb) + 1e-9 || Math.max.apply(null, pb) <= Math.min.apply(null, pa) + 1e-9) return false;
  }
  return true;
}
section('labels: kept labels never overlap (rotated-rectangle test)', 500, t => {
  const lay = L.layout(graph, { R: 300, beta: 0.85, gap: 2.5, rotation: 0, groupOrder: 'data', nodeSort: 'alpha' });
  const prio = {}; graph.nodes.forEach(n => { prio[n.id] = n.outW + n.inW; });
  const items = lay.leaves.map(l => ({ id: l.id, angle: l.x, priority: prio[l.id] }));
  const lineH = 16.8;
  [400, 250, 120, 60, 30].forEach(r0 => {
    const ch = L.chooseLabels(items, r0, lineH);
    const kept = items.filter(i => ch.shown[i.id]);
    t.ok(ch.count === kept.length, 'r0 ' + r0 + ': count matches the kept set (' + ch.count + ')');
    const rects = kept.map(i => rectOf(i.angle, r0, 14 * 0.56 * i.id.length, lineH));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) t.ok(!overlap(rects[i], rects[j]), 'r0 ' + r0 + ': labels ' + kept[i].id + ' and ' + kept[j].id + ' overlap');
    /* maximal: every hidden label would collide with a kept one */
    let addable = 0;
    items.filter(i => !ch.shown[i.id]).forEach(i => {
      const r = rectOf(i.angle, r0, 14 * 0.56 * i.id.length, lineH);
      const minD = 2 * Math.asin(lineH / (2 * r0));
      if (kept.every(k => L.angDist(k.angle, i.angle) >= minD)) addable++;
      void r;
    });
    t.ok(addable === 0, 'r0 ' + r0 + ': no hidden label could still be added');
  });
  const wide = L.chooseLabels(items, 400, lineH);
  const narrow = L.chooseLabels(items, 60, lineH);
  t.ok(wide.count > narrow.count, 'a bigger circle keeps more labels (' + wide.count + ' vs ' + narrow.count + ')');
  t.ok(narrow.count < items.length, 'a small circle must drop labels');
  const heaviest = items.slice().sort((a, b) => b.priority - a.priority)[0];
  t.ok(narrow.shown[heaviest.id], 'the heaviest node keeps its label when space is short');
});

/* ---- 7. radial labels are never upside down */
section('labels: never upside down', 3600, t => {
  for (let i = 0; i < 3600; i++) {
    const a = i / 3600 * L.TAU, p = L.labelPlacement(a);
    t.ok(p.rotate >= -90 - 1e-9 && p.rotate < 90 + 1e-9, 'angle ' + (a * 180 / Math.PI).toFixed(2) + ' rotation ' + p.rotate.toFixed(2) + ' is within [-90, 90)');
  }
});

/* ---- 8. plan: sizes, text floor, the note */
section('plan: 300x300 to 1600x1000, 14px floor, a plain note', 60, t => {
  const sizes = [[300, 300], [300, 600], [600, 500], [900, 600], [1200, 760], [1600, 1000], [1600, 400]];
  const tiny = L.buildGraph([
    { group: 'A', source: 'a', target: 'b', weight: 1 }, { group: 'A', source: 'b', target: 'c', weight: 1 },
    { group: 'B', source: 'd', target: 'a', weight: 1 }, { group: 'B', source: 'e', target: 'c', weight: 1 }
  ]);
  sizes.forEach(([w, h]) => {
    [{ fontSize: 14 }, { fontSize: 9 }, { fontSize: 20 }].forEach(ov => {
      const s = Object.assign({}, baseSettings, ov);
      /* the schema would clamp 9 to 14; plan must hold the floor even if it were bypassed */
      const p = L.plan(graph, w, h, s, measure);
      const tag = w + 'x' + h + ' fs ' + ov.fontSize;
      t.ok(p.fs >= 14, tag + ': text size ' + p.fs + ' is at least 14');
      t.ok(p.R > 0 && isFinite(p.R), tag + ': radius ' + p.R);
      const room = Math.min(w, h - p.noteH) / 2;
      t.ok(p.arcR + p.arcW / 2 + p.nameBand <= room + 0.5, tag + ': rings fit the box (' + (p.arcR + p.arcW / 2 + p.nameBand).toFixed(1) + ' <= ' + room.toFixed(1) + ')');
      t.ok(Object.keys(p.shown).length === p.shownCount, tag + ': shown count consistent');
      const mustNote = p.hidden > 0 || p.clipped > 0 || p.namesHidden > 0;
      t.ok(mustNote === !!p.note, tag + ': note present exactly when something was left out');
      if (p.hidden > 0 && p.labelsOn) t.ok(p.note.indexOf('Showing ' + p.shownCount + ' of ' + graph.nodes.length) === 0, tag + ': note states the real counts');
      t.ok(p.noteH === 0 || p.noteH >= 14 * 1.35, tag + ': note box is tall enough for 14px text');
    });
    const p2 = L.plan(tiny, w, h, baseSettings, measure);
    if (w >= 600) t.ok(p2.hidden === 0 && p2.shownCount === 5, w + 'x' + h + ': 5 nodes all labelled (' + p2.shownCount + ')');
  });
  const off = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { showLabels: false }), measure);
  t.ok(off.shownCount === 0 && off.hidden === 0 && !off.labelsOn, 'labels switched off: nothing shown, nothing reported hidden');
  const small = L.plan(graph, 300, 300, baseSettings, measure);
  t.ok(small.hidden > 0 && small.note && /14px/.test(small.note), 'at 300x300 the note says the 14px floor is why');
});

/* ---- 8b. layout options added with the panel: direction, manual order, filters, arc overhang, plan knobs */
section('layout: direction, manual order, filters, arcs, plan knobs', 15, t => {
  const base = { R: 200, beta: 0.85, gap: 2.5, rotation: 0, groupOrder: 'data', nodeSort: 'alpha' };
  const cw = L.layout(graph, base), ccw = L.layout(graph, Object.assign({}, base, { direction: 'ccw' }));
  t.ok(cw.groups.map(g => g.name).join() === ccw.groups.map(g => g.name).reverse().join(), 'counter-clockwise reverses the group sequence');
  t.ok(cw.leaves.length === ccw.leaves.length && cw.leaves[0].id !== ccw.leaves[0].id, 'counter-clockwise starts from a different node');
  const names = cw.groups.map(g => g.name), want = names.slice().reverse();
  const man = L.orderGroups(graph, { groupOrder: 'manual', manualOrder: want });
  t.ok(man.map(g => g.name).join() === want.join(), 'manual order follows the list');
  const half = L.layout(graph, Object.assign({}, base, { arcPad: 0 })), full = L.layout(graph, base);
  t.ok(half.arcs.every((a, i) => (a.a1 - a.a0) < (full.arcs[i].a1 - full.arcs[i].a0)), 'arc overhang 0 gives shorter arcs');
  const hidden = {}; hidden[names[0]] = true;
  const g2 = L.buildGraph(rows, { hiddenGroups: hidden });
  t.ok(g2.nodes.every(n => n.group !== names[0]) && g2.nodes.length < graph.nodes.length, 'a hidden group removes its nodes');
  t.ok(g2.links.every(l => g2.byId[l.s] && g2.byId[l.t]), 'and every link touching them');
  const sum = g2.links.reduce((a, l) => a + l.weight, 0);
  t.ok(g2.nodes.reduce((a, n) => a + n.outW, 0) === sum && g2.nodes.reduce((a, n) => a + n.inn, 0) === g2.links.length, 'degrees and weights are recomputed after the filter');
  const heavy = L.buildGraph(rows, { minWeight: 20 });
  t.ok(heavy.links.length < graph.links.length && heavy.links.every(l => l.weight >= 20) && heavy.nodes.length === graph.nodes.length, 'a weight floor drops light links and keeps every node');
  const p100 = L.plan(graph, 900, 600, Object.assign({}, baseSettings), measure), p60 = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { sizePct: 60 }), measure);
  t.ok(p60.R < p100.R, 'chart size 60% shrinks the ring (' + p60.R.toFixed(1) + ' < ' + p100.R.toFixed(1) + ')');
  const noArc = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { showArcs: false }), measure);
  t.ok(noArc.arcW === 0 && noArc.R > p100.R, 'no arcs: zero thickness and a bigger ring');
  const thick = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { arcWidth: 14, arcGap: 20 }), measure);
  t.ok(thick.arcW === 14 && thick.R < p100.R, 'arc thickness and gap come from the settings');
  const gap = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { labelGap: 25 }), measure);
  t.ok(gap.pad === baseSettings.nodeSize + 25 && gap.R < p100.R, 'label distance moves the labels out');
  const big = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { nodeSizeBy: 'links', nodeSizeMax: 3 }), measure);
  t.ok(big.pad === baseSettings.nodeSize * 3 + 7, 'sizing nodes by data makes room for the biggest');
  const wide = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { labelMaxPct: 60 }), measure), narrow = L.plan(graph, 900, 600, Object.assign({}, baseSettings, { labelMaxPct: 15 }), measure);
  t.ok(narrow.Lw <= wide.Lw && narrow.clipped >= wide.clipped, 'a narrower label cap clips more');
  const m2 = Object.assign(((tx, px) => tx.length * px * 0.56), {});
  m2.labelOf = n => n.id + '  1234567';
  const withVal = L.plan(graph, 900, 600, baseSettings, m2);
  t.ok(withVal.Lw >= p100.Lw, 'value labels widen the label column');
});

/* ---- 9. settings schema: 40+ settings over 7+ tabs, no sliders, bounded steppers, safe coercion, legacy keys */
const CPlib = ctx.CTabPanel;
const OLD_KEYS = ['beta', 'groupGap', 'groupOrder', 'nodeSort', 'rotation', 'linkOpacity', 'linkMinWidth', 'linkMaxWidth', 'weightScale', 'linkColorMode', 'linkColor',
  'hoverHighlight', 'hoverMode', 'outColor', 'inColor', 'dimOpacity', 'fadeMs', 'glow', 'terminals', 'clickSelect', 'pushHover', 'showReadout', 'entrance',
  'nodeSize', 'nodeHalo', 'showLabels', 'fontSize', 'labelPriority', 'showGroupNames', 'fontFamily', 'bgMode', 'bgCustom', 'textMode', 'textCustom', 'palette'];
section('schema: 40+ settings, 7+ tabs, steppers, chips, dropdowns only', 300, t => {
  const keys = Object.keys(S.BY_KEY);
  t.ok(keys.length >= 40, keys.length + ' settings (at least 40)');
  const tabsUsed = new Set(S.prepared.rows.map(r => r.tab));
  t.ok(S.schema.tabs.length >= 7 && tabsUsed.size >= 7, S.schema.tabs.length + ' tabs, ' + tabsUsed.size + ' with rows (at least 7)');
  ['colors', 'labels', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'].forEach(id => t.ok(S.schema.tabs.some(x => x.id === id), 'standard tab ' + id));
  ['layout', 'nodes', 'links', 'hover', 'arcs'].forEach(id => t.ok(S.prepared.rows.filter(r => r.tab === id).length >= 5, 'chart tab ' + id + ' has real depth (' + S.prepared.rows.filter(r => r.tab === id).length + ' rows)'));
  OLD_KEYS.forEach(k => t.ok(S.BY_KEY[k] !== undefined, 'old key ' + k + ' still exists'));
  ['bundling beta', 'group gaps', 'node size', 'link width by weight', 'incoming colour', 'outgoing colour', 'label rules', 'group arcs', 'hover behaviour'].forEach(() => {});
  ['beta', 'groupGap', 'nodeSize', 'widthByWeight', 'linkMinWidth', 'linkMaxWidth', 'inColor', 'outColor', 'labelPriority', 'labelGap', 'labelMaxPct', 'showGroupNames', 'arcWidth', 'hoverMode', 'dimOpacity'].forEach(k => t.ok(S.BY_KEY[k], 'spec item ' + k + ' is a setting'));
  const types = new Set();
  keys.forEach(k => {
    const o = S.BY_KEY[k];
    types.add(o.type);
    t.ok(['number', 'chips', 'select', 'check', 'color', 'text', 'font', 'palette', 'field', 'list', 'preview', 'action'].indexOf(o.type) >= 0, k + ': control type ' + o.type + ' is allowed');
    t.ok(k.indexOf('.') < 0, k + ': key has no dot (the Viz pages flow reads the last dot segment)');
    if (o.type === 'number') t.ok(o.min !== undefined && o.max !== undefined && o.step > 0, k + ': stepper has min, max and step');
    if (o.type === 'chips' || o.type === 'select') t.ok(o.opts.some(c => c.value === o.def), k + ': default is one of the choices');
    if (o.type !== 'preview' && o.type !== 'action') t.ok(JSON.stringify(S.coerce(k, S.coerce(k, o.def))) === JSON.stringify(S.coerce(k, o.def)), k + ': coercion is idempotent');
    if (o.type !== 'preview' && o.type !== 'action') t.ok(JSON.stringify(S.resolve({ [k]: CPlib.serialize(o, S.DEFAULTS[k]) })[k]) === JSON.stringify(S.DEFAULTS[k]), k + ': the default survives a string round trip');
  });
  t.ok(!types.has('slider') && !types.has('range'), 'no slider or range control type');
  t.ok(S.coerce('fontSize', 9) === 14 && S.coerce('fontSize', '3') === 14, 'text size cannot be set under 14');
  t.ok(S.coerce('fontSize', 40) === 28, 'text size caps at 28');
  t.ok(S.coerce('glow', 'false') === false && S.coerce('glow', 'true') === true, 'toggles survive Tableau string storage');
  t.ok(S.coerce('beta', '0.5') === 0.5 && S.coerce('beta', 7) === 1 && S.resolve({ beta: 'x' }).beta === 0.85, 'beta parses, clamps and falls back');
  t.ok(S.coerce('outColor', 'nope') === undefined || S.resolve({ outColor: 'nope' }).outColor === '#f2b84b', 'a junk colour falls back to the default');
  t.ok(S.resolve({ hoverMode: 'sideways' }).hoverMode === 'both', 'unknown choice falls back to the default');
  const copy = JSON.parse(JSON.stringify(S.resolve({ beta: 0.4, glow: false })));
  t.ok(copy.beta === 0.4 && copy.glow === false && S.resolve(copy).beta === 0.4, 'a Copy settings block round-trips through resolve');
});

/* ---- 9b. saved workbooks keep their look: every old key, stored as the old panel stored it, reads back the same */
section('legacy: old saved keys load unchanged, old panelTheme is carried', 40, t => {
  const old = { beta: '0.5', groupGap: '4', groupOrder: 'size', nodeSort: 'degree', rotation: '-45', linkOpacity: '0.5', linkMinWidth: '1', linkMaxWidth: '6', weightScale: 'log',
    linkColorMode: 'single', linkColor: '#112233', hoverHighlight: 'false', hoverMode: 'out', outColor: '#aa0000', inColor: '#00aa00', dimOpacity: '0.2', fadeMs: '600',
    glow: 'false', terminals: 'false', clickSelect: 'false', pushHover: 'false', showReadout: 'false', entrance: 'false', nodeSize: '7', nodeHalo: 'false', showLabels: 'false',
    fontSize: '20', labelPriority: 'alpha', showGroupNames: 'false', fontFamily: 'Verdana, Geneva, sans-serif', bgMode: 'custom', bgCustom: '#123456', textMode: 'custom',
    textCustom: '#ffffff', palette: 'warm' };
  const r = S.resolve(old);
  const want = { beta: 0.5, groupGap: 4, groupOrder: 'size', nodeSort: 'degree', rotation: -45, linkOpacity: 0.5, linkMinWidth: 1, linkMaxWidth: 6, weightScale: 'log',
    linkColorMode: 'single', linkColor: '#112233', hoverHighlight: false, hoverMode: 'out', outColor: '#aa0000', inColor: '#00aa00', dimOpacity: 0.2, fadeMs: 600,
    glow: false, terminals: false, clickSelect: false, pushHover: false, showReadout: false, entrance: false, nodeSize: 7, nodeHalo: false, showLabels: false,
    fontSize: 20, labelPriority: 'alpha', showGroupNames: false, fontFamily: 'Verdana, Geneva, sans-serif', bgMode: 'custom', bgCustom: '#123456', textMode: 'custom',
    textCustom: '#ffffff', palette: 'warm' };
  Object.keys(want).forEach(k => t.ok(r[k] === want[k], 'saved ' + k + '=' + old[k] + ' reads as ' + JSON.stringify(want[k]) + ' (got ' + JSON.stringify(r[k]) + ')'));
  t.ok(OLD_KEYS.every(k => k in want), 'the legacy fixture covers every old key');
  const d = S.resolve({});
  t.ok(d.beta === 0.85 && d.nodeSize === 4 && d.linkOpacity === 0.34 && d.fadeMs === 280 && d.padding === 0 && d.tipFollow === 'corner' && d.animMs === 700 && d.animEase === 'inout' && d.numDecimals === 0,
    'defaults keep the old look (padding 0, readout in the corner, 700ms ease-in-out entrance)');
  t.ok(S.legacy(k => ({ panelTheme: 'dark' })[k]).panel.theme === 'dark' && S.legacy(k => ({ panelTheme: 'match' })[k]).panel.theme === 'match', 'panelTheme dark and match are carried to the new panel');
  t.ok(S.legacy(k => undefined).panel.theme === undefined && S.legacy(k => ({ panelTheme: 'neon' })[k]).panel.theme === undefined, 'no panelTheme, or a junk one, carries nothing');
  /* through the real store: strings in tableau settings, keyed with the old prefix */
  const bag = {}; Object.keys(old).forEach(k => { bag['neurons.' + k] = old[k]; });
  const store = CPlib.createStore({ rows: S.prepared.rows, settings: { get: k => bag[k], set: (k, v) => { bag[k] = v; }, getAll: () => bag, saveAsync: () => Promise.resolve() }, prefix: 'neurons.' });
  store.load();
  const sv = store.get();
  t.ok(Object.keys(want).every(k => sv[k] === want[k]), 'the real store loads every old key from "neurons.<key>" strings');
});

/* ---- 10. colour: 7 to 1 text on any background, 3 to 1 for marks */
section('theme: 7:1 text on every background', 60, t => {
  const bgs = ['#ffffff', '#081f33', '#0c2a45', '#000000', '#f5e6c8', '#777777', '#808080', '#8a8a8a', '#ff0000', '#00aa00', '#3366cc', '#ffcc00', '#e6e6e6', '#202020', null, 'rgba(0,0,0,0)'];
  bgs.forEach(bg => {
    ['auto', 'navy', 'white', 'custom'].forEach(mode => {
      const th = P.resolveTheme(Object.assign({}, baseSettings, { bgMode: mode, bgCustom: bg || '#081f33' }), bg);
      t.ok(P.contrast(th.ink, th.bg) >= 7, 'bg ' + bg + ' mode ' + mode + ': ink ' + th.ink + ' on ' + th.bg + ' is ' + P.contrast(th.ink, th.bg).toFixed(2));
      t.ok(P.contrast(th.muted, th.bg) >= 6.99, 'bg ' + bg + ' mode ' + mode + ': muted text keeps 7:1');
      th.groups.concat([th.out, th.inn, th.single]).forEach(c => t.ok(P.contrast(c, th.bg) >= 2.99, 'mark colour ' + c + ' keeps 3:1 on ' + th.bg));
    });
  });
  const grey = P.resolveTheme(Object.assign({}, baseSettings, { bgMode: 'auto' }), '#808080');
  t.ok(grey.plate === true, 'a mid-grey worksheet gets a plate, because no ink reaches 7:1 on it');
  const bad = P.resolveTheme(Object.assign({}, baseSettings, { textMode: 'custom', textCustom: '#888888' }), '#ffffff');
  t.ok(bad.ink !== '#888888', 'a custom text colour under 7:1 is refused');
  const good = P.resolveTheme(Object.assign({}, baseSettings, { textMode: 'custom', textCustom: '#003366' }), '#ffffff');
  t.ok(good.ink === '#003366', 'a custom text colour over 7:1 is used');
});

/* ---- 11. source hygiene: vendored libs, no sliders, no dialogs, 14px, no CDN */
section('source: licences, no dialogs, no sliders, no CDN, no small text', 20, t => {
  ['d3-path', 'd3-shape', 'd3-hierarchy'].forEach(n => {
    t.ok(fs.existsSync(path.join(root, 'lib', 'd3', n + '.min.js')), n + ' is vendored');
    const lic = fs.readFileSync(path.join(root, 'lib', 'd3', 'LICENSE-' + n), 'utf8');
    t.ok(/Permission to use, copy, modify/.test(lic) && /Mike Bostock/.test(lic), n + ' licence is committed');
  });
  const files = [];
  (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(e => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); }); })(path.join(root, 'src'));
  t.ok(files.length >= 7, 'scanned ' + files.length + ' source files');
  files.forEach(f => {
    const s = fs.readFileSync(f, 'utf8'), rel = path.relative(root, f);
    if (/\.(js|html)$/.test(f)) {
      t.ok(!/\b(?:alert|confirm|prompt)\s*\(/.test(s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), rel + ': no browser dialogs');
      t.ok(!/type\s*=\s*["']range["']/.test(s) && !/\.type\s*=\s*["']range["']/.test(s), rel + ': no range input');
      t.ok(!/<(?:script|link)[^>]+(?:src|href)=["']https?:/.test(s), rel + ': no CDN script or stylesheet');
    }
    if (/\.css$/.test(f)) {
      const sizes = (s.match(/font-size:\s*[0-9.]+px/g) || []).map(x => parseFloat(x.split(':')[1]));
      t.ok(sizes.every(n => n >= 14), rel + ': ' + sizes.length + ' font-size declarations, none under 14');
    }
  });
});

/* ---- 12. manifest */
section('manifest: house rules', 12, t => {
  const x = fs.readFileSync(path.join(root, 'neurons.trex'), 'utf8');
  t.ok(/id="com[.]datadivers[.]vizext[.]neurons"/.test(x), 'id com.datadivers.vizext.neurons');
  t.ok(/<author [^>]*name="Chris Fryar"/.test(x) && /<author [^>]*email=""/.test(x) && /organization="Data Divers"/.test(x), 'author Chris Fryar, empty email, organization Data Divers');
  t.ok(/<min-api-version>1[.]12<[/]min-api-version>/.test(x), 'min-api 1.12');
  t.ok(/<permission>full data<[/]permission>/.test(x), 'full data permission');
  t.ok(/localhost:8774[/]src[/]index[.]html/.test(x), 'port 8774');
  const enc = (x.match(/<encoding id="/g) || []).length;
  t.ok(enc === 4, 'exactly 4 encodings (got ' + enc + '), the Tableau maximum');
  ['group', 'source', 'target', 'weight'].forEach(id => t.ok(new RegExp('<encoding id="' + id + '">').test(x), 'encoding ' + id));
  t.ok(!/<script/.test(x), 'no script tags in the manifest');
  t.ok(/8774/.test(fs.readFileSync(path.join(root, 'Start-Neurons.ps1'), 'utf8')), 'the start script serves port 8774');
  t.ok(/8774/.test(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), 'package.json serves port 8774');
});

console.log('\n' + (fails ? 'RED' : 'GREEN') + ': ' + passes + ' assertions passed, ' + fails + ' failed, across ' + sections.length + ' sections');
console.log(sections.map(s => s.name.split(':')[0] + '=' + s.subjects).join('  '));
process.exit(fails ? 1 : 0);
