'use strict';

// Mock of the Tableau Extensions API for STANDALONE BROWSER PREVIEW ONLY.
// Loaded by index.html when opened with ?preview=1 (never inside Tableau).
// Reads sample-data/sample.csv (fake people, one row per person per week) and
// serves it as summary data, so the chart renders and every setting in the
// panel can be exercised.
//
// The mock must behave like the real library where the real library bites:
// it throws on an unknown event type, it names measure columns "SUM(x)", it
// sends a fraction as a plain "1.05" string unless told otherwise, and it
// refuses a second data reader while one is still open, so a reader leak or
// two overlapping reads fail loudly here instead of silently in Tableau.
//
// Scenarios (URL parameter):
//   (default)            Week on Category, Load % on Value, Resource on Member.
//                        Is Selected, Capacity Hours and Scheduled Hours on
//                        Detail. Settings seeded to match the original mockup.
//   ?scenario=plain      the same fields with untouched default settings
//   ?scenario=colormeasure  a different measure (Hours Over) on Color, cut
//                        into bands by boundaries in hours
//   ?scenario=colorname  a dimension (Band) on Color: named colors
//   ?scenario=summary    Member empty; Team Min, P25, Median, P75 and Max
//                        arrive as fields on Detail, one row per week
//   ?scenario=minimal    Category and Value only: dots with no range
//   ?scenario=nohighlight  no Is Selected field: range only, pick in the panel
//   ?scenario=uid        Resource Id on Member, Resource Name on Detail
//   ?scenario=salary     big numbers, text categories, 40 members, no percent
//   ?scenario=formatted  Tableau sends the values already formatted ("105.0%")
//   ?scenario=dateobj    dates arrive as Date objects instead of strings
//   ?scenario=split      a Detail dimension splits each value into 2 rows
//   ?scenario=small      a group of two (a thin range)
//   ?scenario=one        a single week
//   ?scenario=long       very long category names
//   ?scenario=many       60 categories
//   &fresh=1             ignore settings saved from an earlier visit
//   &slow=NNNN           no rows for the first NNNN ms (workbook still opening)
//   &rename=NNNN         shelves read empty for the first NNNN ms and no event
//                        follows, like Tableau reloading after a sheet rename
//
// Each scenario keeps its own saved settings, so one does not leak into another.

