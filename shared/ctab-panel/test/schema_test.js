/* Unit test of the ctab-panel schema engine (no DOM): schema validation, coercion, conditional rows, search,
 * validated paste, list merge, number format, theme contrast, the settings store, and the standard rows.
 *
 *   node test/schema_test.js
 *
 * RED and exit 1 on any failure, and RED if it ran fewer than MIN_CHECKS checks. */
'use strict';
const path = require('path');
const P = require(path.join(__dirname, '..', 'ctab-panel.js'));

const MIN_CHECKS = 120;
let pass = 0; const fails = [];
function ok(name, cond, detail) { if (cond) pass++; else fails.push(name + (detail === undefined ? '' : '\n    ' + detail)); }
function eq(name, a, e) { ok(name, JSON.stringify(a) === JSON.stringify(e), 'expected ' + JSON.stringify(e) + ' got ' + JSON.stringify(a)); }
function throws(name, fn, re) { let m = null; try { fn(); } catch (e) { m = String(e.message); } ok(name, m !== null && re.test(m), 'message: ' + m); }

/* ---------------------------------------------------------------- schema */
const T = ['a', { id: 'b', label: 'Bee' }];
const base = { tabs: T, rows: [
  { tab: 'a', key: 'n', label: 'Count', type: 'number', min: 1, max: 10, step: 0.5, def: 4, sec: 'S' },
  { tab: 'a', key: 'sel', label: 'Mode', type: 'select', opts: [['x', 'Ex'], ['y', 'Why']], help: 'pick one' },
  { tab: 'a', key: 'ch', label: 'Style', type: 'chips', opts: [{ value: 'p', label: 'Pee' }, { value: 'q', label: 'Que' }], def: 'q' },
  { tab: 'a', key: 'on', label: 'Enable', type: 'check', def: true },
  { tab: 'b', key: 'col', label: 'Color', type: 'color', def: '#112233' },
  { tab: 'b', key: 'acol', label: 'Auto color', type: 'color', auto: true, def: '' },
  { tab: 'b', key: 'txt', label: 'Caption', type: 'text', def: 'hi', maxLength: 5 },
  { tab: 'b', key: 'fnt', label: 'Font', type: 'font' },
  { tab: 'b', key: 'pal', label: 'Palette', type: 'palette' },
  { tab: 'b', key: 'fld', label: 'Field', type: 'field' },
  { tab: 'b', key: 'lst', label: 'List', type: 'list', source: 'items' },
  { tab: 'b', key: 'dep', label: 'Dependent', type: 'number', min: 0, max: 5, step: 1, def: 1, when: { key: 'on', truthy: true } },
  { tab: 'b', key: 'dep2', label: 'Dependent two', type: 'check', def: false, when: function (s) { return s.sel === 'y'; } },
  { tab: 'b', key: 'dep3', label: 'Both', type: 'check', def: false, when: [{ key: 'on', eq: true }, { key: 'ch', ne: 'p' }, { key: 'sel', in: ['x', 'y'] }] },
  { tab: 'b', key: 'note1', label: 'A note', type: 'note' }
] };
const sch = P.prepare(base);
ok('prepare keeps every row', sch.rows.length === 15);
eq('prepare normalizes tab strings and objects', sch.tabs, [{ id: 'a', label: 'a' }, { id: 'b', label: 'Bee' }]);
eq('select default falls to the first option', sch.rows[1].def, 'x');
eq('check default is false when unset', P.prepare({ tabs: ['t'], rows: [{ tab: 't', key: 'z', label: 'z', type: 'check' }] }).rows[0].def, false);
eq('list default is an empty array', sch.rows[10].def, []);
eq('palette default is datadivers', sch.rows[8].def, 'datadivers');
eq('font default is worksheet', sch.rows[7].def, 'worksheet');
throws('duplicate key throws', () => P.prepare({ tabs: ['t'], rows: [{ tab: 't', key: 'k', type: 'check' }, { tab: 't', key: 'k', type: 'check' }] }), /duplicate key k/);
throws('unknown tab throws', () => P.prepare({ tabs: ['t'], rows: [{ tab: 'zz', key: 'k', type: 'check' }] }), /unknown tab/);
throws('unknown type throws (a range input cannot be declared)', () => P.prepare({ tabs: ['t'], rows: [{ tab: 't', key: 'k', type: 'range', min: 0, max: 1, step: 1 }] }), /unknown row type "range"/);
throws('number without bounds throws', () => P.prepare({ tabs: ['t'], rows: [{ tab: 't', key: 'k', type: 'number' }] }), /needs min, max and step/);
throws('select without opts throws', () => P.prepare({ tabs: ['t'], rows: [{ tab: 't', key: 'k', type: 'select' }] }), /needs opts/);
throws('row without key throws', () => P.prepare({ tabs: ['t'], rows: [{ tab: 't', type: 'check' }] }), /no key/);
throws('schema without tabs throws', () => P.prepare({ rows: [] }), /needs tabs/);
const R = {}; sch.rows.forEach(r => { R[r.key] = r; });

