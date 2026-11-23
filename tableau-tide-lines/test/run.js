/* Headless unit tests for the parts of Tide Lines that need no DOM: the density
 * maths, bandwidth rule, ordering, layout, label fitting, colour contrast and
 * settings coercion.
 *
 * Settings coercion matters: Tableau stores every setting as a string, so "14"
 * must come back as 14 and "false" as false, or a chart that is right on first
 * draw is wrong after a workbook reopen.
 *
 * Run: node test/run.js
 * Exit code 1 and a RED line if anything fails. It also goes RED if it ran
 * fewer than MIN_CHECKS checks, so an empty run can never read as green.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src', 'js');
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ['kde.js', 'layout.js', 'palettes.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), sandbox, { filename: f });
}
const { kde, layout, palettes } = sandbox.TL;

const MIN_CHECKS = 120;
let pass = 0;
const failures = [];
function ok(name, cond, detail) { if (cond) pass++; else failures.push(name + (detail === undefined ? '' : '\n    ' + detail)); }
function near(name, a, e, tol) { ok(name, Math.abs(a - e) <= tol, 'expected ~' + e + ' got ' + a + ' (tol ' + tol + ')'); }
function eq(name, a, e) { ok(name, JSON.stringify(a) === JSON.stringify(e), 'expected ' + JSON.stringify(e) + ' got ' + JSON.stringify(a)); }

/* seeded normal data */
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function normal(r, mu, sd, n) { const out = []; for (let i = 0; i < n; i++) { const u = 1 - r(), v = r(); out.push(mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); } return out; }
function integral(xs, ys) { let a = 0; for (let i = 1; i < xs.length; i++) a += (xs[i] - xs[i - 1]) * (ys[i] + ys[i - 1]) / 2; return a; }

/* ---------------------------------------------------------- quantiles, summary */
const s9 = kde.summarize([1, 2, 3, 4, 5, 6, 7, 8, 9]);
eq('summary n', s9.n, 9);
eq('median of 1..9', s9.median, 5);
eq('q1 of 1..9 (type 7)', s9.q1, 3);
eq('q3 of 1..9 (type 7)', s9.q3, 7);
eq('iqr of 1..9', s9.iqr, 4);
near('sd of 1..9', s9.sd, 2.7386127875258306, 1e-12);
const s4 = kde.summarize([4, 1, 3, 2]);
near('q1 of 1..4 interpolates', s4.q1, 1.75, 1e-12);
near('median of 1..4 interpolates', s4.median, 2.5, 1e-12);
eq('summary does not reorder the input', (function () { const a = [3, 1, 2]; kde.summarize(a); return a; })(), [3, 1, 2]);
ok('empty summary has n 0', kde.summarize([]).n === 0);

/* -------------------------------------------------------------- Silverman */
near('silverman of 1..9 matches the hand calculation', kde.silverman(s9), 0.9 * Math.min(2.7386127875258306, 4 / 1.34) * Math.pow(9, -0.2), 1e-12);
eq('silverman of one point is 0 (caller falls back)', kde.silverman(kde.summarize([5])), 0);
eq('silverman of identical values is 0', kde.silverman(kde.summarize([4, 4, 4, 4])), 0);
const big = kde.summarize(normal(rng(1), 0, 1, 2000));
near('silverman on 2000 standard normals is near 0.9 * 1 * 2000^-0.2', kde.silverman(big), 0.9 * Math.pow(2000, -0.2), 0.05);

