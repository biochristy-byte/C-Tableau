/* Depth Lines unit tests: the maths, with no DOM and no Tableau. Run: node test/run.js
 * Every check names what it examined. The run goes RED if it examined fewer than
 * MIN_CHECKS subjects, so a run that silently skipped things cannot pass. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['lib/d3-array.min.js', 'lib/d3-contour.min.js', 'lib/ctab-panel/ctab-panel.js', 'src/js/core.js', 'src/js/settings.js', 'src/js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const { HX, DL, d3, CTabPanel: CP } = sandbox;
const E = DL.engine, S = DL.settings;

const MIN_CHECKS = 60;
let n = 0; const fails = [];
function ok (name, cond, detail) { n++; if (!cond) fails.push(name + (detail ? '\n    ' + detail : '')); }
function eq (name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function near (name, a, b, tol) { ok(name, Math.abs(a - b) <= tol, 'expected ~' + b + ' got ' + a); }

/* seeded gaussian so the data never changes */
function rng (seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function gauss (r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
function blob (seed, cx, cy, sx, sy, count, w) {
  const r = rng(seed), out = [];
  for (let i = 0; i < count; i++) out.push({ px: cx + gauss(r) * sx, py: cy + gauss(r) * sy, w: w || 1, id: i + 1 });
  return out;
}
try {
const base = S.DEFAULTS;
const W = 500, H = 400;
function area (coords) { // polygon area, outer rings minus holes
  let a = 0;
  coords.forEach(poly => poly.forEach((ring, ri) => {
    let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    a += (ri === 0 ? 1 : -1) * Math.abs(s) / 2;
  }));
  return a;
}

/* ---------------- core: color and contrast */
near('contrast black on white is 21', HX.contrast('#000000', '#ffffff'), 21, 0.001);
near('contrast same color is 1', HX.contrast('#336699', '#336699'), 1, 0.001);
eq('pickText on white is dark ink', HX.pickText('#ffffff'), HX.INK_DARK);
eq('pickText on navy is light ink', HX.pickText('#081f33'), HX.INK_LIGHT);
['#ffffff', '#081f33', '#000000', '#f2f2f2', '#0d2b45', '#fdf6e3'].forEach(bg =>
  ok('ink on ' + bg + ' reaches 7:1', HX.contrast(HX.pickText(bg), bg) >= 7, String(HX.contrast(HX.pickText(bg), bg))));
eq('parseColor short hex', HX.parseColor('#fa0'), [255, 170, 0]);
eq('parseColor rgb()', HX.parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
eq('parseColor rejects junk', HX.parseColor('banana'), null);
eq('mix midpoint', HX.mix('#000000', '#ffffff', 0.5), '#808080');
eq('isDark navy', HX.isDark('#081f33'), true);
eq('isDark white', HX.isDark('#ffffff'), false);

/* ---------------- core: numbers and ticks */
eq('formatNumber thousands separators', HX.formatNumber(1234), '1,234');
eq('formatNumber compact K', HX.formatNumber(84210), '84.2K');
eq('formatNumber compact M', HX.formatNumber(4830000), '4.83M');
eq('formatNumber step decimals', HX.formatNumber(0.05, 0.01), '0.05');
eq('formatNumber zero', HX.formatNumber(0, 0.5), '0');
eq('formatNumber NaN is blank', HX.formatNumber(NaN), '');
const tk = HX.ticks(0, 100, 5);
eq('ticks nice 0..100', Array.from(tk), [0, 20, 40, 60, 80, 100]);
ok('ticks stay inside the range', HX.ticks(3.2, 17.9, 6).every(t => t >= 3.2 && t <= 17.9));
eq('ticks of a flat range', Array.from(HX.ticks(5, 5, 4)), [5]);

/* ---------------- settings: Tableau stores every setting as a string */
const rowOf = k => S.prepared.rows.find(r => r.key === k);
const co = (k, v) => CP.coerce(rowOf(k), v);
eq('settings coerce "9" to a number', co('levels', '9'), 9);
eq('settings clamp labelSize to the 14px floor', co('labelSize', '9'), 14);
eq('settings coerce "false" to boolean', co('fill', 'false'), false);
eq('settings coerce "true" to boolean', co('points', 'true'), true);
eq('settings reject a bad choice', co('multi', 'nonsense'), undefined);
eq('settings clamp levels to 24', co('levels', '999'), 24);
eq('settings clamp bandwidth to 0.5', co('bandwidth', '0'), 0.5);
eq('settings keep a valid hex color', co('bgColor', '#abcdef'), '#abcdef');
eq('settings reject a bad hex', co('bgColor', 'zzz'), undefined);
ok('no row is a slider', S.prepared.rows.every(r => ['check', 'number', 'chips', 'select', 'color', 'text', 'font', 'palette', 'field', 'list', 'note', 'preview', 'action'].includes(r.type)));
ok('every number row that carries text has a 14px floor', ['labelSize', 'valueLabelSize', 'tipSize', 'titleSize'].every(k => rowOf(k).min >= 14));
const nSet = S.KEYS.length;
ok('at least 40 settings (' + nSet + ')', nSet >= 40);
const tabsUsed = new Set(S.prepared.rows.map(r => r.tab));
ok('at least 7 tabs carry settings (' + tabsUsed.size + ')', tabsUsed.size >= 7);
ok('the standard tabs are all present', ['colors', 'labels', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'].every(t => S.schema.tabs.some(x => x.id === t)));
ok('chart tabs: contours, bands, points, category, axes, grid, legend', ['contours', 'bands', 'points', 'category', 'axes', 'grid', 'legend'].every(t => S.schema.tabs.some(x => x.id === t)));
ok('every old saved key still exists or has a LEGACY entry', ['bandwidth', 'levels', 'floor', 'fill', 'lines', 'lineWidth', 'sea', 'points', 'pointSize', 'pointOpacity', 'multi', 'scale', 'cols', 'ramp', 'reverse', 'lineInk', 'axes', 'axisTitles', 'grid', 'legend', 'showGear'].every(k => S.KEYS.includes(k))
  && ['fontSize', 'title', 'theme', 'catPalette', 'selectEnabled', 'hoverEnabled'].every(k => S.LEGACY.some(m => m.old === k)));
/* the old key is read as a fallback: run each LEGACY map */
const lg = k => S.LEGACY.find(m => m.old === k).map;
eq('LEGACY fontSize 18 -> labelSize 18 and titleSize 23', lg('fontSize')('18'), { labelSize: 18, titleSize: 23 });
eq('LEGACY title "Hi" -> titleText and showTitle', lg('title')('Hi'), { titleText: 'Hi', showTitle: true });
eq('LEGACY empty title carries nothing', lg('title')(''), null);
eq('LEGACY theme dark -> custom navy background', lg('theme')('dark'), { bgMode: 'custom', bgColor: '#081f33' });
eq('LEGACY theme light -> custom white background', lg('theme')('light'), { bgMode: 'custom', bgColor: '#ffffff' });
eq('LEGACY theme auto carries nothing (worksheet is the default)', lg('theme')('auto'), null);
eq('LEGACY catPalette okabe -> palette okabe', lg('catPalette')('okabe'), { palette: 'okabe' });
eq('LEGACY selectEnabled -> selectOn', lg('selectEnabled')('false'), { selectOn: 'false' });
eq('LEGACY hoverEnabled -> hoverPush', lg('hoverEnabled')('true'), { hoverPush: 'true' });
const fake = { _v: { 'depthlines.levels': '11', 'depthlines.fontSize': '20' }, get (k) { return this._v[k]; }, set (k, v) { this._v[k] = String(v); }, getAll () { return this._v; }, saveAsync () { return Promise.resolve(); } };
const store = CP.createStore({ rows: S.prepared.rows, settings: fake, prefix: 'depthlines.' });
store.load();
eq('a stored old key (levels 11) loads through the store', store.get().levels, 11);
ok('every default is valid for its own row', S.prepared.rows.filter(r => r.type !== 'note' && r.type !== 'list' && r.type !== 'field').every(r => CP.coerce(r, r.def) !== undefined || r.def === ''), S.prepared.rows.filter(r => r.type !== 'note' && r.type !== 'list' && r.type !== 'field' && CP.coerce(r, r.def) === undefined && r.def !== '').map(r => r.key).join());

/* ---------------- engine: ramps, scales, domains */
eq('rampColor shallow end', E.rampColor('abyss', false, 0, false), '#e2f4f7');
eq('rampColor deep end', E.rampColor('abyss', false, 1, false), '#0d2b45');
eq('rampColor reverse swaps ends', E.rampColor('abyss', false, 0, true), '#0d2b45');
eq('dark ramp deep end is the brightest', E.rampColor('abyss', true, 1, false), '#eafcfe');
ok('dark deep brighter than dark shallow', HX.luminance(HX.parseColor(E.rampColor('sunrise', true, 1))) > HX.luminance(HX.parseColor(E.rampColor('sunrise', true, 0))));
const sc = E.linear(0, 10, 0, 100);
eq('linear maps', sc(5), 50); eq('linear inverts', sc.invert(50), 5);
const dm = E.domainOf([2, 4, 6], 0.1);
near('domain pads low', dm[0], 1.6, 1e-9); near('domain pads high', dm[1], 6.4, 1e-9);
ok('domain of a flat set is not empty', E.domainOf([3, 3], 0.1)[1] > E.domainOf([3, 3], 0.1)[0]);
ok('domain of nothing is safe', E.domainOf([], 0.1)[1] > E.domainOf([], 0.1)[0]);

/* ---------------- engine: thresholds */
[2, 5, 8, 12, 24].forEach(L => {
  const t = E.thresholdsFor(1, L, 6);
  ok('thresholds: exactly ' + L + ' levels', t.length === L);
  ok('thresholds: strictly increasing at ' + L, t.every((v, i) => i === 0 || v > t[i - 1]));
  ok('thresholds: stay below the peak at ' + L, t[t.length - 1] < 1 && t[0] > 0);
});
near('thresholds start at the floor share', E.thresholdsFor(200, 4, 10)[0], 20, 1e-9);
near('thresholds end at the ceiling share', E.thresholdsFor(200, 4, 10, 80)[3], 160, 1e-9);
near('thresholds default ceiling is 95%', E.thresholdsFor(100, 4, 10)[3], 95, 1e-9);
const lin = E.thresholdsFor(1, 6, 6), lgm = E.thresholdsFor(1, 6, 6, 95, 'log');
ok('log spacing keeps the same ends as even spacing', Math.abs(lgm[0] - lin[0]) < 1e-9 && Math.abs(lgm[5] - lin[5]) < 1e-9);
ok('log spacing crowds the bands toward the shallow edge (middle band lower)', lgm[2] < lin[2] && lgm[3] < lin[3]);
ok('log spacing is strictly increasing', lgm.every((v, i) => i === 0 || v > lgm[i - 1]));

/* ---------------- engine: pure geometry */
const sq = [[[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]]]];
ok('inMulti inside the ring', E.inMulti(1, 1, sq));
ok('inMulti outside', !E.inMulti(11, 5, sq));
ok('inMulti inside a hole is outside', !E.inMulti(5, 5, sq));
ok('ringsClosed accepts a closed ring', E.ringsClosed(sq));
ok('ringsClosed REJECTS an open ring', !E.ringsClosed([[[[0, 0], [10, 0], [10, 10], [0, 10]]]]));
eq('pathOf draws every ring and closes it', E.pathOf(sq).split('Z').length - 1, 2);
eq('gridFor one panel', E.gridFor(1, 800, 600, 0), { cols: 1, rows: 1 });
const g4 = E.gridFor(4, 800, 600, 0);
ok('gridFor 4 panels covers 4 cells', g4.cols * g4.rows >= 4);
eq('gridFor honours a column preference', E.gridFor(5, 800, 600, 2), { cols: 2, rows: 3 });
const grp = E.groupPoints([{ cat: 'b' }, { cat: 'a' }, { cat: 'b' }], true);
eq('groupPoints keeps first-seen order', grp.map(g => g.key), ['b', 'a']);
eq('groupPoints counts', grp.map(g => g.points.length), [2, 1]);
eq('groupPoints without a category is one group', E.groupPoints([{}, {}], false).length, 1);

/* ---------------- engine: contours of real density */
const one = [{ key: '', index: 0, points: blob(11, 250, 200, 55, 40, 900) }];
const sBase = Object.assign({}, base, { levels: 8, bandwidth: 5 });
const b1 = E.computeBands(one, W, H, sBase)[0];
ok('contours: produced the requested band count', b1.levels.length === 8);
ok('contours: every level has geometry', b1.levels.every(l => l.coordinates.length > 0), b1.levels.map(l => l.coordinates.length).join());
ok('contours: every ring is CLOSED at every level', b1.levels.every(l => l.closed));
ok('contours: path strings are not empty', b1.levels.every(l => l.d.length > 20));
const areas = b1.levels.map(l => area(l.coordinates));
ok('contours: areas shrink from shallow to deep', areas.every((a, i) => i === 0 || a < areas[i - 1]), areas.map(a => Math.round(a)).join());
// every deep ring lies inside the shallower one: sample the deepest ring's vertices
const deepest = b1.levels[b1.levels.length - 1].coordinates[0][0];
const shallow = b1.levels[0].coordinates;
ok('contours: the deepest ring sits inside the shallowest', deepest.every(p => E.inMulti(p[0], p[1], shallow)));
ok('contours: the deepest band encloses the true centre', E.inMulti(250, 200, b1.levels[b1.levels.length - 1].coordinates));
ok('contours: the shallowest band covers most of the cloud',
  one[0].points.filter(p => E.inMulti(p.px, p.py, shallow)).length > 0.85 * one[0].points.length);
const again = E.computeBands(one, W, H, sBase)[0];
eq('contours: deterministic, same input same paths', again.levels.map(l => l.d), b1.levels.map(l => l.d));
[3, 12, 20].forEach(L => {
  const r = E.computeBands(one, W, H, Object.assign({}, sBase, { levels: L }))[0];
  ok('contours: stepper exactness at ' + L + ' levels', r.levels.length === L && r.levels.every(l => l.coordinates.length > 0 && l.closed));
});
const narrow = E.computeBands(one, W, H, Object.assign({}, sBase, { bandwidth: 2 }))[0];
const wide = E.computeBands(one, W, H, Object.assign({}, sBase, { bandwidth: 14 }))[0];
ok('bandwidth: wider spreads the outer contour', area(wide.levels[0].coordinates) > area(narrow.levels[0].coordinates));
ok('bandwidth: narrower has more separate pieces or equal', narrow.levels[3].coordinates.length >= wide.levels[3].coordinates.length);
near('bandwidth px follows the plot size', E.bandwidthPx(5, 500, 400), 20, 1e-9);
ok('bandwidth px has a floor', E.bandwidthPx(0.5, 100, 100) >= 3);

/* weights */
const heavy = [{ key: '', index: 0, points: one[0].points.map(p => Object.assign({}, p, { w: 3 })) }];
const hv = E.computeBands(heavy, W, H, sBase)[0];
near('weight: tripling every weight triples the peak', hv.max / b1.max, 3, 0.05);

/* categories: shared vs each */
const two = [{ key: 'A', index: 0, points: blob(21, 150, 200, 35, 30, 1200) }, { key: 'B', index: 1, points: blob(22, 350, 200, 55, 45, 300) }];
const shared = E.computeBands(two, W, H, Object.assign({}, sBase, { scale: 'shared' }));
const each = E.computeBands(two, W, H, Object.assign({}, sBase, { scale: 'each' }));
eq('shared: both groups use the same thresholds', shared[0].levels.map(l => l.value), shared[1].levels.map(l => l.value));
ok('each: thresholds differ between groups', each[0].levels[7].value !== each[1].levels[7].value);
ok('shared: the sparse group loses its deep bands', shared[1].levels.filter(l => l.coordinates.length).length < 8);
ok('each: the sparse group keeps all its bands', each[1].levels.every(l => l.coordinates.length > 0));
ok('each: every ring closed in both groups', each.every(g => g.levels.every(l => l.closed)));

/* tiny and degenerate input must not throw */
let threw = false;
try { E.computeBands([{ key: '', index: 0, points: [{ px: 10, py: 10, w: 1, id: 1 }, { px: 11, py: 11, w: 1, id: 2 }] }], 200, 150, sBase); } catch (e) { threw = true; }
ok('two points do not throw', !threw);
threw = false;
try { E.computeBands([{ key: '', index: 0, points: [] }], 200, 150, sBase); } catch (e) { threw = true; }
ok('zero points do not throw', !threw);

} catch (e) { fails.push('test code threw after ' + n + ' checks: ' + (e && e.message)); }

/* ---------------- report */
if (n < MIN_CHECKS) fails.push('only ' + n + ' checks ran, minimum is ' + MIN_CHECKS);
console.log(fails.length ? 'RED  ' + fails.length + ' failed of ' + n + ' checks' : 'GREEN  ' + n + ' checks, 0 failed');
fails.forEach(f => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