/* --------------------------------------------------------------- coerce */
eq('number: string from Tableau settings', P.coerce(R.n, '7.5'), 7.5);
eq('number: clamps high', P.coerce(R.n, 99), 10);
eq('number: clamps low', P.coerce(R.n, -4), 1);
eq('number: rounds to the step precision', P.coerce(R.n, 3.14159), 3.1);
eq('number: NaN is invalid', P.coerce(R.n, 'abc'), undefined);
eq('number: empty string is invalid', P.coerce(R.n, ''), undefined);
eq('number: boolean is invalid', P.coerce(R.n, true), undefined);
eq('number: null is invalid', P.coerce(R.n, null), undefined);
eq('number: Infinity is invalid', P.coerce(R.n, Infinity), undefined);
eq('select: known value', P.coerce(R.sel, 'y'), 'y');
eq('select: unknown value is invalid', P.coerce(R.sel, 'z'), undefined);
eq('chips: known value', P.coerce(R.ch, 'p'), 'p');
eq('chips: unknown value is invalid', P.coerce(R.ch, 'nope'), undefined);
eq('check: "true" string', P.coerce(R.on, 'true'), true);
eq('check: "false" string', P.coerce(R.on, 'false'), false);
eq('check: "maybe" is invalid', P.coerce(R.on, 'maybe'), undefined);
eq('color: 3-digit hex expands', P.coerce(R.col, '#ABC'), '#aabbcc');
eq('color: without hash is accepted', P.coerce(R.col, '3cc4d1'), '#3cc4d1');
eq('color: garbage is invalid', P.coerce(R.col, 'blue'), undefined);
eq('color: empty is invalid when not auto', P.coerce(R.col, ''), undefined);
eq('auto color: empty means auto', P.coerce(R.acol, ''), '');
eq('text: truncated to maxLength', P.coerce(R.txt, 'abcdefgh'), 'abcde');
eq('text: object is invalid', P.coerce(R.txt, {}), undefined);
eq('font: known id', P.coerce(R.fnt, 'arial'), 'arial');
eq('font: a raw css stack is rejected', P.coerce(R.fnt, 'Comic Sans; color:red'), undefined);
eq('palette: known id', P.coerce(R.pal, 'okabe'), 'okabe');
eq('palette: unknown id is invalid', P.coerce(R.pal, 'rainbow'), undefined);
eq('field: any string', P.coerce(R.fld, 'Region'), 'Region');
eq('field: number is invalid', P.coerce(R.fld, 4), undefined);
eq('list: JSON string from settings', P.coerce(R.lst, '[{"key":"a","name":"A","color":"#fff"}]'), [{ key: 'a', name: 'A', color: '#ffffff', hidden: false }]);
eq('list: bad item is invalid', P.coerce(R.lst, [{ name: 'x' }]), undefined);
eq('list: not an array is invalid', P.coerce(R.lst, { a: 1 }), undefined);
eq('list: bad JSON is invalid', P.coerce(R.lst, '[oops'), undefined);
eq('list: hidden flag kept', P.coerce(R.lst, [{ key: 'a', hidden: true }])[0].hidden, true);
eq('note rows are not settable', P.defaultsOf(sch.rows).note1, undefined);
eq('serialize list', P.serialize(R.lst, [{ key: 'a' }]), '[{"key":"a"}]');
eq('serialize number', P.serialize(R.n, 4), '4');
eq('serialize bool', P.serialize(R.on, false), 'false');