/* ----------------------------------------------------------- the density */
const sample = normal(rng(7), 10, 2, 400).sort((a, b) => a - b);
const grid = []; for (let i = 0; i <= 800; i++) grid.push(-10 + 40 * i / 800);
for (const kind of ['gaussian', 'epanechnikov']) {
  const d = kde.density(sample, 0.8, kind, grid);
  near(kind + ' density integrates to 1', integral(grid, d), 1, 0.005);
  ok(kind + ' density is never negative', d.every((v) => v >= 0));
  ok(kind + ' density is finite', d.every(isFinite));
  const peakX = grid[d.indexOf(Math.max.apply(null, d))];
  near(kind + ' peak sits near the true mean 10', peakX, 10, 1.2);
}
const ep = kde.density(sample, 0.8, 'epanechnikov', [sample[0] - 0.8 * kde.EPAN_SCALE - 0.01, sample[sample.length - 1] + 0.8 * kde.EPAN_SCALE + 0.01]);
eq('epanechnikov is exactly zero beyond its support', ep, [0, 0]);
ok('gaussian has a tail where epanechnikov has none', kde.density(sample, 0.8, 'gaussian', [sample[0] - 0.8 * 3])[0] > 0);
const bimodal = normal(rng(3), 0, 1, 300).concat(normal(rng(4), 8, 1, 300)).sort((a, b) => a - b);
const gb = []; for (let i = 0; i <= 400; i++) gb.push(-5 + 18 * i / 400);
const db = kde.density(bimodal, 0.6, 'gaussian', gb);
let peaks = 0; for (let i = 1; i < db.length - 1; i++) if (db[i] > db[i - 1] && db[i] > db[i + 1] && db[i] > 0.05) peaks++;
eq('a two-humped sample draws two humps', peaks, 2);
const ds = kde.density(sample, 0.8, 'gaussian', grid), ds2 = kde.density(sample, 0.8, 'gaussian', grid);
eq('density is deterministic', ds, ds2);

/* ------------------------------------------------------------- build */
const groups = [
  { key: 'wide', values: normal(rng(11), 50, 12, 200) },
  { key: 'tight', values: normal(rng(12), 70, 3, 200) },
  { key: 'tiny', values: [60] },
  { key: 'flat', values: [5, 5, 5, 5] }
];
const shared = kde.build(groups, { kernel: 'gaussian', bandwidth: 0, scale: 'shared', trim: false });
eq('build keeps every category', shared.ridges.map((r) => r.key), ['wide', 'tight', 'tiny', 'flat']);
ok('shared scale: the tallest ridge reaches exactly 1', Math.max.apply(null, shared.ridges.map((r) => Math.max.apply(null, r.ys))) === 1);
const tightPeak = Math.max.apply(null, shared.ridges[1].ys), widePeak = Math.max.apply(null, shared.ridges[0].ys);
ok('shared scale: the tight ridge is taller than the wide one', tightPeak > widePeak * 2, tightPeak + ' vs ' + widePeak);
const own = kde.build(groups, { kernel: 'gaussian', bandwidth: 0, scale: 'own', trim: false });
ok('own scale: every ridge peaks at 1', own.ridges.every((r) => Math.abs(Math.max.apply(null, r.ys) - 1) < 1e-12));
ok('every ridge shares one x grid', shared.ridges.every((r) => r.xs === shared.xs));
ok('the domain covers every value with room for the tails', shared.domain[0] < 5 && shared.domain[1] > 80);
ok('every bandwidth is positive, even for one point and for no spread', shared.ridges.every((r) => r.bw > 0 && isFinite(r.bw)));
ok('shared grid is increasing', shared.xs.every((x, i) => i === 0 || x > shared.xs[i - 1]));
ok('all ridge heights are finite and within 0..1', shared.ridges.every((r) => r.ys.every((v) => isFinite(v) && v >= 0 && v <= 1 + 1e-12)));
const manual = kde.build(groups, { kernel: 'gaussian', bandwidth: 3.5, scale: 'shared', trim: false });
ok('a typed bandwidth is used for every ridge', manual.ridges.every((r) => r.bw === 3.5));
const trimmed = kde.build(groups, { kernel: 'gaussian', bandwidth: 0, scale: 'shared', trim: true });
ok('trim stops each ridge at its own min and max', trimmed.ridges[0].xs[0] === trimmed.ridges[0].stats.min && trimmed.ridges[0].xs[trimmed.ridges[0].xs.length - 1] === trimmed.ridges[0].stats.max);
const wideRidge = shared.ridges[0], gridStep = shared.xs[1] - shared.xs[0];
near('density of the wide ridge integrates to ~1 over the shared grid', integral(wideRidge.xs, wideRidge.raw), 1, 0.01);
near('epanechnikov build integrates to ~1 too', (function () { const b = kde.build(groups, { kernel: 'epanechnikov', bandwidth: 0, scale: 'shared', trim: false }); return integral(b.xs, b.ridges[1].raw); })(), 1, 0.02);
ok('grid step is fine enough for the narrowest ridge', gridStep < shared.ridges[1].bw * 2);
eq('build of nothing does not throw and has no ridges', kde.build([], { kernel: 'gaussian', bandwidth: 0, scale: 'shared', trim: false }).ridges.length, 0);

