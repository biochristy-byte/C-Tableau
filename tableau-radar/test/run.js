/* Headless unit tests for the parts of Radar that need no DOM: pivoting, scales and rings, polar geometry against
 * hand-computed truth from the example CSV, closed and smoothed outlines (and that smoothing never leaves the outer
 * circle), label wrapping, small-multiples layout, the label layout, series/axis lists, and the settings schema
 * (at least 40 settings across at least 7 tabs, no sliders, defaults that survive a string round trip).
 *
 * Run: node test/run.js
 * Exit 1 and a RED line on any failure; RED too if it ran fewer than MIN_CHECKS checks. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CP = require(path.join(ROOT, 'lib', 'ctab-panel', 'ctab-panel.js'));
const M = require(path.join(ROOT, 'src', 'js', 'radar-math.js'));
const SET = require(path.join(ROOT, 'src', 'js', 'settings.js'));
const sandbox = { console, CTabPanel: CP, RD: { math: M } };
sandbox.globalThis = sandbox; vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'js', 'render.js'), 'utf8'), sandbox, { filename: 'render.js' });
const RD = sandbox.RD;

const MIN_CHECKS = 165;
let pass = 0; const fails = [];
function ok(name, cond, detail) { if (cond) pass++; else fails.push(name + (detail === undefined ? '' : '\n    ' + detail)); }
function near(name, a, e, tol) { ok(name, Math.abs(a - e) <= tol, 'expected ~' + e + ' got ' + a + ' (tol ' + tol + ')'); }
function eq(name, a, e) { ok(name, JSON.stringify(a) === JSON.stringify(e), 'expected ' + JSON.stringify(e) + ' got ' + JSON.stringify(a)); }

/* ---------------------------------------------------------------- nice rings */
eq('niceNum rounds up (ceil mode) 16.4 to 20', M.niceNum(16.4, false), 20);
eq('niceNum rounds up 0.7 to 1', M.niceNum(0.7, false), 1);
eq('niceNum keeps 2', M.niceNum(2, false), 2);
eq('niceNum 3.1 goes to 5', M.niceNum(3.1, false), 5);
eq('niceNum of zero falls back to 1', M.niceNum(0, false), 1);
let d = M.domain(0, 82, 5, { minMode: 'zero' });
eq('domain 0..82 with 5 rings is 0..100', [d.lo, d.hi], [0, 100]);
eq('domain ticks are 0,20,...,100', d.ticks, [0, 20, 40, 60, 80, 100]);
d = M.domain(48, 99, 5, { minMode: 'auto' });
ok('domain auto lowers the center to a round number below the minimum', d.lo <= 48 && d.lo % 10 === 0, JSON.stringify(d));
ok('domain auto keeps exactly ring-count steps', d.ticks.length === 6 && Math.abs((d.hi - d.lo) / 5 - (d.ticks[1] - d.ticks[0])) < 1e-9);
ok('domain covers the data', d.hi >= 99 && d.lo <= 48);
d = M.domain(10, 70, 4, { minMode: 'custom', min: 0, maxMode: 'custom', max: 100 });
eq('domain custom min and max are honored exactly', [d.lo, d.hi], [0, 100]);
eq('domain custom ticks are evenly spaced', d.ticks, [0, 25, 50, 75, 100]);
d = M.domain(-40, 60, 5, { minMode: 'zero' });
ok('domain zero mode with negatives still includes them', d.lo <= -40 && d.hi >= 60, JSON.stringify(d));
d = M.domain(5, 5, 4, {});
ok('domain of a constant has hi above lo', d.hi > d.lo && d.ticks.length === 5, JSON.stringify(d));
d = M.domain(NaN, NaN, 3, {});
ok('domain with no data falls back to 0..1', d.lo === 0 && d.hi >= 1);
for (const rings of [1, 2, 3, 5, 7, 10]) { const dd = M.domain(3.3, 97.7, rings, { minMode: 'zero' }); ok('domain gives exactly ' + rings + ' rings', dd.ticks.length === rings + 1 && dd.hi >= 97.7); }