/* -------------------------------------------------------------- defaults */
const D = P.defaultsOf(sch.rows);
eq('defaults: number', D.n, 4); eq('defaults: check', D.on, true); eq('defaults: chips', D.ch, 'q');
eq('defaults are independent copies', (function () { const d = P.defaultsOf(sch.rows); d.lst.push(1); return P.defaultsOf(sch.rows).lst; })(), []);

/* ----------------------------------------------------------- conditionals */
ok('when: no condition is visible', P.isVisible(R.n, D));
ok('when truthy: shown when on', P.isVisible(R.dep, { on: true }));
ok('when truthy: hidden when off', !P.isVisible(R.dep, { on: false }));
ok('when function: shown', P.isVisible(R.dep2, { sel: 'y' }));
ok('when function: hidden', !P.isVisible(R.dep2, { sel: 'x' }));
ok('when array (all of): shown', P.isVisible(R.dep3, { on: true, ch: 'q', sel: 'x' }));
ok('when array: eq fails', !P.isVisible(R.dep3, { on: false, ch: 'q', sel: 'x' }));
ok('when array: ne fails', !P.isVisible(R.dep3, { on: true, ch: 'p', sel: 'x' }));
ok('when array: in fails', !P.isVisible(R.dep3, { on: true, ch: 'q', sel: 'z' }));
ok('a throwing when function does not hide the row', P.isVisible({ when: () => { throw new Error('x'); } }, {}));
eq('visibleRows drops hidden', P.visibleRows(sch.rows, { on: false, sel: 'x', ch: 'q' }).map(r => r.key).filter(k => k.indexOf('dep') === 0), []);

/* ---------------------------------------------------------------- search */
const keys = (q, s) => P.searchRows(sch, s || { on: true, sel: 'y', ch: 'q' }, {}, q).map(r => r.key);
ok('search by label finds the row', keys('count').indexOf('n') >= 0);
ok('search is case-insensitive', keys('COUNT').indexOf('n') >= 0);
ok('search by help text', keys('pick one').indexOf('sel') >= 0);
ok('search by option label', keys('why').indexOf('sel') >= 0);
ok('search by tab label spans the tab', keys('bee').length >= 5);
ok('search by section name', keys('S').indexOf('n') >= 0);
ok('search needs every word', keys('count mode').length === 0);
eq('search for nothing returns nothing', keys('   '), []);
eq('search with no match returns nothing', keys('zzzz'), []);
ok('search skips rows whose when is false', keys('dependent', { on: false, sel: 'x', ch: 'q' }).length === 0);
ok('search finds a conditional row once it is visible', keys('dependent two', { on: true, sel: 'y', ch: 'q' }).indexOf('dep2') >= 0);