/* ---------------------------------------------------------------- sorting */
const rs = [{ key: 'b10', stats: { median: 5 } }, { key: 'a2', stats: { median: 9 } }, { key: 'a10', stats: { median: 1 } }];
eq('data order is kept', kde.sortRidges(rs, 'data', false).map((r) => r.key), ['b10', 'a2', 'a10']);
eq('median order puts the highest on top', kde.sortRidges(rs, 'median', false).map((r) => r.key), ['a2', 'b10', 'a10']);
eq('name order is natural (a2 before a10)', kde.sortRidges(rs, 'name', false).map((r) => r.key), ['a2', 'a10', 'b10']);
eq('flip reverses', kde.sortRidges(rs, 'median', true).map((r) => r.key), ['a10', 'b10', 'a2']);
eq('sorting does not mutate its input', rs.map((r) => r.key), ['b10', 'a2', 'a10']);

/* ------------------------------------------------------------------ ticks */
const t1 = kde.niceTicks(0, 100, 5);
eq('nice ticks for 0..100', t1, [0, 20, 40, 60, 80, 100]);
ok('no negative zero in ticks', kde.niceTicks(-50, 50, 5).every((v) => !Object.is(v, -0)));
ok('ticks stay inside the range', kde.niceTicks(3.2, 97.7, 6).every((v) => v >= 3.2 && v <= 97.7));

/* ----------------------------------------------------------------- layout */
const r5 = layout.rows(10, 400, 5, 2);
near('rows fill the plot height exactly: first peak top to last baseline is the plot height', r5.baselines[4] - (r5.baselines[0] - r5.peak), 400, 1e-9);
near('last baseline is at the bottom of the plot', r5.baselines[4], 410, 1e-9);
near('first ridge peak top is the plot top', r5.baselines[0] - r5.peak, 10, 1e-9);
ok('row spacing is uniform', r5.baselines.every((b, i) => i === 0 || Math.abs(b - r5.baselines[i - 1] - r5.step) < 1e-9));
eq('a font below 14 is raised to 14', layout.labelPlan(3, 50, 9).font, 14);
eq('all labels shown when rows are tall enough', layout.labelPlan(5, 30, 14).shownCount, 5);
eq('no note when all labels are shown', layout.labelPlan(5, 30, 14).note, '');
const lp = layout.labelPlan(60, 6, 14);
ok('when rows are 6px apart, fewer labels are shown', lp.shownCount < 60 && lp.shownCount > 0);
eq('the note says how many', lp.note, 'Showing ' + lp.shownCount + ' of 60 labels');
ok('shown labels are never closer than 1.25 x the font', (function () { const ys = []; lp.shown.forEach((on, i) => { if (on) ys.push(i * 6); }); return ys.every((y, i) => i === 0 || y - ys[i - 1] >= 14 * 1.25 - 1e-9); })());
ok('the font size stays at least 14 however crowded', layout.labelPlan(500, 0.5, 14).font >= 14 && layout.labelPlan(500, 0.5, 20).font === 20);
ok('the first ridge always keeps its label', layout.labelPlan(500, 0.5, 14).shown[0] === true);
const m = (t) => String(t).length * 8;
eq('fitText leaves short text alone', layout.fitText('abc', 100, m), 'abc');
const cut = layout.fitText('abcdefghijklmnopqrstuvwxyz', 100, m);
ok('fitText cuts long text with an ellipsis that fits', cut.endsWith('…') && m(cut) <= 100, cut);
eq('fitText gives nothing when not even one letter fits', layout.fitText('abcdef', 4, m), '');
const pt = layout.pickTicks(kde, 0, 1000, 200, (v) => String(v), m);
ok('picked ticks never overlap', (function () { let last = -1e9; return pt.every((t) => { const x = 200 * t / 1000, w = m(String(t)); const okk = x - w / 2 >= last + 10 - 1e-9; last = x + w / 2; return okk; }); })());