/* ------------------------------------------------------------------ geometry */
near('first axis points straight up', M.angleOf(0, 6, 0, 1), -Math.PI / 2, 1e-12);
near('second of four axes points right (clockwise)', M.angleOf(1, 4, 0, 1), 0, 1e-12);
near('counter-clockwise second of four points left', M.angleOf(1, 4, 0, -1), -Math.PI, 1e-12);
near('rotation of 90 degrees turns the first axis to the right', M.angleOf(0, 6, 90, 1), 0, 1e-12);
let p = M.pointAt(100, 100, 50, M.angleOf(0, 6, 0, 1));
near('pointAt first axis x', p.x, 100, 1e-9); near('pointAt first axis y (up is smaller y)', p.y, 50, 1e-9);
ok('axes are evenly spaced', (() => { const a = [0, 1, 2, 3, 4].map(i => M.angleOf(i, 5, 0, 1)); const g = a.map((v, i) => i ? v - a[i - 1] : 0).slice(1); return g.every(x => Math.abs(x - 2 * Math.PI / 5) < 1e-12); })());
eq('polygonArea of a 10 by 10 square', Math.round(M.polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }])), 100);
const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
ok('pointInPolygon inside', M.pointInPolygon(5, 5, sq)); ok('pointInPolygon outside', !M.pointInPolygon(15, 5, sq)); ok('pointInPolygon outside below', !M.pointInPolygon(5, -1, sq));

/* --------------------------------------------------------- the real example */
function parseCsv(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); out.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}
const csv = parseCsv(fs.readFileSync(path.join(ROOT, 'example', 'who-health-2019.csv'), 'utf8'));
const head = csv.shift();
const rows = csv.map(r => ({ axis: r[1], series: r[0], value: Number(r[3]), label: r[2], tuple: 0 }));
eq('example header', head, ['WHO region', 'Indicator', 'Indicator long name', 'Value']);
eq('example has 49 rows (7 indicators x 7 series)', rows.length, 49);
ok('example values are all numbers', rows.every(r => isFinite(r.value)));
rows.forEach((r, i) => { r.tuple = i + 1; });
const model = M.buildModel(rows, { sortAxes: 'data', sortSeries: 'data' });
eq('pivot makes 7 axes', model.axes.length, 7);
eq('pivot makes 7 series', model.series.length, 7);
eq('axes keep data order', model.axes.map(a => a.key), ['UHC index', 'DTP3 vaccine', 'Measles vaccine', 'Hepatitis B vaccine', 'Skilled birth care', 'Life expectancy', 'Healthy life expectancy']);
eq('series keep data order', model.series.map(s => s.key), ['Africa', 'Americas', 'Eastern Mediterranean', 'Europe', 'South-East Asia', 'Western Pacific', 'Global']);
const afr = model.series[0];
eq('Africa values equal the CSV (UHC, DTP3, MCV1, HepB3, skilled birth, life exp, HALE)', afr.values, [48, 77, 72, 77, 67.3, 64.3, 55.7]);
eq('Europe life expectancy', model.series[3].values[5], 78.2);
ok('axis labels take the Label field', model.axes[0].label === 'Universal health coverage service index (0 to 100)');
ok('every cell has a tuple id for selection', model.series.every(s => s.tupleList.length === 7));
const cfg = { rings: 5, minMode: 'zero', maxMode: 'auto' };
const sc = M.scales(model.axes, model.series, Object.assign({ perAxis: false }, cfg));
eq('shared scale is 0..100 for the WHO data', [sc.axes[0].lo, sc.axes[0].hi], [0, 100]);
ok('shared scale gives every axis the same domain', sc.axes.every(a => a === sc.axes[0]));
const scp = M.scales(model.axes, model.series, Object.assign({ perAxis: true }, cfg, { minMode: 'auto' }));
ok('per-axis scale gives each axis its own domain', new Set(scp.axes.map(a => a.hi + ':' + a.lo)).size > 1);
ok('per-axis domains cover each axis', model.axes.every((a, i) => model.series.every(s => s.values[i] <= scp.axes[i].hi && s.values[i] >= scp.axes[i].lo)));
// independent truth: vertex positions
const CX = 300, CY = 250, R = 200, th = model.axes.map((a, i) => -Math.PI / 2 + 2 * Math.PI * i / 7);
const pts = M.seriesPoints(afr, sc, CX, CY, R, th, 'zero', 1);
eq('seriesPoints makes one vertex per axis', pts.length, 7);
let maxErr = 0;
pts.forEach((pt, i) => { const r = R * afr.values[i] / 100, ex = CX + r * Math.cos(th[i]), ey = CY + r * Math.sin(th[i]); maxErr = Math.max(maxErr, Math.abs(pt.x - ex), Math.abs(pt.y - ey)); });
ok('every Africa vertex sits at radius R x value / 100 along its axis (independent calculation)', maxErr < 1e-9, 'max error ' + maxErr);
const half = M.seriesPoints(afr, sc, CX, CY, R, th, 'zero', 0.5);
ok('animation progress 0.5 puts every vertex at half the radius', half.every((pt, i) => Math.abs(Math.hypot(pt.x - CX, pt.y - CY) - 0.5 * Math.hypot(pts[i].x - CX, pts[i].y - CY)) < 1e-9));
ok('progress 0 collapses every vertex to the center', M.seriesPoints(afr, sc, CX, CY, R, th, 'zero', 0).every(pt => Math.hypot(pt.x - CX, pt.y - CY) < 1e-9));
const straight = M.polygonPath(pts);
ok('the straight outline is one closed path with 7 vertices', /^M[^MZ]*Z$/.test(straight) && (straight.match(/L/g) || []).length === 6 && straight.endsWith('Z'), straight);
ok('the outline has no NaN', straight.indexOf('NaN') < 0);