/* ----------------------------------------------------------------- paste */
const paste = (t, pre) => P.parsePaste(sch.rows, t, pre);
let p = paste('');
ok('paste: empty text refused with a message', !p.ok && /Paste the settings/.test(p.message));
p = paste('{not json');
ok('paste: bad JSON refused with a message', !p.ok && /not valid JSON/.test(p.message));
p = paste('[1,2]');
ok('paste: an array refused', !p.ok && /JSON object/.test(p.message));
p = paste('"hello"');
ok('paste: a string refused', !p.ok && /JSON object/.test(p.message));
p = paste('{"zzz": 1}');
ok('paste: only unknown keys refused', !p.ok && p.ignored[0] === 'zzz' && /No settings/.test(p.message));
p = paste('{"n": 6, "on": false, "sel": "y"}');
ok('paste: valid map applies', p.ok && p.applied === 3 && p.values.n === 6 && p.values.on === false && p.values.sel === 'y', JSON.stringify(p));
p = paste('{"n": "oops", "sel": "y", "extra": 1}');
ok('paste: invalid value skipped, valid kept, unknown ignored', p.ok && p.applied === 1 && p.invalid[0] === 'n' && p.ignored[0] === 'extra' && /invalid/.test(p.message), JSON.stringify(p));
p = paste('{"radar.n": "9", "radar.on": "false"}', 'radar.');
ok('paste: the extension prefix is stripped and strings coerce', p.ok && p.values.n === 9 && p.values.on === false, JSON.stringify(p));
p = paste('{"rd_n": 4, "rd_on": "false"}', 'rd_');
ok('paste: a prefix without dots is stripped', p.ok && p.values.n === 4 && p.values.on === false, JSON.stringify(p));
p = paste('{"other7.n": 3}');
ok('paste: any other prefix matches by last segment', p.ok && p.values.n === 3);
p = paste('{"n": 99}');
ok('paste: out-of-range number is clamped, not refused', p.ok && p.values.n === 10);
p = paste('{"lst": "[{\\"key\\":\\"a\\"}]"}');
ok('paste: a list written as a string parses', p.ok && Array.isArray(p.values.lst), JSON.stringify(p));

/* ------------------------------------------------------------------ list */
const items = [{ key: 'a', name: 'Alpha', color: '#111111' }, { key: 'b', name: 'Beta', color: '#222222' }, { key: 'c', name: 'Gamma', color: '#333333' }];
eq('mergeList with nothing saved is the items', P.mergeList([], items).map(m => m.key), ['a', 'b', 'c']);
eq('mergeList follows the saved order and appends new', P.mergeList([{ key: 'c' }, { key: 'a' }], items).map(m => m.key), ['c', 'a', 'b']);
eq('mergeList drops a key that left the data', P.mergeList([{ key: 'zz' }, { key: 'b' }], items).map(m => m.key), ['b', 'a', 'c']);
eq('mergeList ignores a duplicate saved key', P.mergeList([{ key: 'a' }, { key: 'a' }], items).map(m => m.key), ['a', 'b', 'c']);
eq('mergeList keeps a saved name', P.mergeList([{ key: 'a', name: 'Ay' }], items)[0].name, 'Ay');
eq('mergeList falls back to the item name', P.mergeList([{ key: 'a', name: '' }], items)[0].name, 'Alpha');
eq('mergeList keeps a saved color', P.mergeList([{ key: 'b', color: '#abcdef' }], items)[0].color, '#abcdef');
eq('mergeList keeps hidden', P.mergeList([{ key: 'a', hidden: true }], items)[0].hidden, true);
eq('mergeList of null items is empty', P.mergeList([], null), []);

