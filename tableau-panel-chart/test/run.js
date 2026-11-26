/* Panel Chart unit gate (node, no browser): the settings schema, aggregation, sorting, stacking, nice ticks, text
 * fitting, and the full layout of every chart type across fixtures, sizes and setting variants. Each layout must keep
 * every text at 14px or more, inside the frame, at 7:1 on its own background, and touching no other text.
 *
 *   node test/run.js
 * Exit 1 (RED) on any failure or when fewer subjects were examined than the floors below.
 */
'use strict';
var path = require('path');
var CP = require('../lib/ctab-panel/ctab-panel.js');
var SET = require('../src/js/settings.js');
var M = require('../src/js/model.js');
require('../dev/fixtures.js');
var FX = globalThis.PC_FIXTURES;
var EM = String.fromCharCode(0x2014);
var pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; console.log('RED  ' + name + (detail !== undefined ? '  ' + JSON.stringify(detail).slice(0, 300) : '')); }
}
function near(a, b, e) { return Math.abs(a - b) <= (e || 1e-9); }
var measure = function (t, size, weight) { return Math.ceil(String(t).length * size * (weight === 'bold' ? 0.6 : 0.56)) + 1; };

/* ---------------------------------------------------------------- schema */
var rows = SET.prepared.rows.filter(function (r) { return r.type !== 'note' && r.type !== 'preview' && r.type !== 'action'; });
check('settings: at least 60 (' + rows.length + ')', rows.length >= 60, rows.length);
check('tabs: at least 15 (' + SET.schema.tabs.length + ')', SET.schema.tabs.length >= 15);
check('the eight chart tabs come first', SET.schema.tabs.slice(0, 8).map(function (t) { return t.label; }).join(',') === 'Chart,Bars,Lines,Points,Axes,Grid,Legend,Title');
check('no slider: no row is a range type', rows.every(function (r) { return r.type !== 'range'; }));
rows.forEach(function (r) {
  var c = CP.coerce(r, r.def);
  check('default of ' + r.key + ' coerces to itself', JSON.stringify(c) === JSON.stringify(r.def), [r.def, c]);
  var strs = [r.label, r.help || '', r.placeholder || ''].concat((r.opts || []).map(function (o) { return o.label; }));
  check('no em dash in ' + r.key, strs.every(function (s) { return s.indexOf(EM) < 0; }));
});
['labelSize', 'valueLabelSize', 'titleSize', 'subtitleSize', 'tipSize'].forEach(function (k) {
  check('text size setting ' + k + ' cannot go under 14px', SET.BY_KEY[k] && SET.BY_KEY[k].min >= 14, SET.BY_KEY[k] && SET.BY_KEY[k].min);
});
check('every chart tab has rows', SET.schema.tabs.every(function (t) { return rows.some(function (r) { return r.tab === t.id; }); }));
check('the Title tab holds the four title rows', ['showTitle', 'titleText', 'titleSize', 'titleWeight'].every(function (k) { return SET.BY_KEY[k].tab === 'title'; }));

/* ---------------------------------------------------------------- aggregation, order, stacking */
var R = [{ cat: 'A', ser: 'x', value: 2, tuple: 1 }, { cat: 'A', ser: 'x', value: 4, tuple: 2 }, { cat: 'B', ser: 'x', value: 10, tuple: 3 },
  { cat: 'B', ser: 'y', value: -3, tuple: 4 }, { cat: 'C', ser: 'y', value: 1, tuple: 5 }, { cat: 'C', ser: 'x', value: null, tuple: 6 }];
