/* Sketchbook unit tests: layout maths, seeds and rough.js determinism, no DOM and no Tableau.
 * Run: node test/run.js
 * Goes RED if it examined fewer than MIN_CHECKS subjects, or if the test code itself throws. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['lib/rough.js', 'lib/ctab-panel/ctab-panel.js', 'src/js/core.js', 'src/js/settings.js', 'src/js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const { HX, SB } = sandbox;
const rough = vm.runInContext('rough', sandbox);
const E = SB.engine, S = SB.settings, CP = sandbox.CTabPanel;

const MIN_CHECKS = 70;
let n = 0; const fails = [];
function ok (name, cond, detail) { n++; if (!cond) fails.push(name + (detail ? '\n    ' + detail : '')); }
function eq (name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b), 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); }
function near (name, a, b, tol) { ok(name, Math.abs(a - b) <= tol, 'expected ~' + b + ' got ' + a); }

try {
  /* ---------------- core */
  near('contrast black on white', HX.contrast('#000000', '#ffffff'), 21, 0.001);
  ['#ffffff', '#fbf6e9', '#081f33', '#000000', '#0f1b27'].forEach(bg => ok('ink on ' + bg + ' reaches 7:1', HX.contrast(HX.pickText(bg), bg) >= 7));
  eq('paper takes dark ink', HX.pickText('#fbf6e9'), HX.INK_DARK);
  eq('navy takes light ink', HX.pickText('#081f33'), HX.INK_LIGHT);
  eq('formatNumber 1,234', HX.formatNumber(1234), '1,234');
  eq('formatNumber step decimals', HX.formatNumber(2.5, 0.5), '2.5');
  eq('ticks nice', Array.from(HX.ticks(0, 90, 5)), [0, 20, 40, 60, 80]);

  /* ---------------- settings (ctab-panel rows) */
  const rowOf = k => S.prepared.rows.find(r => r.key === k);
  const co = (k, v) => CP.coerce(rowOf(k), v);
  eq('"14" becomes number', co('labelSize', '14'), 14);
  eq('labelSize floor is 14', co('labelSize', '10'), 14);
  eq('"false" becomes boolean', co('grid', 'false'), false);
  eq('seed never 0 (rough treats 0 as random)', co('seed', '0'), 1);
  eq('seed rounds to an integer', Math.round(co('seed', '41.6')), 42);
  eq('roughness clamps high', co('roughness', '99'), 5);
  eq('roughness clamps low', co('roughness', '-3'), 0);
  eq('bad fill style is refused', co('fillStyle', 'crayon'), undefined);
  eq('good fill style kept', co('fillStyle', 'zigzag'), 'zigzag');
  eq('chart types are bar, line, dot', rowOf('chartType').opts.map(o => o.value), ['bar', 'line', 'dot']);
  eq('fill styles include the three old ones first', rowOf('fillStyle').opts.map(o => o.value).slice(0, 3), ['hachure', 'solid', 'zigzag']);
  ok('no row is a slider', S.prepared.rows.every(r => ['check', 'number', 'chips', 'select', 'color', 'text', 'font', 'palette', 'field', 'list', 'note'].includes(r.type)));
  ok('every number row that carries text has a 14px floor', ['labelSize', 'valueLabelSize', 'tipSize', 'titleSize', 'legendSwatch'].every(k => rowOf(k).min >= 14));
  const nSet = S.KEYS.length;
  ok('at least 40 settings (' + nSet + ')', nSet >= 40);
  const tabsUsed = new Set(S.prepared.rows.map(r => r.tab));
  ok('at least 7 tabs carry settings (' + tabsUsed.size + ')', tabsUsed.size >= 7);
  ok('the standard tabs are all present', ['colors', 'labels', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'].every(t => S.schema.tabs.some(x => x.id === t)));
  ok('chart tabs: chart, sketch, marks, axes, grid, underline, legend', ['chart', 'sketch', 'marks', 'axes', 'grid', 'underline', 'legend'].every(t => S.schema.tabs.some(x => x.id === t)));
  ok('every old saved key still exists or has a LEGACY entry', ['chartType', 'sort', 'labels', 'zero', 'underline', 'fillStyle', 'roughness', 'bowing', 'seed', 'hachureGap', 'hachureAngle', 'strokeWidth', 'barWidth', 'lineWidth', 'lineDots', 'dotSize', 'stems', 'palette', 'color', 'axes', 'axisTitles', 'grid', 'legend', 'showGear'].every(k => S.KEYS.includes(k))
    && ['fontSize', 'title', 'theme', 'selectEnabled', 'hoverEnabled'].every(k => S.LEGACY.some(m => m.old === k)));
  const lg = k => S.LEGACY.find(m => m.old === k).map;
  eq('LEGACY fontSize 18 -> labelSize, titleSize 24 (1.35x), valueLabelSize', lg('fontSize')('18'), { labelSize: 18, titleSize: 24, valueLabelSize: 18 });
  eq('LEGACY title "Hi" -> titleText and showTitle', lg('title')('Hi'), { titleText: 'Hi', showTitle: true });
  eq('LEGACY theme paper -> custom cream background', lg('theme')('paper'), { bgMode: 'custom', bgColor: '#fbf6e9' });
  eq('LEGACY theme dark -> custom navy background', lg('theme')('dark'), { bgMode: 'custom', bgColor: '#081f33' });
  eq('LEGACY theme auto carries nothing', lg('theme')('auto'), null);
  eq('LEGACY palette ink -> the Pencil greys check', lg('palette')('ink'), { greys: true });
  eq('LEGACY palette okabe needs no carry (the key is still valid)', lg('palette')('okabe'), null);
  eq('LEGACY labels none -> value labels off', lg('labels')('none'), { valueLabels: false });
  eq('LEGACY labels value -> value labels on', lg('labels')('value'), { valueLabels: true });
  eq('LEGACY selectEnabled -> selectOn', lg('selectEnabled')('false'), { selectOn: 'false' });
  eq('LEGACY hoverEnabled -> hoverPush', lg('hoverEnabled')('true'), { hoverPush: 'true' });
  const fake = { _v: { 'sketchbook.seed': '7', 'sketchbook.palette': 'okabe' }, get (k) { return this._v[k]; }, set (k, v) { this._v[k] = String(v); }, getAll () { return this._v; }, saveAsync () { return Promise.resolve(); } };
  const store = CP.createStore({ rows: S.prepared.rows, settings: fake, prefix: 'sketchbook.' });
  store.load();
  eq('a stored old key (seed 7) loads through the store', store.get().seed, 7);
  eq('a stored old palette okabe loads as the Okabe-Ito palette', store.get().palette, 'okabe');
  eq('an old palette divers is not a valid palette id, so the default holds', (() => { fake._v['sketchbook.palette'] = 'divers'; const s2 = CP.createStore({ rows: S.prepared.rows, settings: fake, prefix: 'sketchbook.' }); s2.load(); return s2.get().palette; })(), 'datadivers');
  eq('valueDomain honours a fixed top', E.valueDomain(E.aggregate([{ cat: 'a', series: '', value: 5, label: '', id: 1 }], 'data'), 'bar', true, 5, null, 20).hi, 20);

  /* ---------------- aggregate */
  const rows = [
    { cat: 'B', series: 'x', value: 5, label: '', id: 1 }, { cat: 'A', series: 'x', value: 9, label: 'nine', id: 2 },
    { cat: 'C', series: 'x', value: 1, label: '', id: 3 }, { cat: 'A', series: 'y', value: 2, label: '', id: 4 },
    { cat: 'A', series: 'x', value: 1, label: '', id: 5 }
  ];
  const a0 = E.aggregate(rows, 'data');
  eq('data order keeps first-seen categories', a0.cats.map(c => c.key), ['B', 'A', 'C']);
  eq('series first-seen order', a0.series.map(s => s.key), ['x', 'y']);
  eq('duplicates are summed', a0.cell(a0.cats[1], a0.series[0]).value, 10);
  eq('duplicates keep every tuple id', a0.cell(a0.cats[1], a0.series[0]).ids, [2, 5]);
  eq('label survives the merge', a0.cell(a0.cats[1], a0.series[0]).label, 'nine');
  eq('a missing cell is null', a0.cell(a0.cats[0], a0.series[1]), null);
  eq('category totals add across series', a0.cats.map(c => c.total), [5, 12, 1]);
  eq('sort value-desc', E.aggregate(rows, 'value-desc').cats.map(c => c.key), ['A', 'B', 'C']);
  eq('sort value-asc', E.aggregate(rows, 'value-asc').cats.map(c => c.key), ['C', 'B', 'A']);
  eq('sort alpha', E.aggregate(rows, 'alpha').cats.map(c => c.key), ['A', 'B', 'C']);
  eq('numeric-aware alpha sort', E.aggregate([{ cat: '10', series: '', value: 1, id: 1 }, { cat: '9', series: '', value: 1, id: 2 }], 'alpha').cats.map(c => c.key), ['9', '10']);

  /* ---------------- value domain */
  const dBar = E.valueDomain(E.aggregate([{ cat: 'a', series: '', value: 37, id: 1 }, { cat: 'b', series: '', value: 82, id: 2 }], 'data'), 'bar', true, 5);
  ok('bars start at zero', dBar.lo === 0, JSON.stringify(dBar));
  ok('domain snaps up to a tick', dBar.hi >= 82 && Math.abs(dBar.hi / dBar.step - Math.round(dBar.hi / dBar.step)) < 1e-9, JSON.stringify(dBar));
  const neg = E.valueDomain(E.aggregate([{ cat: 'a', series: '', value: -5, id: 1 }, { cat: 'b', series: '', value: 3, id: 2 }], 'data'), 'bar', true, 5);
  ok('negatives widen the low end', neg.lo <= -5 && neg.hi >= 3);
  const lineNoZero = E.valueDomain(E.aggregate([{ cat: 'a', series: '', value: 70, id: 1 }, { cat: 'b', series: '', value: 80, id: 2 }], 'data'), 'line', false, 5);
  ok('a line without "zero" can start above zero', lineNoZero.lo > 0, JSON.stringify(lineNoZero));
  const lineZero = E.valueDomain(E.aggregate([{ cat: 'a', series: '', value: 70, id: 1 }, { cat: 'b', series: '', value: 80, id: 2 }], 'data'), 'line', true, 5);
  eq('a line with "zero" starts at 0', lineZero.lo, 0);
  const flat = E.valueDomain(E.aggregate([{ cat: 'a', series: '', value: 5, id: 1 }], 'data'), 'dot', false, 5);
  ok('a flat set still has a range', flat.hi > flat.lo);
  const nothing = E.valueDomain(E.aggregate([], 'data'), 'bar', true, 5);
  ok('no data has a safe range', nothing.hi > nothing.lo);

  /* ---------------- marks geometry */
  const agg = E.aggregate([
    { cat: 'a', series: 's1', value: 10, id: 1 }, { cat: 'a', series: 's2', value: 20, id: 2 },
    { cat: 'b', series: 's1', value: -10, id: 3 }, { cat: 'b', series: 's2', value: 40, id: 4 },
    { cat: 'c', series: 's1', value: 30, id: 5 }, { cat: 'c', series: 's2', value: 0, id: 6 }], 'data');
  const plot = { x: 60, y: 20, w: 600, h: 300 };
  const dom = E.valueDomain(agg, 'bar', true, 5);
  const sBar = Object.assign({}, S.DEFAULTS, { chartType: 'bar' });
  const L = E.marks(agg, plot, dom, sBar);
  eq('one mark per filled cell', L.marks.length, 6);
  const bars = L.marks;
  ok('bar heights are proportional to values', Math.abs(bars[3].h / bars[1].h - 2) < 1e-9, bars[3].h + ' / ' + bars[1].h);
  ok('positive bars sit on or above the zero line', bars.filter(m => m.value > 0).every(m => m.top + m.h <= L.zeroY + 1e-6));
  ok('negative bars hang below the zero line', bars.filter(m => m.value < 0).every(m => Math.abs(m.top - L.zeroY) < 1e-6 && m.top + m.h > L.zeroY));
  ok('a zero value is a zero-height bar', bars[5].h === 0);
  ok('every bar stays inside the plot', bars.every(m => m.x >= plot.x - 1e-6 && m.x + m.w <= plot.x + plot.w + 1e-6 && m.top >= plot.y - 1e-6 && m.top + m.h <= plot.y + plot.h + 1e-6));
  const byX = bars.slice().sort((p, q) => p.x - q.x);
  ok('no two bars overlap horizontally', byX.every((m, i) => i === 0 || m.x >= byX[i - 1].x + byX[i - 1].w - 1e-6));
  ok('grouped bars share their category band', Math.abs((bars[0].cx + bars[1].cx) / 2 - (plot.x + L.step * 0.5)) < 1e-6);
  near('zero line sits at value 0', L.sy(0), L.zeroY, 1e-9);
  near('sy maps the domain top to plot top', L.sy(dom.hi), plot.y, 1e-9);
  near('sy maps the domain bottom to plot bottom', L.sy(dom.lo), plot.y + plot.h, 1e-9);
  const sDot = Object.assign({}, S.DEFAULTS, { chartType: 'dot', dotSize: 16 });
  const LD = E.marks(agg, plot, E.valueDomain(agg, 'dot', true, 5), sDot);
  ok('dots stay inside the plot horizontally', LD.marks.every(m => m.cx - m.d / 2 >= plot.x - 1e-6 && m.cx + m.d / 2 <= plot.x + plot.w + 1e-6));
  ok('dots are never smaller than 6px or bigger than the setting', LD.marks.every(m => m.d >= 6 && m.d <= 16));
  ok('side-by-side dots in one category do not collide', Math.abs(LD.marks[0].cx - LD.marks[1].cx) >= LD.marks[0].d - 1e-6);
  const sLine = Object.assign({}, S.DEFAULTS, { chartType: 'line' });
  const LL = E.marks(agg, plot, E.valueDomain(agg, 'line', true, 5), sLine);
  ok('line points of different series share the category x', Math.abs(LL.marks[0].cx - LL.marks[1].cx) < 1e-9);
  const wide = E.marks(agg, plot, dom, Object.assign({}, sBar, { barWidth: 100 }));
  const slim = E.marks(agg, plot, dom, Object.assign({}, sBar, { barWidth: 40 }));
  ok('bar width setting changes bar width', wide.marks[0].w > slim.marks[0].w);

  /* ---------------- seeds */
  ok('seedFor is deterministic', E.seedFor(42, 3, 2, 1) === E.seedFor(42, 3, 2, 1));
  const seen = new Set(); let bad = 0, total = 0;
  for (let ci = 0; ci < 24; ci++) for (let si = 0; si < 8; si++) for (let k = 1; k <= 9; k++) { const v = E.seedFor(42, ci, si, k); total++; seen.add(v); if (!(v >= 1) || !Number.isInteger(v)) bad++; }
  ok('seedFor never returns 0 or a non-integer (' + total + ' seeds)', bad === 0);
  ok('every mark gets its own seed (' + seen.size + ' of ' + total + ')', seen.size === total);
  ok('a different base seed changes the seed', E.seedFor(1, 3, 2, 1) !== E.seedFor(2, 3, 2, 1));
  eq('truncate keeps short text', E.truncate('Japan', 10), 'Japan');
  eq('truncate adds an ellipsis', E.truncate('Saint Vincent and the Grenadines', 10), 'Saint Vin…');

  /* ---------------- rough.js: deterministic for a seed */
  const gen = rough.generator();
  const sig = (d) => JSON.stringify(gen.toPaths(d).map(p => [p.d, p.stroke, p.fill, p.strokeWidth]));
  const rect = (o) => gen.rectangle(10, 10, 120, 80, Object.assign({ fill: '#2aa9b8', fillStyle: 'hachure', roughness: 1.2, bowing: 1, hachureGap: 7, hachureAngle: -41 }, o));
  ok('same seed gives identical paths', sig(rect({ seed: 42 })) === sig(rect({ seed: 42 })));
  ok('a different seed gives different paths', sig(rect({ seed: 42 })) !== sig(rect({ seed: 43 })));
  const first = sig(rect({ seed: 7 }));
  gen.circle(50, 50, 30, { seed: 99, roughness: 2 }); gen.line(0, 0, 90, 90, { seed: 5 }); rect({ seed: 1234 });
  ok('drawing other shapes in between does not change a seeded shape', sig(rect({ seed: 7 })) === first);
  ok('roughness changes the sketch', sig(rect({ seed: 42, roughness: 3 })) !== sig(rect({ seed: 42, roughness: 0 })));
  ok('bowing changes the sketch', sig(rect({ seed: 42, bowing: 6 })) !== sig(rect({ seed: 42, bowing: 0 })));
  const sigH = sig(rect({ seed: 42, fillStyle: 'hachure' })), sigZ = sig(rect({ seed: 42, fillStyle: 'zigzag' })), sigS = sig(rect({ seed: 42, fillStyle: 'solid' }));
  ok('hachure, zigzag and solid draw three different fills', sigH !== sigZ && sigH !== sigS && sigZ !== sigS);
  const paths = (o) => gen.toPaths(rect(Object.assign({ seed: 42 }, o)));
  ok('solid fill is one filled path', paths({ fillStyle: 'solid' }).some(p => p.fill && p.fill !== 'none'));
  ok('hachure fill is stroked lines, not a solid area', paths({ fillStyle: 'hachure' }).some(p => p.stroke === '#2aa9b8'));
  ok('tighter hatch spacing draws more hatch', paths({ hachureGap: 3 }).map(p => p.d.length).reduce((a, b) => a + b, 0) > paths({ hachureGap: 14 }).map(p => p.d.length).reduce((a, b) => a + b, 0));
  const nums = (d) => (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const clean = gen.toPaths(gen.rectangle(10, 10, 120, 80, { seed: 3, roughness: 0, bowing: 0, fill: '#000', fillStyle: 'hachure' }));
  const xs = [], ys = [];
  clean.forEach(p => { const v = nums(p.d); for (let i = 0; i + 1 < v.length; i += 2) { xs.push(v[i]); ys.push(v[i + 1]); } });
  ok('with roughness 0 every point stays inside the rectangle (' + xs.length + ' points)', xs.length > 20 && Math.min(...xs) >= 9 && Math.max(...xs) <= 131 && Math.min(...ys) >= 9 && Math.max(...ys) <= 91,
    [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].join());
  ok('a seeded line is identical twice', JSON.stringify(gen.toPaths(gen.line(0, 0, 100, 50, { seed: 8 }))) === JSON.stringify(gen.toPaths(gen.line(0, 0, 100, 50, { seed: 8 }))));
  ok('seed 0 is the random one (why the engine never returns it)', sig(gen.line(0, 0, 100, 50, { seed: 0 })) !== sig(gen.line(0, 0, 100, 50, { seed: 0 })));
} catch (e) { fails.push('test code threw after ' + n + ' checks: ' + ((e && e.stack) || e)); }

if (n < MIN_CHECKS) fails.push('only ' + n + ' checks ran, minimum is ' + MIN_CHECKS);
console.log(fails.length ? 'RED  ' + fails.length + ' failed of ' + n + ' checks' : 'GREEN  ' + n + ' checks, 0 failed');
fails.forEach(f => console.log('  FAIL ' + f));
process.exit(fails.length ? 1 : 0);