(function () {
  const scenario = (/[?&]scenario=([^&]+)/.exec(location.search) || [])[1] || 'default';
  const slowMs = Number((/[?&]slow=([0-9]+)/.exec(location.search) || [])[1] || 0);
  const renameMs = Number((/[?&]rename=([0-9]+)/.exec(location.search) || [])[1] || 0);
  const fresh = /[?&]fresh=1/.test(location.search);
  const storePrefix = 'range-dot-preview:' + scenario + ':';
  if (fresh) { try { window.localStorage.removeItem(storePrefix + 'settings'); } catch (e) {} }

  // Settings a user would have saved, applied the first time a scenario opens.
  function seedSettings(obj) {
    try {
      if (window.localStorage.getItem(storePrefix + 'settings') === null) {
        window.localStorage.setItem(storePrefix + 'settings', JSON.stringify(obj));
      }
    } catch (e) {}
  }

  // [shelf, csv column, field name Tableau would show, kind]
  // shelf 'detail' = in the summary data but not a custom encoding.
  const CAT = ['category', 'week_start', 'Week Start', 'date'];
  const VAL = ['value', 'load_pct', 'AGG(Load %)', 'num'];
  const MEM = ['member', 'resource', 'Resource', 'string'];
  const SEL = ['detail', 'is_selected', 'Is Selected', 'bool'];
  const CAP = ['detail', 'capacity_hours', 'SUM(Capacity Hours)', 'num'];
  const SCH = ['detail', 'scheduled_hours', 'SUM(Scheduled Hours)', 'num'];
  const FULL = [CAT, VAL, MEM, SEL, CAP, SCH];
  const SHELVES = {
    default: FULL,
    plain: FULL,
    formatted: FULL,
    dateobj: FULL,
    one: FULL,
    small: FULL,
    many: FULL,
    long: [['category', 'week_start', 'Program', 'string'], VAL, MEM, SEL, CAP, SCH],
    split: FULL.concat([['detail', 'project', 'Project', 'string']]),
    colormeasure: [CAT, VAL, MEM, ['color', 'hours_over', 'SUM(Hours Over)', 'num'], SEL, CAP],
    colorname: [CAT, VAL, MEM, ['color', 'band', 'Band', 'string'], SEL, CAP],
    summary: [CAT, ['value', 'load_pct', 'AGG(Load %)', 'num'],
      ['detail', 'team_min', 'Team Min', 'num'], ['detail', 'team_p25', 'Team P25', 'num'],
      ['detail', 'team_median', 'Team Median', 'num'], ['detail', 'team_p75', 'Team P75', 'num'],
      ['detail', 'team_max', 'Team Max', 'num'], CAP],
    minimal: [CAT, VAL],
    nohighlight: [CAT, VAL, MEM, CAP],
    uid: [CAT, VAL, ['member', 'resource_id', 'Resource Id', 'string'], ['detail', 'resource', 'Resource Name', 'string'], SEL, CAP],
    salary: [['category', 'grade', 'Grade', 'string'], ['value', 'salary', 'AVG(Salary)', 'num'],
      ['member', 'employee', 'Employee', 'string'], ['detail', 'grade_order', 'MIN(Grade Order)', 'int']],
  };
  const shelves = SHELVES[scenario] || SHELVES.default;

  // The look of the original mockup: percent of capacity, a line at 100%, four bands.
  const LIMIT_LOOK = {
    valueFormat: 'percent', valueDecimals: 0, groupLabel: 'Team',
    refShow: true, refValue: 1, refLabel: 'capacity',
    bands: [
      { upTo: 0.85, color: '#5fa2ce', label: 'Has room' },
      { upTo: 1, color: '#57606c', label: 'Full' },
      { upTo: 1.2, color: '#fc7d0b', label: 'Over' },
      { upTo: null, color: '#c85200', label: 'Far over' },
    ],
    catFormat: 'md', catTitle: 'Week of', noteTemplate: '{note} h cap', noteKey: 'Usual capacity: {baseline} h',
    title: "{highlight} sits above the team's middle in {above} of {n} weeks and is over capacity in {over}.",
    subtitle: 'Load % (scheduled ÷ capacity)',
  };
  const look = (extra) => Object.assign({}, LIMIT_LOOK, extra || {});
  if (['default', 'formatted', 'dateobj', 'one', 'small', 'many', 'long', 'split', 'uid', 'summary'].indexOf(scenario) !== -1) seedSettings(look());
  if (scenario === 'colormeasure') {
    seedSettings(look({ bands: [
      { upTo: -6, color: '#5fa2ce', label: 'Open 6 h or more' },
      { upTo: 0, color: '#57606c', label: 'Within capacity' },
      { upTo: 6, color: '#fc7d0b', label: 'Over by up to 6 h' },
      { upTo: null, color: '#c85200', label: 'Over by more than 6 h' },
    ] }));
  }
  if (scenario === 'colorname') seedSettings(look({ bands: [] }));
  if (scenario === 'salary') seedSettings({ title: 'Where {highlight} sits in each grade', valueFormat: 'compact', valueDecimals: 0, valuePrefix: '$', groupLabel: 'Grade', highlightPick: 'Employee 05' });

  // Minimal CSV parser (quoted fields, commas inside quotes).
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const head = rows.shift();
    return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
  }

  function cell(raw, kind) {
    if (raw == null || raw === '') return { value: null, nativeValue: null, formattedValue: 'Null' };
    if (kind === 'num') {
      const n = Number(raw);
      // Tableau's default for a fraction is a plain number string.
      let f = String(Math.round(n * 1000) / 1000);
      if (scenario === 'formatted') f = (n * 100).toFixed(1) + '%';
      if (scenario === 'salary') f = Math.round(n).toLocaleString('en-US');
      return { value: n, nativeValue: n, formattedValue: f };
    }
    if (kind === 'int') {
      const n = Number(raw);
      return { value: n, nativeValue: n, formattedValue: String(Math.round(n)) };
    }
    if (kind === 'bool') {
      const b = /^true$/i.test(String(raw));
      return { value: b, nativeValue: b, formattedValue: b ? 'True' : 'False' };
    }
    if (kind === 'date') {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
      const f = m ? Number(m[2]) + '/' + Number(m[3]) + '/' + m[1] : raw;
      const native = scenario === 'dateobj' && m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : raw;
      return { value: native, nativeValue: native, formattedValue: f };
    }
    return { value: raw, nativeValue: raw, formattedValue: raw };
  }

  function quantile(sorted, p) {
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }
  function isoPlus(iso, days) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // A repeatable stand-in for random numbers, so every load draws the same chart.
  function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

  let dataTable = null;
  const ready = fetch('./sample-data/sample.csv', { cache: 'no-store' })
    .then((r) => r.text())
    .then((text) => {
      let records = parseCsv(text);
      records.forEach((r) => {
        const l = Number(r.load_pct);
        r.hours_over = String(Math.round((Number(r.scheduled_hours) - Number(r.capacity_hours)) * 10) / 10);
        r.band = l > 1.2 ? 'Far over' : (l > 1 ? 'Over' : (l >= 0.85 ? 'Full' : 'Has room'));
      });
      const weeks = Array.from(new Set(records.map((r) => r.week_start)));

      if (scenario === 'summary') {
        // What a level of detail calculation would hand over: one row per week.
        records = weeks.map((w) => {
          const all = records.filter((r) => r.week_start === w);
          const v = all.map((r) => Number(r.load_pct)).sort((a, b) => a - b);
          const me = all.find((r) => /^true$/i.test(r.is_selected));
          return Object.assign({}, me, { team_min: String(v[0]), team_p25: String(quantile(v, 0.25)), team_median: String(quantile(v, 0.5)),
            team_p75: String(quantile(v, 0.75)), team_max: String(v[v.length - 1]) });
        });
      }
      if (scenario === 'minimal') records = records.filter((r) => /^true$/i.test(r.is_selected));
      if (scenario === 'one') records = records.filter((r) => r.week_start === weeks[0]);
      if (scenario === 'small') {
        const keep = Array.from(new Set(records.map((r) => r.resource))).slice(0, 2);
        records = records.filter((r) => keep.indexOf(r.resource) !== -1);
      }
      if (scenario === 'long') {
        const names = ['Enterprise resource planning upgrade and data migration program', 'Student information system integration',
          'Research computing storage refresh for the regional campuses', 'Identity and access management', 'Network core replacement, phase two of four',
          'Learning management system', 'Classroom technology standardization and support model review', 'Service desk'];
        records.forEach((r) => { r.week_start = names[weeks.indexOf(r.week_start) % names.length]; });
      }
      if (scenario === 'many') {
        const out = [];
        for (let k = 0; k < 60; k++) {
          const w = weeks[k % weeks.length];
          records.filter((r) => r.week_start === w).forEach((r) => {
            out.push(Object.assign({}, r, { week_start: isoPlus(weeks[0], k * 7), load_pct: String(Math.round(Number(r.load_pct) * (0.8 + 0.4 * ((k * 7) % 11) / 10) * 100) / 100) }));
          });
        }
        records = out;
      }
      if (scenario === 'split') {
        // A dimension on Detail doubles the rows; the halves add up to the whole.
        const out = [];
        records.forEach((r) => {
          out.push(Object.assign({}, r, { project: 'Project work', load_pct: String(Number(r.load_pct) * 0.6), scheduled_hours: String(Number(r.scheduled_hours) * 0.6) }));
          out.push(Object.assign({}, r, { project: 'Run the business', load_pct: String(Number(r.load_pct) * 0.4), scheduled_hours: String(Number(r.scheduled_hours) * 0.4) }));
        });
        records = out;
      }
      if (scenario === 'salary') {
        // Six grades, 40 fake employees spread across them, salaries widening with grade.
        const rand = rng(7);
        const out = [];
        for (let e = 0; e < 40; e++) {
          const g = 1 + (e % 6);
          const base = 42000 + g * 14500;
          out.push({ grade: 'Grade ' + g + (g === 6 ? ' and senior staff' : ''), grade_order: String(g), employee: 'Employee ' + String(e + 1).padStart(2, '0'),
            salary: String(Math.round(base * (0.82 + rand() * 0.4))) });
        }
        // Employee 05 holds a row in every grade so there is a dot to follow.
        for (let g = 1; g <= 6; g++) {
          if (!out.some((r) => r.employee === 'Employee 05' && r.grade_order === String(g))) {
            out.push({ grade: 'Grade ' + g + (g === 6 ? ' and senior staff' : ''), grade_order: String(g), employee: 'Employee 05', salary: String(Math.round((42000 + g * 14500) * (0.9 + 0.04 * g))) });
          }
        }
        records = out;
      }

      const columns = shelves.map((s, i) => ({ fieldName: s[2], dataType: s[3] === 'num' ? 'float' : s[3], index: i }));
      const data = records.map((r) => shelves.map((s) => cell(r[s[1]], scenario === 'long' && s[0] === 'category' ? 'string' : s[3])));
      dataTable = { columns, data, totalRowCount: data.length };
      console.log('[preview] scenario "' + scenario + '": ' + data.length + ' rows from sample.csv');
    });

  const mockStart = Date.now();
  let openReaders = 0;

  const worksheet = {
    name: 'Sheet 1',
    // Like the real library: an unknown event type throws.
    addEventListener: function (type) {
      if (!type) throw new Error('unsupported-event-name: Cannot add event, unsupported event type: ' + type);
    },
    getVisualSpecificationAsync: function () {
      const custom = shelves.filter((s) => s[0] !== 'detail');
      if (renameMs > 0 && (Date.now() - mockStart) < renameMs) {
        return Promise.resolve({ activeMarksSpecificationIndex: 0,
          marksSpecifications: [{ markType: 'bar', encodings: custom.map((s) => ({ id: s[0] })) }] });
      }
      return Promise.resolve({
        activeMarksSpecificationIndex: 0,
        marksSpecifications: [{
          markType: 'bar',
          // The spec names the field without its aggregation; the data column
          // carries it. viz.js has to match the two.
          encodings: custom.map((s) => ({ id: s[0], field: { name: s[2].replace(/^[A-Z]+\((.*)\)$/, '$1') } })),
        }],
      });
    },
    getSummaryDataReaderAsync: function () {
      return ready.then(() => {
        // Tableau allows one open reader per worksheet.
        if (openReaders > 0) throw new Error('mock: a data reader is already open. Release it before opening another.');
        openReaders++;
        let released = false;
        return {
          pageCount: 1,
          getAllPagesAsync: function () {
            if (released) return Promise.reject(new Error('mock: reader used after release'));
            if (slowMs > 0 && (Date.now() - mockStart) < slowMs) {
              return Promise.resolve({ columns: dataTable.columns, data: [], totalRowCount: 0 });
            }
            return Promise.resolve(dataTable);
          },
          releaseAsync: function () {
            if (!released) { released = true; openReaders--; }
            return Promise.resolve();
          },
        };
      });
    },
  };

  // Settings persisted to localStorage so the preview remembers your choices.
  const settings = {
    get: function (key) {
      try { return window.localStorage.getItem(storePrefix + key); } catch (e) { return null; }
    },
    set: function (key, val) {
      try { window.localStorage.setItem(storePrefix + key, val); } catch (e) {}
    },
    saveAsync: function () { return Promise.resolve(); },
  };

  window.tableau = {
    extensions: {
      initializeAsync: function () { return ready; },
      worksheetContent: { worksheet: worksheet },
      settings: settings,
      environment: { context: 'preview', mode: 'authoring' },
    },
    TableauEventType: {
      // Only events the real library defines (it has no VisualSpecificationChanged).
      SummaryDataChanged: 'summary-data-changed',
    },
  };
})();