var k = M.cellKey;
check('sum', M.aggregate(R, 'sum').cells[k('A', 'x')].v === 6);
check('average', M.aggregate(R, 'avg').cells[k('A', 'x')].v === 3);
check('smallest', M.aggregate(R, 'min').cells[k('A', 'x')].v === 2);
check('largest', M.aggregate(R, 'max').cells[k('A', 'x')].v === 4);
check('count counts rows with no value too', M.aggregate(R, 'count').cells[k('C', 'x')].v === 1);
check('sum skips a missing value', !M.aggregate(R, 'sum').cells[k('C', 'x')]);
check('tuples are kept per cell', M.aggregate(R, 'sum').cells[k('A', 'x')].tuples.join() === '1,2');
var agg = M.aggregate(R, 'sum'), D = CP.defaultsOf(SET.prepared.rows);
function S(o) { var s = JSON.parse(JSON.stringify(D)); Object.keys(o || {}).forEach(function (x) { s[x] = o[x]; }); return s; }
check('data order', M.orderCats(agg, S(), ['x', 'y']).cats.join() === 'A,B,C');
check('largest first (sum across series)', M.orderCats(agg, S({ sort: 'desc' }), ['x', 'y']).cats.join() === 'B,A,C');
check('smallest first', M.orderCats(agg, S({ sort: 'asc' }), ['x', 'y']).cats.join() === 'C,A,B');
check('by name with numbers', M.orderCats(M.aggregate([{ cat: 'S10', ser: 'a', value: 1 }, { cat: 'S9', ser: 'a', value: 1 }], 'sum'), S({ sort: 'name' }), ['a']).cats.join() === 'S9,S10');
check('my order follows the list', M.orderCats(agg, S({ sort: 'manual', catOrder: [{ key: 'C' }, { key: 'A' }] }), ['x', 'y']).cats.join() === 'C,A,B');
check('reverse', M.orderCats(agg, S({ flip: true }), ['x', 'y']).cats.join() === 'C,B,A');
check('first N after sorting', M.orderCats(agg, S({ sort: 'desc', topN: 2 }), ['x', 'y']).cats.join() === 'B,A');
check('a hidden category is dropped', M.orderCats(agg, S({ catOrder: [{ key: 'B', hidden: true }] }), ['x', 'y']).cats.join() === 'A,C');
var st = M.stack(agg, ['A', 'B', 'C'], ['x', 'y'], 'stack', false);
check('stacked: positive values stack up from zero', st[k('B', 'x')].a === 0 && st[k('B', 'x')].b === 10);
check('stacked: a negative value stacks down from zero', st[k('B', 'y')].a === 0 && st[k('B', 'y')].b === -3);
var pc = M.stack(agg, ['A', 'B', 'C'], ['x', 'y'], 'percent', false);
check('100% stacked: each category sums to 100', near(Math.abs(pc[k('B', 'x')].v) + Math.abs(pc[k('B', 'y')].v), 100, 1e-6), pc[k('B', 'x')]);
check('100% stacked: a single series is 100', near(pc[k('A', 'x')].v, 100, 1e-9));
var gp = M.stack(agg, ['A', 'B'], ['x', 'y'], 'group', false);
check('side by side: every bar starts at zero', gp[k('B', 'y')].a === 0 && gp[k('B', 'x')].a === 0);
check('missing value leaves a gap', !M.stack(agg, ['A'], ['x', 'y'], 'group', false)[k('A', 'y')]);
check('missing value as zero', M.stack(agg, ['A'], ['x', 'y'], 'group', true)[k('A', 'y')].v === 0);
[[0, 97, 6], [-3, 10, 5], [0.001, 0.0042, 4], [1200, 1200, 6], [-500, -20, 3]].forEach(function (c) {
  var t = M.niceTicks(c[0], c[1], c[2]);
  check('nice ticks cover ' + c[0] + '..' + c[1], t.min <= Math.min(c[0], c[1]) && t.max >= Math.max(c[0], c[1]) && t.ticks.length >= 2 && t.ticks.length <= c[2] + 3, t);
  var m = t.step / Math.pow(10, Math.floor(Math.log(t.step) / Math.LN10));
  check('nice step 1, 2, 2.5 or 5 (' + t.step + ')', [1, 2, 2.5, 5, 10].some(function (x) { return near(m, x, 1e-6); }));
});
var ft = M.fitText(measure, 'Northern Atlantic coastal districts, autumn quarter', 14, 'normal', 120, 2);
check('long text wraps to two lines that each fit', ft.length === 2 && ft.every(function (l) { return measure(l, 14, 'normal') <= 120; }), ft);
check('the cut line ends in an ellipsis', ft[1].slice(-1) === String.fromCharCode(0x2026), ft);
check('short text is left alone', M.fitText(measure, 'Harbor', 14, 'normal', 200, 2).join() === 'Harbor');
check('fontPx floors at 14', M.fontPx(9) === 14 && M.fontPx(18) === 18);
check('curve: straight, smooth and steps all draw', ['straight', 'smooth', 'step'].every(function (c) { return /^M/.test(M.curvePath([[0, 0], [10, 5], [20, 2], [30, 8]], c)); }));