/* ------------------------------------------------------- colour and contrast */
near('black on white is 21:1', palettes.contrast('#000000', '#ffffff'), 21, 1e-9);
near('white on white is 1:1', palettes.contrast('#ffffff', '#ffffff'), 1, 1e-9);
ok('ensureContrast lifts a weak grey on white to 7:1', palettes.contrast(palettes.ensureContrast('#999999', '#ffffff', 7), '#ffffff') >= 7);
ok('ensureContrast lifts a weak grey on navy to 7:1', palettes.contrast(palettes.ensureContrast('#445566', '#081f33', 7), '#081f33') >= 7);
eq('ensureContrast leaves a good colour alone', palettes.ensureContrast('#0b1f2e', '#ffffff', 7), '#0b1f2e');
ok('ensureContrast copes with a bad colour string', palettes.contrast(palettes.ensureContrast('nonsense', '#ffffff', 7), '#ffffff') >= 7);
ok('rgb() worksheet backgrounds parse', palettes.toRgb('rgb(8, 31, 51)')[2] === 51);
ok('navy reads as dark, white as light', palettes.isDark('#081f33') && !palettes.isDark('#ffffff'));
for (const bg of ['#ffffff', '#081f33', '#f4f1ea', '#123456', '#ddeeff', '#222222']) {
  ok('auto ink is 7:1 on ' + bg, palettes.contrast(palettes.ensureContrast(palettes.isDark(bg) ? '#f3f5f7' : '#0b1f2e', bg, 7), bg) >= 7);
}
ok('on a mid-grey background 7:1 is impossible, so the best of black or white is used (>= 4.5)', palettes.contrast(palettes.ensureContrast('#0b1f2e', '#777777', 7), '#777777') >= 4.5);
ok('every ramp is deep to light', Object.keys(palettes.RAMPS).every((k) => { const r = palettes.RAMPS[k]; return r.length >= 5; }));
ok('the default ramp opens on Data Divers navy and passes through teal', palettes.RAMPS.tide[0] === '#0c2a45' && palettes.RAMPS.tide.indexOf('#3cc4d1') > 0);
for (const bg of ['#ffffff', '#081f33']) {
  const cols = [0, 1, 2, 3, 4, 5].map((i) => palettes.ridgeColor('tide', '#000000', i, 6, bg));
  ok('ridge colours are distinct on ' + bg, new Set(cols).size === 6);
}

