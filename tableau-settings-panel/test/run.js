/* Unit gate for the Settings Panel model, run under node against the mock Dashboard Extensions API.
 *   node test/run.js
 * Every check counts; the run ends with one GREEN or RED line and refuses GREEN below its floors.
 */
'use strict';
var path = require('path'), fs = require('fs');
var ROOT = path.join(__dirname, '..');
var M = require(path.join(ROOT, 'src/js/model.js'));
var LIB = require(path.join(ROOT, 'dev/mock-dashboard.js'));
var pass = 0, fail = 0, subjects = { params: 0, filters: 0, presets: 0, files: 0 };
function check(name, ok, detail) {
  if (ok) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 300) : '')); }
}
function find(list, id) { return list.filter(function (c) { return c.id === id; })[0]; }
function last(mock, op) { return mock.calls.filter(function (c) { return c.op === op; }).pop(); }

async function main() {
  var mock = LIB.create(), dash = mock.dashboard;
  var m = await M.read(dash);
  subjects.params = m.params.length; subjects.filters = m.filters.length;

  /* ---- reading: one control per parameter, the right control for each type ---- */
  var want = { 'Top N': 'stepper', 'Profit Ratio Target': 'stepper', 'Metric': 'chips', 'Region Focus': 'select', 'Bucket Size': 'chips', 'Show Labels': 'toggle',
    'Title Text': 'text', 'Discount Cap': 'stepper', 'Sales Floor': 'stepper', 'As Of Month': 'date', 'Start Date': 'date' };
  check('11 parameters read, one control each', m.params.length === 11, m.params.length);
  Object.keys(want).forEach(function (n) { var c = find(m.params, 'p:' + n); check(n + ' gets a ' + want[n] + ' control', c && c.control === want[n], c && c.control); });
  var topn = find(m.params, 'p:Top N');
  check('range parameter keeps its min, max and step', topn.min === 1 && topn.max === 50 && topn.step === 1, [topn.min, topn.max, topn.step]);
  var ratio = find(m.params, 'p:Profit Ratio Target');
  check('float range step 0.05 shows 2 decimals', ratio.step === 0.05 && ratio.dec === 2, [ratio.step, ratio.dec]);
  var asof = find(m.params, 'p:As Of Month');
  check('date range parameter steps by months within its range', asof.period === 'months' && asof.min === '2025-01-01' && asof.max === '2026-12-01', asof);
  check('no control is ever a slider (no "range" or "slider" control kind)', m.params.every(function (c) { return ['stepper', 'chips', 'select', 'toggle', 'text', 'date'].indexOf(c.control) >= 0; }));

  /* ---- filters: grouped, shared across sheets, each type read ---- */
  var region = find(m.filters, 'f:categorical:Region');
  check('Region filter on 3 sheets becomes one shared control', region && region.sheets.length === 3 && region.group === 'On 3 sheets', region && region.sheets);
  check('categorical domain read (4 regions, all selected)', region.domain.length === 4 && region.all === true, [region.domain.length, region.all]);
  var seg = find(m.filters, 'f:categorical:Segment');
  check('exclude-mode filter read as exclude with its one value', seg.exclude === true && seg.selected.length === 1 && seg.all === false, seg.selected);
  var sales = find(m.filters, 'f:range:Sales');
  check('numeric range filter read with domain and a 1-2-5 step', sales.dmin <= sales.min && sales.max <= sales.dmax && [1, 2, 5, 10, 20, 50, 100, 200].indexOf(sales.step) >= 0 && !sales.isDate, [sales.dmin, sales.dmax, sales.step]);
  var od = find(m.filters, 'f:range:Order Date');
  check('date range filter read as ISO dates', od.isDate && /^\d{4}-\d{2}-\d{2}$/.test(od.min) && /^\d{4}-\d{2}-\d{2}$/.test(od.max), [od.min, od.max]);
  var ship = find(m.filters, 'f:relative-date:Ship Date');
  check('relative date filter read (last 3 months from 2026-11-24)', ship.range === 'lastn' && ship.n === 3 && ship.period === 'months' && ship.anchor === '2026-11-24', ship);
  var prod = find(m.filters, 'f:hierarchical:Product');
  check('hierarchical filter listed but marked not editable', prod && prod.unsupported === true);
  var cust = find(m.filters, 'f:categorical:Customer');
  check('a 233-value filter reads its whole domain', cust.domain.length === 233, cust.domain.length);
  check('8 filter controls in all', m.filters.length === 8, m.filters.map(function (f) { return f.id; }));

  /* ---- every parameter write changes the workbook ---- */
  var sets = [['Top N', 12, 12], ['Profit Ratio Target', 0.25, 0.25], ['Metric', 'Profit', 'Profit'], ['Region Focus', 'South and West', 'South and West'], ['Bucket Size', '50', 50],
    ['Show Labels', false, false], ['Title Text', 'Q3 review', 'Q3 review'], ['Discount Cap', 0.35, 0.35], ['Sales Floor', 750, 750], ['As Of Month', '2026-01-01', '2026-01-01'], ['Start Date', '2025-07-04', '2025-07-04']];
  for (var i = 0; i < sets.length; i++) {
    var c = find(m.params, 'p:' + sets[i][0]);
    await M.setParam(c, sets[i][1]);
    var got = mock.param(sets[i][0]).currentValue.value;
    check('setParam ' + sets[i][0] + ' changes the workbook to ' + sets[i][2], got === sets[i][2], got);
  }
  check('Top N is clamped into its range (99 becomes 50)', (await M.setParam(topn, 99)) === 50 && mock.param('Top N').currentValue.value === 50);
  var rej = await M.setParam(find(m.params, 'p:Metric'), 'Revenue').then(function () { return false; }, function () { return true; });
  check('a value outside a list parameter is refused before Tableau is called', rej);
  var rejd = await M.setParam(asof, '2026-02-31').then(function () { return false; }, function () { return true; });
  check('an impossible date (2026-02-31) is refused', rejd);

  /* ---- every filter write changes every copy ---- */
  await M.setCategorical(region, ['East', 'West'], false);
  check('categorical keep: East and West on all 3 sheets', mock.sheets.every(function (ws) { var f = ws.filters.Region; return f.appliedValues.map(function (d) { return d.value; }).join() === 'East,West' && !f.isExcludeMode; }));
  await M.setCategorical(region, ['South'], true);
  check('categorical exclude: South excluded on all 3 sheets', mock.sheets.every(function (ws) { var f = ws.filters.Region; return f.isExcludeMode && f.appliedValues[0].value === 'South'; }));
  await M.setCategorical(region, 'all');
  check('categorical all: every sheet back to All', mock.sheets.every(function (ws) { return ws.filters.Region.isAllSelected; }));
  await M.setRange(sales, 100, 900, false);
  var sf = mock.sheet('Orders').filters.Sales;
  check('numeric range: 100 to 900, empty values left out', sf.minValue.value === 100 && sf.maxValue.value === 900 && sf.includeNullValues === false, [sf.minValue.value, sf.maxValue.value]);
  await M.setRange(sales, 900, 100, true);
  check('a reversed range is put in order, not refused', sf.minValue.value === 100 && sf.maxValue.value === 900 && sf.includeNullValues === true);
  await M.setRange(od, '2025-06-01', '2025-12-31', true);
  var of = mock.sheet('Profit Trend').filters['Order Date'];
  check('date range sent as Date objects', of.minValue.value instanceof Date && M.isoDate(of.minValue.value) === '2025-06-01' && M.isoDate(of.maxValue.value) === '2025-12-31');
  await M.setRelative(ship, { anchor: '2026-10-01', period: 'weeks', range: 'nextn', n: 6 });
  var rf = mock.sheet('Orders').filters['Ship Date'];
  check('relative date: next 6 weeks from 2026-10-01', rf.rangeType === 'nextn' && rf.rangeN === 6 && rf.periodType === 'weeks' && M.isoDate(rf.anchorDate.value) === '2026-10-01', rf);
  await M.clearFilter(sales);
  check('clearFilter puts the range back to the whole domain', sf.minValue.value === sales.dmin && sf.maxValue.value === sales.dmax);

  /* ---- highlighting reads through one reader and always releases it ---- */
  var ws0 = mock.sheet('Sales by Region'), mk = await M.marks(ws0);
  check('marks: text columns of Sales by Region (Region, Category)', mk.columns.map(function (c) { return c.name; }).join() === 'Region,Category', mk.columns.map(function (c) { return c.name; }));
  check('marks: the reader was released', ws0.open === false);
  var mk2 = await M.marks(ws0);
  check('a second read works (no leaked reader)', mk2.columns.length === 2);
  await M.highlight(ws0, 'Region', ['East']);
  check('highlight selects marks by value', ws0.selected && ws0.selected.field === 'Region' && ws0.selected.values.join() === 'East');
  await M.highlight(ws0, 'Region', []);
  check('an empty highlight clears the selection', ws0.selected === null && last(mock, 'clearSelectedMarksAsync'));

  /* ---- presets and defaults round trip through string settings ---- */
  var fresh = LIB.create(), fm = await M.read(fresh.dashboard), st = fresh.tableau.extensions.settings;
  var base = M.capture(fm);
  await M.saveDefaults(st, base);
  await M.setParam(find(fm.params, 'p:Top N'), 33);
  await M.setParam(find(fm.params, 'p:Show Labels'), false);
  await M.setCategorical(find(fm.filters, 'f:categorical:Category'), ['Technology'], false);
  await M.setRange(find(fm.filters, 'f:range:Sales'), 300, 1200, true);
  await M.setRelative(find(fm.filters, 'f:relative-date:Ship Date'), { anchor: '2026-01-15', period: 'days', range: 'last', n: 1 });
  fm = await M.read(fresh.dashboard);
  var snapB = M.capture(fm);
  var list = M.addPreset([], 'Tech focus', snapB, 1764000000000);
  list = M.addPreset(list, 'Tech focus', base, 1764000000001);
  check('a duplicate preset name gets a number (Tech focus 2)', list[1].name === 'Tech focus 2', list.map(function (p) { return p.name; }));
  list = M.renamePreset(list, list[1].id, '  As shipped  ');
  check('rename trims and keeps the id', list[1].name === 'As shipped' && list.length === 2);
  await M.savePresets(st, list);
  check('presets are stored as one string in extension settings', typeof fresh.settings['sp.presets'] === 'string');
  var loaded = M.loadPresets(st);
  check('presets reload from settings with names and snapshots', loaded.length === 2 && loaded[0].name === 'Tech focus' && loaded[1].snap.params['Top N'] === base.params['Top N']);
  subjects.presets = loaded.length;
  var r1 = await M.restore(fm, M.loadDefaults(st));
  fm = await M.read(fresh.dashboard);
  check('reset to defaults restores every parameter and filter exactly', JSON.stringify(M.capture(fm)) === JSON.stringify(base), r1);
  check('reset sent only the 5 things that differed', r1.applied === 5 && r1.failed.length === 0, r1);
  var r2 = await M.restore(fm, loaded[0].snap);
  fm = await M.read(fresh.dashboard);
  check('applying a preset restores its captured state exactly', JSON.stringify(M.capture(fm)) === JSON.stringify(snapB), r2);
  var r3 = await M.restore(fm, { v: 1, params: { 'Gone Param': 1 }, filters: { 'f:categorical:Gone': { all: true } } });
  check('a preset naming things not on the dashboard reports them and changes nothing', r3.applied === 0 && r3.missing.join() === 'Gone Param,Gone', r3);
  list = M.deletePreset(loaded, loaded[0].id);
  check('delete removes exactly one preset', list.length === 1 && list[0].name === 'As shipped');
  st.set('sp.presets', '{not json'); check('a corrupt presets string loads as an empty list, never throws', M.loadPresets(st).length === 0);

  /* ---- search and helpers ---- */
  check('search matches a sheet name (Orders finds Sales range)', M.matches(sales, 'orders') && !M.matches(sales, 'trend'));
  check('search matches every word', M.matches(find(m.params, 'p:Region Focus'), 'region south') && !M.matches(find(m.params, 'p:Region Focus'), 'region north'));
  check('date stepping by month, quarter and week', M.addPeriod('2026-01-31', 'months', 1) === '2026-03-03' || M.addPeriod('2026-01-15', 'months', 1) === '2026-02-15');
  check('quarters add three months', M.addPeriod('2026-01-15', 'quarters', 1) === '2026-04-15' && M.addPeriod('2026-01-15', 'weeks', -1) === '2026-01-08');
  check('niceStep lands on 1-2-5', M.niceStep(1980, true) === 100 && M.niceStep(1, false) === 0.05);

  /* ---- house rules over the shipping files ---- */
  var EM = String.fromCharCode(0x2014), files = [];
  (function walk(d) { fs.readdirSync(d).forEach(function (f) { var p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(js|css|html|trex|md|txt)$/.test(f)) files.push(p); }); })(path.join(ROOT, 'src'));
  ['settings-panel.trex', 'README.md', 'START-HERE.txt', 'dev/dev.html', 'dev/mock-dashboard.js'].forEach(function (f) { if (fs.existsSync(path.join(ROOT, f))) files.push(path.join(ROOT, f)); });
  subjects.files = files.length;
  var dashes = files.filter(function (f) { return fs.readFileSync(f, 'utf8').indexOf(EM) >= 0; });
  check('no em dash in any of ' + files.length + ' shipping files', files.length >= 8 && !dashes.length, dashes);
  var ranges = files.filter(function (f) { return /type=["']?range/.test(fs.readFileSync(f, 'utf8')); });
  check('no range input (slider) in any shipping file', !ranges.length, ranges);
  var fetches = files.filter(function (f) { return /\.js$/.test(f) && /\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|importScripts)\s*\(/.test(fs.readFileSync(f, 'utf8')); });
  check('no network call in shipping code (fetch, XHR, WebSocket, beacon)', !fetches.length, fetches);
  var trex = fs.readFileSync(path.join(ROOT, 'settings-panel.trex'), 'utf8');
  check('manifest is a dashboard extension with email="" and min API 1.12', /<dashboard-extension /.test(trex) && /email=""/.test(trex) && /<min-api-version>1\.12<\/min-api-version>/.test(trex) && !/worksheet-extension/.test(trex));

  console.log('\nsubjects: ' + subjects.params + ' parameters, ' + subjects.filters + ' filter controls, ' + subjects.presets + ' presets round-tripped, ' + subjects.files + ' files scanned');
  var floors = subjects.params >= 11 && subjects.filters >= 8 && subjects.presets >= 2 && subjects.files >= 8 && pass >= 60;
  if (fail || !floors) { console.log('RED  unit: ' + pass + ' passed, ' + fail + ' failed' + (floors ? '' : ' (below a floor: 11 params, 8 filters, 2 presets, 8 files, 60 checks)')); process.exit(1); }
  console.log('GREEN unit: ' + pass + ' checks passed over ' + subjects.params + ' parameters, ' + subjects.filters + ' filter controls, ' + subjects.files + ' files');
}
main().catch(function (e) { console.log('RED  unit crashed: ' + (e && e.stack || e)); process.exit(1); });
