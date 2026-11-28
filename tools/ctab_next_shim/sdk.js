// C-Tableau stand-in for @analytics/data-app-sdk (Tableau Next data apps). Written from scratch from the SHAPES seen in real app source;
// no vendor code. It answers a query id from app.spec.json by running the query on the viz page's own rows, through the public
// Tableau Extensions API surface that the page's stand-in provides (workbook.getAllDataSourcesAsync, DataSource.queryAsync).
import spec from '@ctab/spec';   // app.spec.json, embedded by `ctab_next.py build`

// ===================== SDK SHAPES: the only place that maps Next shapes to the stand-in =====================
// Spec query:  { id, query: { kind:'semantic', query: { sourceName, fields:[{field, alias, aggregation?}], filters:[{field, filterType, values}], limit } } }
// Result rows: objects keyed by field alias. A field with no aggregation is a group-by dimension, one with it is a measure.
var AGG = { sum: 'SUM', avg: 'AVG', average: 'AVG', mean: 'AVG', count: 'COUNT', countd: 'COUNTD', distinctcount: 'COUNTD', min: 'MIN', max: 'MAX', median: 'MEDIAN' };

function fieldList(q, map) {
  return q.fields.map(function (f) {
    var cap = caption(f.field, map), out = { fieldCaption: cap, fieldAlias: f.alias || f.field };
    if (f.aggregation) {
      var fn = AGG[String(f.aggregation).toLowerCase()];
      if (!fn) throw new Error('C-Tableau: aggregation "' + f.aggregation + '" on ' + f.field + ' is not supported yet.');
      out.function = fn;
    }
    return out;
  });
}
function filterList(q, map) {
  return (q.filters || []).map(function (f) {
    var t = String(f.filterType || '').toLowerCase(), field = { fieldCaption: caption(f.field, map) }, v = f.values || (f.value !== undefined ? [f.value] : []);
    if (t === 'in' || t === 'equals' || t === 'eq') return { field: field, filterType: 'SET', values: v };
    if (t === 'notin' || t === 'not_in' || t === 'notequals') return { field: field, filterType: 'SET', values: v, exclude: true };
    if (t === 'gte') return { field: field, filterType: 'QUANTITATIVE_NUMERICAL', quantitativeFilterType: 'MIN', min: v[0] };
    if (t === 'lte') return { field: field, filterType: 'QUANTITATIVE_NUMERICAL', quantitativeFilterType: 'MAX', max: v[0] };
    if (t === 'between') return { field: field, filterType: 'QUANTITATIVE_NUMERICAL', quantitativeFilterType: 'RANGE', min: v[0], max: v[1] };
    throw new Error('C-Tableau: filterType "' + f.filterType + '" on ' + f.field + ' is not supported yet. Post this message.');
  });
}
function sortList(q, fields) {   // guessed shape: orderBy / sort: [{ field | alias, direction }]
  var o = q.orderBy || q.sort || [];
  o.forEach(function (s, i) {
    var key = s.alias || s.field;
    fields.forEach(function (f) { if (f.fieldAlias === key || f._src === key) { f.sortDirection = String(s.direction || 'asc').toUpperCase() === 'DESC' ? 'DESC' : 'ASC'; f.sortPriority = i + 1; } });
  });
}
// =====================================================================================================

var fieldMapP = null, dsP = null, cache = {};
function loadMap() {
  if (!fieldMapP) fieldMapP = fetch('./ctab-fields.json').then(function (r) {
    if (!r.ok) throw new Error('C-Tableau: ctab-fields.json is missing from the app (' + r.status + ').');
    return r.json();
  });
  return fieldMapP;
}
function caption(semantic, map) {
  var c = map[semantic];
  if (!c) throw new Error('C-Tableau: no CSV column is mapped for field "' + semantic + '". Edit ctab-fields.json.');
  return c;
}
function waitTableau(n) {
  return new Promise(function (res, rej) {
    (function poll(i) {
      var t = window.tableau && window.tableau.extensions;
      if (t) return res(t);
      if (i > 100) return rej(new Error('C-Tableau: this app runs on a C-Tableau viz page (no Tableau Extensions API here).'));
      setTimeout(function () { poll(i + 1); }, 50);
    })(0);
  });
}
function dataSource(name) {
  if (!dsP) dsP = waitTableau().then(function (ext) {
    return Promise.resolve(ext.initializeAsync()).then(function () { return ext.workbook.getAllDataSourcesAsync(); });
  });
  return dsP.then(function (list) {
    if (!list || !list.length) throw new Error('C-Tableau: the viz page has no data source. Publish it with --csv.');
    var low = String(name || '').toLowerCase();
    return list.filter(function (d) { return String(d.name).toLowerCase() === low || String(d.id).toLowerCase() === low; })[0] || list[0];
  });
}
export function getSpec() { return spec; }
export function runQuery(id) {
  if (cache[id]) return cache[id];
  var entry = (spec.queries || (spec.data && spec.data.queries) || []).filter(function (x) { return x.id === id; })[0];
  if (!entry) return (cache[id] = Promise.reject(new Error('C-Tableau: app.spec.json has no query with id "' + id + '".')));
  var q = entry.query && entry.query.query ? entry.query.query : entry.query;
  cache[id] = Promise.all([loadMap(), dataSource(q.sourceName)]).then(function (a) {
    var map = a[0], ds = a[1], fields = fieldList(q, map), filters = (typeof __CTAB_SABOTAGE__ !== 'undefined' && __CTAB_SABOTAGE__) ? [] : filterList(q, map);
    fields.forEach(function (f, i) { f._src = q.fields[i].field; });
    sortList(q, fields);
    fields.forEach(function (f) { delete f._src; });
    return ds.queryAsync({ fields: fields, filters: filters }).then(function (r) {
      var rows = r && r.data ? r.data : [];
      if (q.limit && rows.length > q.limit) rows = rows.slice(0, q.limit);
      return { rows: rows, rowCount: rows.length };
    });
  });
  return cache[id];
}
