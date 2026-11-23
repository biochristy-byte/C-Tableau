/* Reef unit tests: layout math, settings coercion, colour maths.
 * No DOM needed. Run: node test/run.js
 * Every assertion counts toward a printed total, and the run goes RED when fewer
 * than MIN_CHECKS assertions ran, so an empty run cannot pass.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CP = require(path.join(ROOT, 'lib', 'ctab-panel', 'ctab-panel.js'));
const SET = require(path.join(ROOT, 'src', 'js', 'settings.js'));
const sandbox = { console, Math, Map, Set, Array, Object, JSON, Number, String, isFinite, parseFloat, parseInt, CTabPanel: CP };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
function load(rel) { vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), sandbox, { filename: rel }); }
load('lib/d3-hierarchy.min.js');
['src/js/colors.js', 'src/js/layout.js'].forEach(load);
const { colors, layout } = sandbox.RF;

let pass = 0; const failures = [];
function ok(name, cond, detail) { if (cond) pass++; else failures.push(name + (detail ? '\n    ' + detail : '')); }
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }

function csv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const split = (line) => { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const head = split(text[0]);
  return text.slice(1).map((l) => { const c = split(l), o = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
}
const real = csv(path.join(ROOT, 'example', 'us-deaths-by-cause-2017.csv'));
const toRows = (rs, f) => rs.map((r, i) => ({ path: f.path.map((k) => r[k]), value: Number(r[f.size]), color: null, tuple: i + 1 }));

/* ---------------------------------------------------------- settings */
const rows = SET.prepared.rows, byKey = {}; rows.forEach((r) => { byKey[r.key] = r; });
const settable = rows.filter((r) => r.type !== 'note');
const tabsUsed = new Set(settable.map((r) => r.tab));
ok('at least 40 settings (' + settable.length + ')', settable.length >= 40);
ok('at least 7 tabs (' + tabsUsed.size + '): ' + [...tabsUsed].join(', '), tabsUsed.size >= 7);
ok('has the standard tabs and the Reef tabs', ['colors', 'labels', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields', 'packing', 'depth', 'zoom', 'rings', 'legend'].every((t) => tabsUsed.has(t)), [...tabsUsed].join());
ok('no slider row type exists in the schema', rows.every((r) => r.type !== 'slider' && r.type !== 'range'));
const defs = CP.defaultsOf(rows);
eq('SET.DEFAULTS is the defaults of the rows', SET.DEFAULTS, defs);
// every default survives the string round trip the Tableau settings store applies
let rt = 0;
settable.forEach((r) => { const s = r.type === 'list' ? JSON.stringify(defs[r.key]) : String(defs[r.key]); const c = CP.coerce(r, s); if (JSON.stringify(c) === JSON.stringify(defs[r.key])) rt++; else failures.push('default of ' + r.key + ' does not survive a string round trip: ' + JSON.stringify(c)); });
ok('all ' + settable.length + ' defaults survive a string round trip', rt === settable.length);
settable.forEach((r) => { if (r.type === 'select' || r.type === 'chips') ok('default of ' + r.key + ' is one of its choices', r.opts.some((o) => o.value === String(defs[r.key]))); });
settable.forEach((r) => { if (r.type === 'number') ok('number ' + r.key + ' has its default inside min and max', defs[r.key] >= r.min && defs[r.key] <= r.max); });
ok('every text size floor is 14px', ['fontSize', 'tipSize', 'titleSize'].every((k) => byKey[k].min === 14));
ok('every when points at a real key', rows.every((r) => { const ws = !r.when ? [] : Array.isArray(r.when) ? r.when : [r.when]; return ws.every((w) => typeof w === 'function' || byKey[w.key]); }));
// the keys Reef shipped with are all still there, with the values they shipped with
const OLD = { colorMode: 'group', colorField: '', sort: 'size', palette: 'reef', rampName: 'reef', singleColor: '#3cc4d1', groupFill: 18, leafOpacity: 92, ringWidth: 1.5, gap: 5, hideBelow: 2, margin: 12, legend: true,
  labels: true, groupLabels: true, showValues: true, fontSize: 14, zoomOnClick: true, zoomMs: 700, breadcrumb: true, intro: true, theme: 'worksheet', customBg: '#0d2b45', tooltips: true, selectEnabled: true, gearCorner: 'tr' };
Object.keys(OLD).forEach((k) => eq('saved key ' + k + ' kept with its old default', defs[k], OLD[k]));
// coercion
eq('"14" coerces to the number 14', CP.coerce(byKey.fontSize, '14'), 14);
eq('label size never goes below 14', CP.coerce(byKey.fontSize, '9'), 14);
eq('label size caps at 28', CP.coerce(byKey.fontSize, '99'), 28);
eq('"false" coerces to false', CP.coerce(byKey.labels, 'false'), false);
eq('number out of range clamps', CP.coerce(byKey.zoomMs, '99999'), 2000);
eq('bad colour is refused', CP.coerce(byKey.singleColor, 'red'), undefined);
eq('good colour kept, lower-cased', CP.coerce(byKey.singleColor, '#ABCDEF'), '#abcdef');
eq('unknown palette is refused', CP.coerce(byKey.palette, 'nope'), undefined);
eq('every old palette id still loads', ['reef', 'lagoon', 'sunset', 'datadivers', 'kelp', 'colorblind10'].map((v) => CP.coerce(byKey.palette, v)), ['reef', 'lagoon', 'sunset', 'datadivers', 'kelp', 'colorblind10']);
eq('every old theme id still loads', ['worksheet', 'light', 'dark', 'custom'].map((v) => CP.coerce(byKey.theme, v)), ['worksheet', 'light', 'dark', 'custom']);
eq('colour field keeps any column name', CP.coerce(byKey.colorField, 'Age-adjusted death rate'), 'Age-adjusted death rate');
// old saved settings: font stack and valueFormat are read as a fallback when the new key is empty
function fake(obj) { return { v: Object.assign({}, obj), get(k) { return this.v[k]; }, set(k, x) { this.v[k] = String(x); }, getAll() { return Object.assign({}, this.v); }, saveAsync() { return Promise.resolve(); } }; }
function loaded(obj) { const st = CP.createStore({ rows: SET.prepared.rows, settings: SET.withLegacy(fake(obj)), prefix: 'reef.' }); return st.load(); }
const STACKS = { 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif': 'worksheet', '"Segoe UI", system-ui, Roboto, Arial, sans-serif': 'segoe', 'Arial, Helvetica, sans-serif': 'arial',
  '"Helvetica Neue", Helvetica, Arial, sans-serif': 'helvetica', '"Trebuchet MS", Tahoma, sans-serif': 'trebuchet', 'Verdana, Geneva, sans-serif': 'verdana' };
Object.keys(STACKS).forEach((k) => eq('old fontFamily ' + k.slice(0, 22) + ' reads as font ' + STACKS[k], loaded({ 'reef.fontFamily': k }).font, STACKS[k]));
eq('old valueFormat plain reads as numCompact false', loaded({ 'reef.valueFormat': 'plain' }).numCompact, false);
eq('old valueFormat compact reads as numCompact true', loaded({ 'reef.valueFormat': 'compact' }).numCompact, true);
eq('nothing saved: numCompact keeps the old compact look', loaded({}).numCompact, true);
eq('a saved new key beats the old one', loaded({ 'reef.font': 'verdana', 'reef.fontFamily': 'Arial, Helvetica, sans-serif' }).font, 'verdana');
eq('an unknown old stack falls back to the default font', loaded({ 'reef.fontFamily': 'Papyrus, fantasy' }).font, 'worksheet');
const old = loaded({ 'reef.palette': 'sunset', 'reef.fontSize': '16', 'reef.colorMode': 'field', 'reef.zoomMs': '500', 'reef.theme': 'dark', 'reef.labels': 'false', 'reef.gap': '9', 'reef.tooltips': 'false' });
eq('an old workbook keeps palette, label size, colour mode, zoom time, theme, labels, gap, tooltips', [old.palette, old.fontSize, old.colorMode, old.zoomMs, old.theme, old.labels, old.gap, old.tooltips], ['sunset', 16, 'field', 500, 'dark', false, 9, false]);
ok('settings.js never calls a browser dialog or draws a range input', !/\b(prompt|alert|confirm)\s*\(|type\s*=\s*['"]range['"]/.test(fs.readFileSync(path.join(ROOT, 'src/js/settings.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src/js/app.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src/js/render.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src/css/reef.css'), 'utf8')));
ok('the old panel is gone (no src/js/panel.js)', !fs.existsSync(path.join(ROOT, 'src/js/panel.js')));
ok('default palette is the reef palette', defs.palette === 'reef' && colors.PALETTES.reef[0] === '#f08f8f' && colors.PALETTES.reef.indexOf('#3cc4d1') > -1);
/* --------------------------------------------------------- colour maths */
function near(name, a, b, tol) { ok(name, Math.abs(a - b) <= (tol || 1e-6), 'expected ~' + b + ' got ' + a); }
near('black on white is 21:1', colors.contrast('#000000', '#ffffff'), 21, 1e-9);
near('contrast is symmetric', colors.contrast('#3cc4d1', '#081f33'), colors.contrast('#081f33', '#3cc4d1'), 1e-12);
[['light chip', '#10202b', '#ffffff'], ['dark chip', '#f3f5f7', '#081f33']].forEach((p) => ok(p[0] + ' text clears 7:1', colors.contrast(p[1], p[2]) >= 7, String(colors.contrast(p[1], p[2]))));
eq('parse #abc', colors.parse('#abc'), { r: 170, g: 187, b: 204, a: 1 });
eq('parse rgba', colors.parse('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
eq('parse junk is null', colors.parse('banana'), null);
eq('mix endpoints', [colors.mix('#000000', '#ffffff', 0), colors.mix('#000000', '#ffffff', 1)], ['#000000', '#ffffff']);
eq('ramp endpoints are the first and last stop', [colors.ramp(0, colors.RAMPS.reef), colors.ramp(1, colors.RAMPS.reef)], [colors.RAMPS.reef[0], colors.RAMPS.reef[4]]);
eq('compact format', [colors.fmt(1234, 'compact'), colors.fmt(1500000, 'compact'), colors.fmt(2.4e9, 'compact'), colors.fmt(842, 'compact')], ['1.2K', '1.5M', '2.4B', '842']);
eq('plain format', colors.fmt(1234567, 'plain'), '1,234,567');
eq('format of NaN is empty', colors.fmt(NaN, 'plain'), '');

/* ------------------------------------------------------------- hierarchy */
const F3 = { path: ['Cause group', 'Cause', 'Census region'], size: 'Deaths' };
const t3 = layout.buildTree(toRows(real, F3), 3, 'size');
const sumReal = real.reduce((a, r) => a + Number(r.Deaths), 0);
eq('real data: 3 levels yield 10 causes x 4 regions = 40 leaves', t3.root.leaves().length, 40);
eq('real data: top-level groups', t3.root.children.length, 5);
near('real data: root value equals the sum of every row', t3.root.value, sumReal, 1e-6);
eq('real data: nothing dropped', t3.dropped, 0);
ok('size sort puts the biggest group first', t3.root.children[0].value >= t3.root.children[1].value);
const t1 = layout.buildTree(toRows(real.filter((r) => r.Cause === 'Cancer'), { path: ['State'], size: 'Deaths' }), 1, 'name');
eq('one level: 51 states under cancer', t1.root.leaves().length, 51);
ok('name sort is A to Z', t1.root.children.every((c, i, a) => !i || a[i - 1].data.name <= c.data.name));
const bad = layout.buildTree([
  { path: ['Alpha', 'x'], value: 0 }, { path: ['Alpha', 'y'], value: -5 }, { path: ['Alpha', 'z'], value: 10 },
  { path: [null, 'blank group'], value: 10 }, { path: ['Beta', null], value: 10 }, { path: ['Beta', 'x'], value: 10 }, { path: ['Beta', 'x'], value: 10 },
  { path: ['Gamma', 'x'], value: NaN }], 2, 'data');
eq('zero, negative and NaN rows are dropped and counted', bad.dropped, 3);
eq('identical paths merge and sum', bad.root.leaves().filter((l) => l.data.name === 'x').map((l) => l.value), [20]);
ok('blank names become (blank), not undefined', bad.root.descendants().some((n) => n.data.name === '(blank)') && !bad.root.descendants().some((n) => n.data.name === 'undefined' || n.data.name === 'null'));
const emptyTree = layout.buildTree([], 2, 'size'); eq('no rows gives a root with no children', emptyTree.root.children, undefined);
const cmix = layout.buildTree([{ path: ['A'], value: 3, color: 10 }, { path: ['A'], value: 1, color: 20 }], 1, 'size').root.leaves()[0].data;
near('numeric colour is a size-weighted mean on merge', cmix.cs / cmix.cw, 12.5);

/* ------------------------------------------------- single-child chains */
function singles(root) { return root.descendants().filter((n) => n.parent && n.children && n.children.length === 1).map((n) => n.data.name); }
function groupsOf(root) { return root.descendants().filter((n) => n.parent && n.children).length; }
const cancers = t3.root.descendants().filter((n) => n.data.name === 'Cancers');
eq('real data: Cancers has one child in the source, so it folds into ONE circle', cancers.length, 1);
eq('real data: the folded Cancers circle holds the 4 regions directly', cancers[0].children.map((c) => c.data.name).sort(), ['Midwest', 'Northeast', 'South', 'West']);
ok('real data: no separate Cancer circle remains', !t3.root.descendants().some((n) => n.data.name === 'Cancer'));
eq('real data: a folded circle keeps its full path for selection', cancers[0].children[0].data.pathNames.length, 3);
eq('real data: folding keeps the total', Math.round(t3.root.value), Math.round(sumReal));
eq('real data: no group has exactly one child', singles(t3.root), []);
const chain = layout.buildTree([{ path: ['Heart', 'Heart disease', 'Valve'], value: 4 }, { path: ['Heart', 'Heart disease', 'Valve'], value: 2 }, { path: ['Lung', 'Asthma', 'Child'], value: 3 }, { path: ['Lung', 'Asthma', 'Adult'], value: 3 }, { path: ['Gut', 'Colon', 'Polyp'], value: 1 }, { path: ['Gut', 'Colon', 'Polyp'], value: 2 }], 3, 'name');
eq('a 3-step chain folds into one leaf named Parent: Child', chain.root.leaves().filter((l) => l.data.name === 'Heart: Valve').length, 1);
eq('chain leaves keep every folded name', chain.root.leaves().map((l) => l.data.name).sort(), ['Adult', 'Child', 'Gut: Colon: Polyp', 'Heart: Valve']);
eq('Lung with one child Asthma folds to the circle Lung: Asthma holding Child and Adult', chain.root.descendants().filter((n) => n.data.name === 'Lung: Asthma' && n.children && n.children.length === 2).length, 1);
eq('chain data: no group has exactly one child', singles(chain.root), []);
eq('a plural parent folds to the parent name', layout.buildTree([{ path: ['Cancers', 'Cancer'], value: 1 }, { path: ['Other', 'x'], value: 1 }, { path: ['Other', 'y'], value: 1 }], 2, 'name').root.leaves().map((l) => l.data.name).sort(), ['Cancers', 'x', 'y']);
eq('a one-level tree keeps its leaves (root is never folded)', layout.buildTree([{ path: ['Solo'], value: 1 }], 1, 'name').root.children.map((c) => c.data.name), ['Solo']);
eq('a blank only child folds into the parent name', layout.buildTree([{ path: ['Beta', null], value: 1 }, { path: ['Other', 'x'], value: 1 }, { path: ['Other', 'y'], value: 1 }], 2, 'name').root.leaves().map((l) => l.data.name).sort(), ['Beta', 'x', 'y']);
ok('big random tree: no single-child group (' + groupsOf(layout.buildTree(bigRowsEarly(), 3, 'size').root) + ' groups checked)', singles(layout.buildTree(bigRowsEarly(), 3, 'size').root).length === 0);
function bigRowsEarly() { const r = (function () { let q = 777; return () => (q = (q * 1664525 + 1013904223) % 4294967296) / 4294967296; })(); return Array.from({ length: 600 }, (_, i) => ({ path: ['G' + (i % 9), 'S' + (i % 41), 'L' + i], value: 1 + r() * 9, tuple: i })); }

/* ------------------------------------------------------------------ pack */
function checkPack(name, root) {
  let worst = 0, pairs = 0, parents = 0, leafRatio = [];
  root.each((p) => {
    if (!p.children) { leafRatio.push(p.r * p.r / p.value); return; }
    parents++;
    p.children.forEach((c) => { const d = Math.hypot(c.x - p.x, c.y - p.y); worst = Math.max(worst, d + c.r - p.r); });
    for (let i = 0; i < p.children.length; i++) for (let j = i + 1; j < p.children.length; j++) {
      const a = p.children[i], b = p.children[j]; pairs++;
      worst = Math.max(worst, a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y));
    }
  });
  ok(name + ': no circle overlaps a sibling and every child sits inside its parent (worst excess ' + worst.toExponential(2) + ', ' + pairs + ' pairs, ' + parents + ' parents)', worst < 1e-6 && pairs >= 0 && parents > 0);
  const lo = Math.min.apply(null, leafRatio), hi = Math.max.apply(null, leafRatio);
  ok(name + ': leaf area is proportional to value', (hi - lo) / hi < 1e-9, lo + ' .. ' + hi);
  return { pairs, parents };
}
let totalPairs = 0;
[0, 5, 20].forEach((gap) => { totalPairs += checkPack('real 3-level gap ' + gap, layout.pack(layout.buildTree(toRows(real, F3), 3, 'size').root, gap)).pairs; });
const rng = (function () { let s = 12345; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; })();
const bigRows = Array.from({ length: 1200 }, (_, i) => ({ path: ['G' + (i % 12), 'S' + (i % 60), 'L' + i], value: Math.pow(rng(), -1.4) * 10, tuple: i }));
totalPairs += checkPack('1,200 leaves', layout.pack(layout.buildTree(bigRows, 3, 'size').root, 4)).pairs;
ok('overlap check examined many sibling pairs', totalPairs > 3000, String(totalPairs));
const root3 = layout.pack(layout.buildTree(toRows(real, F3), 3, 'size').root, 5);
ok('root circle fits inside the 1000 square', root3.x - root3.r >= -1e-6 && root3.x + root3.r <= 1000 + 1e-6 && root3.y - root3.r >= -1e-6 && root3.y + root3.r <= 1000 + 1e-6);

/* ------------------------------------------------------------------ view */
[[900, 560], [300, 300], [1600, 1000], [420, 640]].forEach((wh) => {
  const f = root3.children[1], v = layout.viewFor(f, wh[0], wh[1], 0, 0, 12);
  const l = v.ox + (f.x - f.r) * v.k, rr = v.ox + (f.x + f.r) * v.k, t = v.oy + (f.y - f.r) * v.k, b = v.oy + (f.y + f.r) * v.k;
  ok('focus circle fits a ' + wh.join('x') + ' stage with its margin', l >= 11.99 && t >= 11.99 && rr <= wh[0] - 11.99 && b <= wh[1] - 11.99, [l, t, rr, b].join());
});
const A = { x: 500, y: 500, r: 500 }, B = { x: 120, y: 700, r: 60 };
const e0 = layout.lerpFocus(A, B, 0), e1 = layout.lerpFocus(A, B, 1);
near('lerp starts at A', e0.r, 500, 1e-9); near('lerp ends at B (r)', e1.r, 60, 1e-9); near('lerp ends at B (x)', e1.x, 120, 1e-9); near('lerp ends at B (y)', e1.y, 700, 1e-9);
let mono = true, prev = Infinity; for (let i = 0; i <= 100; i++) { const r = layout.lerpFocus(A, B, i / 100).r; if (r > prev + 1e-9) mono = false; prev = r; }
ok('zoom radius shrinks monotonically with no overshoot', mono);
near('ease(0)', layout.easeInOut(0), 0); near('ease(1)', layout.easeInOut(1), 1); near('ease(.5)', layout.easeInOut(0.5), 0.5);
let em = true, ep = -1; for (let i = 0; i <= 200; i++) { const v = layout.easeInOut(i / 200); if (v < ep - 1e-12) em = false; ep = v; }
ok('easing never goes backwards', em);
ok('easing starts and ends slowly (smooth, not choppy)', layout.easeInOut(0.02) < 0.001 && layout.easeInOut(0.98) > 0.999);

/* ---------------------------------------------------------------- labels */
function overlapCount(chips) { let n = 0; for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) { const a = chips[i], b = chips[j]; if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) n++; } return n; }
function planFor(root, wh, fs) {
  const v = layout.viewFor(root, wh[0], wh[1], 0, 0, 12), cands = [];
  root.descendants().forEach((n) => {
    if (n === root) return;
    cands.push({ id: n.data.name + '#' + cands.length, group: !!n.children, x: v.ox + n.x * v.k, y: v.oy + n.y * v.k, r: n.r * v.k, texts: [n.data.name + '  ' + Math.round(n.value), n.data.name], prio: n.depth });
  });
  const chips = layout.planLabels(cands, { x0: 2, y0: 2, x1: wh[0] - 2, y1: wh[1] - 2 }, (t) => t.length * fs * 0.58, fs, 8, 5);
  return { chips, cands };
}
let chipTotal = 0;
[[900, 560, 14], [300, 300, 14], [1600, 1000, 14], [900, 560, 20]].forEach((p) => {
  const { chips, cands } = planFor(root3, [p[0], p[1]], p[2]), byId = {}; cands.forEach((c) => { byId[c.id] = c; });
  chipTotal += chips.length;
  eq('labels at ' + p.join('x') + ': zero overlapping chips', overlapCount(chips), 0);
  let inside = true; chips.forEach((c) => { const k = byId[c.id], rr = k.r - 2 + 1e-6; [[c.x, c.y], [c.x + c.w, c.y], [c.x, c.y + c.h], [c.x + c.w, c.y + c.h]].forEach((q) => { if (Math.hypot(q[0] - k.x, q[1] - k.y) > rr) inside = false; }); if (c.x < 2 || c.y < 2 || c.x + c.w > p[0] - 2 || c.y + c.h > p[1] - 2) inside = false; });
  ok('labels at ' + p.join('x') + ': every chip lies inside its own circle and the stage (' + chips.length + ' placed)', inside);
});
ok('label planner placed chips at all (not vacuously empty)', chipTotal > 20, String(chipTotal));
const tinyOnly = layout.planLabels([{ id: 'x', group: false, x: 50, y: 50, r: 6, texts: ['A very long name'], prio: 0 }], { x0: 0, y0: 0, x1: 100, y1: 100 }, (t) => t.length * 8, 14, 8, 5);
eq('a circle too small for its label gets no chip', tinyOnly.length, 0);

const noStub = planFor(root3, [900, 560], 14).chips.every((c) => c.text.indexOf('…') < 0 && c.text.indexOf('...') < 0);
ok('planner output never contains an ellipsis', noStub);
const src = fs.readFileSync(path.join(ROOT, 'src/js/render.js'), 'utf8');
ok('renderer builds no truncated label text', src.indexOf('…') < 0 && !/slice\(0, -1\)/.test(src));

// new layout levers
{
  const rowsA = toRows(real, F3);
  const r0 = layout.pack(layout.buildTree(rowsA, 3, 'size').root, 5), r1 = layout.pack(layout.buildTree(rowsA, 3, 'size').root, 5, { topGap: 30 }), r2 = layout.pack(layout.buildTree(rowsA, 3, 'size').root, 5, { groupPad: 20 });
  ok('topGap spreads the top-level groups (the first group shrinks against the fixed frame)', r1.children[0].r < r0.children[0].r, r0.children[0].r + ' vs ' + r1.children[0].r);
  ok('groupPad leaves more room inside nested groups (leaves shrink)', r2.leaves()[0].r < r0.leaves()[0].r);
  const down = layout.buildTree(rowsA, 3, 'size').root.children.map((c) => c.data.name), up = layout.buildTree(rowsA, 3, 'size', { reverse: true }).root.children.map((c) => c.data.name);
  eq('reverse flips the sort order of the top-level groups', up, down.slice().reverse());
  ok('fold:false keeps single-child rings (more circles than the folded tree)', layout.buildTree(rowsA, 3, 'size', { fold: false }).root.descendants().length > layout.buildTree(rowsA, 3, 'size').root.descendants().length);
  eq('ease endpoints for all three curves', ['inout', 'out', 'linear'].map((n) => [layout.ease(n, 0), layout.ease(n, 1)]), [[0, 1], [0, 1], [0, 1]]);
  ok('ease curves differ at 25%', new Set(['inout', 'out', 'linear'].map((n) => layout.ease(n, 0.25).toFixed(4))).size === 3);
  near('viewFor scale halves the zoom at sizePct 50', layout.viewFor({ x: 500, y: 500, r: 500 }, 900, 560, 0, 0, 12, 0.5).k * 2, layout.viewFor({ x: 500, y: 500, r: 500 }, 900, 560, 0, 0, 12, 1).k, 1e-9);
}

/* --------------------------------------------------------------- report */
const MIN_CHECKS = 185;
const total = pass + failures.length;
console.log('Reef unit tests: ' + pass + ' passed, ' + failures.length + ' failed, ' + total + ' checks run (minimum ' + MIN_CHECKS + ')');
if (failures.length) { console.log('\nFAILURES\n' + failures.map((f) => ' - ' + f).join('\n')); }
if (total < MIN_CHECKS) { console.log('RED: fewer checks ran than the declared minimum, so this run proves nothing'); process.exit(2); }
process.exit(failures.length ? 1 : 0);
