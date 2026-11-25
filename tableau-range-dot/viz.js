'use strict';

// Range Dot: a Tableau Viz Extension.
// One column per member of the Category field. Each column shows where a
// group sits (a light bar for its range, a darker band for its middle, a
// line for its center) and a dot for one highlighted member, colored by
// bands with boundaries set in the panel.
// All options live in the floating "Range Dot Settings" panel opened from
// the gear in the top-right corner. The panel can be dragged anywhere and
// previews every change live. Plain SVG, no charting library.
//
// HOW THIS FILE IS LAID OUT
//   PART 1  What the chart is: shelves, Detail inputs, settings, controls.
//   PART 2  The chart: buildModel(), drawChart(), the tooltip.
//   PART 3  Plumbing: startup, the panel, data loading with retries,
//           formatting, diagnostics. Rarely needs editing.
// To make a new chart, rewrite Part 2 and adjust the lists in Part 1.

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const NAME = 'Range Dot';
  const SLUG = 'range-dot';
  const VERSION = '1.1.0';

  // =========================================================================
  // PART 1: WHAT THE CHART IS
  // =========================================================================

  // The custom shelves, matching the <encoding id> values in the .trex.
  // Tableau allows FOUR at most. Anything else rides on Detail (EXTRAS).
  //   category  one column per member (a week, a grade, a store)
  //   value     the measure being compared
  //   member    who the range is made of (a person, a product). Optional when
  //             the range arrives as ready-made fields on Detail.
  //   color     optional. A measure is cut into bands at boundaries set in the
  //             panel; a dimension colors the dot by its own names.
  const SHELVES = ['category', 'value', 'member', 'color'];
  // Shelves that must be filled before anything can draw.
  const REQUIRED = ['category', 'value'];
  // The required shelf that has to hold numbers.
  const NUMERIC_SHELF = 'value';

  // Inputs read from the built-in Detail shelf, matched by field name. Each
  // one gets a dropdown on the Fields tab (Auto, Not used, or a named field).
  // numeric: true means the column must hold numbers; any: true takes either.
  const EXTRAS = [
    { key: 'highlight', label: 'Highlight (the dot)', any: true, re: /highlight|selected|select|focus|spotlight|is[ _]?me|flag|chosen/i },
    { key: 'name', label: 'Member name', re: /name|label/i },
    { key: 'note', label: 'Category note', any: true, re: /note|capacity|cap|availab|annotation|comment|caption/i },
    { key: 'order', label: 'Sort order', numeric: true, re: /order|rank|sort|sequence|position/i },
    { key: 'low', label: 'Range low', numeric: true, re: /\bmin|minimum|lowest|\blow\b|floor/i },
    { key: 'q1', label: 'Band low', numeric: true, re: /pct25|p25|q1\b|25th|lower quartile|first quartile/i },
    { key: 'mid', label: 'Center', numeric: true, re: /median|pct50|p50|midpoint|50th|\bmid\b/i },
    { key: 'q3', label: 'Band high', numeric: true, re: /pct75|p75|q3\b|75th|upper quartile|third quartile/i },
    { key: 'high', label: 'Range high', numeric: true, re: /\bmax|maximum|highest|\bhigh\b|ceiling/i },
  ];

  const PALETTES = {
    colorblind: ['#1170aa', '#fc7d0b', '#a3acb9', '#57606c', '#5fa2ce', '#c85200', '#7b848f', '#a3cce9', '#ffbc79', '#c8d0d9'],
    tableau10: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
    ocean: ['#003f5c', '#2f6f8f', '#3d85c6', '#4cc0c0', '#6fd3c7', '#9adcd6', '#1b98a2', '#0e5a8a'],
    sunset: ['#f94144', '#f3722c', '#f8961e', '#f9844a', '#f9c74f', '#e76f51', '#ef476f', '#ffb703'],
    earth: ['#582f0e', '#7f4f24', '#936639', '#a68a64', '#b6ad90', '#656d4a', '#414833', '#333d29'],
    mono: ['#1b1b1b', '#3d3d3d', '#5c5c5c', '#7a7a7a', '#999999', '#b8b8b8', '#d0d0d0', '#e6e6e6'],
  };
  const PALETTE_ORDER = [
    ['colorblind', 'Color Blind'], ['tableau10', 'Tableau 10'], ['ocean', 'Ocean'],
    ['sunset', 'Sunset'], ['earth', 'Earth'], ['mono', 'Mono'],
  ];
  // Low to high, for new boundary bands: blue, slate, orange, dark orange.
  const BAND_RAMP = ['#5fa2ce', '#57606c', '#fc7d0b', '#c85200', '#1170aa', '#a3acb9', '#ffbc79', '#7b848f'];

  // Every setting needs a default here. Saved settings are merged over these,
  // so a workbook saved before a setting existed still opens.
  const DEFAULTS = {
    // Layout
    fit: 'fill',                  // fill | fixed
    colWidth: 90,
    barWidth: 22,                 // px, capped at 70% of the column
    radius: 4,
    sortBy: 'auto',               // auto | order | name | data
    showCategories: true,
    catFormat: 'auto',            // auto | md | mond | mdy | monyear
    showCatTitle: true,
    catTitle: '',                 // '' => the field name
    noteShow: 'unusual',          // unusual | always | never
    noteTemplate: '{note}',
    noteUsual: '',                // the baseline; '' => the most common note
    noteWhich: 'any',             // any | below | above the baseline
    noteTolPct: 1,                // % of the baseline that still counts as equal
    noteAccent: false,
    noteColor: '#c85200',
    noteKey: '',                  // a line for the key, e.g. 'Usual capacity: {baseline} h'
    showAxis: true,
    axisZero: true,
    gridlines: true,
    // Range
    rangeKind: 'minmax',          // minmax | p5p95 | p10p90 | none
    bandKind: 'iqr',              // iqr | p10p90 | sd | none
    centerKind: 'median',         // median | mean | none
    rangeIncludes: true,
    showPeers: false,
    groupLabel: 'Group',
    rangeColor: '#e3e7eb',
    bandColor: '#c8d0d9',
    centerColor: '#8f99a5',
    centerWeight: 2,
    // Dot
    highlightPick: '',            // '' => the Highlight field; else a member
    dotSize: 9,
    dotRing: 2.5,
    dotLabels: 'auto',            // auto | right | above | off
    colorMode: 'auto',            // auto | bounds | position | field | single
    bands: [],                    // [{ upTo: number|null, color, label }], last has upTo null
    boundEdge: 'lower',           // a value exactly on a boundary: lower | upper band
    posBelow: '#5fa2ce',
    posInside: '#57606c',
    posAbove: '#fc7d0b',
    nameColors: {},
    singleColor: '#1170aa',
    // Values
    valueFormat: 'auto',          // auto | percent | percent100 | number | compact
    valueDecimals: 1,
    valueSep: true,
    valuePrefix: '',
    valueSuffix: '',
    hoverTips: true,
    tipArea: 'marks',
    tipStats: true,
    tipDiff: true,
    tipNames: true,
    // Reference line
    refShow: false,
    refValue: 1,
    refLabel: '',
    refColor: '#2b2f33',
    refWidth: 1.25,
    refDash: true,
    // Title
    showTitle: true,
    title: '',                    // '' => sheet name
    subtitle: '',
    legend: 'show',               // show | hidden
    // Colors
    palette: 'colorblind',
    background: '#ffffff',
    gridColor: '#e6e9ec',
    // Fonts
    fontFamily: 'Poppins',
    titleSize: 18,
    subtitleSize: 13,
    labelSize: 12,
    textColor: '#2b2f33',
    mutedColor: '#5f6770',
    // Fields: which Detail column feeds each EXTRAS input ('auto', '' or a name)
    fieldMap: { highlight: 'auto', name: 'auto', note: 'auto', order: 'auto', low: 'auto', q1: 'auto', mid: 'auto', q3: 'auto', high: 'auto' },
  };

  // [element id, settings key, kind, label formatter for ranges].
  // kind: select | check | range | text | color | number.
  const CONTROLS = [
    ['sel-fit', 'fit', 'select'],
    ['rng-colwidth', 'colWidth', 'range', (v) => v + 'px'],
    ['rng-barwidth', 'barWidth', 'range', (v) => v + 'px'],
    ['rng-radius', 'radius', 'range', (v) => (v > 0 ? v + 'px' : 'Square')],
    ['sel-sort', 'sortBy', 'select'],
    ['chk-catlabels', 'showCategories', 'check'],
    ['sel-catfmt', 'catFormat', 'select'],
    ['chk-cattitle', 'showCatTitle', 'check'],
    ['inp-cattitle', 'catTitle', 'text'],
    ['sel-noteshow', 'noteShow', 'select'],
    ['inp-notetpl', 'noteTemplate', 'text'],
    ['inp-noteusual', 'noteUsual', 'text'],
    ['sel-notewhich', 'noteWhich', 'select'],
    ['rng-notetol', 'noteTolPct', 'range', (v) => (v > 0 ? v + '%' : 'Exact')],
    ['chk-noteaccent', 'noteAccent', 'check'],
    ['col-notecolor', 'noteColor', 'color'],
    ['inp-notekey', 'noteKey', 'text'],
    ['chk-axis', 'showAxis', 'check'],
    ['chk-axiszero', 'axisZero', 'check'],
    ['chk-grid', 'gridlines', 'check'],

    ['sel-rangekind', 'rangeKind', 'select'],
    ['sel-bandkind', 'bandKind', 'select'],
    ['sel-centerkind', 'centerKind', 'select'],
    ['chk-rangeincl', 'rangeIncludes', 'check'],
    ['chk-peers', 'showPeers', 'check'],
    ['inp-grouplabel', 'groupLabel', 'text'],
    ['col-range', 'rangeColor', 'color'],
    ['col-band', 'bandColor', 'color'],
    ['col-center', 'centerColor', 'color'],
    ['rng-centerweight', 'centerWeight', 'range', (v) => v + 'px'],

    ['rng-dotsize', 'dotSize', 'range', (v) => v + 'px'],
    ['rng-dotring', 'dotRing', 'range', (v) => (v > 0 ? v + 'px' : 'None')],
    ['sel-dotlabels', 'dotLabels', 'select'],
    ['sel-colormode', 'colorMode', 'select'],
    ['sel-boundedge', 'boundEdge', 'select'],
    ['col-posbelow', 'posBelow', 'color'],
    ['col-posinside', 'posInside', 'color'],
    ['col-posabove', 'posAbove', 'color'],
    ['col-single', 'singleColor', 'color'],

    ['sel-valfmt', 'valueFormat', 'select'],
    ['rng-valdec', 'valueDecimals', 'range', (v) => String(v)],
    ['chk-valsep', 'valueSep', 'check'],
    ['inp-valprefix', 'valuePrefix', 'text'],
    ['inp-valsuffix', 'valueSuffix', 'text'],
    ['chk-tips', 'hoverTips', 'check'],
    ['sel-tiparea', 'tipArea', 'select'],
    ['chk-tipstats', 'tipStats', 'check'],
    ['chk-tipdiff', 'tipDiff', 'check'],
    ['chk-tipnames', 'tipNames', 'check'],

    ['chk-refshow', 'refShow', 'check'],
    ['num-refvalue', 'refValue', 'number'],
    ['inp-reflabel', 'refLabel', 'text'],
    ['col-refcolor', 'refColor', 'color'],
    ['rng-refwidth', 'refWidth', 'range', (v) => v + 'px'],
    ['chk-refdash', 'refDash', 'check'],

    ['chk-showtitle', 'showTitle', 'check'],
    ['inp-title', 'title', 'text'],
    ['inp-subtitle', 'subtitle', 'text'],
    ['sel-legend', 'legend', 'select'],

    ['col-background', 'background', 'color'],
    ['col-grid', 'gridColor', 'color'],

    ['sel-font', 'fontFamily', 'select'],
    ['rng-titlesize', 'titleSize', 'range', (v) => v + 'px'],
    ['rng-subtitlesize', 'subtitleSize', 'range', (v) => v + 'px'],
    ['rng-labelsize', 'labelSize', 'range', (v) => v + 'px'],
    ['col-text', 'textColor', 'color'],
    ['col-muted', 'mutedColor', 'color'],
  ];

  // Rows that only make sense for some choices. Called whenever the draft
  // changes, so the panel grays out what does not apply.
  function updateDependentRows() {
    if (!draft) return;
    const off = (rowId, ctlId, isOff) => {
      const row = $(rowId);
      if (row) row.classList.toggle('off', isOff);
      const ctl = ctlId && $(ctlId);
      if (ctl) ctl.disabled = isOff;
    };
    off('row-colwidth', 'rng-colwidth', draft.fit !== 'fixed');
    off('row-catfmt', 'sel-catfmt', !draft.showCategories);
    const noNote = draft.noteShow === 'never';
    off('row-notetpl', 'inp-notetpl', noNote);
    off('row-noteusual', 'inp-noteusual', noNote);
    off('row-notewhich', 'sel-notewhich', noNote);
    off('row-notetol', 'rng-notetol', noNote);
    off('row-noteaccent', 'chk-noteaccent', noNote);
    $('col-notecolor').disabled = noNote || !draft.noteAccent;
    off('row-refvalue', 'num-refvalue', !draft.refShow);
    off('row-reflabel', 'inp-reflabel', !draft.refShow);
    const m = lastData ? safeModel(lastData, draft) : null;
    const cm = m ? m.colorMode : draft.colorMode;
    // Boundaries stay live under Automatic, where adding one switches them on.
    $('sec-bounds').classList.toggle('off', draft.colorMode === 'position' || draft.colorMode === 'field' ||
      draft.colorMode === 'single' || (draft.colorMode === 'auto' && !!m && m.colorNames.length > 0));
    $('sec-position').classList.toggle('off', cm !== 'position');
    $('sec-names').classList.toggle('off', cm !== 'field');
    off('row-single', 'col-single', cm !== 'single');
  }

  // Everything in the panel that is built from the data or is not a plain
  // control: the highlight picker, the boundary editor, the named colors.
  // Called by populatePanel() each time the panel is filled.
  function populateExtra() {
    buildHighlightPicker();
    buildBandList();
    buildNameColorList();
  }

  function safeModel(data, cfg) {
    try { return buildModel(data, cfg); } catch (e) { return null; }
  }

  function buildHighlightPicker() {
    const sel = $('sel-hlpick');
    clear(sel);
    const m = lastData ? safeModel(lastData, draft) : null;
    const fieldName = m && m.extras.highlight !== -1 ? lastData.cols[m.extras.highlight].name : '';
    addOption(sel, '', fieldName ? 'From the field: ' + fieldName : 'No one (no Highlight field found)');
    if (m && m.mode === 'members') m.members.forEach((mb) => addOption(sel, mb.key, mb.name));
    sel.value = draft.highlightPick;
    if (sel.value !== draft.highlightPick) sel.value = '';
    sel.disabled = !m || m.mode !== 'members';
    sel.onchange = () => { draft.highlightPick = sel.value; schedulePreview(); };
  }

  // The boundary editor: one row per boundary, then the band above the last.
  function buildBandList() {
    const list = $('band-list');
    clear(list);
    const bands = cleanBands(draft.bands);
    const m = lastData ? safeModel(lastData, draft) : null;
    const commit = (rebuild) => {
      draft.bands = rebuild ? cleanBands(bands) : bands;
      if (rebuild) buildBandList();
      updateDependentRows();
      schedulePreview();
    };
    if (!bands.length) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = 'No boundaries yet. Add one, or let the data suggest a set.';
      list.appendChild(h);
    }
    bands.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'band-row';
      const lead = document.createElement('span');
      lead.className = 'band-lead';
      const isLast = b.upTo == null;
      lead.textContent = isLast ? 'Above that' : 'Up to';
      row.appendChild(lead);
      if (isLast) {
        const sp = document.createElement('span');
        sp.className = 'band-num';
        row.appendChild(sp);
      } else {
        const num = document.createElement('input');
        num.type = 'number';
        num.step = 'any';
        num.className = 'band-num';
        num.value = b.upTo;
        num.title = m ? 'Shows as ' + fmtColorValue(b.upTo, m, draft) : '';
        num.addEventListener('input', () => { const n = Number(num.value); if (num.value !== '' && isFinite(n)) { b.upTo = n; commit(false); } });
        // Sort only once the typing is done, so the row does not jump mid-edit.
        num.addEventListener('change', () => commit(true));
        row.appendChild(num);
      }
      const col = document.createElement('input');
      col.type = 'color';
      col.value = normalizeHex(b.color) || '#57606c';
      col.addEventListener('input', () => { b.color = col.value; commit(false); });
      row.appendChild(col);
      const lab = document.createElement('input');
      lab.type = 'text';
      lab.placeholder = 'Label';
      lab.value = b.label || '';
      lab.addEventListener('input', () => { b.label = lab.value; commit(false); });
      row.appendChild(lab);
      const del = document.createElement('button');
      del.className = 'band-del';
      del.textContent = '×';
      del.title = 'Remove this boundary';
      if (isLast) del.style.visibility = 'hidden';
      del.addEventListener('click', () => { bands.splice(i, 1); if (bands.length === 1) bands.length = 0; commit(true); });
      row.appendChild(del);
      list.appendChild(row);
    });
    const hint = $('hint-bandrange');
    if (m && m.colorStats) {
      hint.textContent = 'Type boundaries in the data’s own units. ' + m.colorSourceName + ' runs from ' +
        trimNum(m.colorStats.min) + ' to ' + trimNum(m.colorStats.max) + (m.isPct && m.colorSource === 'value'
          ? ', shown as ' + fmtColorValue(m.colorStats.min, m, draft) + ' to ' + fmtColorValue(m.colorStats.max, m, draft) + '.' : '.');
    } else hint.textContent = 'Type boundaries in the data’s own units (0.75 for 75% when the data holds fractions).';
  }

  function addBand() {
    if (!draft) return;
    const bands = cleanBands(draft.bands);
    const m = lastData ? safeModel(lastData, draft) : null;
    const nums = bands.filter((b) => b.upTo != null).map((b) => b.upTo);
    let next;
    if (nums.length >= 2) next = nums[nums.length - 1] + (nums[nums.length - 1] - nums[nums.length - 2]);
    else if (nums.length === 1) next = m && m.colorStats && m.colorStats.max > nums[0] ? (nums[0] + m.colorStats.max) / 2 : nums[0] * 2 || 1;
    else next = m && m.colorStats ? m.colorStats.median : 1;
    next = Number(trimNum(next));
    if (!bands.length) bands.push({ upTo: null, color: BAND_RAMP[1], label: '' });
    bands.splice(bands.length - 1, 0, { upTo: next, color: BAND_RAMP[(bands.length - 1) % BAND_RAMP.length], label: '' });
    // Recolor along the ramp while every band still has a ramp color.
    if (bands.every((b) => BAND_RAMP.indexOf(b.color) !== -1) && bands.length <= 4) bands.forEach((b, i) => { b.color = BAND_RAMP[i]; });
    draft.bands = cleanBands(bands);
    buildBandList();
    updateDependentRows();
    schedulePreview();
  }

  // Three boundaries at the quartiles of the color values, as a starting set.
  function suggestBands() {
    if (!draft || !lastData) return;
    const m = safeModel(lastData, Object.assign(clone(draft), { bands: [] }));
    if (!m || !m.colorStats) return;
    const s = m.colorStats;
    const cuts = [s.q1, s.median, s.q3].map((v) => Number(trimNum(v))).filter((v, i, a) => a.indexOf(v) === i);
    draft.bands = cleanBands(cuts.map((v, i) => ({ upTo: v, color: BAND_RAMP[i], label: '' }))
      .concat([{ upTo: null, color: BAND_RAMP[cuts.length], label: '' }]));
    buildBandList();
    updateDependentRows();
    schedulePreview();
  }

  // One click for the most common use: a value that is a share of a limit
  // (hours against capacity, spend against budget, sales against quota).
  function quickLimit() {
    if (!draft) return;
    const m = lastData ? safeModel(lastData, draft) : null;
    // Fractions (1 = at the limit) unless the data clearly holds 0 to 100.
    const k = m && !m.isPct && m.valueMax > 10 ? 100 : 1;
    draft.valueFormat = k === 100 ? 'percent100' : 'percent';
    draft.valueDecimals = 0;
    draft.refShow = true;
    draft.refValue = k;
    if (!draft.refLabel.trim()) draft.refLabel = 'limit';
    draft.colorMode = 'auto';
    draft.boundEdge = 'lower';
    draft.bands = [
      { upTo: 0.85 * k, color: BAND_RAMP[0], label: 'Has room' },
      { upTo: 1 * k, color: BAND_RAMP[1], label: 'Full' },
      { upTo: 1.2 * k, color: BAND_RAMP[2], label: 'Over' },
      { upTo: null, color: BAND_RAMP[3], label: 'Far over' },
    ];
    if (!draft.title.trim()) draft.title = '{highlight} is above the {group} median in {above} of {n} and over the {ref} in {over}.';
    populatePanel();
    schedulePreview();
  }

  // Colors for the names a Color dimension holds, one row per name.
  function buildNameColorList() {
    const list = $('name-color-list');
    clear(list);
    const m = lastData ? safeModel(lastData, draft) : null;
    if (!m || !m.colorNames.length) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = 'Put a dimension on the Color shelf to color the dot by its names.';
      list.appendChild(h);
      return;
    }
    m.colorNames.forEach((nm) => {
      const row = document.createElement('div');
      row.className = 'band-row';
      const col = document.createElement('input');
      col.type = 'color';
      col.value = m.nameColor(nm);
      col.addEventListener('input', () => { draft.nameColors[nm] = col.value; schedulePreview(); });
      const lab = document.createElement('span');
      lab.className = 'band-name';
      lab.textContent = nm;
      lab.title = nm;
      row.appendChild(col);
      row.appendChild(lab);
      list.appendChild(row);
    });
  }

  // Wiring for the buttons above. Called once at startup.
  function wireExtra() {
    $('btn-band-add').addEventListener('click', addBand);
    $('btn-band-suggest').addEventListener('click', suggestBands);
    $('btn-band-clear').addEventListener('click', () => {
      if (!draft) return;
      draft.bands = [];
      buildBandList();
      updateDependentRows();
      schedulePreview();
    });
    $('btn-names-reset').addEventListener('click', () => {
      if (!draft) return;
      draft.nameColors = {};
      buildNameColorList();
      schedulePreview();
    });
    $('btn-quick-limit').addEventListener('click', quickLimit);
  }

  // =========================================================================
  // PART 2: THE CHART
  // =========================================================================

  // Boundaries as saved can be anything (an older version, a pasted block).
  // Returns [] or a clean ascending list whose last band has upTo null.
  function cleanBands(raw) {
    if (!Array.isArray(raw)) return [];
    const nums = [];
    let top = null;
    raw.forEach((b) => {
      if (!b || typeof b !== 'object') return;
      const color = normalizeHex(b.color) || '#57606c';
      const label = b.label == null ? '' : String(b.label);
      const n = (b.upTo === null || b.upTo === undefined || b.upTo === '') ? null : Number(b.upTo);
      if (n == null) { if (!top) top = { upTo: null, color, label }; } else if (isFinite(n)) nums.push({ upTo: n, color, label });
    });
    if (!nums.length) return [];
    nums.sort((a, b) => a.upTo - b.upTo);
    return nums.concat([top || { upTo: null, color: BAND_RAMP[nums.length % BAND_RAMP.length], label: '' }]);
  }

  // Which band a value falls in. edge says where a value exactly on a
  // boundary belongs: 'lower' keeps it in the band below, 'upper' moves it up.
  function bandIndex(v, bands, edge) {
    for (let i = 0; i < bands.length - 1; i++) {
      if (edge === 'upper' ? v < bands[i].upTo : v <= bands[i].upTo) return i;
    }
    return bands.length - 1;
  }

  // Linear interpolation between ranks, the same answer as Tableau's
  // PERCENTILE and Excel's PERCENTILE.INC.
  function quantile(sorted, p) {
    const n = sorted.length;
    if (!n) return null;
    const h = (n - 1) * p;
    const lo = Math.floor(h), hi = Math.ceil(h);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
  }

  function statsOf(values) {
    const s = values.slice().sort((a, b) => a - b);
    const n = s.length;
    if (!n) return null;
    const mean = s.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(s.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (n - 1)) : 0;
    return { n, min: s[0], max: s[n - 1], mean, sd, median: quantile(s, 0.5), q1: quantile(s, 0.25), q3: quantile(s, 0.75),
      p5: quantile(s, 0.05), p95: quantile(s, 0.95), p10: quantile(s, 0.1), p90: quantile(s, 0.9) };
  }

  function truthy(cell) {
    if (!cell) return false;
    if (cell.v === true || cell.v === 1) return true;
    const s = String(cell.v == null ? cell.f : cell.v).trim();
    return /^(true|t|yes|y|1|x|selected|highlight|highlighted)$/i.test(s);
  }

  // A category's date, when it is one. Tableau's own text is tried first: it
  // already says which calendar day is meant, whatever the time zone.
  function dateOf(cell) {
    if (!cell) return null;
    const tryStr = (raw) => {
      const s = String(raw == null ? '' : raw).trim();
      let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
      if (m) return new Date(Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]) - 1, Number(m[2]));
      if (/[a-z]{3}/i.test(s) && /\d{4}/.test(s)) { const t = Date.parse(s); if (isFinite(t)) return new Date(t); }
      return null;
    };
    const d = tryStr(cell.f) || tryStr(cell.v);
    return d && isFinite(d.getTime()) ? d.getTime() : null;
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(ms, how) {
    const d = new Date(ms);
    if (how === 'md') return (d.getMonth() + 1) + '/' + d.getDate();
    if (how === 'mond') return MONTHS[d.getMonth()] + ' ' + d.getDate();
    if (how === 'mdy') return (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2);
    if (how === 'monyear') return MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    return '';
  }

  // 40.00 -> '40', 0.8500001 -> '0.85'.
  function trimNum(v) {
    if (v == null || !isFinite(v)) return '';
    const a = Math.abs(v);
    const d = a >= 100 ? 1 : (a >= 1 ? 2 : 3);
    return String(Number(Number(v).toFixed(d)));
  }

  // Turn raw rows into what the drawing needs. PURE: it takes the settings as
  // an argument, so the panel can preview draft choices and Diagnostics can
  // describe the applied ones. Never read S or draft in here.
  //
  // Three shapes of data are accepted:
  //   members  Member shelf filled: one row per category and member. The
  //            range, the middle band and the center are computed here.
  //   summary  Member shelf empty, range fields on Detail: one row per
  //            category that already carries low, high and the rest.
  //   dots     neither: one dot per category and nothing behind it.
  function buildModel(data, cfg) {
    const sh = data.shelf;
    const ex = resolveExtras(data, cfg);
    const has = (i) => i != null && i !== -1;
    const hasMember = has(sh.member);
    const hasColorField = has(sh.color);
    const colorNumeric = hasColorField && isNumericCol(data, sh.color);
    const summaryFields = (ex.low !== -1 && ex.high !== -1) || (ex.q1 !== -1 && ex.q3 !== -1);
    const mode = hasMember ? 'members' : (summaryFields ? 'summary' : 'dots');
    const catIsDate = /date/i.test(data.cols[sh.category].type || '');

    const cats = [];
    const catByKey = new Map();
    const members = [];
    const memberByKey = new Map();
    let summed = 0;

    data.cells.forEach((r, i) => {
      const ckey = textOf(r[sh.category]);
      let cat = catByKey.get(ckey);
      if (!cat) {
        cat = { key: ckey, date: dateOf(r[sh.category]), order: null, row: i, entries: new Map(), given: {}, notes: [] };
        catByKey.set(ckey, cat);
        cats.push(cat);
      }
      if (ex.order !== -1) {
        const o = numOf(r[ex.order]);
        if (o != null && (cat.order == null || o < cat.order)) cat.order = o;
      }
      if (mode === 'summary') {
        ['low', 'q1', 'mid', 'q3', 'high'].forEach((k) => {
          if (ex[k] !== -1 && cat.given[k] == null) cat.given[k] = numOf(r[ex[k]]);
        });
      }
      const mkey = hasMember ? textOf(r[sh.member]) : '\u0000dot';
      let mb = memberByKey.get(mkey);
      if (!mb) {
        mb = { key: mkey, name: hasMember ? mkey : '', flagged: false, shown: '' };
        memberByKey.set(mkey, mb);
        members.push(mb);
      }
      if (ex.highlight !== -1 && truthy(r[ex.highlight])) mb.flagged = true;
      if (ex.name !== -1 && !mb.shown) mb.shown = textOf(r[ex.name]);

      const v = numOf(r[sh.value]);
      let e = cat.entries.get(mkey);
      if (!e) {
        e = { member: mb, v: null, f: '', n: 0, colorV: null, colorT: '', colorF: '', note: '' };
        cat.entries.set(mkey, e);
      }
      // A dimension on Detail splits a category and member into several
      // rows. Add them up so there is still one value each. Right for sums
      // and counts, wrong for averages and ratios, so a notice says so.
      if (v != null) {
        e.v = (e.v == null ? 0 : e.v) + v;
        e.n++;
        e.f = e.n === 1 ? r[sh.value].f : '';
      }
      if (hasColorField) {
        if (colorNumeric) {
          const cv = numOf(r[sh.color]);
          if (cv != null) { e.colorV = (e.colorV == null ? 0 : e.colorV) + cv; e.colorF = e.n <= 1 ? r[sh.color].f : ''; }
        } else if (!e.colorT) e.colorT = textOf(r[sh.color]);
      }
      if (ex.note !== -1 && !e.note) {
        const nc = r[ex.note];
        e.note = typeof nc.v === 'number' ? trimNum(nc.v) : textOf(nc);
      }
    });
    cats.forEach((c) => c.entries.forEach((e) => { if (e.n > 1) summed++; }));

    // A name field only helps when it tells the members apart.
    const shownNames = new Set(members.map((m) => m.shown).filter(Boolean));
    const useNames = mode === 'members' && ex.name !== -1 && (members.length < 2 || shownNames.size > 1);
    members.forEach((m) => { if (useNames && m.shown) m.name = m.shown; });

    // Who gets a dot.
    let highlighted = [];
    let highlightFrom = 'none';
    if (mode !== 'members') {
      highlighted = members.slice();
      highlightFrom = 'row';
    } else {
      const pick = String(cfg.highlightPick || '').trim();
      const picked = pick ? members.filter((m) => m.key === pick || m.name === pick) : [];
      if (picked.length) { highlighted = picked; highlightFrom = 'picked'; }
      else {
        const flagged = members.filter((m) => m.flagged);
        // A field that is true for everyone singles nobody out.
        if (flagged.length && (flagged.length < members.length || members.length === 1)) { highlighted = flagged; highlightFrom = 'field'; }
      }
    }
    const hlKeys = new Set(highlighted.map((m) => m.key));

    // Order the categories.
    const hasOrder = ex.order !== -1 && cats.some((c) => c.order != null);
    const allDates = cats.length > 0 && cats.every((c) => c.date != null) &&
      (catIsDate || cats.every((c) => /^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(c.key)));
    let by = cfg.sortBy;
    if (by === 'auto') by = hasOrder ? 'order' : (allDates ? 'date' : 'data');
    if (by === 'order' && !hasOrder) by = 'data';
    const sorted = cats.slice();
    if (by === 'order') sorted.sort((a, b) => (a.order == null ? Infinity : a.order) - (b.order == null ? Infinity : b.order));
    else if (by === 'date') sorted.sort((a, b) => a.date - b.date);
    else if (by === 'name') sorted.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));

    // Per category: the range, the band, the center, the dots.
    const rangeOn = cfg.rangeKind !== 'none';
    const bandOn = cfg.bandKind !== 'none';
    const centerOn = cfg.centerKind !== 'none';
    const allNums = [];
    const out = [];
    sorted.forEach((cat) => {
      const c = { key: cat.key, date: cat.date, label: cat.key, lo: null, hi: null, bandLo: null, bandHi: null, center: null,
        n: 0, stats: null, dots: [], peers: [], note: '' };
      if (cat.date != null && allDates && cfg.catFormat !== 'auto') c.label = fmtDate(cat.date, cfg.catFormat) || cat.key;
      const entries = Array.from(cat.entries.values()).filter((e) => e.v != null);
      if (mode === 'members') {
        const pool = entries.filter((e) => cfg.rangeIncludes || !hlKeys.has(e.member.key));
        const st = statsOf(pool.map((e) => e.v));
        c.stats = st;
        if (st) {
          c.n = st.n;
          if (rangeOn) {
            if (cfg.rangeKind === 'p5p95') { c.lo = st.p5; c.hi = st.p95; }
            else if (cfg.rangeKind === 'p10p90') { c.lo = st.p10; c.hi = st.p90; }
            else { c.lo = st.min; c.hi = st.max; }
          }
          if (bandOn) {
            if (cfg.bandKind === 'p10p90') { c.bandLo = st.p10; c.bandHi = st.p90; }
            else if (cfg.bandKind === 'sd') { c.bandLo = st.mean - st.sd; c.bandHi = st.mean + st.sd; }
            else { c.bandLo = st.q1; c.bandHi = st.q3; }
          }
          if (centerOn) c.center = cfg.centerKind === 'mean' ? st.mean : st.median;
        }
        c.peers = entries.filter((e) => !hlKeys.has(e.member.key));
      } else if (mode === 'summary') {
        const g = cat.given;
        if (rangeOn && g.low != null && g.high != null) { c.lo = Math.min(g.low, g.high); c.hi = Math.max(g.low, g.high); }
        if (bandOn && g.q1 != null && g.q3 != null) { c.bandLo = Math.min(g.q1, g.q3); c.bandHi = Math.max(g.q1, g.q3); }
        if (centerOn && g.mid != null) c.center = g.mid;
      }
      c.dots = entries.filter((e) => hlKeys.has(e.member.key));
      // The note belongs to the highlighted member when there is one, else it
      // is the most common note among the rows.
      const noted = (c.dots.length ? c.dots : entries).map((e) => e.note).filter(Boolean);
      c.note = mostCommon(noted);
      [c.lo, c.hi, c.bandLo, c.bandHi, c.center].forEach((v) => { if (v != null) allNums.push(v); });
      c.dots.forEach((e) => allNums.push(e.v));
      if (cfg.showPeers) c.peers.forEach((e) => allNums.push(e.v));
      out.push(c);
    });
    const hasRange = out.some((c) => c.lo != null || c.bandLo != null || c.center != null);
    const hasDots = out.some((c) => c.dots.length > 0);

    // Notes: a baseline everyone expects (40 hours, say) and the exceptions
    // to it. The baseline is the most common note unless one was typed.
    const noteList = out.map((c) => c.note).filter(Boolean);
    const hasNotes = noteList.length > 0;
    const noteDetected = mostCommon(noteList);
    const noteBaseline = String(cfg.noteUsual || '').trim() || noteDetected;
    const baseNum = noteBaseline !== '' && isFinite(Number(noteBaseline)) ? Number(noteBaseline) : null;
    out.forEach((c) => {
      c.noteDiff = null;
      c.noteException = false;
      if (!c.note || noteBaseline === '') return;
      const nv = isFinite(Number(c.note)) ? Number(c.note) : null;
      if (baseNum != null && nv != null) {
        // A small tolerance, so 39.9 against 40 is not called out.
        const tol = Math.abs(baseNum) * Math.max(0, cfg.noteTolPct) / 100 + 1e-9;
        c.noteDiff = nv - baseNum;
        c.noteException = cfg.noteWhich === 'below' ? c.noteDiff < -tol
          : (cfg.noteWhich === 'above' ? c.noteDiff > tol : Math.abs(c.noteDiff) > tol);
      } else c.noteException = !sameNote(c.note, noteBaseline);
    });
    const noteExceptions = out.filter((c) => c.noteException).length;

    // Percent detection. Tableau's own format reaches the extension only
    // sometimes, so a measure that looks like a share reads as a percent
    // unless the Values tab says otherwise: every value within 0 to 1, or a
    // field named like a rate whose values stay small.
    const valueName = cleanFieldName(data.cols[sh.value].name);
    const everyV = [];
    cats.forEach((cat) => cat.entries.forEach((e) => { if (e.v != null) everyV.push(e.v); }));
    const tabPct = cats.some((cat) => Array.from(cat.entries.values()).some((e) => /%/.test(e.f || '')));
    const maxAbs = everyV.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
    const within01 = everyV.length > 0 && everyV.some((v) => v > 0 && v < 1) && everyV.every((v) => v >= 0 && v <= 1);
    const rateName = /%|pct|percent|rate|ratio|share|utili[sz]/i.test(valueName);
    const fraction = !tabPct && (within01 || (rateName && maxAbs <= 10 && everyV.some((v) => v % 1 !== 0)));
    // Seen in Tableau 2026.3: a field with a percent default format arrives as
    // 0.81 with the text "81%". The values Tableau formatted keep its text, but
    // everything worked out here (the axis, the median, the range) has no text
    // of its own and must read the same way, with the same decimals.
    let tabFraction = false, tabDecimals = 0;
    if (tabPct) {
      cats.forEach((cat) => cat.entries.forEach((e) => {
        if (e.v == null || !/%/.test(e.f || '')) return;
        const shown = parseFloat(String(e.f).replace(/[^0-9.\-]/g, ''));
        if (!isFinite(shown)) return;
        const dec = (String(e.f).split('.')[1] || '').replace(/[^0-9]/g, '').length;
        if (Math.abs(shown - e.v * 100) <= 0.51 / Math.pow(10, dec)) { tabFraction = true; tabDecimals = Math.max(tabDecimals, dec); }
      }));
    }

    // Dot color.
    const bands = cleanBands(cfg.bands);
    const pal = paletteOf(cfg.palette);
    const colorNames = [];
    if (hasColorField && !colorNumeric) {
      cats.forEach((cat) => cat.entries.forEach((e) => { if (e.colorT && !colorNames.includes(e.colorT)) colorNames.push(e.colorT); }));
    }
    const nameColor = (nm) => normalizeHex((cfg.nameColors || {})[nm]) || normalizeHex(nm) ||
      pal[Math.max(0, colorNames.indexOf(nm)) % pal.length];
    let colorMode = cfg.colorMode;
    if (colorMode === 'auto') colorMode = colorNames.length ? 'field' : (bands.length ? 'bounds' : (hasRange ? 'position' : 'single'));
    if (colorMode === 'field' && !colorNames.length) colorMode = 'single';
    if (colorMode === 'bounds' && !bands.length) colorMode = 'single';
    if (colorMode === 'position' && !hasRange) colorMode = 'single';
    const colorSource = colorNumeric ? 'color' : 'value';
    const colorSourceName = colorNumeric ? cleanFieldName(data.cols[sh.color].name) : valueName;
    const sameColorCol = !colorNumeric || sh.color === sh.value;
    // Statistics over every member, not only the dot, so a suggested set of
    // boundaries still fits when someone else is highlighted.
    const colorVals = [];
    cats.forEach((cat) => cat.entries.forEach((e) => {
      const cv = colorNumeric ? e.colorV : e.v;
      if (cv != null) colorVals.push(cv);
    }));
    out.forEach((c) => c.dots.forEach((e) => {
      const cv = colorNumeric ? e.colorV : e.v;
      e.cv = cv;
      e.band = '';
      if (colorMode === 'bounds' && cv != null) {
        const b = bands[bandIndex(cv, bands, cfg.boundEdge)];
        e.color = b.color;
        e.band = b.label;
      } else if (colorMode === 'position') {
        const lo = c.bandLo != null ? c.bandLo : c.center;
        const hi = c.bandHi != null ? c.bandHi : c.center;
        if (lo == null) { e.color = cfg.posInside; }
        else if (e.v < lo) { e.color = cfg.posBelow; e.band = 'Below the middle'; }
        else if (e.v > hi) { e.color = cfg.posAbove; e.band = 'Above the middle'; }
        else { e.color = cfg.posInside; e.band = 'In the middle'; }
      } else if (colorMode === 'field' && e.colorT) {
        e.color = nameColor(e.colorT);
        e.band = e.colorT;
      } else e.color = cfg.singleColor;
    }));
    const colorStats = colorVals.length ? statsOf(colorVals) : null;

    // The numbers a headline can quote.
    const refOn = cfg.refShow && isFinite(cfg.refValue);
    let above = 0, below = 0, over = 0, under = 0, nDots = 0;
    out.forEach((c) => {
      if (!c.dots.length) return;
      nDots++;
      const v = c.dots.reduce((a, e) => a + e.v, 0) / c.dots.length;
      if (c.center != null) { if (v > c.center) above++; else if (v < c.center) below++; }
      if (refOn) { if (v > cfg.refValue) over++; else if (v < cfg.refValue) under++; }
    });
    const hlNames = highlighted.map((m) => m.name).filter(Boolean);
    const groupLabel = String(cfg.groupLabel || '').trim() || 'Group';
    const fieldNames = {
      category: cleanFieldName(data.cols[sh.category].name),
      value: valueName,
      member: hasMember ? cleanFieldName(data.cols[sh.member].name) : '',
      color: hasColorField ? cleanFieldName(data.cols[sh.color].name) : '',
    };
    const refLabel = String(cfg.refLabel || '').trim();
    const tokens = {
      highlight: hlNames.length === 0 ? valueName : (hlNames.length <= 2 ? hlNames.join(' and ') : hlNames.length + ' ' + (fieldNames.member || 'members')),
      group: groupLabel.toLowerCase(), Group: groupLabel,
      category: fieldNames.category, value: valueName, member: fieldNames.member,
      n: nDots, above, below, over, under, ref: refLabel || 'line',
      baseline: noteBaseline, exceptions: noteExceptions,
    };

    if (refOn) allNums.push(cfg.refValue);
    let lo = allNums.length ? Math.min.apply(null, allNums) : 0;
    let hi = allNums.length ? Math.max.apply(null, allNums) : 1;
    if (cfg.axisZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (hi === lo) hi = lo + (Math.abs(lo) || 1);

    return { mode, cats: out, hasNotes, noteBaseline, noteDetected, noteExceptions, members: mode === 'members' ? members : [], highlighted, highlightFrom, hasRange, hasDots,
      hasMember, hasColorField, colorNumeric, colorMode, colorSource, colorSourceName, sameColorCol, colorNames, nameColor,
      colorStats, bands, pal, lo, hi, valueMax: maxAbs, summed, tabPct, tabFraction, tabDecimals, fraction, isPct: tabPct || fraction, refOn,
      extras: ex, fieldNames, groupLabel, refLabel, tokens, sortedBy: by, allDates };
  }

  // A note with the words around it: "{note} h cap" turns 24 into "24 h cap".
  // {value} means the same as {note}; {baseline} is the usual value and
  // {diff} the signed gap to it.
  function noteLabel(c, model, cfg) {
    if (!c.note) return '';
    const tpl = String(cfg.noteTemplate || '').trim();
    if (!tpl) return c.note;
    if (!/\{(note|value|baseline|diff)\}/.test(tpl)) return tpl;
    const diff = c.noteDiff == null ? '' : (c.noteDiff > 0 ? '+' : '') + trimNum(c.noteDiff);
    return tpl.replace(/\{(note|value)\}/g, c.note).replace(/\{baseline\}/g, model.noteBaseline).replace(/\{diff\}/g, diff);
  }
  // 40 and 40.0 are the same note; so are two spellings that differ in case.
  function sameNote(a, b) {
    const x = String(a).trim(), y = String(b).trim();
    if (x !== '' && y !== '' && isFinite(Number(x)) && isFinite(Number(y))) return Number(x) === Number(y);
    return x.toLowerCase() === y.toLowerCase();
  }

  function mostCommon(list) {
    let best = '', bestN = 0;
    const counts = new Map();
    list.forEach((x) => {
      const n = (counts.get(x) || 0) + 1;
      counts.set(x, n);
      if (n > bestN) { best = x; bestN = n; }
    });
    return best;
  }

  // A value from the color source, shown the way the reader will see it.
  function fmtColorValue(v, model, cfg) {
    if (model.colorSource === 'value' || model.sameColorCol) return fmtValue(v, '', model, cfg);
    return fixed(v, Math.abs(v) >= 100 ? 0 : Math.min(2, Math.max(1, cfg.valueDecimals)), cfg.valueSep);
  }

  function fillTemplate(text, model) {
    const t = model.tokens;
    return String(text || '').replace(/\{(\w+)\}/g, (all, k) => (Object.prototype.hasOwnProperty.call(t, k) ? String(t[k]) : all));
  }

  // What each piece is called, for the key and the tooltip.
  function partNames(model, cfg) {
    const G = model.groupLabel;
    const range = model.mode === 'summary' ? G + ' range'
      : ({ minmax: G + ' range', p5p95: G + ' 5th to 95th percentile', p10p90: G + ' 10th to 90th percentile' })[cfg.rangeKind] || '';
    const band = model.mode === 'summary' ? 'Middle band'
      : ({ iqr: 'Middle half', p10p90: 'Middle 80%', sd: 'Within 1 standard deviation' })[cfg.bandKind] || '';
    const center = model.mode === 'summary' ? G + ' center' : (cfg.centerKind === 'mean' ? G + ' average' : G + ' median');
    const ends = model.mode === 'summary' ? ['Low', 'High']
      : ({ minmax: ['Low', 'High'], p5p95: ['5th percentile', '95th percentile'], p10p90: ['10th percentile', '90th percentile'] })[cfg.rangeKind] || ['', ''];
    const bandEnds = model.mode === 'summary' ? ['Band low', 'Band high']
      : ({ iqr: ['25th percentile', '75th percentile'], p10p90: ['10th percentile', '90th percentile'], sd: ['1 standard deviation below', '1 standard deviation above'] })[cfg.bandKind] || ['', ''];
    const centerShort = model.mode === 'summary' ? 'Center' : (cfg.centerKind === 'mean' ? 'Average' : 'Median');
    return { range, band, center, ends, bandEnds, centerShort };
  }

  // Draw everything from the cached data and the settings in force.
  function draw() {
    if (!lastData) return;
    const cfg = cfgNow();
    let model;
    try { model = buildModel(lastData, cfg); } catch (e) { recordError('model', e); return; }
    lastModel = model;
    updateHints(model, cfg);
    try {
      drawHeader(model, cfg);
      drawChart(model, cfg);
    } catch (e) {
      recordError('draw', e);
      showNotice('Part of the chart could not be drawn. Open the gear, Fields tab, and copy the Diagnostics.');
      return;
    }
    if (model.summed > 0 && !summedNoticeShown) {
      summedNoticeShown = true;
      showNotice(model.summed + ' values arrived as several rows, because a field on Detail splits them. ' +
        'They were added together, which is right for sums and counts but not for averages or ratios.');
    } else if (model.summed === 0 && summedNoticeShown) {
      // The data changed and the note no longer applies.
      summedNoticeShown = false;
      hideNotice();
    }
  }

  // Plain-words status lines in the panel, so a switch that cannot do anything
  // yet says why instead of looking broken.
  function updateHints(model, cfg) {
    const set = (id, text) => { const el = $(id); if (el) { el.textContent = text; el.style.display = text ? 'block' : 'none'; } };
    set('hint-mode', model.mode === 'members'
      ? 'The range is worked out here from ' + model.members.length + ' ' + (model.fieldNames.member || 'members') + '.'
      : model.mode === 'summary' ? 'The Member shelf is empty, so the range comes from the low and high fields on Detail (see the Fields tab).'
        : 'Nothing to build a range from yet. Put a dimension on Member, or put low and high fields on Detail.');
    set('hint-dot', model.mode !== 'members' ? 'Each row is its own dot, so there is no one to pick.'
      : model.highlightFrom === 'none' ? 'No one is highlighted yet, so no dot is drawn. Pick a member here, or put a true or false field on Detail.'
        : model.highlightFrom === 'field' ? 'Highlighted by the field ' + lastData.cols[model.extras.highlight].name + ': ' + model.tokens.highlight + '.'
          : 'Picked here: ' + model.tokens.highlight + '. Choose the first entry to follow the Highlight field again.');
    const using = { bounds: 'boundaries on ' + model.colorSourceName, position: 'position against the ' + model.groupLabel.toLowerCase(),
      field: 'the names in ' + model.fieldNames.color, single: 'one color' }[model.colorMode];
    let why = '';
    if (cfg.colorMode === 'bounds' && model.colorMode !== 'bounds') why = ' Boundaries was chosen, but none are set yet.';
    if (cfg.colorMode === 'field' && model.colorMode !== 'field') why = ' Color names was chosen, but the Color shelf holds no dimension.';
    if (cfg.colorMode === 'position' && model.colorMode !== 'position') why = ' Position was chosen, but there is no range to compare with.';
    set('hint-color', 'Now coloring by ' + using + '.' + why);
    const noteField = model.extras.note !== -1 ? lastData.cols[model.extras.note].name : '';
    set('hint-baseline', !noteField ? 'No note field was found on Detail. Put one there, such as capacity hours, or pick it on the Fields tab.'
      : !model.hasNotes ? 'The note field ' + noteField + ' is empty for these columns.'
        : 'Detected baseline: ' + model.noteDetected + ' (the most common value of ' + noteField + ').' +
          (String(cfg.noteUsual || '').trim() ? ' Using the typed baseline, ' + model.noteBaseline + '.' : '') +
          ' ' + model.noteExceptions + ' of ' + model.cats.length + ' columns count as exceptions.');
  }

  function drawHeader(model, cfg) {
    const title = $('h-title');
    const sub = $('h-sub');
    clear(title);
    const text = fillTemplate(cfg.title.trim() || sheetName || NAME, model);
    title.style.display = cfg.showTitle ? 'block' : 'none';
    title.style.fontSize = cfg.titleSize + 'px';
    // Text before a | is bold, the rest regular weight.
    const bar = text.indexOf('|');
    const b = document.createElement('span');
    b.textContent = bar === -1 ? text : text.slice(0, bar).trim();
    title.appendChild(b);
    if (bar !== -1) {
      const rest = document.createElement('span');
      rest.className = 'h-rest';
      rest.textContent = ' | ' + text.slice(bar + 1).trim();
      title.appendChild(rest);
    }
    const subText = fillTemplate(cfg.subtitle, model);
    sub.textContent = subText;
    sub.style.display = cfg.showTitle && subText.trim() ? 'block' : 'none';
    sub.style.fontSize = cfg.subtitleSize + 'px';
    sub.style.color = cfg.mutedColor;

    // The key: what the light bar, the darker band, the line and the dot are.
    const lg = $('legend');
    clear(lg);
    const showLegend = cfg.legend === 'show';
    lg.style.display = showLegend ? 'flex' : 'none';
    lg.style.fontSize = Math.max(10, cfg.labelSize - 1) + 'px';
    lg.style.color = cfg.mutedColor;
    if (showLegend) {
      const names = partNames(model, cfg);
      const add = (cls, style, label) => {
        const item = document.createElement('div');
        item.className = 'lg-item';
        const g = document.createElement('span');
        g.className = cls;
        Object.assign(g.style, style);
        const nm = document.createElement('span');
        nm.textContent = label;
        item.appendChild(g);
        item.appendChild(nm);
        lg.appendChild(item);
      };
      const drawn = (k) => model.cats.some((c) => c[k] != null);
      if (drawn('lo') && names.range) add('lg-bar', { background: cfg.rangeColor }, names.range);
      if (drawn('bandLo') && names.band) add('lg-bar', { background: cfg.bandColor }, names.band);
      if (drawn('center')) add('lg-line', { background: cfg.centerColor }, names.center);
      if (cfg.showPeers && model.cats.some((c) => c.peers.length)) add('lg-peer', { background: cfg.mutedColor }, 'Each ' + (model.fieldNames.member || 'member').toLowerCase());
      if (model.hasDots) {
        if (model.colorMode === 'bounds') {
          add('lg-dot lg-open', { borderColor: cfg.mutedColor }, model.tokens.highlight + ':');
          model.bands.forEach((bd, i) => add('lg-dot', { background: bd.color }, bandLabel(model, cfg, i)));
        } else if (model.colorMode === 'position') {
          add('lg-dot lg-open', { borderColor: cfg.mutedColor }, model.tokens.highlight + ':');
          add('lg-dot', { background: cfg.posBelow }, 'below the middle');
          add('lg-dot', { background: cfg.posInside }, 'in the middle');
          add('lg-dot', { background: cfg.posAbove }, 'above the middle');
        } else if (model.colorMode === 'field') {
          add('lg-dot lg-open', { borderColor: cfg.mutedColor }, model.tokens.highlight + ':');
          model.colorNames.forEach((nm) => add('lg-dot', { background: model.nameColor(nm) }, nm));
        } else add('lg-dot', { background: cfg.singleColor }, model.tokens.highlight);
      }
      // An optional line that states the baseline, so the exceptions under
      // the columns have something to read against.
      const keyLine = model.hasNotes ? fillTemplate(String(cfg.noteKey || '').trim(), model) : '';
      if (keyLine) {
        const item = document.createElement('div');
        item.className = 'lg-item lg-text';
        item.textContent = keyLine;
        lg.appendChild(item);
      }
      if (!lg.firstChild) lg.style.display = 'none';
    }
    // An empty header should take no room at all.
    $('header').style.display = (cfg.showTitle || (showLegend && lg.firstChild)) ? 'block' : 'none';
  }

  // A band's label for the key: the one typed, or its limits spelled out.
  function bandLabel(model, cfg, i) {
    const b = model.bands[i];
    if (b.label && b.label.trim()) return b.label.trim();
    if (b.upTo == null) return 'above ' + fmtColorValue(model.bands[i - 1].upTo, model, cfg);
    return 'up to ' + fmtColorValue(b.upTo, model, cfg);
  }

  // Tick spacing that lands on round numbers: 1, 2, 2.5 or 5 times a power of ten.
  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    const nice = f <= 1 ? 1 : (f <= 2 ? 2 : (f <= 2.5 ? 2.5 : (f <= 5 ? 5 : 10)));
    return nice * pow;
  }

  function drawChart(model, cfg) {
    const body = $('body');
    const svg = $('chart');
    clear(svg);
    const n = model.cats.length;
    // offset sizes, not client sizes: they do not change when a scrollbar
    // appears, so the layout cannot feed back on itself.
    const W = body.offsetWidth;
    let H = body.offsetHeight;
    body.style.overflowY = 'hidden';
    if (W < 60 || H < 40 || n === 0) { body.style.overflowX = 'hidden'; sizeSvg(svg, Math.max(W, 1), 1); return; }

    const fs = cfg.labelSize;
    const f = (v) => fmtValue(v, '', model, cfg);
    const tw = (s, size, bold) => textWidthEstimate(s, size) * (bold ? 1.04 : 1);

    // Left gutter: the value axis labels, and the category field's name.
    const axisW = cfg.showAxis ? Math.max(tw(f(model.hi), fs - 1), tw(f(model.lo), fs - 1)) + 8 : 0;
    const catTitle = cfg.showCategories && cfg.showCatTitle ? (cfg.catTitle.trim() || model.fieldNames.category) : '';
    const catTitleW = catTitle ? Math.min(tw(catTitle, fs), 130) + 10 : 0;
    const padLeft = 14 + Math.max(axisW, catTitleW);

    // Dot labels: beside the dot when the gap to the next column allows, above
    // it when the column is wide enough, hidden when neither is true.
    const oneDot = model.cats.every((c) => c.dots.length <= 1);
    let lw = 0;
    model.cats.forEach((c) => c.dots.forEach((e) => { lw = Math.max(lw, tw(fmtValue(e.v, e.f, model, cfg), fs - 1, true)); }));
    const r0 = cfg.dotSize;
    const colFor = (padR) => (cfg.fit === 'fixed' ? cfg.colWidth : Math.max(6, (W - padLeft - padR) / n));
    const barFor = (cw) => Math.max(2, Math.min(cfg.barWidth, cw * 0.7));
    const overFor = (cw) => Math.max(0, Math.min(5, (cw - barFor(cw)) / 2 - 1));
    const fitsRight = (cw) => lw + Math.min(r0, cw * 0.45) + 5 <= cw - barFor(cw) / 2 - overFor(cw) - 3;
    let padRight = 16;
    let colW = colFor(padRight);
    let labelMode = cfg.dotLabels;
    if (!model.hasDots) labelMode = 'off';
    if (labelMode === 'auto') {
      if (!oneDot) labelMode = 'off';
      else if (fitsRight(colW)) labelMode = 'right';
      else labelMode = lw + 4 <= colW ? 'above' : 'off';
    }
    if (labelMode === 'right') {
      // The last label needs room past the last column.
      padRight = Math.max(16, Math.min(r0, colW * 0.45) + 5 + lw + 8 - colW / 2);
      colW = colFor(padRight);
      if (cfg.dotLabels === 'auto' && !fitsRight(colW)) {
        labelMode = lw + 4 <= colFor(16) ? 'above' : 'off';
        padRight = 16;
        colW = colFor(padRight);
      }
    }
    const barW = barFor(colW);
    const over = overFor(colW);
    const r = Math.max(2.5, Math.min(r0, colW * 0.45));
    const ring = Math.min(cfg.dotRing, r * 0.5);

    // Sideways scrolling only when asked for (fixed columns), or when the
    // columns would otherwise be too thin to see.
    const contentW = Math.ceil(padLeft + n * colW + padRight);
    const scrollsX = contentW > W + 1;
    body.style.overflowX = scrollsX ? 'auto' : 'hidden';
    if (scrollsX) H -= scrollbarWidth();
    const svgW = scrollsX ? contentW : W;
    sizeSvg(svg, svgW, H);

    // Category labels: one line when they fit, wrapped when the columns are
    // wide enough to wrap into, otherwise every few columns.
    const labels = model.cats.map((c) => c.label);
    const maxLabelW = cfg.showCategories ? Math.max.apply(null, labels.map((s) => tw(s, fs))) : 0;
    let every = 1;
    let lineSets = labels.map((s) => [s]);
    if (cfg.showCategories && maxLabelW + 8 > colW) {
      if (colW >= 44) lineSets = labels.map((s) => wrapLabel(s, fs, colW - 6));
      else every = Math.max(1, Math.ceil((Math.min(maxLabelW, 84) + 10) / colW));
    }
    const maxLines = cfg.showCategories ? Math.max.apply(null, lineSets.map((l) => l.length)) : 0;
    // Notes: every one, only those that differ from the usual, or none.
    const noteText = (c) => noteLabel(c, model, cfg);
    const showNote = (c) => cfg.showCategories && c.note && cfg.noteShow !== 'never' &&
      (cfg.noteShow === 'always' || c.noteException);
    const anyNote = model.cats.some(showNote);
    const lineH = fs * 1.25;
    const padBottom = (cfg.showCategories ? 8 + maxLines * lineH : 6) + (anyNote ? (fs - 1.5) * 1.3 : 0) + 6;
    const padTop = r + ring + 6 + (labelMode === 'above' ? fs + 2 : 0);

    const x0 = padLeft;
    const x1 = x0 + n * colW;
    const y0 = padTop;
    const y1 = Math.max(y0 + 20, H - padBottom);

    // Value axis on round numbers.
    const step = niceStep(model.hi - model.lo, clamp(Math.round((y1 - y0) / 56), 2, 8));
    const lo = Math.floor(model.lo / step + 1e-9) * step;
    let hi = Math.ceil(model.hi / step - 1e-9) * step;
    if (hi <= lo) hi = lo + step;
    const y = (v) => y1 - ((v - lo) / (hi - lo)) * (y1 - y0);
    const halo = { stroke: cfg.background, 'stroke-width': 3.5, 'paint-order': 'stroke', 'stroke-linejoin': 'round' };

    // Axis labels carry only the decimals the tick spacing needs: 50%, not 50.0%.
    const pctLike = cfg.valueFormat === 'percent' || (cfg.valueFormat === 'auto' && (model.fraction || model.tabFraction));
    const shownStep = pctLike ? step * 100 : step;
    const axisDec = shownStep >= 1 ? (Math.abs(shownStep % 1) < 1e-9 ? 0 : 1) : Math.min(4, Math.ceil(-Math.log10(shownStep) - 1e-9));
    const axisCfg = cfg.valueFormat === 'compact' ? cfg : Object.assign({}, cfg, { valueDecimals: axisDec, axisDecimals: axisDec });
    const fAxis = (v) => fmtValue(v, '', model, axisCfg);

    for (let k = 0, v = lo; v <= hi + step * 1e-6; k++, v = lo + k * step) {
      const yy = Math.round(y(v)) + 0.5;
      if (cfg.gridlines) svg.appendChild(makeEl('line', { x1: x0, x2: x1, y1: yy, y2: yy, stroke: cfg.gridColor, 'stroke-width': 1 }));
      if (cfg.showAxis) {
        svg.appendChild(makeEl('text', { x: x0 - 8, y: yy + (fs - 1) * 0.35, 'text-anchor': 'end', 'font-size': fs - 1, fill: cfg.mutedColor },
          fAxis(Math.abs(v) < step * 1e-6 ? 0 : v)));
      }
    }
    if (!cfg.gridlines) svg.appendChild(makeEl('line', { x1: x0, x2: x1, y1: Math.round(y1) + 0.5, y2: Math.round(y1) + 0.5, stroke: cfg.gridColor, 'stroke-width': 1 }));

    const refG = makeEl('g', {});
    if (model.refOn) {
      const yy = Math.round(y(cfg.refValue)) + 0.5;
      const attrs = { x1: x0, x2: x1, y1: yy, y2: yy, stroke: cfg.refColor, 'stroke-width': cfg.refWidth };
      if (cfg.refDash) attrs['stroke-dasharray'] = '4 3';
      refG.appendChild(makeEl('line', attrs));
    }
    svg.appendChild(refG);

    const names = partNames(model, cfg);
    const colEls = [];
    const labelEls = [];
    model.cats.forEach((c, i) => {
      const cx = x0 + (i + 0.5) * colW;
      const g = makeEl('g', { class: 'col-g' });
      svg.appendChild(g);
      if (c.lo != null) {
        const top = y(c.hi), h = Math.max(2, y(c.lo) - y(c.hi));
        g.appendChild(makeEl('rect', { class: 'mark', x: cx - barW / 2, y: top - (h === 2 ? 1 : 0), width: barW, height: h,
          rx: Math.min(cfg.radius, barW / 2, h / 2), fill: cfg.rangeColor }));
      }
      if (c.bandLo != null) {
        const top = y(c.bandHi), h = Math.max(2, y(c.bandLo) - y(c.bandHi));
        g.appendChild(makeEl('rect', { class: 'mark', x: cx - barW / 2, y: top - (h === 2 ? 1 : 0), width: barW, height: h,
          rx: Math.min(Math.max(0, cfg.radius - 1), barW / 2, h / 2), fill: cfg.bandColor }));
      }
      if (c.center != null) {
        g.appendChild(makeEl('line', { class: 'mark', x1: cx - barW / 2 - over, x2: cx + barW / 2 + over, y1: y(c.center), y2: y(c.center),
          stroke: cfg.centerColor, 'stroke-width': cfg.centerWeight, 'stroke-linecap': 'round' }));
      }
      if (cfg.showPeers) {
        const pr = clamp(barW * 0.14, 1.8, 3.2);
        c.peers.forEach((e) => {
          const p = makeEl('circle', { class: 'mark peer', cx, cy: y(e.v), r: pr, fill: cfg.mutedColor, 'fill-opacity': 0.5 });
          p.appendChild(makeEl('title', {}, e.member.name + ': ' + fmtValue(e.v, e.f, model, cfg)));
          g.appendChild(p);
        });
      }
      c.dots.forEach((e) => {
        const cy = y(e.v);
        const attrs = { class: 'mark dot', cx, cy, r, fill: e.color };
        if (ring > 0) { attrs.stroke = cfg.background; attrs['stroke-width'] = ring; }
        g.appendChild(makeEl('circle', attrs));
        if (labelMode === 'right' || labelMode === 'above') {
          const t = fmtValue(e.v, e.f, model, cfg);
          const pos = labelMode === 'right'
            ? { x: cx + r + ring / 2 + 4, y: cy + (fs - 1) * 0.36, 'text-anchor': 'start' }
            : { x: cx, y: cy - r - ring / 2 - 4, 'text-anchor': 'middle' };
          const te = makeEl('text', Object.assign({ class: 'dot-label', 'font-size': fs - 1, 'font-weight': 600, fill: cfg.textColor }, pos, halo), t);
          g.appendChild(te);
          labelEls.push(te);
        }
      });

      if (cfg.showCategories && i % every === 0) {
        const lines = every > 1 ? [c.label] : lineSets[i];
        const maxW = every > 1 ? every * colW - 6 : Math.max(colW - 4, 10);
        lines.forEach((ln, li) => {
          const t = makeEl('text', { x: every > 1 ? cx - colW / 2 + 2 : cx, y: y1 + 8 + fs * 0.85 + li * lineH,
            'text-anchor': every > 1 ? 'start' : 'middle', 'font-size': fs, fill: cfg.textColor }, ln);
          g.appendChild(t);
          fitText(t, maxW);
        });
        if (showNote(c)) {
          const t = makeEl('text', { x: every > 1 ? cx - colW / 2 + 2 : cx, y: y1 + 8 + maxLines * lineH + (fs - 1.5) * 0.95,
            'text-anchor': every > 1 ? 'start' : 'middle', 'font-size': fs - 1.5,
            fill: cfg.noteAccent && c.noteException ? cfg.noteColor : cfg.mutedColor,
            'font-weight': cfg.noteAccent && c.noteException ? 600 : 400 }, noteText(c));
          g.appendChild(t);
          fitText(t, maxW);
        }
      }

      // Where hovering counts. By default only the marks themselves: the bar
      // from its lowest to its highest piece, and each dot. Empty space above
      // and below the bar, and the labels under it, stay quiet. The old
      // behavior, the whole column, is the "column" choice on the Values tab.
      const hit = makeEl('g', { class: 'hit' });
      if (cfg.tipArea === 'column') {
        hit.appendChild(makeEl('rect', { x: cx - colW / 2, y: 0, width: colW, height: H, fill: 'transparent' }));
      } else {
        const ends = [c.lo, c.hi, c.bandLo, c.bandHi, c.center].filter((v) => v != null);
        if (ends.length) {
          // A thin bar or a flat range still gets a target a hand can find.
          const wHit = Math.min(colW, Math.max(barW + over * 2, 10));
          let top = y(Math.max.apply(null, ends)) - 2;
          let bot = y(Math.min.apply(null, ends)) + 2;
          if (bot - top < 8) { const mid = (top + bot) / 2; top = mid - 4; bot = mid + 4; }
          hit.appendChild(makeEl('rect', { x: cx - wHit / 2, y: top, width: wHit, height: bot - top, fill: 'transparent' }));
        }
        c.dots.forEach((e) => {
          hit.appendChild(makeEl('circle', { cx, cy: y(e.v), r: Math.min(colW / 2, r + ring / 2 + 2), fill: 'transparent' }));
        });
        if (cfg.showPeers) {
          c.peers.forEach((e) => { hit.appendChild(makeEl('circle', { cx, cy: y(e.v), r: 5, fill: 'transparent' })); });
        }
      }
      if (cfg.hoverTips) {
        hit.addEventListener('mouseenter', (ev) => {
          showTip(model, c, names, ev);
          svg.classList.add('hovering');
          colEls.forEach((o) => o.classList.toggle('dim', o !== g));
        });
        hit.addEventListener('mousemove', moveTooltip);
        hit.addEventListener('mouseleave', () => {
          hideTooltip();
          svg.classList.remove('hovering');
          colEls.forEach((o) => o.classList.remove('dim'));
        });
      }
      g.appendChild(hit);
      colEls.push(g);
    });

    // The line's name sits at its right end, above the line, clear of the dots' labels.
    if (model.refOn && model.refLabel) {
      const yy = y(cfg.refValue);
      const t = makeEl('text', Object.assign({ x: svgW - 6, y: yy - 5, 'text-anchor': 'end', 'font-size': fs - 1, fill: cfg.refColor }, halo), model.refLabel);
      svg.appendChild(t);
      // Step below the line when a dot or its label is in the way above it.
      try {
        const inWay = Array.from(svg.querySelectorAll('.dot')).concat(labelEls).map((el) => el.getBBox());
        const blocked = () => {
          const a = t.getBBox();
          return inWay.some((b2) => !(b2.x + b2.width < a.x - 2 || b2.x > a.x + a.width + 2 || b2.y + b2.height < a.y || b2.y > a.y + a.height));
        };
        if (blocked()) {
          t.setAttribute('y', yy + (fs - 1) + 3);
          if (blocked()) t.setAttribute('y', yy - 5);
        }
      } catch (e) { /* not rendered yet */ }
    }

    if (catTitle) {
      const t = makeEl('text', { x: 14, y: y1 + 8 + fs * 0.85, 'font-size': fs, fill: cfg.mutedColor }, catTitle);
      svg.appendChild(t);
      fitText(t, padLeft - 18);
    }
  }

  function showTip(model, c, names, ev) {
    const cfg = cfgNow();
    const lines = [];
    const nm = (label) => (cfg.tipNames ? '<span class="t-muted">' + escapeHtml(label) + ':</span> ' : '');
    const f = (v) => escapeHtml(fmtValue(v, '', model, cfg));
    const noteLine = c.note ? ' <span class="t-muted">' + escapeHtml(noteLabel(c, model, cfg)) + '</span>' : '';
    lines.push('<div class="t-title">' + escapeHtml(c.label) + noteLine + '</div>');
    c.dots.forEach((e) => {
      const who = e.member.name || model.fieldNames.value;
      lines.push('<div><span class="t-dot" style="background:' + e.color + '"></span>' + nm(who) +
        '<span class="t-strong">' + escapeHtml(fmtValue(e.v, e.f, model, cfg)) + '</span>' +
        (e.band ? ' <span class="t-muted">' + escapeHtml(e.band) + '</span>' : '') + '</div>');
      if (model.colorNumeric && !model.sameColorCol && e.cv != null) {
        lines.push('<div>' + nm(model.colorSourceName) + escapeHtml(e.colorF && e.colorF !== 'Null' ? e.colorF : fmtColorValue(e.cv, model, cfg)) + '</div>');
      }
    });
    if (cfg.tipStats && (c.lo != null || c.bandLo != null || c.center != null)) {
      lines.push('<div class="t-sep"></div>');
      lines.push('<div class="t-muted">' + escapeHtml(model.groupLabel) + (c.n ? ' of ' + c.n : '') + '</div>');
      if (c.hi != null) lines.push('<div>' + nm(names.ends[1]) + f(c.hi) + '</div>');
      if (c.bandHi != null) lines.push('<div>' + nm(names.bandEnds[1]) + f(c.bandHi) + '</div>');
      if (c.center != null) lines.push('<div>' + nm(names.centerShort) + '<span class="t-strong">' + f(c.center) + '</span></div>');
      if (c.bandLo != null) lines.push('<div>' + nm(names.bandEnds[0]) + f(c.bandLo) + '</div>');
      if (c.lo != null) lines.push('<div>' + nm(names.ends[0]) + f(c.lo) + '</div>');
    }
    if (cfg.tipDiff && c.dots.length === 1) {
      const v = c.dots[0].v;
      const parts = [];
      if (c.center != null) parts.push(fmtDiff(v, c.center, model, cfg) + ' vs ' + escapeHtml(names.centerShort.toLowerCase()));
      if (model.refOn) parts.push(fmtDiff(v, cfg.refValue, model, cfg) + ' vs ' + escapeHtml(model.refLabel || 'line'));
      if (parts.length) lines.push('<div class="t-muted">' + parts.join(' · ') + '</div>');
    }
    const tip = $('tooltip');
    tip.innerHTML = lines.join('');
    tip.style.display = 'block';
    moveTooltip(ev);
  }

  // What Diagnostics says about the chart itself. Add anything that would
  // help explain a wrong picture from a distance.
  function describeModel(m) {
    return {
      mode: m.mode, categories: m.cats.length, sortedBy: m.sortedBy, categoriesAreDates: m.allDates,
      members: m.members.length, firstMembers: m.members.slice(0, 5).map((x) => x.name),
      highlightFrom: m.highlightFrom, highlighted: m.highlighted.slice(0, 6).map((x) => x.name),
      colorMode: m.colorMode, colorSource: m.colorSourceName, colorShelfIsNumber: m.colorNumeric, colorNames: m.colorNames.slice(0, 8),
      colorValueRange: m.colorStats ? [m.colorStats.min, m.colorStats.max] : null,
      boundaries: m.bands.map((b) => ({ upTo: b.upTo, color: b.color, label: b.label })), boundaryEdge: S.boundEdge,
      scale: [m.lo, m.hi], summedValues: m.summed, tableauSentPercent: m.tabPct, tableauPercentIsFraction: m.tabFraction,
      tableauPercentDecimals: m.tabDecimals, shownAsPercent: m.isPct,
      headline: m.tokens,
      note: { field: m.extras.note === -1 ? 'none' : lastData.cols[m.extras.note].name, detectedBaseline: m.noteDetected,
        typedBaseline: S.noteUsual, baselineUsed: m.noteBaseline, which: S.noteWhich, tolerancePct: S.noteTolPct, show: S.noteShow,
        exceptions: m.cats.filter((c) => c.noteException).slice(0, 12).map((c) => ({ category: c.label, note: c.note, diff: c.noteDiff })) },
      first: m.cats.slice(0, 3).map((c) => ({ category: c.key, label: c.label, note: c.note, n: c.n, low: c.lo, bandLow: c.bandLo,
        center: c.center, bandHigh: c.bandHi, high: c.hi,
        dots: c.dots.map((e) => ({ who: e.member.name, value: e.v, formatted: e.f, shown: fmtValue(e.v, e.f, m, S), colorValue: e.cv, band: e.band, color: e.color })) })),
    };
  }

  // The message shown when a required shelf is empty.
  function describeMissing(fields) {
    return 'encodings not ready (' + REQUIRED.map((k) => k + '=' + (fields[k] || 'none')).join(', ') + ')';
  }

  // =========================================================================
  // PART 3: PLUMBING
  // =========================================================================

  let S = clone(DEFAULTS);       // applied settings
  let draft = null;              // settings being edited in the panel (previewed live)

  let lastData = null;           // cached rows so redraws don't refetch
  let lastModel = null;          // the model behind the current drawing
  let sheetName = '';
  let renderSeq = 0;
  let retryTimer = null;
  let transientTries = 0; // structural transients (rename/reload): keep chart, retry
  let emptyTries = 0;     // "looks empty": retry a few times before blanking
  let everRendered = false;
  let idleTimer = null;
  let idleTicks = 0;
  let blankReason = '';
  let resizeTimer = null;
  let previewTimer = null;
  let lastFields = null;        // shelf field names from the last render
  let lastError = null;         // { where, message, stack, time }
  const errorLog = [];          // recent errors, newest last
  let panelPos = null;          // { left, top } once the panel has been dragged
  let panelPinned = false;      // true = a strip down the right side, beside the chart
  let panelSections = ['layout']; // accordion sections left open (pinned view)
  let summedNoticeShown = false;
  // A running log of what each render saw, for the Diagnostics text. This is
  // how blank-view problems (sheet rename, workbook save) get diagnosed.
  const T0 = Date.now();
  const trace = [];
  function tr(step, detail) {
    trace.push(((Date.now() - T0) / 1000).toFixed(1) + 's ' + step + (detail ? ': ' + detail : ''));
    if (trace.length > 60) trace.shift();
  }
  const DEFAULT_MESSAGE = document.getElementById('msg-text').innerHTML;
  // Where the last-drawn data is kept for an instant repaint after a reload.
  // In the browser preview each scenario gets its own, so they do not mix.
  // Inside Tableau every sheet using this extension shares the one key, so a
  // reloaded sheet can flash another sheet's chart before its own data lands.
  const SNAP_KEY = SLUG + '-snapshot' + (/[?&]preview=1/.test(location.search)
    ? ':' + ((/[?&]scenario=([^&]+)/.exec(location.search) || [])[1] || 'default') : '');

  // ---------------------------------------------------------------- init -----

  document.getElementById('msg-retry').addEventListener('click', () => {
    tr('user', 'clicked Retry');
    clearRetry();
    stopIdlePoll();
    render();
  });
  document.getElementById('msg-diag').addEventListener('click', () => {
    const ta = document.getElementById('msg-diag-text');
    ta.value = diagnosticsText();
    ta.style.display = 'block';
    copyText(ta, document.getElementById('msg-diag'), 'Diagnostics');
  });

  // Copy a textarea's text and say on the button whether it worked. Tableau's
  // frame often blocks the clipboard, so fall back to execCommand, and if that
  // fails too, leave the text selected and ask for a right-click Copy. Not Ctrl+C:
  // inside Tableau Desktop that copies the worksheet's data instead.
  function copyText(ta, btn, label) {
    ta.focus();
    ta.select();
    const say = (msg) => { btn.textContent = msg; setTimeout(() => { btn.textContent = label; }, 4000); };
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    if (ok) { say('Copied'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(ta.value).then(() => say('Copied'), () => say('Right-click the text, Copy'));
    } else say('Right-click the text, Copy');
  }

  // Anything that escapes a try/catch still gets recorded for Diagnostics.
  // Both listeners are needed: an error inside the initializeAsync callback
  // is a rejected promise, which 'error' alone never sees.
  window.addEventListener('error', (ev) => recordError('window', ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => recordError('promise', ev.reason));

  tableau.extensions.initializeAsync().then(
    () => {
      // Setup problems are recorded, but never stop the first render: a
      // throw here is exactly what would leave the view blank.
      try {
        const worksheet = tableau.extensions.worksheetContent.worksheet;
        sheetName = worksheet.name || '';
        loadSettings();
        loadPanelPos();
        buildPanelStatic();
        wirePanel();
        wireExtra();
        wireAccordion();
        wireDrag();
        applyChrome();

        // Redraw when the drawing area changes size. Watch the element, not
        // just the window: the frame can start with no size at all (a hidden
        // dashboard tab, a sheet still laying out) and gain one later with no
        // window resize event, which would leave an empty chart.
        const redrawSoon = () => {
          if (resizeTimer) clearTimeout(resizeTimer);
          resizeTimer = setTimeout(() => { resizeTimer = null; draw(); }, 120);
        };
        window.addEventListener('resize', redrawSoon);
        if (window.ResizeObserver) {
          let lastW = -1, lastH = -1;
          new ResizeObserver(() => {
            // Compare inside an animation frame, against the last size seen.
            // At high display scaling scrollbars can flip on and off, each
            // flip fires another resize, and the chart blanks in a loop the
            // preview cannot reproduce.
            window.requestAnimationFrame(() => {
              const b = $('body');
              // offset sizes ignore the scrollbar, so drawing one cannot retrigger this.
              if (b.offsetWidth === lastW && b.offsetHeight === lastH) return;
              lastW = b.offsetWidth; lastH = b.offsetHeight;
              redrawSoon();
            });
          }).observe($('body'));
        }

        // SummaryDataChanged is the ONLY data event. It fires when numbers
        // move and when a field is swapped. There is no
        // VisualSpecificationChanged event; asking for it throws, which skips
        // the first render and leaves the view blank after a sheet rename.
        listen(worksheet, 'SummaryDataChanged', 'summary data changed');
      } catch (e) {
        recordError('setup', e);
      }

      // Tableau reloads the extension's iframe when the worksheet is renamed.
      // Repaint the last-drawn chart from sessionStorage, then refresh live.
      let snap = false;
      try { snap = loadSnapshot(); if (snap) { showApp(true); draw(); } } catch (e) { recordError('snapshot', e); }
      tr('init', 'ok, sheet "' + sheetName + '", snapshot ' + (snap ? 'restored' : 'none'));
      render();
    },
    (err) => {
      recordError('init', err);
      const msg = err && err.message ? err.message : String(err);
      tr('init', 'FAILED: ' + msg);
      // Opened in a plain browser tab: the real library only starts inside
      // Tableau's frame. Point at the preview instead of looking broken.
      if (/not running inside an iframe/i.test(msg) || window.top === window) {
        const previewUrl = location.pathname + '?preview=1';
        showMessage('This page is running outside Tableau, so there is no worksheet to read.<br />' +
          'To use it: in a Tableau worksheet, Marks card, mark type dropdown, <b>Add Viz Extension</b>, pick the <b>.trex</b> file.<br />' +
          'To look at it here with sample data: <a href="' + previewUrl + '">open the browser preview</a>.');
        return;
      }
      showMessage('The extension could not start: <b>' + escapeHtml(msg) +
        '</b><br />Click Diagnostics below and send the text to Claude.');
    }
  );

  // Subscribe to a Tableau event if it exists; never let a missing one throw.
  function listen(worksheet, name, label) {
    const type = tableau.TableauEventType && tableau.TableauEventType[name];
    if (!type) { tr('init', 'event ' + name + ' not available, skipped'); return; }
    try {
      worksheet.addEventListener(type, () => { tr('event', label); render(); });
    } catch (e) {
      recordError('listen ' + name, e);
    }
  }

  // ------------------------------------------------------------ settings -----

  // All settings are ONE JSON object under ONE key, merged over DEFAULTS.
  function loadSettings() {
    const raw = tableau.extensions.settings.get('settings');
    if (raw) {
      try {
        S = withDefaults(JSON.parse(raw));
      } catch (e) { S = clone(DEFAULTS); }
    }
  }

  // Turn any saved or pasted object into complete, correctly typed settings.
  // Merged over DEFAULTS, so a workbook saved before a setting existed still
  // opens. Tableau stores strings only: the JSON keeps each type, but a value
  // that arrives as the wrong type ("14", "false") draws right once and wrong
  // after a reopen, so each one is brought back to the type of its default.
  // Keys that are not settings are dropped.
  function withDefaults(obj) {
    const out = clone(DEFAULTS);
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(DEFAULTS).forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) return;
      const d = DEFAULTS[k], v = obj[k];
      if (typeof d === 'number') { const n = Number(v); out[k] = (v === '' || v == null || !isFinite(n)) ? d : n; }
      else if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : (v === 'true' ? true : (v === 'false' ? false : d));
      else if (typeof d === 'string') out[k] = v == null ? d : String(v);
      else if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = Object.assign(clone(d), v && typeof v === 'object' ? v : {});
      else out[k] = v;
    });
    return out;
  }

  function saveSettings() {
    try {
      tableau.extensions.settings.set('settings', JSON.stringify(S));
      const p = tableau.extensions.settings.saveAsync();
      // Viewers without edit rights can't save; the view still updates.
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* read-only context */ }
  }

  // How this person likes the panel (where it floats, pinned or not, which
  // sections are open) is per machine, not part of the workbook.
  function loadPanelPos() {
    try {
      const raw = window.localStorage.getItem(SLUG + ':panel-pos');
      if (raw) { const p = JSON.parse(raw); if (p && isFinite(p.left) && isFinite(p.top)) panelPos = p; }
      const m = JSON.parse(window.localStorage.getItem(SLUG + ':panel-mode'));
      if (m && typeof m === 'object') {
        panelPinned = m.pinned === true;
        if (Array.isArray(m.open)) panelSections = m.open.filter((x) => typeof x === 'string');
      }
    } catch (e) {}
  }
  function savePanelPos() {
    try {
      if (panelPos) window.localStorage.setItem(SLUG + ':panel-pos', JSON.stringify(panelPos));
      else window.localStorage.removeItem(SLUG + ':panel-pos');
      window.localStorage.setItem(SLUG + ':panel-mode', JSON.stringify({ pinned: panelPinned, open: panelSections }));
    } catch (e) {}
  }

  function paletteOf(key) { return PALETTES[key] || PALETTES[PALETTE_ORDER[0][0]]; }
  // Settings in force for drawing: the draft while the panel is open (live
  // preview), otherwise what was applied.
  function cfgNow() { return draft || S; }

  // --------------------------------------------------------------- panel -----

  function $(id) { return document.getElementById(id); }

  function buildPanelStatic() {
    const wrap = $('palette-cards');
    clear(wrap);
    PALETTE_ORDER.forEach(([key, name]) => {
      const card = document.createElement('div');
      card.className = 'pcard';
      card.dataset.key = key;
      const sw = document.createElement('div');
      sw.className = 'swatches';
      PALETTES[key].slice(0, 6).forEach((hex) => {
        const s = document.createElement('span');
        s.style.background = hex;
        sw.appendChild(s);
      });
      const label = document.createElement('div');
      label.className = 'pname';
      label.textContent = name;
      card.appendChild(sw);
      card.appendChild(label);
      card.addEventListener('click', () => {
        if (!draft) return;
        draft.palette = key;
        markPaletteSelection(key);
        schedulePreview();
      });
      wrap.appendChild(card);
    });
  }

  function addOption(sel, value, text) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  }

  function wirePanel() {
    $('gear').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if ($('panel').style.display === 'flex') closePanel(); else openPanel();
    });
    $('btn-cancel').addEventListener('click', closePanel);
    $('btn-apply').addEventListener('click', applyPanel);
    $('btn-reset').addEventListener('click', resetDraft);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && $('panel').style.display === 'flex') closePanel();
    });

    document.querySelectorAll('#tabs .tab').forEach((tab) => {
      tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

    // Every control edits the draft and previews at once; nothing is saved
    // until Apply, and Cancel puts the applied settings back.
    CONTROLS.forEach(([id, key, kind, fmt]) => {
      const el = $(id);
      if (!el) { recordError('panel', new Error('CONTROLS names a missing element: ' + id)); return; }
      const evt = (kind === 'text' || kind === 'range' || kind === 'color' || kind === 'number') ? 'input' : 'change';
      el.addEventListener(evt, () => {
        if (!draft) return;
        if (kind === 'check') draft[key] = el.checked;
        else if (kind === 'range') {
          draft[key] = Number(el.value);
          $('lbl-' + id.slice(4)).textContent = fmt(draft[key]);
        } else if (kind === 'number') draft[key] = Number(el.value);
        else draft[key] = el.value;
        updateDependentRows();
        schedulePreview();
      });
    });

    $('notice-close').addEventListener('click', hideNotice);

    // Copy a look out, or paste one in. A pasted set goes into the draft, so
    // it previews at once and is saved only on Apply.
    $('btn-set-copy').addEventListener('click', () => {
      const ta = $('set-text');
      ta.value = JSON.stringify(draft || S, null, 2);
      ta.style.display = 'block';
      $('set-load-row').style.display = 'none';
      copyText(ta, $('btn-set-copy'), 'Copy settings');
    });
    $('btn-set-paste').addEventListener('click', () => {
      const ta = $('set-text');
      ta.value = '';
      ta.style.display = 'block';
      $('set-load-row').style.display = 'flex';
      $('set-msg').textContent = '';
      ta.focus();
    });
    $('btn-set-load').addEventListener('click', () => {
      if (!draft) return;
      let obj = null;
      try { obj = JSON.parse($('set-text').value); } catch (e) { obj = null; }
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { $('set-msg').textContent = 'That is not a copied settings block.'; return; }
      draft = withDefaults(obj);
      populatePanel();
      $('set-msg').textContent = 'Loaded. Click Apply to save.';
      schedulePreview();
    });
    $('btn-diag').addEventListener('click', () => {
      const ta = $('diag-text');
      ta.value = diagnosticsText();
      ta.style.display = 'block';
    });
    $('btn-diag-copy').addEventListener('click', () => {
      const ta = $('diag-text');
      ta.value = diagnosticsText();
      ta.style.display = 'block';
      copyText(ta, $('btn-diag-copy'), 'Copy');
    });
  }

  // Drag the panel by its title bar; Dock returns it to the corner.
  function wireDrag() {
    const panel = $('panel');
    const head = $('panel-head');
    let drag = null;
    head.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('button') || panel.classList.contains('pinned')) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top, id: ev.pointerId };
      try { head.setPointerCapture(ev.pointerId); } catch (e) {}
      head.classList.add('dragging');
      ev.preventDefault();
    });
    head.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      placePanel(ev.clientX - drag.dx, ev.clientY - drag.dy);
    });
    const end = () => {
      if (!drag) return;
      drag = null;
      head.classList.remove('dragging');
      savePanelPos();
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (ev) => { if (!ev.target.closest('button') && !panel.classList.contains('pinned')) dockPanel(true); });
    $('btn-dock').addEventListener('click', () => dockPanel(true));
    $('btn-pin').addEventListener('click', () => { panelPinned = !panelPinned; savePanelPos(); applyPanelMode(); });
    // The chart's own resize handling redraws; this only re-places the panel.
    window.addEventListener('resize', () => { if (panel.style.display === 'flex') applyPanelMode(false); });
  }

  function placePanel(left, top) {
    const p = $('panel');
    const w = p.offsetWidth || 400;
    const h = p.offsetHeight || 300;
    // Keep the whole panel in view, and at least its title bar and buttons
    // when the view is smaller than the panel.
    left = clamp(left, Math.min(0, window.innerWidth - w), Math.max(0, window.innerWidth - w));
    top = clamp(top, 0, Math.max(0, window.innerHeight - Math.min(h, window.innerHeight - 8)));
    p.style.left = Math.round(left) + 'px';
    p.style.top = Math.round(top) + 'px';
    p.style.right = 'auto';
    panelPos = { left: Math.round(left), top: Math.round(top) };
  }

  function dockPanel(forget) {
    const p = $('panel');
    p.style.left = 'auto';
    p.style.right = '8px';
    p.style.top = '8px';
    if (forget) { panelPos = null; savePanelPos(); }
  }

  // Floating or pinned. Pinned makes the panel a strip down the right side,
  // narrows the chart so nothing is covered, and shows the tabs as an
  // accordion. A view too narrow to share falls back to floating, and the
  // preference is kept for when there is room again.
  // A short dashboard zone has no room for a strip either: it would be all title bar and buttons.
  function canPin() { return window.innerWidth >= 760 && window.innerHeight >= 420; }
  function applyPanelMode(redraw) {
    const p = $('panel');
    const open = p.style.display === 'flex';
    const pinned = panelPinned && canPin();
    p.classList.toggle('pinned', pinned);
    p.classList.toggle('accordion', pinned);
    document.body.classList.toggle('panel-pinned', pinned && open);
    const btn = $('btn-pin');
    btn.textContent = pinned ? 'Float' : 'Pin to side';
    btn.disabled = !canPin();
    btn.title = !canPin() ? 'The view is too small to pin the panel'
      : (pinned ? 'Let the panel float so it can be dragged' : 'Keep the panel down the right side, beside the chart');
    $('btn-dock').style.display = pinned ? 'none' : '';
    $('panel-head').title = pinned ? '' : 'Drag to move. Double-click to dock.';
    if (pinned) { p.style.left = ''; p.style.top = ''; p.style.right = ''; }
    else if (open) { if (panelPos) placePanel(panelPos.left, panelPos.top); else dockPanel(false); }
    if (redraw !== false) draw(); // the chart's width may have changed
  }

  // Give every pane a header built from its tab, and wrap its rows in a body.
  // Tabs show one pane at a time; the accordion shows every header and opens
  // as many as the person likes. Which view shows is decided in the CSS.
  function wireAccordion() {
    document.querySelectorAll('#panes .pane').forEach((pane) => {
      const name = pane.dataset.pane;
      const tab = document.querySelector('#tabs .tab[data-tab="' + name + '"]');
      const body = document.createElement('div');
      body.className = 'pane-body';
      while (pane.firstChild) body.appendChild(pane.firstChild);
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'acc-head';
      const label = document.createElement('span');
      label.textContent = tab ? tab.textContent : name;
      const chev = document.createElement('span');
      chev.className = 'chev';
      chev.textContent = '\u203A';
      head.appendChild(label);
      head.appendChild(chev);
      head.addEventListener('click', () => {
        const i = panelSections.indexOf(name);
        if (i === -1) panelSections.push(name); else panelSections.splice(i, 1);
        savePanelPos();
        reflectAccordion();
      });
      pane.appendChild(head);
      pane.appendChild(body);
    });
    reflectAccordion();
  }
  function reflectAccordion() {
    document.querySelectorAll('#panes .pane').forEach((pane) => {
      const open = panelSections.indexOf(pane.dataset.pane) !== -1;
      pane.classList.toggle('open', open);
      const head = pane.querySelector('.acc-head');
      if (head) head.setAttribute('aria-expanded', String(open));
    });
  }

  function showTab(name) {
    document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#panes .pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  }

  function openPanel() {
    draft = clone(S);
    $('reset-note').style.display = 'none';
    populatePanel();
    $('panel').style.display = 'flex';
    applyPanelMode();
  }

  // Restore every setting to its default. Edits the DRAFT only, so nothing is
  // saved until Apply and Cancel still backs out.
  function resetDraft() {
    draft = clone(DEFAULTS);
    populatePanel();
    $('reset-note').style.display = 'block';
    schedulePreview();
  }

  function populatePanel() {
    CONTROLS.forEach(([id, key, kind, fmt]) => {
      const el = $(id);
      if (!el) return;
      if (kind === 'check') el.checked = !!draft[key];
      else el.value = draft[key];
      if (kind === 'range') $('lbl-' + id.slice(4)).textContent = fmt(draft[key]);
    });
    $('inp-title').placeholder = sheetName || NAME;
    markPaletteSelection(draft.palette);
    buildFieldList();
    populateExtra();
    updateDependentRows();
  }

  // One dropdown per Detail-shelf input: Auto (shows what it matched), Not
  // used, or any column that isn't already on one of the custom shelves.
  function buildFieldList() {
    const list = $('field-list');
    clear(list);
    if (!draft || !lastData) {
      list.innerHTML = '<div class="hint">Field choices appear once the chart has data.</div>';
      return;
    }
    const cols = lastData.cols;
    const onShelf = new Set(Object.values(lastData.shelf).filter((i) => i !== -1));
    const ex = resolveExtras(lastData, draft);
    EXTRAS.forEach((x) => {
      const row = document.createElement('div');
      row.className = 'row';
      const lab = document.createElement('label');
      lab.className = 'name';
      lab.textContent = x.label;
      const sel = document.createElement('select');
      const autoIdx = resolveExtras(lastData, Object.assign(clone(draft), { fieldMap: Object.assign(clone(draft.fieldMap), { [x.key]: 'auto' }) }))[x.key];
      addOption(sel, 'auto', 'Auto' + (autoIdx === -1 ? ' (none found)' : ': ' + cols[autoIdx].name));
      addOption(sel, '', 'Not used');
      cols.forEach((c, i) => { if (!onShelf.has(i)) addOption(sel, c.name, c.name); });
      sel.value = draft.fieldMap[x.key];
      if (sel.value !== draft.fieldMap[x.key]) sel.value = 'auto';
      sel.addEventListener('change', () => {
        draft.fieldMap[x.key] = sel.value;
        buildFieldList();
        schedulePreview();
      });
      row.appendChild(lab);
      row.appendChild(sel);
      row.appendChild(document.createElement('span'));
      list.appendChild(row);
      if (x.numeric && ex[x.key] !== -1 && !isNumericCol(lastData, ex[x.key])) {
        const w = document.createElement('div');
        w.className = 'field-warn';
        w.textContent = cols[ex[x.key]].name + ' has no numbers in it. Pick a numeric field.';
        list.appendChild(w);
      }
    });
  }

  function markPaletteSelection(key) {
    document.querySelectorAll('#palette-cards .pcard').forEach((c) => c.classList.toggle('selected', c.dataset.key === key));
  }

  function closePanel() {
    draft = null;
    $('panel').style.display = 'none';
    applyPanelMode(false); // the chart takes back its full width
    applyChrome();
    draw(); // put the applied settings back
  }

  function applyPanel() {
    if (draft) {
      S = clone(draft);
      saveSettings();
    }
    draft = null;
    $('panel').style.display = 'none';
    applyPanelMode(false);
    applyChrome();
    draw();
  }

  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { previewTimer = null; applyChrome(); draw(); }, 40);
  }

  // Background and font for the whole view (not the panel).
  function applyChrome() {
    const c = cfgNow();
    $('app').style.background = c.background;
    $('message').style.background = c.background;
    ['app', 'tooltip'].forEach((id) => { $(id).style.fontFamily = fontStack(c.fontFamily); });
    $('app').style.color = c.textColor;
  }

  // --------------------------------------------------------------- data ------

  // Which field is on each custom shelf.
  async function getEncodedFields(worksheet) {
    const spec = await worksheet.getVisualSpecificationAsync();
    const marks = spec && spec.marksSpecifications
      ? spec.marksSpecifications[spec.activeMarksSpecificationIndex]
      : null;
    const fields = {};
    SHELVES.forEach((k) => { fields[k] = null; });
    if (!marks || !marks.encodings) return { fields, validSpec: false };
    for (const enc of marks.encodings) {
      if (enc.field && fields.hasOwnProperty(enc.id)) fields[enc.id] = enc.field.name;
    }
    return { fields, validSpec: true };
  }

  // The shelf says "Value"; the data column may say "SUM(Value)" or the
  // reverse. Match exactly, then with the aggregation stripped, then loosely.
  function findColumnIndex(columns, fieldName) {
    if (!fieldName) return -1;
    let idx = columns.findIndex((c) => c.fieldName === fieldName);
    if (idx !== -1) return idx;
    const want = cleanFieldName(fieldName);
    idx = columns.findIndex((c) => cleanFieldName(c.fieldName) === want);
    if (idx !== -1) return idx;
    return columns.findIndex((c) => c.fieldName.indexOf(fieldName) !== -1 || fieldName.indexOf(c.fieldName) !== -1);
  }

  async function readData(worksheet) {
    // ignoreSelection: without it, selected marks can narrow the rows returned.
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
    try {
      return await reader.getAllPagesAsync();
    } finally {
      // Always release: a leaked reader eventually stops returning data.
      try { await reader.releaseAsync(); } catch (e) {}
    }
  }

  // One render at a time. A worksheet allows only ONE open data reader, so two
  // overlapping reads make the second fail, and without ordering a slow early
  // read could land after a fast later one and draw stale data. A request that
  // arrives mid-render collapses into a single follow-up; the last one wins.
  // The watchdog covers a Tableau call that never answers.
  let rendering = false;
  let renderQueued = false;
  let renderStarted = 0;
  async function render() {
    if (rendering && Date.now() - renderStarted < 15000) { renderQueued = true; return; }
    if (rendering) tr('render', 'previous render never finished; starting over');
    rendering = true;
    renderStarted = Date.now();
    try {
      await renderOnce();
    } finally {
      rendering = false;
      if (renderQueued) { renderQueued = false; render(); }
    }
  }

  async function renderOnce() {
    const mySeq = ++renderSeq;
    tr('render #' + mySeq, 'start');
    try {
      // After a failed start there is no worksheet; retrying can't fix that.
      if (!tableau.extensions.worksheetContent) { tr('render #' + mySeq, 'no worksheet (extension never started)'); return; }
      const worksheet = tableau.extensions.worksheetContent.worksheet;
      sheetName = worksheet.name || sheetName;
      const { fields, validSpec } = await getEncodedFields(worksheet);
      tr('spec', validSpec ? SHELVES.map((k) => k + '=' + (fields[k] || '-')).join(', ') : 'invalid (no marks spec)');
      if (mySeq !== renderSeq) return;
      if (!validSpec) { transientRetry(); return; }

      if (REQUIRED.some((k) => !fields[k])) { emptyRetryOrBlank(describeMissing(fields)); return; }

      const dataTable = await readData(worksheet);
      tr('data', dataTable.data.length + ' rows; columns: ' + dataTable.columns.map((c) => c.fieldName + ' (' + c.dataType + ')').join(', '));
      if (mySeq !== renderSeq) return;

      const columns = dataTable.columns;
      const idx = {};
      for (const k of SHELVES) {
        idx[k] = findColumnIndex(columns, fields[k]);
        // A field is on the shelf but not in the data yet: mid-change, retry.
        if (fields[k] && idx[k] === -1) { transientRetry(); return; }
      }

      if (dataTable.data.length === 0) {
        emptyRetryOrBlank('0 rows returned (' + REQUIRED.map((k) => k + '=' + fields[k]).join(', ') + ')');
        return;
      }

      // Keep every column, not just the shelves: the Detail inputs are
      // matched later, and the Fields tab lists them all.
      const cols = columns.map((c) => ({ name: c.fieldName, type: c.dataType }));
      const cells = dataTable.data.map((r) => r.map((c) => liteCell(c)));

      if (!cells.some((r) => numOf(r[idx[NUMERIC_SHELF]]) != null)) {
        tr(NUMERIC_SHELF, 'no numeric values in ' + fields[NUMERIC_SHELF]);
        if (!idleTimer && emptyTries < (everRendered ? 5 : 25)) {
          emptyTries++;
          if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; render(); }, Math.min(1200, 200 + emptyTries * 100));
          return;
        }
        emptyTries = 0;
        lastData = null;
        clearSnapshot();
        showMessage('Couldn&#39;t read numbers from <b>' + escapeHtml(fields[NUMERIC_SHELF]) + '</b>.<br />' +
          'That shelf needs a measure, for example SUM of a value.');
        startIdlePoll();
        return;
      }

      clearRetry();
      everRendered = true;
      stopIdlePoll();
      blankReason = '';
      lastData = { cols, cells, shelf: idx };
      lastFields = fields;
      tr('render #' + mySeq, 'drawn');
      saveSnapshot();
      showApp(true);
      draw();
    } catch (err) {
      recordError('render', err);
      transientRetry();
    }
  }

  function transientRetry() {
    if (retryTimer) return;
    if (transientTries >= 8) {
      // Keep the last good view, but don't stop checking: Tableau may not send
      // another event, so a slow poll is the only way to recover on its own.
      tr('retry', 'fast retries used up; slow re-check every few seconds');
      startIdlePoll();
      return;
    }
    tr('retry', 'transient, try ' + (transientTries + 1));
    const delay = Math.min(1500, Math.round(150 * Math.pow(1.6, transientTries)));
    transientTries++;
    retryTimer = setTimeout(() => { retryTimer = null; render(); }, delay);
  }

  // "Looks empty": a workbook still opening (Tableau answers before the data
  // exists and may not fire another event) or a genuinely empty sheet. Be
  // patient before the first render, then keep re-checking slowly once blank.
  function emptyRetryOrBlank(reason) {
    blankReason = reason || '';
    tr('empty', blankReason);
    if (idleTimer) return;
    const budget = everRendered ? 5 : 25;
    if (emptyTries < budget) {
      emptyTries++;
      if (!retryTimer) {
        const delay = Math.min(1200, 200 + emptyTries * 100);
        retryTimer = setTimeout(() => { retryTimer = null; render(); }, delay);
      }
      return;
    }
    emptyTries = 0;
    lastData = null;
    clearSnapshot();
    $('msg-text').innerHTML = DEFAULT_MESSAGE;
    showApp(false);
    startIdlePoll();
  }

  function startIdlePoll() {
    if (idleTimer) return;
    idleTicks = 0;
    // Every 2s for the first 2 minutes, then every 10s for 20 more.
    idleTimer = setInterval(() => {
      idleTicks++;
      if (idleTicks > 180) { tr('poll', 'stopped; click Retry'); stopIdlePoll(); return; }
      if (idleTicks > 60 && idleTicks % 5 !== 0) return;
      render();
    }, 2000);
  }
  function stopIdlePoll() {
    if (idleTimer) { clearInterval(idleTimer); idleTimer = null; }
    idleTicks = 0;
  }
  function clearRetry() {
    transientTries = 0;
    emptyTries = 0;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }

  // Which column feeds each Detail-shelf input. Pure: takes settings so the
  // panel can show what Auto would pick.
  function resolveExtras(data, cfg) {
    const onShelf = new Set(Object.values(data.shelf).filter((i) => i !== -1));
    const taken = new Set();
    const out = {};
    EXTRAS.forEach((x) => {
      const want = (cfg.fieldMap || {})[x.key];
      let idx = -1;
      if (want === '') idx = -1;
      else if (want && want !== 'auto') idx = data.cols.findIndex((c) => c.name === want);
      else {
        idx = data.cols.findIndex((c, i) => !onShelf.has(i) && !taken.has(i) && x.re.test(c.name) &&
          (x.any ? true : (x.numeric ? isNumericCol(data, i) : !isNumericCol(data, i))));
      }
      if (idx !== -1) taken.add(idx);
      out[x.key] = idx;
    });
    return out;
  }

  function isNumericCol(data, i) {
    const c = data.cols[i];
    if (c.type === 'int' || c.type === 'float') return true;
    return data.cells.some((r) => typeof r[i].v === 'number');
  }

  // 'SUM(Value)' -> 'Value', for labels and for matching shelf to column.
  function cleanFieldName(n) {
    const m = /^[A-Z]+\(([^)]*)\)$/.exec(String(n || ''));
    return m ? m[1] : String(n || '');
  }

  // ------------------------------------------------------------- tooltip -----

  function moveTooltip(ev) {
    const tip = $('tooltip');
    const pad = 14;
    let x = ev.clientX + pad;
    let y = ev.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 4) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 4) y = ev.clientY - r.height - pad;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  }
  function hideTooltip() { $('tooltip').style.display = 'none'; }

  // ---------------------------------------------------------- formatting -----

  // Keep only what drawing needs from a Tableau cell: v is the native value
  // (for math), f is Tableau's formatted text (for labels).
  function liteCell(cell) {
    let v = cell.nativeValue;
    if (v instanceof Date) v = v.toISOString();
    if (v != null && typeof v === 'object') v = String(v);
    return { v, f: cell.formattedValue == null ? '' : String(cell.formattedValue) };
  }
  function textOf(cell) {
    if (!cell) return '';
    if (cell.f !== '' && cell.f !== 'Null') return cell.f;
    return cell.v == null ? '' : String(cell.v);
  }
  function numOf(cell) {
    if (!cell) return null;
    if (typeof cell.v === 'number') return isFinite(cell.v) ? cell.v : null;
    const s = String(cell.v == null ? cell.f : cell.v).replace(/[^0-9.eE+-]/g, '');
    const n = s === '' ? NaN : Number(s);
    return isFinite(n) ? n : null;
  }

  // A value as the Values tab asks for it. v is the number, f is Tableau's
  // text for it ('' when the number was computed here). Use this EVERYWHERE a
  // value is shown: labels, tooltips, legends. One formatter, no strays.
  function fmtValue(v, f, model, cfg) {
    if (v == null || !isFinite(v)) return f || '';
    const d = cfg.valueDecimals;
    let s;
    if (cfg.valueFormat === 'auto') {
      if (model.fraction) s = fixed(v * 100, d, cfg.valueSep) + '%';
      else if (f && f !== 'Null') return f;          // Tableau's own text
      // A number worked out here, on a measure Tableau sent as "81%".
      else if (model.tabFraction) s = fixed(v * 100, cfg.axisDecimals != null ? cfg.axisDecimals : model.tabDecimals, cfg.valueSep) + '%';
      else s = fixed(v, Math.abs(v) >= 100 ? 0 : d, cfg.valueSep);
    } else if (cfg.valueFormat === 'percent') s = fixed(v * 100, d, cfg.valueSep) + '%';
    else if (cfg.valueFormat === 'percent100') s = fixed(v, d, cfg.valueSep) + '%';
    else if (cfg.valueFormat === 'compact') s = compact(v, d);
    else s = fixed(v, d, cfg.valueSep);
    return (cfg.valuePrefix || '') + s + (cfg.valueSuffix || '');
  }
  // The difference between a value and its reference, in the value's units.
  function fmtDiff(v, r, model, cfg) {
    const d = v - r;
    const sign = d >= 0 ? '+' : '-';
    const a = Math.abs(d);
    const pct = cfg.valueFormat === 'percent' || (cfg.valueFormat === 'auto' && model.isPct);
    if (pct) return sign + fixed(a * 100, Math.max(1, cfg.valueDecimals), false) + ' pts';
    if (cfg.valueFormat === 'percent100') return sign + fixed(a, Math.max(1, cfg.valueDecimals), false) + ' pts';
    if (cfg.valueFormat === 'compact') return sign + compact(a, cfg.valueDecimals);
    return sign + fixed(a, cfg.valueDecimals, cfg.valueSep);
  }
  function fixed(x, d, sep) {
    const s = Number(x).toFixed(d);
    if (!sep) return s;
    const parts = s.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return parts.join('.');
  }
  function compact(x, d) {
    const a = Math.abs(x);
    if (a >= 1e9) return (x / 1e9).toFixed(d) + 'B';
    if (a >= 1e6) return (x / 1e6).toFixed(d) + 'M';
    if (a >= 1e3) return (x / 1e3).toFixed(d) + 'K';
    return x.toFixed(a >= 100 ? 0 : d);
  }

  // ------------------------------------------------------------- helpers -----

  function textWidthEstimate(s, fs) { return String(s).length * fs * 0.6; }

  // Break a label into lines no wider than maxW (by the width estimate),
  // at most three lines; the last line takes whatever is left.
  function wrapLabel(text, fs, maxW) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    words.forEach((w) => {
      const next = cur ? cur + ' ' + w : w;
      if (cur && textWidthEstimate(next, fs) > maxW && lines.length < 2) { lines.push(cur); cur = w; }
      else cur = next;
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  // Trim an SVG text node to a pixel width, with an ellipsis. The node must
  // already be in the document, or there is nothing to measure.
  function fitText(el, maxW) {
    try {
      if (el.getComputedTextLength() <= maxW) return;
      const full = el.textContent;
      let lo = 1, hi = full.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        el.textContent = full.slice(0, mid) + '…';
        if (el.getComputedTextLength() <= maxW) lo = mid; else hi = mid - 1;
      }
      el.textContent = full.slice(0, lo) + '…';
      el.appendChild(makeEl('title', {}, full));
    } catch (e) { /* not rendered yet */ }
  }

  let sbw = null;
  function scrollbarWidth() {
    if (sbw != null) return sbw;
    const d = document.createElement('div');
    d.style.cssText = 'position:absolute;top:-200px;width:100px;height:100px;overflow:scroll;visibility:hidden';
    document.body.appendChild(d);
    sbw = d.offsetWidth - d.clientWidth;
    document.body.removeChild(d);
    return sbw;
  }

  function sizeSvg(svg, w, h) {
    svg.setAttribute('width', Math.round(w));
    svg.setAttribute('height', Math.round(h));
    svg.setAttribute('viewBox', '0 0 ' + Math.round(w) + ' ' + Math.round(h));
  }

  function showApp(show) {
    $('app').style.display = show ? 'flex' : 'none';
    $('message').style.display = show ? 'none' : 'flex';
    const d = $('diag');
    d.textContent = (!show && blankReason) ? blankReason : '';
    d.style.display = (!show && blankReason) ? 'block' : 'none';
    if (!show && blankReason) console.log('[' + SLUG + '] blank:', blankReason);
    if (!show) hideTooltip();
  }
  // A specific, actionable message in place of the default instructions.
  function showMessage(html) {
    $('msg-text').innerHTML = html;
    blankReason = '';
    showApp(false);
  }

  // Everything needed to diagnose a problem remotely, as plain text. Inside
  // Tableau there is no console, so this is the only window into a failure.
  function diagnosticsText() {
    const out = { extension: NAME + ' ' + VERSION, time: new Date().toISOString(), sheet: sheetName };
    try {
      const env = tableau.extensions.environment;
      if (env) out.tableau = { context: env.context, version: env.tableauVersion, api: env.apiVersion, mode: env.mode };
    } catch (e) { /* not available */ }
    out.shelves = lastFields;
    if (lastData) {
      out.columns = lastData.cols.map((c, i) => i + ': ' + c.name + ' (' + c.type + ')');
      out.shelfColumns = lastData.shelf;
      try {
        const m = buildModel(lastData, S);
        out.detailMatches = {};
        EXTRAS.forEach((x) => { out.detailMatches[x.key] = m.extras[x.key] === -1 ? 'none' : lastData.cols[m.extras[x.key]].name; });
        out.model = describeModel(m);
      } catch (e) { out.model = 'error: ' + e.message; }
      out.rowCount = lastData.cells.length;
      // Native AND formatted, side by side: most "wrong number" reports are
      // a formatting surprise, and this shows exactly what Tableau sent.
      out.sampleRows = lastData.cells.slice(0, 4).map((r) => r.map((c) => ({ native: c.v, formatted: c.f })));
    } else out.data = 'none loaded';
    out.state = { everRendered, blankReason, viewShown: $('app').style.display === 'flex', polling: !!idleTimer,
      panelOpen: !!draft, panelPinned, panelSections };
    out.trace = trace.slice();
    out.lastError = lastError;
    out.recentErrors = errorLog.slice(0, -1);
    out.settings = S;
    return JSON.stringify(out, null, 2);
  }

  function recordError(where, err) {
    const e = err instanceof Error ? err : new Error(String(err && err.message ? err.message : err));
    lastError = { where, message: e.message, stack: String(e.stack || '').split(String.fromCharCode(10)).slice(0, 6).join(String.fromCharCode(10)),
      time: new Date().toISOString() };
    errorLog.push(lastError);
    if (errorLog.length > 8) errorLog.shift();
    console.error('[' + SLUG + '] ' + where + ':', e);
  }

  function showNotice(text) {
    const n = $('notice');
    n.querySelector('span').textContent = text;
    n.style.display = 'flex';
  }
  function hideNotice() { $('notice').style.display = 'none'; }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function makeEl(name, attrs, text) {
    const el = document.createElementNS(SVG_NS, name);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text != null) el.textContent = text;
    return el;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  // Snapshot the last-drawn data so an iframe reload (e.g. on sheet rename)
  // can repaint instantly instead of flashing blank.
  function saveSnapshot() {
    try { window.sessionStorage.setItem(SNAP_KEY, JSON.stringify(lastData)); } catch (e) {}
  }
  function loadSnapshot() {
    try {
      const raw = window.sessionStorage.getItem(SNAP_KEY);
      if (raw) {
        const snap = JSON.parse(raw);
        // Ignore a snapshot saved by an older version in a different shape.
        if (snap && Array.isArray(snap.cells) && snap.cells.length && Array.isArray(snap.cols) &&
            snap.shelf && REQUIRED.every((k) => snap.shelf[k] != null && snap.shelf[k] !== -1)) {
          lastData = snap;
          return true;
        }
      }
    } catch (e) {}
    return false;
  }
  function clearSnapshot() {
    try { window.sessionStorage.removeItem(SNAP_KEY); } catch (e) {}
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function hexToRgb(hex) {
    const norm = normalizeHex(hex) || '#808080'; // never NaN, even for junk
    const n = parseInt(norm.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  // '#8754E8', '8754e8', ' #8754E8 ', '#85E', '#8754E8FF' -> '#8754e8'; else null.
  // Hex colors from data are messy; never trust them raw.
  function normalizeHex(v) {
    if (v == null) return null;
    let h = String(v).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    else if (/^[0-9a-f]{8}$/i.test(h)) h = h.slice(0, 6);
    return /^[0-9a-f]{6}$/i.test(h) ? '#' + h.toLowerCase() : null;
  }
  // Blend from color a toward color b by t (0 = a, 1 = b).
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const r = Math.round(A.r + (B.r - A.r) * t);
    const g = Math.round(A.g + (B.g - A.g) * t);
    const bl = Math.round(A.b + (B.b - A.b) * t);
    return '#' + [r, g, bl].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  // Relative lightness 0..1, for choosing dark or light text over a color.
  function luminance(hex) {
    const c = hexToRgb(hex);
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  }
  function fontStack(f) {
    if (f === 'system') return "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    return f + ", 'Segoe UI', sans-serif";
  }
  // Kept for charts that need them; unused helpers cost nothing.
  void wrapLabel; void mixHex; void luminance;
})();