/* ----------------------------------------------------------- number format */
const F = (v, s) => P.formatNumber(v, s);
eq('format: 1 decimal default', F(1234.567, {}), '1,234.6');
eq('format: 0 decimals', F(1234.567, { numDecimals: 0 }), '1,235');
eq('format: space separator', F(1234567, { numDecimals: 0, numThousands: 'space' }), '1 234 567');
eq('format: no separator', F(1234567, { numDecimals: 0, numThousands: 'none' }), '1234567');
eq('format: compact K', F(12345, { numCompact: true, numDecimals: 1 }), '12.3K');
eq('format: compact M', F(3400000, { numCompact: true, numDecimals: 1 }), '3.4M');
eq('format: compact B', F(5600000000, { numCompact: true, numDecimals: 0 }), '6B');
eq('format: prefix and suffix', F(5, { numPrefix: '$', numSuffix: ' pts', numDecimals: 0 }), '$5 pts');
eq('format: negative', F(-1234.5, { numDecimals: 1 }), '-1,234.5');
eq('format: percent scale', F(0.256, { numScale: '100', numDecimals: 1, numSuffix: '%' }), '25.6%');
eq('format: negative zero has no sign', F(-0.001, { numDecimals: 1 }), '0.0');
eq('format: NaN is empty', F(NaN, {}), '');
eq('format: a string is empty', F('x', {}), '');
eq('format: bad scale falls back to 1', F(5, { numScale: 'x', numDecimals: 0 }), '5');

