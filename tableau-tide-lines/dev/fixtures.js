/* Fixtures for the development harness. Seeded, so every run draws the same ridges. */
(function (global) {
  'use strict';
  function rng (seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss (r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  var COLS = ['Group', 'Segment', 'Short', 'Value'];
  function make (specs, perGroup, seed) {
    var r = rng(seed), rows = [];
    specs.forEach(function (sp, gi) {
      for (var i = 0; i < perGroup; i++) {
        var v = sp.mix && r() < sp.mix[0] ? sp.mix[1] + sp.mix[2] * gauss(r) : sp.mu + sp.sd * gauss(r);
        rows.push({ Group: sp.name, Segment: sp.seg || (gi % 2 ? 'North' : 'South'), Short: sp.short || sp.name, Value: Math.round(v * 100) / 100 });
      }
    });
    return rows;
  }
  var typical = [
    { name: 'Alder Creek', mu: 52, sd: 8 }, { name: 'Brine Point', mu: 61, sd: 6 },
    { name: 'Coral Cove', mu: 45, sd: 11, mix: [0.4, 70, 5] }, { name: 'Dune Harbour', mu: 68, sd: 9 },
    { name: 'Eel Reach', mu: 38, sd: 5 }, { name: 'Foam Bay', mu: 57, sd: 13 }
  ];
  var many = [];
  for (var i = 0; i < 60; i++) many.push({ name: 'Station ' + (i + 1), mu: 30 + (i * 7) % 40, sd: 5 + (i % 5) * 2 });
  var longNames = [
    { name: 'Northern Atlantic continental shelf survey, autumn cohort', mu: 40, sd: 7, short: 'North Atlantic autumn' },
    { name: 'Southern Pacific trench monitoring programme, winter cohort', mu: 62, sd: 9, short: 'South Pacific winter' },
    { name: 'Indian Ocean monsoon-season baseline', mu: 51, sd: 6, short: 'Indian Ocean' }
  ];
  var flat = [];
  [1, 2, 3].forEach(function (g) { for (var k = 0; k < 8; k++) flat.push({ Group: 'Flat ' + g, Segment: 'A', Short: 'Flat ' + g, Value: 10 * g }); });
  global.TL_FIXTURES = {
    typical: { label: 'Six sites, 45 readings each', columns: COLS, rows: make(typical, 45, 11) },
    many: { label: '60 ridges (labels cannot all fit)', columns: COLS, rows: make(many, 18, 5) },
    long: { label: 'Long names (truncate, hover for full)', columns: COLS, rows: make(longNames, 60, 3) },
    tiny: { label: 'One ridge, three points', columns: COLS, rows: [
      { Group: 'Solo', Segment: 'A', Short: 'Solo', Value: 4 }, { Group: 'Solo', Segment: 'A', Short: 'Solo', Value: 5 }, { Group: 'Solo', Segment: 'A', Short: 'Solo', Value: 9 }] },
    constant: { label: 'Identical values (no spread)', columns: COLS, rows: flat },
    empty: { label: 'No rows', columns: COLS, rows: [] }
  };
})(typeof window !== 'undefined' ? window : globalThis);