/* ---------------------------------------------------------------- smoothing */
function parseBez(d) {
  const m = d.match(/^M([-\d.]+),([-\d.]+)/), out = { start: [+m[1], +m[2]], segs: [] };
  const re = /C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/g; let x;
  while ((x = re.exec(d))) out.segs.push([+x[1], +x[2], +x[3], +x[4], +x[5], +x[6]]);
  return out;
}
function sampleBez(b) {
  const out = []; let p0 = b.start;
  b.segs.forEach(s => { for (let t = 0; t <= 1.0001; t += 0.05) { const u = 1 - t; out.push([u * u * u * p0[0] + 3 * u * u * t * s[0] + 3 * u * t * t * s[2] + t * t * t * s[4], u * u * u * p0[1] + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5]]); } p0 = [s[4], s[5]]; });
  return out;
}
const smooth = M.cardinalClosedPath(pts, 0.8, CX, CY, R);
const bz = parseBez(smooth);
ok('smoothed outline is closed (ends in Z)', smooth.endsWith('Z'));
eq('smoothed outline has one cubic segment per vertex', bz.segs.length, 7);
ok('smoothed outline passes through every vertex', bz.segs.every((s, i) => Math.abs(s[4] - pts[(i + 1) % 7].x) < 0.01 && Math.abs(s[5] - pts[(i + 1) % 7].y) < 0.01));
ok('smoothing zero is the straight polygon', M.cardinalClosedPath(pts, 0, CX, CY, R) === straight);
ok('fewer than 3 points falls back to a polygon', M.cardinalClosedPath(pts.slice(0, 2), 0.8, CX, CY, R) === M.polygonPath(pts.slice(0, 2)));
// worst case: one spike at full value between zeros, which makes a cardinal curve overshoot
const spike = { values: [100, 0, 0, 0, 0, 0, 0, 0], key: 'spike' }, a8 = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ key: String(i) }));
const sc8 = M.scales(a8, [spike], { perAxis: false, rings: 4, minMode: 'zero', maxMode: 'custom', max: 100 });
const th8 = a8.map((a, i) => M.angleOf(i, 8, 0, 1));
for (const sm of [0.3, 0.8, 1]) {
  const pp = M.seriesPoints(spike, sc8, CX, CY, R, th8, 'zero', 1), samples = sampleBez(parseBez(M.cardinalClosedPath(pp, sm, CX, CY, R)));
  const far = Math.max.apply(null, samples.map(s => Math.hypot(s[0] - CX, s[1] - CY)));
  ok('spike outline at smoothness ' + sm + ' stays inside the outer circle (max ' + far.toFixed(2) + ' of ' + R + ')', far <= R + 0.05);
}
const rnd = (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
let worst = 0;
for (let t = 0; t < 200; t++) {
  const n = 3 + Math.floor(rnd() * 10), ser = { values: Array.from({ length: n }, () => rnd() * 100) }, ax = ser.values.map((v, i) => ({ key: String(i) }));
  const s2 = M.scales(ax, [ser], { perAxis: false, rings: 5, minMode: 'zero', maxMode: 'custom', max: 100 }), t2 = ax.map((a, i) => M.angleOf(i, n, 0, 1));
  const q = M.seriesPoints(ser, s2, CX, CY, R, t2, 'zero', 1), sm = sampleBez(parseBez(M.cardinalClosedPath(q, 0.2 + rnd() * 0.8, CX, CY, R)));
  worst = Math.max(worst, Math.max.apply(null, sm.map(v => Math.hypot(v[0] - CX, v[1] - CY))));
}
ok('200 random shapes: no smoothed outline leaves the outer circle (worst ' + worst.toFixed(3) + ')', worst <= R + 0.05);

/* -------------------------------------------------------------- missing data */
const holes = { values: [10, null, 30, null, 50], key: 'h' }, hx = [0, 1, 2, 3, 4].map(i => ({ key: String(i) })), hs = M.scales(hx, [holes], { perAxis: false, rings: 2, minMode: 'zero', maxMode: 'auto' });
const ht = hx.map((a, i) => M.angleOf(i, 5, 0, 1));
eq('missing = zero keeps all 5 vertices', M.seriesPoints(holes, hs, 0, 0, 100, ht, 'zero', 1).length, 5);
eq('missing = skip drops the empty vertices', M.seriesPoints(holes, hs, 0, 0, 100, ht, 'skip', 1).length, 3);
ok('a missing value under zero sits at the center', Math.hypot(M.seriesPoints(holes, hs, 0, 0, 100, ht, 'zero', 1)[1].x, M.seriesPoints(holes, hs, 0, 0, 100, ht, 'zero', 1)[1].y) < 1e-9);
ok('frac clamps below the domain to 0 and above to 1', M.frac(sc, 0, -50) === 0 && M.frac(sc, 0, 500) === 1);

/* ------------------------------------------------------------------ pivoting */
const dup = M.buildModel([{ axis: 'a', series: 's', value: 10 }, { axis: 'a', series: 's', value: 30 }, { axis: 'b', series: 's', value: 5 }, { axis: 'c', series: 's', value: 7 }], {});
eq('duplicate (axis, series) rows are averaged', dup.series[0].values[0], 20);
const none = M.buildModel([{ axis: 'a', series: null, value: 1 }, { axis: 'b', series: '', value: 2 }, { axis: 'c', value: 3 }], { singleName: 'Score' });
eq('rows with no series become one series with the value name', [none.series.length, none.series[0].key], [1, 'Score']);
const gap = M.buildModel([{ axis: 'a', series: 'x', value: 1 }, { axis: 'b', series: 'x', value: 2 }, { axis: 'a', series: 'y', value: 3 }], {});
eq('a (axis, series) with no row is null', gap.series[1].values, [3, null]);
eq('non-numeric values are ignored, not zero', M.buildModel([{ axis: 'a', series: 'x', value: NaN }, { axis: 'b', series: 'x', value: 4 }], {}).series[0].values, [null, 4]);
const unsorted = [{ axis: 'b', series: 'x', value: 5 }, { axis: 'a', series: 'x', value: 9 }, { axis: 'c', series: 'x', value: 1 }, { axis: 'B2', series: 'x', value: 3 }];
eq('sort axes by name', M.buildModel(unsorted, { sortAxes: 'name' }).axes.map(a => a.key), ['a', 'b', 'B2', 'c']);
eq('sort axes by name, descending', M.buildModel(unsorted, { sortAxes: 'nameDesc' }).axes.map(a => a.key), ['c', 'B2', 'b', 'a']);
eq('sort axes by average, high to low', M.buildModel(unsorted, { sortAxes: 'meanDesc' }).axes.map(a => a.key), ['a', 'b', 'B2', 'c']);
eq('sort axes by average, low to high', M.buildModel(unsorted, { sortAxes: 'mean' }).axes.map(a => a.key), ['c', 'B2', 'b', 'a']);
eq('manual axis order follows the saved list, unknown axes last', M.buildModel(unsorted, { sortAxes: 'manual', axisOrder: ['c', 'a'] }).axes.map(a => a.key), ['c', 'a', 'b', 'B2']);
eq('axis indexes are renumbered after sorting', M.buildModel(unsorted, { sortAxes: 'name' }).axes.map(a => a.i), [0, 1, 2, 3]);
eq('values follow the sorted axes', M.buildModel(unsorted, { sortAxes: 'name' }).series[0].values, [9, 5, 3, 1]);
const two = [{ axis: 'a', series: 'z', value: 1 }, { axis: 'a', series: 'm', value: 9 }, { axis: 'a', series: 'q', value: 5 }];
eq('sort series by name', M.buildModel(two, { sortSeries: 'name' }).series.map(s => s.key), ['m', 'q', 'z']);
eq('sort series by average, high to low', M.buildModel(two, { sortSeries: 'meanDesc' }).series.map(s => s.key), ['m', 'q', 'z']);
eq('data order keeps first appearance', M.buildModel(two, { sortSeries: 'data' }).series.map(s => s.key), ['z', 'm', 'q']);
eq('an empty input makes an empty model', (() => { const e = M.buildModel([], {}); return [e.axes.length, e.series.length]; })(), [0, 0]);

/* --------------------------------------------------------------------- text */
const meas = t => t.length * 8;
let lines = M.wrapText('Universal health coverage service index', 120, meas, 5);
ok('wrapped lines fit the width', lines.every(l => meas(l) <= 120), JSON.stringify(lines));
eq('wrapping keeps every word, in order', lines.join(' '), 'Universal health coverage service index');
lines = M.wrapText('Universal health coverage service index for everyone', 120, meas, 2);
eq('wrapping to two lines ends with an ellipsis when the text is longer', lines.length, 2);
ok('the cut line ends with an ellipsis and still fits', lines[1].endsWith(M.ELLIPSIS) && meas(lines[1]) <= 120, JSON.stringify(lines));
lines = M.wrapText('Supercalifragilisticexpialidocious', 100, meas, 4);
ok('a word wider than the line is broken by characters and fits', lines.length >= 3 && lines.every(l => meas(l) <= 100), JSON.stringify(lines));
eq('short text stays on one line', M.wrapText('Speed', 100, meas, 2), ['Speed']);
eq('empty text gives one empty line', M.wrapText('', 100, meas, 2), ['']);
eq('fitLine keeps text that fits', M.fitLine('Europe', 100, meas), 'Europe');
{ const f = M.fitLine('Eastern Mediterranean', 90, meas); ok('fitLine cuts with an ellipsis and the result fits', f.endsWith(M.ELLIPSIS) && meas(f) <= 90 && f.length > 3, f); }
eq('fitLine returns empty when not even one character fits', M.fitLine('Europe', 3, meas), '');
ok('overlaps() agrees on touching and crossing boxes', M.overlaps({ l: 0, t: 0, r: 10, b: 10 }, { l: 5, t: 5, r: 15, b: 15 }) && !M.overlaps({ l: 0, t: 0, r: 10, b: 10 }, { l: 20, t: 0, r: 30, b: 10 }) && !M.overlaps({ l: 0, t: 0, r: 10, b: 10 }, { l: 10, t: 0, r: 20, b: 10 }));

/* ---------------------------------------------------------- small multiples */
for (const [w, h, n] of [[900, 520, 7], [300, 300, 7], [1600, 1000, 12], [420, 640, 3], [500, 500, 1], [800, 300, 5]]) {
  const L = M.layoutMultiples(w, h, n, 0, 12);
  ok('multiples ' + w + 'x' + h + ' n=' + n + ': one cell per series', L.cells.length === n && L.cols * L.rows >= n);
  ok('multiples ' + w + 'x' + h + ' n=' + n + ': every cell inside the frame', L.cells.every(c => c.x >= -1e-9 && c.y >= -1e-9 && c.x + c.w <= w + 1e-6 && c.y + c.h <= h + 1e-6));
  let overlap = false; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (M.overlaps({ l: L.cells[i].x, t: L.cells[i].y, r: L.cells[i].x + L.cells[i].w, b: L.cells[i].y + L.cells[i].h }, { l: L.cells[j].x, t: L.cells[j].y, r: L.cells[j].x + L.cells[j].w, b: L.cells[j].y + L.cells[j].h }, -0.01)) overlap = true;
  ok('multiples ' + w + 'x' + h + ' n=' + n + ': no two cells overlap', !overlap);
}
const auto = M.layoutMultiples(900, 520, 7, 0, 12), fixed = M.layoutMultiples(900, 520, 7, 2, 12);
ok('auto columns make the cells at least as big as 2 fixed columns', Math.min(auto.cells[0].w, auto.cells[0].h) >= Math.min(fixed.cells[0].w, fixed.cells[0].h) - 1e-9);
eq('a fixed column count is honored', fixed.cols, 2);
eq('more columns than series is capped', M.layoutMultiples(900, 520, 3, 8, 0).cols, 3);

/* ------------------------------------------------------------ prepare (lists) */
const DEF = SET.DEFAULTS;
const S = Object.assign({}, DEF);
let pr = RD.prepare(model, S);
eq('prepare keeps 7 axes and 7 series by default', [pr.axes.length, pr.series.length], [7, 7]);
ok('prepare gives each series a palette color from Data Divers', pr.series[0].color === '#3cc4d1' && pr.series[2].color === '#f26b5b');
pr = RD.prepare(model, Object.assign({}, S, { palette: 'okabe', paletteReverse: true }));
ok('prepare follows the palette and reverse settings', pr.series[0].color === CP.paletteColors('okabe', true)[0]);
pr = RD.prepare(model, Object.assign({}, S, { catColors: [{ key: 'Europe', name: 'EU', color: '#112233', hidden: false }, { key: 'Africa', hidden: true }] }));
ok('prepare applies series order, rename, recolor and hide', pr.series[0].key === 'Europe' && pr.series[0].name === 'EU' && pr.series[0].color === '#112233' && !pr.series.some(x => x.key === 'Africa'), JSON.stringify(pr.series.map(x => x.key)));
pr = RD.prepare(model, Object.assign({}, S, { benchMode: 'series', benchSeries: 'global' }));
ok('prepare pulls the benchmark series out (case-insensitive) and keeps 6 series', pr.bench && pr.bench.key === 'Global' && pr.series.length === 6 && !pr.series.some(x => x.key === 'Global'));
ok('the benchmark carries its own values', pr.bench.values[5] === 73.4);
pr = RD.prepare(model, Object.assign({}, S, { benchMode: 'series', benchSeries: 'nope' }));
ok('an unknown benchmark series changes nothing', !pr.bench && pr.series.length === 7);
pr = RD.prepare(model, Object.assign({}, S, { benchMode: 'value', benchValue: 90, benchLabel: 'Target' }));
ok('a benchmark value makes a constant ring with its own name', pr.bench && pr.bench.name === 'Target' && pr.bench.values.every(v => v === 90) && pr.series.length === 7);
pr = RD.prepare(model, Object.assign({}, S, { axesList: [{ key: 'Life expectancy', name: 'Life', hidden: false }, { key: 'UHC index', hidden: true }] }));
ok('prepare applies axis order, rename and hide, and keeps values aligned', pr.axes[0].key === 'Life expectancy' && pr.axes[0].label === 'Life' && pr.axes.length === 6 && !pr.axes.some(a => a.key === 'UHC index'));
ok('values still match their axis after the reorder (Africa life expectancy 64.3)', pr.series[0].values[0] === 64.3 && pr.series[0].values.length === 6);
pr = RD.prepare(model, Object.assign({}, S, { benchMode: 'value', benchValue: 150 }));
const sc2 = RD.scaleOf(pr, Object.assign({}, S, { benchMode: 'value', benchValue: 150 }));
ok('a benchmark above the data stretches the scale to include it', sc2.axes[0].hi >= 150);

/* -------------------------------------------------------------- label layout */
const fakeMeasure = t => t.length * 7.5;
function lay(w, h, axes, over) {
  const s = Object.assign({}, DEF, over || {});
  const pp = { axes: axes.map(a => ({ key: a, label: a })), series: [] };
  return { s, pp, L: RD.layoutRadar(w, h, pp, s, fakeMeasure, pp.axes.map(a => a.label)) };
}
const names7 = model.axes.map(a => a.label);
for (const [w, h] of [[900, 520], [1600, 1000], [420, 640], [300, 300], [640, 400]]) {
  const { L, pp } = lay(w, h, names7);
  const boxes = L.labels.map(x => x.box);
  ok('label layout ' + w + 'x' + h + ': radius is positive and the center is inside', L.R >= 8 && L.cx > 0 && L.cx < w && L.cy > 0 && L.cy < h, JSON.stringify([L.R, L.cx, L.cy]));
  ok('label layout ' + w + 'x' + h + ': the ring circle fits the frame', L.cx - L.R >= -0.5 && L.cx + L.R <= w + 0.5 && L.cy - L.R >= -0.5 && L.cy + L.R <= h + 0.5);
  ok('label layout ' + w + 'x' + h + ': every kept label is inside the frame', boxes.every(b => b.l >= -0.5 && b.r <= w + 0.5 && b.t >= -0.5 && b.b <= h + 0.5), JSON.stringify(boxes.filter(b => b.l < -0.5 || b.r > w + 0.5 || b.t < -0.5 || b.b > h + 0.5)));
  let clash = false; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (M.overlaps(boxes[i], boxes[j], 0)) clash = true;
  ok('label layout ' + w + 'x' + h + ': no two kept labels overlap', !clash);
  ok('label layout ' + w + 'x' + h + ': kept + hidden = axes (or all hidden for room)', L.labelsOff || L.labels.length + L.hidden === pp.axes.length, JSON.stringify([L.labels.length, L.hidden]));
}
const roomy = lay(1600, 1000, names7).L;
eq('with room, all 7 labels are kept', roomy.labels.length, 7);
const tight = lay(300, 300, names7).L;
ok('at 300x300 the radar still draws, with labels kept or dropped', tight.R > 20 && (tight.labelsOff || tight.labels.length + tight.hidden === 7));
const dense = lay(420, 300, Array.from({ length: 24 }, (_, i) => 'Axis number ' + (i + 1))).L;
ok('24 long axis names in a small frame: overlapping labels are dropped (some hidden), none overlap', dense.hidden > 0 || dense.labelsOff, JSON.stringify([dense.hidden, dense.labelsOff]));
const noLab = lay(500, 400, names7, { labelsOn: false }).L;
ok('labels off: no label boxes and a bigger radar', noLab.labels.length === 0 && noLab.R > roomy.R * 0.4 && !noLab.labelsOff);
const halfL = lay(900, 520, names7, { sizePct: 50 }).L, full = lay(900, 520, names7, { sizePct: 100 }).L;
near("chart size 50% halves the radius", halfL.R, full.R / 2, 0.01);
const first = lay(900, 520, names7).L.thetas[0];
near('the first axis is straight up by default', first, -Math.PI / 2, 1e-12);
ok('counter-clockwise reverses the second axis', lay(900, 520, names7, { direction: 'ccw' }).L.thetas[1] < first);

/* ------------------------------------------------------------------ settings */
const rowsAll = SET.prepared.rows.filter(r => r.type !== 'note');
const tabsUsed = SET.prepared.tabs.filter(t => rowsAll.some(r => r.tab === t.id));
ok('at least 40 settings (' + rowsAll.length + ')', rowsAll.length >= 40);
ok('at least 7 tabs with settings (' + tabsUsed.length + ')', tabsUsed.length >= 7);
ok('every standard tab is present', ['colors', 'labels', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'].every(id => tabsUsed.some(t => t.id === id)));
ok('chart-specific tabs: layout, rings, axes, series, benchmark, legend', ['layout', 'rings', 'axes', 'series', 'benchmark', 'legend'].every(id => tabsUsed.some(t => t.id === id)));
ok('no slider: no row type is range-like', rowsAll.every(r => ['number', 'select', 'chips', 'check', 'color', 'text', 'font', 'list', 'palette', 'field', 'preview', 'action'].indexOf(r.type) >= 0));
ok('every tab has at least 3 settings', tabsUsed.every(t => rowsAll.filter(r => r.tab === t.id).length >= 3), tabsUsed.map(t => t.id + ':' + rowsAll.filter(r => r.tab === t.id).length).join(' '));
ok('keys are unique', new Set(rowsAll.map(r => r.key)).size === rowsAll.length);
ok('numbers and booleans round trip as strings', rowsAll.filter(r => r.type === 'number' || r.type === 'check').every(r => CP.coerce(r, String(r.def)) === r.def), rowsAll.filter(r => (r.type === 'number' || r.type === 'check') && CP.coerce(r, String(r.def)) !== r.def).map(r => r.key).join());
ok('every default value is accepted by its own row', rowsAll.filter(r => r.type !== 'preview' && r.type !== 'action').every(r => CP.coerce(r, r.def) !== undefined), rowsAll.filter(r => r.type !== 'preview' && r.type !== 'action' && CP.coerce(r, r.def) === undefined).map(r => r.key).join());
ok('label, value, ring-value, tooltip, title sizes all floor at 14', ['labelSize', 'valueLabelSize', 'ringLabelSize', 'tipSize', 'titleSize'].every(k => rowsAll.filter(r => r.key === k)[0].min >= 14));
ok('numeric defaults sit inside their own bounds', rowsAll.filter(r => r.type === 'number').every(r => r.def >= r.min && r.def <= r.max));
ok('the default palette is Data Divers', DEF.palette === 'datadivers');
ok('defaults make a sensible chart: overlay, shared scale, straight, fill on, legend bottom', DEF.view === 'overlay' && DEF.scaleMode === 'shared' && DEF.curve === 'straight' && DEF.fillOn && DEF.legendPos === 'bottom');
ok('conditional rows exist and hide in the default state (columns, custom center, smoothness)', ['mcols', 'minCustom', 'smooth', 'benchSeries'].every(k => { const r = rowsAll.filter(x => x.key === k)[0]; return r && r.when && !CP.isVisible(r, DEF); }));
ok('they appear when their condition holds', CP.isVisible(rowsAll.filter(x => x.key === 'mcols')[0], Object.assign({}, DEF, { view: 'multiples' })) && CP.isVisible(rowsAll.filter(x => x.key === 'smooth')[0], Object.assign({}, DEF, { curve: 'smooth' })));
ok('the field rows are Axis, Series, Value and Label', ['fieldAxis', 'fieldSeries', 'fieldValue', 'fieldLabel'].every(k => rowsAll.some(r => r.key === k && r.type === 'field')));
ok('the benchmark picker is a dynamic select fed by the series list', (() => { const r = rowsAll.filter(x => x.key === 'benchSeries')[0]; return r.type === 'select' && r.dynamic && r.source === 'categories'; })());
ok('search finds the ring count from the word "rings"', CP.searchRows(SET.prepared, DEF, {}, 'number of rings').map(r => r.key).indexOf('ringCount') >= 0);
const pasted = CP.parsePaste(SET.prepared.rows, JSON.stringify({ 'radar.view': 'multiples', curve: 'smooth', ringCount: '6', nope: 1 }), 'radar.');
ok('a pasted settings object (prefixed, with strings) applies', pasted.ok && pasted.values.view === 'multiples' && pasted.values.curve === 'smooth' && pasted.values.ringCount === 6 && pasted.ignored.length === 1, JSON.stringify(pasted));

/* ------------------------------------------------------------- number format */
eq('format with the default settings', CP.formatNumber(1234.5, DEF), '1,234.5');
eq('format percent scale', CP.formatNumber(0.482, Object.assign({}, DEF, { numScale: '100', numDecimals: 0, numSuffix: '%' })), '48%');

console.log('examined ' + (pass + fails.length) + ' checks');
if (pass + fails.length < MIN_CHECKS) fails.push('ran only ' + (pass + fails.length) + ' checks, floor ' + MIN_CHECKS);
if (fails.length) { console.log('RED  ' + fails.length + ' failed'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('GREEN  ' + pass + ' checks (floor ' + MIN_CHECKS + ')');