/* -------------------------------------------------------------- settings (ctab-panel schema) */
const SET = require('../src/js/settings.js');
const CP = require('../lib/ctab-panel/ctab-panel.js');
const rowsAll = SET.prepared.rows.filter((r) => r.type !== 'note');
const rowOf = (k) => SET.BY_KEY[k];
const typed = (k, raw) => CP.coerce(rowOf(k), raw);
eq('"14" comes back as the number 14', typed('labelSize', '14'), 14);
eq('label size cannot be coerced below 14', typed('labelSize', '9'), 14);
eq('label size cannot be set below 14 by a number either', typed('labelSize', 3), 14);
eq('"false" comes back as boolean false', typed('flip', 'false'), false);
eq('"true" comes back as boolean true', typed('showMedian', 'true'), true);
eq('an unknown kernel is refused', typed('kernel', 'triangle'), undefined);
eq('a bad colour is refused', typed('bgColor', 'red'), undefined);
eq('a typed bandwidth of -4 is clamped to Auto (0)', typed('bandwidth', '-4'), 0);
eq('a bandwidth keeps two decimals (0.35 stays 0.35)', typed('bandwidth', '0.35'), 0.35);
eq('overlap is clamped to its maximum', typed('overlap', '99'), 8);
eq('garbage numbers are refused', typed('overlap', 'abc'), undefined);
ok('at least 60 settings (' + rowsAll.length + ')', rowsAll.length >= 60);
ok('at least 15 tabs: 6 chart tabs plus the nine standard ones (' + SET.schema.tabs.length + ')', SET.schema.tabs.length >= 15 && SET.schema.tabs.slice(0, 6).map((x) => x.id).join() === 'density,layout,marks,gradient,outline,axis');
ok('the nine standard tabs are all present', ['colors', 'labels', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'].every((id) => SET.schema.tabs.some((x) => x.id === id)));
ok('every chart tab has at least 5 settings', ['density', 'layout', 'marks', 'gradient', 'outline', 'axis'].every((id) => rowsAll.filter((r) => r.tab === id).length >= 5));
ok('no setting is a slider (no row type is range)', rowsAll.every((r) => ['number', 'select', 'chips', 'check', 'color', 'text', 'font', 'palette', 'field', 'list'].indexOf(r.type) >= 0));
ok('every number row has a unit-safe floor: no text size row goes below 14', rowsAll.filter((r) => /size$/i.test(r.key) && r.unit === 'px' && /label|tip|title|value/i.test(r.key)).every((r) => r.min >= 14));
ok('the font choices are sans-serif only', CP.FONTS.every((f) => !/serif\b(?!.*sans)|mono|courier|georgia|times/i.test(f.stack.replace(/sans-serif/gi, 'sans'))));
eq('sort chips', rowOf('sort').opts.map((o) => o.value), ['data', 'median', 'name', 'mean', 'count', 'manual']);
eq('kernel chips are gaussian and epanechnikov', rowOf('kernel').opts.map((o) => o.value), ['gaussian', 'epanechnikov']);
ok('the bandwidth default is Auto (0)', SET.DEFAULTS.bandwidth === 0);
ok('"Send hover to Tableau" is still there and still defaults on', rowOf('hoverPush').type === 'check' && SET.DEFAULTS.hoverPush === true && rowOf('hoverPush').label === 'Send hover to Tableau');
ok('visibility rules gate the one-colour picker', CP.isVisible(rowOf('singleColor'), { palette: 'single' }, {}) && !CP.isVisible(rowOf('singleColor'), { palette: 'tide' }, {}));
/* the settings an existing workbook has saved keep their keys and their defaults */
const OLD_DEFAULTS = { kernel: 'gaussian', bandwidth: 0, scale: 'shared', trim: 'extend', sort: 'median', flip: false, overlap: 2, labelSize: 14, showGrid: true, showAxisTitle: true,
  showMedian: true, showQuartiles: true, fillOpacity: 0.9, lineWidth: 1.5, hoverLift: 6, colorSource: 'tide', palette: 'tide', singleColor: '#3cc4d1', bgColor: '#ffffff', hoverPush: true };
Object.keys(OLD_DEFAULTS).forEach((k) => eq('saved key ' + k + ' is kept with its old default', SET.DEFAULTS[k], OLD_DEFAULTS[k]));
/* old keys that moved are read as a fallback */
const L = (o) => SET.legacy((k) => o[k]);
eq('legacy animate=false -> animOn false', L({ animate: 'false' }), { animOn: false });
eq('legacy bgMatch=false -> custom background', L({ bgMatch: 'false' }), { bgMode: 'custom' });
eq('legacy bgMatch=true -> worksheet background', L({ bgMatch: 'true' }), { bgMode: 'worksheet' });
eq('legacy inkAuto=false + inkColor -> label color', L({ inkAuto: 'false', inkColor: '#112233' }), { labelColor: '#112233' });
eq('legacy inkAuto=true leaves label color on Auto', L({ inkAuto: 'true', inkColor: '#112233' }), {});
eq('legacy selectEnabled=false -> selectOn false', L({ selectEnabled: 'false' }), { selectOn: false });
eq('legacy font stack -> font id', L({ fontFamily: '"Trebuchet MS", Tahoma, sans-serif' }), { fontFamily: 'trebuchet' });
eq('a font id already in the new form is left alone', L({ fontFamily: 'verdana' }), {});
eq('a new key already saved wins over the old one', L({ animate: 'false', animOn: 'true' }), {});
eq('nothing saved, nothing to migrate', L({}), {});
/* the store takes strings back to typed values, the way Tableau hands them over */
const fake = { v: { 'tidelines.overlap': '3.5', 'tidelines.flip': 'true', 'tidelines.kernel': 'epanechnikov', 'tidelines.catColors': '[{"key":"A","name":"Alpha","color":"#112233","hidden":true}]' },
  get(k) { return this.v[k]; }, set(k, x) { this.v[k] = String(x); }, getAll() { return this.v; }, saveAsync() { return Promise.resolve(); } };
const st = CP.createStore({ rows: SET.prepared.rows, settings: fake, prefix: 'tidelines.' }); st.load();
eq('store: stored strings come back typed', [st.get().overlap, st.get().flip, st.get().kernel], [3.5, true, 'epanechnikov']);
eq('store: a saved override list comes back as objects', st.get().catColors[0].name, 'Alpha');
eq('store: an unset setting keeps its default', st.get().bwMult, 1);
st.setMany(L({ animate: 'false', bgMatch: 'false' }));
eq('store: legacy values land on the new keys and are saved as strings', [fake.v['tidelines.animOn'], fake.v['tidelines.bgMode']], ['false', 'custom']);

/* ---------------------------------------------------- new density, sort and tick options */
const g2 = [{ key: 'a', values: [1, 2, 3, 4, 5, 6, 7, 8, 9] }, { key: 'b', values: [10, 20, 30, 40, 50] }];
const bb1 = kde.build(g2, { kernel: 'gaussian', bandwidth: 2, scale: 'shared' }), bb2 = kde.build(g2, { kernel: 'gaussian', bandwidth: 2, bwMult: 2, scale: 'shared' });
near('bandwidth adjust x2 doubles every ridge bandwidth', bb2.ridges[0].bw / bb1.ridges[0].bw, 2, 1e-12);
const bp1 = kde.build(g2, { kernel: 'gaussian', bandwidth: 2 }), bp2 = kde.build(g2, { kernel: 'gaussian', bandwidth: 2, padMult: 2 });
ok('room past the data x2 widens the axis', bp2.domain[1] - bp2.domain[0] > bp1.domain[1] - bp1.domain[0]);
const br = kde.build(g2, { kernel: 'gaussian', bandwidth: 2, range: [0, 100] });
eq('a custom axis range sets the domain', br.domain, [0, 100]);
eq('a backwards custom range is ignored', kde.build(g2, { kernel: 'gaussian', bandwidth: 2, range: [100, 0] }).domain, bp1.domain);
ok('curve detail sets the grid size', kde.build(g2, { kernel: 'gaussian', bandwidth: 2, points: 100 }).xs.length === 100);
const rsx = bb1.ridges;
eq('sort by average puts the larger mean first', kde.sortRidges(rsx, 'mean', false).map((r) => r.key), ['b', 'a']);
eq('sort by count puts the larger n first (input given smaller-first)', kde.sortRidges(rsx.slice().reverse(), 'count', false).map((r) => r.key), ['a', 'b']);
eq('my order follows the saved list', kde.sortRidges(rsx, 'manual', false, ['b', 'a']).map((r) => r.key), ['b', 'a']);
eq('my order puts unknown keys last, in data order', kde.sortRidges(rsx, 'manual', false, ['b']).map((r) => r.key), ['b', 'a']);
eq('my order reversed', kde.sortRidges(rsx, 'manual', true, ['a', 'b']).map((r) => r.key), ['b', 'a']);
ok('most ticks caps the number of ticks', layout.pickTicks(kde, 0, 1000, 2000, (v) => String(v), m, 3).length <= layout.pickTicks(kde, 0, 1000, 2000, (v) => String(v), m, 10).length && layout.pickTicks(kde, 0, 1000, 2000, (v) => String(v), m, 3).length <= 5);
ok('two-line names need more room per label', layout.labelPlan(20, 20, 14, 2).shownCount < layout.labelPlan(20, 20, 14, 1).shownCount);

/* ------------------------------------------------------------ verdict */
if (pass < MIN_CHECKS) failures.push('RAN ONLY ' + pass + ' checks, the floor is ' + MIN_CHECKS);
if (failures.length) {
  console.log('RED  ' + failures.length + ' failed, ' + pass + ' passed');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
console.log('GREEN  ' + pass + ' checks passed (floor ' + MIN_CHECKS + ')');
