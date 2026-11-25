/* Fixtures for the development harness and the gates. Seeded, so every run draws the same chart.
 * Each fixture names the fields on its shelves (enc); the harness puts them on the mock's Marks card. */
(function (global) {
  'use strict';
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var REGIONS = ['Harbor', 'Midtown', 'Lakeside', 'Old Mill', 'Riverside', 'Uptown', 'West End'];
  var PRODUCTS = ['Coffee', 'Pastry', 'Sandwich'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var COLS = ['Region', 'Product', 'Month', 'Sales', 'Profit', 'Units'];
  var r = rng(7), base = [];
  REGIONS.forEach(function (rg, ri) {
    PRODUCTS.forEach(function (p, pi) {
      MONTHS.forEach(function (m, mi) {
        if (p === 'Sandwich' && m === 'Mar') return;  /* one gap, so Missing values has something to do */
        var sales = Math.round((900 + ri * 260 + pi * 420) * (1 + 0.35 * Math.sin((mi + pi) / 2)) * (0.85 + 0.3 * r()));
        var profit = Math.round(sales * (0.06 + 0.14 * r()) - (rg === 'Old Mill' && pi === 2 ? 420 : 0) - (mi === 1 ? 120 : 0));
        base.push({ Region: rg, Product: p, Month: m, Sales: sales, Profit: profit, Units: Math.round(sales / (3 + pi * 2)) });
      });
    });
  });
  var many = [], lr = rng(3);
  for (var i = 0; i < 40; i++) many.push({ Region: 'Store ' + (i + 1), Product: 'All', Month: 'Jan', Sales: Math.round(2000 + 9000 * lr()), Profit: Math.round(800 * lr() - 200), Units: 10 });
  var LONG = ['Northern Atlantic coastal districts, autumn quarter', 'Southern Pacific island markets and resorts', 'Central plains wholesale accounts', 'Great Lakes university campuses', 'Desert southwest travel centers'];
  var long = [], qr = rng(5);
  LONG.forEach(function (n) { PRODUCTS.forEach(function (p) { long.push({ Region: n, Product: p, Month: 'Jan', Sales: Math.round(1500 + 6000 * qr()), Profit: 1, Units: 1 }); }); });
  function enc(cat, val, col, xv) { return { category: cat, value: val, color: col || null, xvalue: xv || null }; }
  global.PC_FIXTURES = {
    sales: { label: 'Sales by region and product (245 rows)', columns: COLS, rows: base, enc: enc('Region', 'Sales', 'Product') },
    monthly: { label: 'Monthly sales by product', columns: COLS, rows: base, enc: enc('Month', 'Sales', 'Product') },
    scatter: { label: 'Profit against sales, every row', columns: COLS, rows: base, enc: enc('Region', 'Profit', 'Product', 'Sales') },
    single: { label: 'Sales by region, no series', columns: COLS, rows: base, enc: enc('Region', 'Sales') },
    negative: { label: 'Profit by region (some losses)', columns: COLS, rows: base, enc: enc('Region', 'Profit', 'Product') },
    many: { label: '40 stores (labels cannot all fit)', columns: COLS, rows: many, enc: enc('Region', 'Sales') },
    long: { label: 'Long category names', columns: COLS, rows: long, enc: enc('Region', 'Sales', 'Product') },
    empty: { label: 'No rows', columns: COLS, rows: [], enc: enc('Region', 'Sales') }
  };
})(typeof window !== 'undefined' ? window : globalThis);
