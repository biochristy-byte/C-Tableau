/* Fixtures for the development harness. Seeded, so every run draws the same radars. */
(function (global) {
  'use strict';
  function rng(seed) { var s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; var t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  var ENC = { axis: 'Axis', series: 'Series', value: 'Value', label: 'Label' };
  function make(axes, series, seed, lo, hi, opts) {
    var r = rng(seed), rows = [];
    series.forEach(function (sn) {
      axes.forEach(function (an) {
        var v = Math.round((lo + (hi - lo) * r()) * 10) / 10;
        if (opts && opts.hole && r() < opts.hole) return;
        rows.push({ Axis: an, Series: sn, Value: v, Label: an });
      });
    });
    return { columns: ['Axis', 'Series', 'Value', 'Label'], rows: rows, enc: ENC };
  }
  var six = ['Speed', 'Power', 'Defense', 'Stamina', 'Agility', 'Focus'];
  var twelve = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var F = {
    typical: Object.assign({ label: 'Six axes, three series' }, make(six, ['Alpha', 'Bravo', 'Charlie'], 11, 20, 95)),
    many: Object.assign({ label: 'Twelve axes, two series' }, make(twelve, ['This year', 'Last year'], 5, 10, 90)),
    tiny: Object.assign({ label: 'Three axes, one series' }, make(['One', 'Two', 'Three'], ['Only'], 3, 30, 80)),
    two: Object.assign({ label: 'Two axes (too few)' }, make(['One', 'Two'], ['Only'], 3, 30, 80)),
    longnames: Object.assign({ label: 'Long axis names' }, make(['Universal health coverage service index for the whole population', 'Births attended by skilled health personnel in the previous calendar year', 'Immunization coverage', 'Supercalifragilisticexpialidocious measurement', 'Short'], ['A', 'B'], 9, 1, 9)),
    negative: Object.assign({ label: 'Negative values' }, make(six, ['Gain', 'Loss'], 21, -40, 60)),
    holes: Object.assign({ label: 'Missing values' }, make(six, ['Alpha', 'Bravo', 'Charlie'], 14, 20, 95, { hole: 0.25 })),
    manyseries: Object.assign({ label: 'Twelve series' }, make(six, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12'], 8, 15, 95)),
    constant: { label: 'All values equal', columns: ['Axis', 'Series', 'Value', 'Label'], enc: ENC, rows: ['A', 'B', 'C', 'D'].map(function (a) { return { Axis: a, Series: 'Flat', Value: 50, Label: a }; }) },
    empty: { label: 'No rows', columns: ['Axis', 'Series', 'Value', 'Label'], rows: [], enc: ENC }
  };
  global.RD_FIXTURES = F;
})(window);