/* ---------------------------------------------------------------- layout across the matrix */
function model(fx) {
  var f = FX[fx], e = f.enc, rows2 = f.rows.map(function (r, i) {
    return { cat: String(r[e.category]), ser: e.color ? String(r[e.color]) : e.value, value: typeof r[e.value] === 'number' ? r[e.value] : null, x: e.xvalue ? r[e.xvalue] : null, tuple: i + 1 };
  });
  return { rows: rows2, catName: e.category, valueName: e.value, serName: e.color || '', xName: e.xvalue || '', hasSeries: !!e.color, hasX: !!e.xvalue, emptyMessage: 'empty' };
}
var VARIANTS = [{}, { valueLabels: true }, { orientation: 'horizontal', valueLabels: true }, { stack: 'percent', valueLabels: true }, { stack: 'group', valueLabels: true },
  { legendPos: 'right' }, { legendPos: 'bottom', showTitle: true, subtitleText: 'Every store, every product, last twelve months', titleAlign: 'center' },
  { labelSize: 20, valueLabels: true, valueLabelSize: 18 }, { labelColor: '#8fa7b8', valueLabels: true }, { sort: 'desc', topN: 5, refLine: 'avg' }];
var TYPES = ['bar', 'line', 'area', 'scatter'], SIZES = [[900, 520], [390, 700], [300, 300], [1600, 1000]];
var layouts = 0, texts = 0, marks = 0, overlapPairs = 0;
['sales', 'monthly', 'scatter', 'single', 'negative', 'many', 'long'].forEach(function (fx) {
  var dm = model(fx);
  TYPES.forEach(function (type) {
    VARIANTS.forEach(function (v, vi) {
      SIZES.forEach(function (sz, si) {
        if (vi > 2 && si > 1) return;
        ['#ffffff', '#081f33'].forEach(function (bg, bi) {
          if (bi && vi % 3) return;
          var s = S(v); s.chartType = type;
          var L = M.layout(dm, s, { W: sz[0], H: sz[1], bg: bg, measure: measure }), tag = fx + '/' + type + '/v' + vi + '/' + sz.join('x') + '/' + bg;
          layouts++;
          if (L.empty) { check('only a frame too small is empty: ' + tag, sz[0] <= 300, L.empty); return; }
          marks += L.marks.length;
          check('marks drawn: ' + tag, L.marks.length > 0);
          L.marks.forEach(function (m) { if (m.color) check('mark color 3:1 on the background: ' + tag + ' ' + m.key, CP.color.contrast(m.color, bg) >= 3, [m.color, bg]); });
          L.legend.forEach(function (k) { check('legend key 3:1 on the background: ' + tag, CP.color.contrast(k.color, bg) >= 3, [k.color, bg]); });
          L.texts.forEach(function (t) {
            texts++;
            check('text 14px or more: ' + tag + ' ' + t.text, t.size >= 14, t.size);
            check('text inside the frame: ' + tag + ' "' + t.text + '"', t.box.l >= -1 && t.box.t >= -1 && t.box.r <= sz[0] + 1 && t.box.b <= sz[1] + 1, t.box);
            check('text 7:1 on its background: ' + tag + ' ' + t.text, CP.color.contrast(t.fill, t.bg) >= 7, [t.fill, t.bg]);
            check('no em dash in chart text: ' + tag, t.text.indexOf(EM) < 0);
          });
          for (var i = 0; i < L.texts.length; i++) for (var j = i + 1; j < L.texts.length; j++) {
            overlapPairs++;
            if (M.hit(L.texts[i].box, L.texts[j].box, -0.5)) check('no two texts touch: ' + tag, false, [L.texts[i].text, L.texts[j].text]);
          }
        });
      });
    });
  });
});
check('layouts examined: ' + layouts + ' (floor 600)', layouts >= 600, layouts);
check('texts examined: ' + texts + ' (floor 20000)', texts >= 20000, texts);
check('marks laid out: ' + marks + ' (floor 50000)', marks >= 50000, marks);
check('text pairs checked for overlap: ' + overlapPairs + ' (floor 400000)', overlapPairs >= 400000, overlapPairs);

console.log('examined: ' + rows.length + ' settings, ' + layouts + ' layouts, ' + texts + ' texts, ' + marks + ' marks, ' + overlapPairs + ' text pairs');
if (fail) { console.log('RED: unit gate, ' + fail + ' failed of ' + (pass + fail) + ' checks'); process.exit(1); }
console.log('GREEN: unit gate, ' + pass + ' checks passed');