/* --------------------------------------------------------- palettes, fonts */
ok('seven palettes: Data Divers plus six', P.PALETTES.length === 7 && P.PALETTES[0].id === 'datadivers');
ok('six palettes are marked colorblind-safe', P.PALETTES.filter(p => p.safe).length === 6);
ok('every palette color is a 6-digit hex', P.PALETTES.every(p => p.colors.every(c => /^#[0-9a-f]{6}$/.test(c))));
eq('paletteColors reverses', P.paletteColors('okabe', true)[0], '#999999');
eq('paletteColors unknown id falls back to Data Divers', P.paletteColors('nope')[0], '#3cc4d1');
ok('paletteColors returns a copy', (function () { const a = P.paletteColors('okabe'); a[0] = 'x'; return P.paletteColors('okabe')[0] !== 'x'; })());
ok('every font stack ends in a sans-serif generic and has no serif or mono face', P.FONTS.every(f => /sans-serif$/.test(f.stack) && !/mono|courier|georgia|times/i.test(f.stack)));
ok('fontStack of an unknown id is the worksheet stack', P.fontStack('zzz') === P.FONTS[0].stack);

/* ----------------------------------------------------------------- themes */
const C = P.color;
function theme(name, chart, custom) { return C.themeTokens(name, chart, custom); }
function pairs(t) { return [['ink', 'bg'], ['ink', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['accent', 'bg'], ['accent', 'surface'], ['danger', 'bg'], ['danger', 'surface']]; }
const themes = {
  light: theme('light'), dark: theme('dark'),
  'match white': theme('match', { bg: '#ffffff', ink: '#222222' }), 'match dark': theme('match', { bg: '#0a1619', ink: '#e7f3ef' }),
  'match mid grey': theme('match', { bg: '#808080', ink: '#808080' }), 'match peach': theme('match', { bg: '#fdf3ec', ink: '#fdf3ec' }),
  'match saturated': theme('match', { bg: '#ff0000', ink: '#ff0000' }), 'match navy': theme('match', { bg: '#081f33', ink: '#3cc4d1' }),
  'custom': theme('custom', null, { bg: '#123456', ink: '#123457' }), 'custom light': theme('custom', null, { bg: '#fafafa', ink: '#ffffff' }),
  'match unparseable chart color falls back to light': theme('match', { bg: 'red', ink: 'x' })
};
Object.keys(themes).forEach(n => {
  pairs().forEach(([a, b]) => ok('theme ' + n + ': ' + a + ' on ' + b + ' is at least 7:1', C.contrast(themes[n][a], themes[n][b]) >= 7, a + ' ' + themes[n][a] + ' on ' + themes[n][b] + ' = ' + C.contrast(themes[n][a], themes[n][b]).toFixed(2)));
  ok('theme ' + n + ': border is at least 3:1 on the background', C.contrast(themes[n].border, themes[n].bg) >= 3);
});
ok('inverse (selected chips) pair ink on bg is at least 7:1 in every theme', Object.keys(themes).every(n => C.contrast(themes[n].ink, themes[n].bg) >= 7));
ok('ensureContrast leaves a passing color alone', C.ensureContrast('#000000', ['#ffffff'], 7) === '#000000');
ok('ensureContrast darkens on a light background', C.contrast(C.ensureContrast('#aaaaaa', ['#ffffff'], 7), '#ffffff') >= 7);
ok('ensureContrast lightens on a dark background', C.contrast(C.ensureContrast('#333333', ['#000000'], 7), '#000000') >= 7);
ok('legalBg pushes a mid grey to something black or white can reach', Math.max(C.contrast('#000000', C.legalBg('#808080')), C.contrast('#ffffff', C.legalBg('#808080'))) >= 7.5);
ok('legalBg leaves white alone', C.legalBg('#ffffff') === '#ffffff');
ok('normHex rejects junk', C.normHex('#12345') === null && C.normHex(5) === null && C.normHex('#12345g') === null);

/* ------------------------------------------------------------------ store */
function fakeSettings(init) {
  const m = Object.assign({}, init || {}); let saves = 0, fail = false;
  return { m, get saves() { return saves; }, failSave(v) { fail = v; },
    get: k => m[k], getAll: () => Object.assign({}, m), set: (k, v) => { m[k] = String(v); },
    saveAsync: () => { saves++; return fail ? Promise.reject(new Error('viewer')) : Promise.resolve(); } };
}
(async function () {
  let notes = [];
  let fs = fakeSettings({ 'rd.n': '7', 'rd.on': 'false', 'rd.sel': 'bogus' });
  let st = P.createStore({ schema: base, settings: fs, prefix: 'rd.', debounce: 20, onChange: ks => notes.push(ks) });
  st.load();
  ok('store load: stored number comes back typed', st.get().n === 7);
  ok('store load: stored "false" comes back as false', st.get().on === false);
  ok('store load: an invalid stored value falls to the default', st.get().sel === 'x');
  ok('store load: untouched keys keep their default', st.get().ch === 'q');
  fs = fakeSettings({ 'viz9.n': '8' }); st = P.createStore({ schema: base, settings: fs, prefix: 'rd.', debounce: 20 }); st.load();
  ok('store load: a host with another prefix is matched by last segment', st.get().n === 8);
  fs = fakeSettings(); notes = [];
  st = P.createStore({ schema: base, settings: fs, prefix: 'rd.', debounce: 25, onChange: ks => notes.push(ks) });
  const r1 = st.set('n', 5), r2 = st.set('n', 5.5), r3 = st.set('on', false);
  ok('store set: reports the changed keys', r1[0] === 'n' && r2[0] === 'n' && r3[0] === 'on');
  ok('store set: a same value reports nothing', st.set('n', 5.5).length === 0);
  ok('store set: an invalid value is refused', st.set('n', 'abc').length === 0 && st.get().n === 5.5);
  ok('store set: an unknown key is refused', st.set('nope', 1).length === 0);
  ok('store set: written as strings under the prefix', fs.m['rd.n'] === '5.5' && fs.m['rd.on'] === 'false');
  ok('store set: nothing saved yet (debounced)', fs.saves === 0);
  await new Promise(r => setTimeout(r, 90));
  ok('store: three rapid changes made exactly one saveAsync', fs.saves === 1, String(fs.saves));
  ok('store: change notices batched into one call', notes.length === 1 && notes[0].length === 2, JSON.stringify(notes));
  st.setMany({ n: 2, ch: 'p', lst: [{ key: 'a', name: 'A' }] });
  ok('store setMany: a list is stored as JSON', JSON.parse(fs.m['rd.lst'])[0].key === 'a');
  const before = fs.saves; st.flush();
  ok('store flush saves immediately', fs.saves === before + 1);
  const rs = st.reset(['n']);
  ok('store reset(keys) restores just those', rs[0] === 'n' && st.get().n === 4 && st.get().ch === 'p');
  st.reset();
  ok('store reset() restores everything', st.get().ch === 'q' && st.get().on === true && st.get().lst.length === 0);
  fs.failSave(true); st.set('n', 9); st.flush(); await new Promise(r => setTimeout(r, 10));
  ok('store survives a rejected saveAsync (viewer mode)', st.get().n === 9);
  const ps = st.panelState; ps.set({ x: 12, y: 30, min: true }); eq('panel state round-trips through settings', ps.get(), { x: 12, y: 30, min: true });
  ok('panel state with no stored value is an empty object', P.createStore({ schema: base, settings: fakeSettings() }).panelState.get().x === undefined);
  const snap = st.snapshot(); snap.n = 1; ok('snapshot is a copy', st.get().n === 9);
  const noSt = P.createStore({ schema: base }); noSt.set('n', 3); ok('a store with no settings object still works in memory', noSt.get().n === 3);

  /* ------------------------------------------------------------ standard */
  const std = P.standard({ fields: [{ key: 'fieldAxis', label: 'Axis field' }, { key: 'fieldValue', label: 'Value field', kind: 'numeric' }] });
  const full = P.prepare({ tabs: std.tabs, rows: std.rows });
  ok('standard: nine standard tabs', std.tabs.length === 9 && ['colors', 'labels', 'numbers', 'tooltip', 'fonts', 'background', 'animation', 'interaction', 'fields'].every(id => std.tabs.some(t => t.id === id)));
  ok('standard: at least 40 rows on their own', std.rows.length >= 40, String(std.rows.length));
  ok('standard validates as a schema', full.rows.length === std.rows.length);
  ok('standard: no range-like type anywhere', std.rows.every(r => ['number', 'select', 'chips', 'check', 'color', 'text', 'font', 'list', 'palette', 'field', 'note'].indexOf(r.type) >= 0));
  ok('standard: every tab has a row', std.tabs.every(t => std.rows.some(r => r.tab === t.id)));
  ok('standard: no number can go below 14px for text sizes', std.rows.filter(r => /Size$/.test(r.key) && r.unit === 'px').every(r => r.min >= 14), 'keys ' + std.rows.filter(r => /Size$/.test(r.key)).map(r => r.key + ':' + r.min));
  ok('standard: every default coerces to itself', full.rows.every(r => r.type === 'note' || JSON.stringify(P.coerce(r, r.def)) === JSON.stringify(r.def)), full.rows.filter(r => r.type !== 'note' && JSON.stringify(P.coerce(r, r.def)) !== JSON.stringify(r.def)).map(r => r.key).join());
  ok('standard: the default palette is Data Divers', std.rows.filter(r => r.key === 'palette')[0].def === 'datadivers');
  ok('standard: fields rows come from opts', std.rows.filter(r => r.tab === 'fields').length === 2 && std.rows[std.rows.length - 1].kind === 'numeric');
  ok('standard: conditional rows exist', std.rows.some(r => r.when));
  const skipped = P.standard({ skip: ['fields', 'tooltip'] });
  ok('standard: skip leaves tabs and rows out', skipped.tabs.length === 7 && !skipped.rows.some(r => r.tab === 'tooltip' || r.tab === 'fields'));
  const over = P.standard({ over: { animMs: { def: 900 } } });
  ok('standard: over changes a default', over.rows.filter(r => r.key === 'animMs')[0].def === 900);
  const sd = P.defaultsOf(full.rows);
  ok('standard: label size default meets the 14px floor', sd.labelSize >= 14 && sd.tipSize >= 14 && sd.valueLabelSize >= 14);

  console.log('examined ' + (pass + fails.length) + ' checks');
  if (pass + fails.length < MIN_CHECKS) fails.push('ran only ' + (pass + fails.length) + ' checks, floor ' + MIN_CHECKS);
  if (fails.length) { console.log('RED  ' + fails.length + ' failed'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('GREEN  ' + pass + ' checks (floor ' + MIN_CHECKS + ')');
})();
