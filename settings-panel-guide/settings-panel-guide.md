# A settings panel that holds up

**Instructions for Claude.** You are helping someone add a settings panel to a custom chart that runs as a web page: a Tableau viz extension, a Tableau data app, or any embedded visualization. This file gives you a tested starter and the rules behind it. Build from the starter. Do not design the panel from scratch.

There are two parts. **Part 1** is the panel from Range Dot, a Tableau viz extension by Celia Fryar at XeoMatrix, refined over four extensions. Start there. **Part 2** is the panel from one of her Tableau data apps, which makes different choices for a different job. Every rule in both exists because something went wrong without it.

# Part 1: the chart extension panel

## What the person should get

A gear in the corner opens a panel that floats over the chart. They change a setting and the chart changes at once. They can drag the panel out of the way or pin it down the right side, back out of everything with Cancel, or keep it with Apply. They can copy a chart's formatting to another worksheet, and capture a diagnostics report when something looks wrong. Nothing they do can lose their work or strand the panel off screen.

## The behavior contract

Hold the panel to every line of this list. The test section at the end checks each one.

| Behavior | Why |
| --- | --- |
| A gear fixed in the top-right corner opens and closes the panel. | One place to look, in every chart. |
| The panel floats over the chart with no dimming overlay. | The chart must stay visible while settings change. |
| Every change previews live, about 40 ms after the edit. | People tune by eye. A panel that needs Apply to show anything gets abandoned. |
| **Apply** saves. **Cancel** and **Escape** put the applied settings back. | A draft can be thrown away. |
| **Reset to defaults** changes the draft only and shows a note saying so. | Reset is the most destructive button, so Cancel must still undo it. |
| A click outside the panel does not close it. | A live-preview panel that vanished on a stray click lost work. |
| Drag it by its title bar. **Dock**, or a double-click on the title bar, returns it to the corner. | The panel will always cover something the person needs to see. |
| It cannot be dragged out of reach. | A panel off screen with no way back is a dead end. |
| **Pin to side** turns the panel into a strip down the right edge, and the chart moves over beside it. **Float** undoes it. | A floating panel always covers part of the chart. Pinned, nothing is covered, which matters for long tuning sessions. |
| Pinned, the groups show as an accordion: every header visible, each one opening and closing on a click. | A tall strip has room to show several groups at once. Tabs show only one. |
| Where the panel floats, whether it is pinned, and which sections are open are remembered per machine, not saved with the settings. | These are habits of the person, not properties of the chart. |
| Only the panes scroll. The title bar and the buttons stay in view. | On a short view, Apply must still be reachable. |
| Floating, tabs group the rows. | Past about ten settings, one long list stops working. |
| **Copy formatting** and **Paste** move a look from one worksheet to another. | People build one chart they like and want five more that match. |
| **Diagnostics** shows a report that can be copied and sent. | An embedded chart has no console. Without a capture, every problem starts with guessing. |
| Rows that do not apply are grayed out, not hidden. | Hiding rows makes the panel jump under the pointer. |
| No text in the panel is smaller than 13 px. | Smaller is hard to read for many people. |

## The one idea that makes it work

Two objects hold settings.

- `S` is what is applied and saved.
- `draft` is a copy of `S` made when the panel opens. Controls edit `draft`. It is `null` while the panel is closed.

One function returns the settings in force:

```js
function cfgNow() { return draft || S; }
```

Every drawing function takes that result as an argument named `cfg`. That is the whole live preview. Cancel sets `draft` to `null` and redraws. Apply copies `draft` into `S`, saves, and redraws.

This only works if the code that shapes the data and draws the chart is **pure**: it takes `(data, cfg)` and reads nothing else. Never read `S` or `draft` inside it. The payoff is large. The panel can call the same function with the draft to build its own lists, with a modified copy to answer "what would Automatic pick," and a diagnostics dump can call it with the applied settings.

## The starter

Save this as `panel-starter.html` and open it in a browser. It runs on its own, with five bars standing in for the chart. Everything in the contract works in it, and it was tested in a browser before this file was written.

One note on where the pieces come from. The floating panel, the tabs, the draft and the clamp are Range Dot's, used inside Tableau. Pin to side and the accordion were added to Range Dot afterward and confirmed inside Tableau, on a worksheet and on a dashboard. The formatting-only copy and the "last copy on this machine" shortcut exist only in this starter and are tested in a browser, not yet inside Tableau.

Read it once before changing it. The numbered comments at the top of the script mark the three things you will edit most.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Settings panel starter</title>
<style>
  html, body { margin: 0; height: 100%; background: #fff; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #2b2f36; }
  #app { height: 100%; display: flex; flex-direction: column; }
  #title { flex: 0 0 auto; padding: 14px 52px 6px 20px; font-size: 18px; font-weight: 700; }
  #chart { flex: 1 1 auto; min-height: 0; width: 100%; display: block; }

  /* The gear: fixed in the corner, always reachable. */
  #gear { position: fixed; top: 8px; right: 8px; z-index: 900; width: 30px; height: 30px; border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.12); background: rgba(255,255,255,0.9); cursor: pointer; padding: 0;
    font-size: 17px; line-height: 1; color: #555; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
  #gear:hover { color: #000; background: #fff; }

  /* The panel floats over the chart. No dimming overlay, so the chart stays visible. */
  #panel { position: fixed; top: 8px; right: 8px; z-index: 1001; display: none; flex-direction: column;
    width: 400px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); box-sizing: border-box;
    background: #f7f8fa; border: 1px solid #d9dce1; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,0.25);
    padding: 0 18px 14px; font-size: 13px; }
  #panel-head { display: flex; align-items: center; gap: 8px; margin: 0 -18px 8px; padding: 12px 14px 10px 18px;
    cursor: grab; user-select: none; touch-action: none; border-bottom: 1px solid #e3e6eb;
    border-radius: 8px 8px 0 0; background: #eef1f5; }
  #panel-head.dragging { cursor: grabbing; }
  #panel-head h2 { font-size: 16px; font-weight: 700; margin: 0; flex: 1 1 auto; }
  #panel-head .grip { color: #9aa2ad; font-size: 15px; letter-spacing: -2px; line-height: 1; }
  .head-btn, .mini-btn, .tab { font-family: inherit; font-size: 13px; cursor: pointer; border: 1px solid #cfd3da;
    background: #fff; color: #4b5260; }
  .head-btn { padding: 3px 8px; border-radius: 5px; }
  .mini-btn { padding: 4px 10px; border-radius: 5px; }
  .mini-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
  #tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; flex: 0 0 auto; }
  .tab { padding: 5px 9px; border-radius: 14px; }
  .tab.active { background: #2f7ed8; border-color: #2f7ed8; color: #fff; }
  /* Only the panes scroll. The title bar and the buttons never leave the view. */
  #panes { overflow-y: auto; overflow-x: hidden; flex: 1 1 auto; min-height: 0; padding-right: 4px; }
  .pane { display: none; }
  .pane.active { display: block; }
  .acc-head { display: none; }

  /* Pinned: a full-height strip on the right. The chart moves over, so nothing is covered. */
  #panel.pinned { top: 0; right: 0; bottom: 0; left: auto; width: 360px; max-height: none; border-radius: 0;
    border-width: 0 0 0 1px; box-shadow: -4px 0 16px rgba(0,0,0,0.12); }
  #panel.pinned #panel-head { cursor: default; border-radius: 0; }
  #panel.pinned .grip { visibility: hidden; }
  body.panel-pinned #app { margin-right: 360px; }
  body.panel-pinned #gear { right: 368px; }

  /* Accordion: the same panes, stacked, each under a header that opens and closes it. */
  #panel.accordion #tabs { display: none; }
  #panel.accordion .pane { display: block; border-bottom: 1px solid #e3e6eb; }
  #panel.accordion .acc-head { display: flex; width: 100%; box-sizing: border-box; align-items: center; justify-content: space-between;
    font: inherit; font-weight: 700; color: #2b2f36; padding: 11px 2px; border: 0; background: transparent;
    cursor: pointer; text-align: left; }
  #panel.accordion .acc-head:hover { color: #2f7ed8; }
  .acc-head .chev { font-size: 18px; line-height: 1; color: #6b7280; transition: transform 0.15s; }
  .pane.open .acc-head .chev { transform: rotate(90deg); }
  #panel.accordion .pane-body { display: none; padding-bottom: 10px; }
  #panel.accordion .pane.open .pane-body { display: block; }
  #panel button:focus-visible, #panel input:focus-visible, #panel select:focus-visible, #gear:focus-visible {
    outline: 2px solid #2f7ed8; outline-offset: 2px; }
  .head-btn:disabled { opacity: 0.45; cursor: default; }
  .section { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: #2f7ed8; text-transform: uppercase; margin: 14px 0 6px; }
  /* Every row is the same three columns: label, control, value. */
  .row { display: grid; grid-template-columns: 112px 1fr auto; align-items: center; gap: 8px; margin: 7px 0; }
  .row label.name { color: #555; }
  .row.off { opacity: 0.45; }
  #panel select, #panel input[type="text"], #panel input[type="number"], #panel textarea {
    width: 100%; box-sizing: border-box; font: inherit; padding: 5px 6px; border: 1px solid #cfd3da; border-radius: 4px; background: #fff; }
  #panel input[type="range"] { width: 100%; }
  #panel input[type="color"] { width: 34px; height: 24px; padding: 0; border: 1px solid #cfd3da; border-radius: 3px; background: #fff; cursor: pointer; }
  #panel input[type="checkbox"] { width: 16px; height: 16px; accent-color: #2f7ed8; }
  .slider-val { color: #6b7280; min-width: 48px; text-align: right; }
  .check { display: flex; align-items: center; gap: 8px; }
  .hint { color: #6b7280; margin: 4px 0 8px; line-height: 1.45; }
  .item-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
  .item-row span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #set-text, #diag-text { display: none; height: 110px; margin-top: 8px; font-family: Consolas, 'Courier New', monospace; resize: vertical; }
  #diag-text { height: 180px; }
  #reset-note { display: none; flex: 0 0 auto; margin-top: 10px; padding: 7px 10px; background: #fff6e5;
    border: 1px solid #f0d9a8; border-radius: 5px; color: #7a5b1e; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 12px; flex: 0 0 auto; }
  .btn { font: inherit; padding: 8px 18px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
  #btn-cancel { background: #e6e8eb; color: #333; }
  #btn-apply { background: #2f7ed8; color: #fff; }
  /* Reset sits apart from Cancel and Apply so it is not mistaken for the main action. */
  #btn-reset { background: transparent; color: #b4232a; border-color: #e2c3c5; margin-right: auto; padding: 8px 12px; }
</style>
</head>
<body>
<button id="gear" title="Settings" aria-label="Settings">&#9881;</button>

<div id="app">
  <div id="title"></div>
  <svg id="chart"></svg>
</div>

<!-- To add a setting: a row here, a default in DEFAULTS, a line in CONTROLS.
     Ids are prefix-name: sel- chk- rng- inp- col- num-. A slider's value label is lbl-<same name>.
     To add a group: a button in #tabs and a pane in #panes with the same name. The accordion
     headers are built from the tab buttons, so there is nothing else to write. -->
<div id="panel">
  <div id="panel-head" title="Drag to move. Double-click to dock.">
    <span class="grip">&#8942;&#8942;</span>
    <h2>Settings</h2>
    <button class="head-btn" id="btn-pin">Pin to side</button>
    <button class="head-btn" id="btn-dock" title="Return the panel to the corner">Dock</button>
  </div>
  <div id="tabs">
    <button class="tab active" data-tab="layout">Layout</button>
    <button class="tab" data-tab="title">Title</button>
    <button class="tab" data-tab="colors">Colors</button>
    <button class="tab" data-tab="tools">Tools</button>
  </div>
  <div id="panes">
    <div class="pane active" data-pane="layout">
      <div class="row"><label class="name">Bars</label>
        <select id="sel-fit">
          <option value="fit">Fit the view</option>
          <option value="fixed">Fixed width</option>
        </select><span></span></div>
      <div class="row" id="row-barwidth"><label class="name">Bar width</label>
        <input type="range" id="rng-barwidth" min="8" max="90" step="1" />
        <span class="slider-val" id="lbl-barwidth"></span></div>
      <div class="row"><label class="name">Gap</label>
        <input type="range" id="rng-gap" min="0" max="40" step="1" />
        <span class="slider-val" id="lbl-gap"></span></div>
      <div class="row"><label class="name">Labels</label>
        <div class="check"><input type="checkbox" id="chk-labels" /><span>Show the value on each bar</span></div><span></span></div>
      <div class="row" id="row-decimals"><label class="name">Decimals</label>
        <input type="number" id="num-decimals" min="0" max="3" step="1" /><span></span></div>
    </div>
    <div class="pane" data-pane="title">
      <div class="row"><label class="name">Title</label>
        <input type="text" id="inp-title" /><span></span></div>
      <div class="hint">Use {top} for the largest category and {n} for how many there are. The title rewrites itself when the data changes.</div>
    </div>
    <div class="pane" data-pane="colors">
      <div class="row"><label class="name">Bar color</label>
        <div class="check"><input type="color" id="col-bar" /></div><span></span></div>
      <div class="section">One color per category</div>
      <div id="name-color-list"></div>
      <div class="mini-btns"><button class="mini-btn" id="btn-names-reset">Reset these</button></div>
    </div>
    <div class="pane" data-pane="tools">
      <div class="section">Copy formatting</div>
      <div class="hint">Copy the look of this chart, open the same chart on another sheet, and paste. Formatting leaves out
        anything tied to this sheet's data, such as per-category colors. A pasted look previews at once and is saved when you click Apply.</div>
      <div class="mini-btns">
        <button class="mini-btn" id="btn-set-copy">Copy formatting</button>
        <button class="mini-btn" id="btn-set-copyall">Copy everything</button>
        <button class="mini-btn" id="btn-set-paste">Paste</button>
      </div>
      <textarea id="set-text" placeholder="Paste a copied block here, then click Load"></textarea>
      <div class="mini-btns" id="set-load-row" style="display:none">
        <button class="mini-btn" id="btn-set-last">Use the last copy on this machine</button>
        <button class="mini-btn" id="btn-set-load">Load</button>
      </div>
      <div class="hint" id="set-msg"></div>
      <div class="section">Diagnostics</div>
      <div class="hint">If something looks wrong, copy this text and send it to whoever maintains the chart. It lists the data
        the chart received, what it worked out, recent errors and the settings.</div>
      <div class="mini-btns">
        <button class="mini-btn" id="btn-diag">Show diagnostics</button>
        <button class="mini-btn" id="btn-diag-copy">Copy</button>
      </div>
      <textarea id="diag-text" readonly></textarea>
    </div>
  </div>
  <div id="reset-note">Defaults restored. Click Apply to save, or Cancel to keep your current settings.</div>
  <div class="actions">
    <button class="btn" id="btn-reset" title="Restore every setting to its default">Reset to defaults</button>
    <button class="btn" id="btn-cancel">Cancel</button>
    <button class="btn" id="btn-apply">Apply</button>
  </div>
</div>

<script>
(function () {
  'use strict';
  const NAME = 'Panel starter';
  const VERSION = '1.1.0';
  const SLUG = 'panel-starter'; // prefix for anything kept in localStorage

  // 1. Every setting has a default. The default's type is the setting's type.
  const DEFAULTS = {
    fit: 'fit',
    barWidth: 36,
    gap: 10,
    labels: true,
    decimals: 0,
    title: '{top} leads {n} categories',
    barColor: '#1170aa',
    nameColors: {}, // per-item settings are keyed by name, never by position
  };

  // 2. One line per plain control: [element id, settings key, kind, slider label].
  const CONTROLS = [
    ['sel-fit', 'fit', 'select'],
    ['rng-barwidth', 'barWidth', 'range', (v) => v + ' px'],
    ['rng-gap', 'gap', 'range', (v) => v + ' px'],
    ['chk-labels', 'labels', 'check'],
    ['num-decimals', 'decimals', 'number'],
    ['inp-title', 'title', 'text'],
    ['col-bar', 'barColor', 'color'],
  ];

  // Settings tied to one sheet's data. "Copy formatting" leaves these out, so
  // pasting a look onto another sheet keeps that sheet's own.
  const DATA_BOUND = ['nameColors'];

  // 3. Where settings are kept. Swap these two functions for your host.
  const store = {
    load() { try { return window.localStorage.getItem(SLUG + ':settings'); } catch (e) { return null; } },
    save(text) { try { window.localStorage.setItem(SLUG + ':settings', text); } catch (e) { /* read-only */ } },
  };

  // Stands in for the data your host hands you.
  const DATA = [
    { name: 'North', value: 42.5 }, { name: 'South', value: 31.25 }, { name: 'East', value: 55.75 },
    { name: 'West', value: 23 }, { name: 'Central', value: 37.5 },
  ];

  let S = clone(DEFAULTS); // applied and saved
  let draft = null;        // a copy of S while the panel is open, otherwise null
  let previewTimer = null;
  // How this person likes the panel: where it floats, whether it is pinned to
  // the side, which accordion sections are open. Per machine, never saved with S.
  const ui = { pos: null, pinned: false, open: ['layout'] };
  // For Diagnostics: the last few draws and anything that went wrong.
  const trace = [];
  const errors = [];

  function $(id) { return document.getElementById(id); }
  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  // The settings in force for drawing. This one line is the live preview.
  function cfgNow() { return draft || S; }

  // ------------------------------------------------------------ the chart ---

  // Pure: everything it needs comes in as arguments. It never reads S or draft,
  // so the panel can call it with the draft to build its own lists.
  function buildModel(data, cfg) {
    const top = data.reduce((a, b) => (b.value > a.value ? b : a), data[0]);
    return {
      n: data.length,
      top: top ? top.name : '',
      max: Math.max.apply(null, data.map((d) => d.value).concat([0])),
      bars: data.map((d) => ({ name: d.name, value: d.value, color: cfg.nameColors[d.name] || cfg.barColor })),
    };
  }

  function draw() {
    const cfg = cfgNow();
    const model = buildModel(DATA, cfg);
    $('title').textContent = cfg.title.replace(/\{top\}/g, model.top).replace(/\{n\}/g, model.n);
    const svg = $('chart');
    const box = svg.getBoundingClientRect();
    const W = box.width, H = box.height;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const add = (name, attrs, text) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', name);
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
      if (text != null) el.textContent = text;
      svg.appendChild(el);
    };
    trace.push({ at: new Date().toISOString(), width: Math.round(W), height: Math.round(H), bars: model.n, preview: !!draft });
    if (trace.length > 12) trace.shift();
    const pad = 20, base = H - 28;
    const slot = cfg.fit === 'fixed' ? cfg.barWidth + cfg.gap : (W - pad * 2) / Math.max(1, model.n);
    const bw = cfg.fit === 'fixed' ? cfg.barWidth : Math.max(2, slot - cfg.gap);
    // Check a saved value where it is used. A saved or pasted number can be anything.
    const dec = clamp(Math.round(cfg.decimals) || 0, 0, 3);
    model.bars.forEach((b, i) => {
      const h = model.max ? (b.value / model.max) * Math.max(0, base - 34) : 0;
      const x = pad + i * slot + (slot - bw) / 2;
      add('rect', { x, y: base - h, width: bw, height: h, rx: 3, fill: b.color });
      add('text', { x: x + bw / 2, y: base + 18, 'text-anchor': 'middle', 'font-size': 13, fill: '#444' }, b.name);
      if (cfg.labels) {
        add('text', { x: x + bw / 2, y: base - h - 6, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600, fill: '#222' }, b.value.toFixed(dec));
      }
    });
  }

  // ------------------------------------------------------------- settings ---

  // Turn any saved or pasted object into complete, correctly typed settings.
  // Merged over DEFAULTS, so something saved before a setting existed still
  // loads. Each value is brought back to the type of its default, and keys
  // that are not settings are dropped.
  function withDefaults(obj) {
    const out = clone(DEFAULTS);
    if (!obj || typeof obj !== 'object') return out;
    Object.keys(DEFAULTS).forEach((k) => {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) return;
      const d = DEFAULTS[k], v = obj[k];
      if (typeof d === 'number') { const n = Number(v); out[k] = (v === '' || v == null || !isFinite(n)) ? d : n; }
      else if (typeof d === 'boolean') out[k] = typeof v === 'boolean' ? v : (v === 'true' ? true : (v === 'false' ? false : d));
      else if (typeof d === 'string') out[k] = v == null ? d : String(v);
      else if (d && typeof d === 'object' && !Array.isArray(d)) out[k] = Object.assign(clone(d), v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      else out[k] = v;
    });
    return out;
  }

  // All settings are ONE JSON string under ONE key.
  function loadSettings() {
    const raw = store.load();
    if (!raw) return;
    try { S = withDefaults(JSON.parse(raw)); } catch (e) { S = clone(DEFAULTS); }
  }
  function saveSettings() { store.save(JSON.stringify(S)); }

  // Panel preferences belong to the machine, not to the saved settings.
  function loadUi() {
    try {
      const p = JSON.parse(window.localStorage.getItem(SLUG + ':panel'));
      if (!p || typeof p !== 'object') return;
      if (p.pos && isFinite(p.pos.left) && isFinite(p.pos.top)) ui.pos = { left: p.pos.left, top: p.pos.top };
      ui.pinned = p.pinned === true;
      if (Array.isArray(p.open)) ui.open = p.open.filter((x) => typeof x === 'string');
    } catch (e) {}
  }
  function saveUi() {
    try { window.localStorage.setItem(SLUG + ':panel', JSON.stringify(ui)); } catch (e) {}
  }

  function recordError(where, err) {
    errors.push({ at: new Date().toISOString(), where, message: String((err && err.message) || err) });
    if (errors.length > 20) errors.shift();
  }

  // ---------------------------------------------------------------- panel ---

  function wirePanel() {
    $('gear').addEventListener('click', () => { if ($('panel').style.display === 'flex') closePanel(); else openPanel(); });
    $('btn-cancel').addEventListener('click', closePanel);
    $('btn-apply').addEventListener('click', applyPanel);
    $('btn-reset').addEventListener('click', resetDraft);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('panel').style.display === 'flex') closePanel(); });
    document.querySelectorAll('#tabs .tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.tab)));

    // Every control edits the draft and previews at once. Nothing is saved
    // until Apply, and Cancel puts the applied settings back.
    CONTROLS.forEach(([id, key, kind, fmt]) => {
      const el = $(id);
      if (!el) { recordError('panel', 'CONTROLS names a missing element: ' + id); return; }
      const evt = (kind === 'select' || kind === 'check') ? 'change' : 'input';
      el.addEventListener(evt, () => {
        if (!draft) return;
        if (kind === 'check') draft[key] = el.checked;
        else if (kind === 'range' || kind === 'number') {
          const n = Number(el.value);
          if (el.value === '' || !isFinite(n)) return; // a number box is empty for a moment while typing
          draft[key] = n;
          if (kind === 'range') $('lbl-' + id.slice(4)).textContent = fmt(n);
        } else draft[key] = el.value;
        updateDependentRows();
        schedulePreview();
      });
    });

    $('btn-names-reset').addEventListener('click', () => {
      if (!draft) return;
      draft.nameColors = {};
      buildNameColorList();
      schedulePreview();
    });

    // Copy a look out, or paste one in. A pasted look goes into the draft.
    $('btn-set-copy').addEventListener('click', () => copyBlock(false, $('btn-set-copy'), 'Copy formatting'));
    $('btn-set-copyall').addEventListener('click', () => copyBlock(true, $('btn-set-copyall'), 'Copy everything'));
    $('btn-set-paste').addEventListener('click', () => {
      const ta = $('set-text');
      ta.value = '';
      ta.style.display = 'block';
      $('set-load-row').style.display = 'flex';
      $('btn-set-last').style.display = lastCopy() ? '' : 'none';
      $('set-msg').textContent = '';
      ta.focus();
    });
    $('btn-set-last').addEventListener('click', () => loadBlock(lastCopy()));
    $('btn-set-load').addEventListener('click', () => {
      let obj = null;
      try { obj = JSON.parse($('set-text').value); } catch (e) { obj = null; }
      loadBlock(obj);
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

  // A copied look is a small labeled block, so a paste can tell what it is.
  // It goes to the clipboard as text AND into localStorage, because another
  // sheet running this same chart can read localStorage even when the host
  // blocks the clipboard.
  function copyBlock(everything, btn, label) {
    const settings = clone(draft || S);
    if (!everything) DATA_BOUND.forEach((k) => { delete settings[k]; });
    const block = { chart: SLUG, kind: everything ? 'everything' : 'formatting', copied: new Date().toISOString(), settings };
    const text = JSON.stringify(block, null, 2);
    try { window.localStorage.setItem(SLUG + ':copied', text); } catch (e) {}
    const ta = $('set-text');
    ta.value = text;
    ta.style.display = 'block';
    $('set-load-row').style.display = 'none';
    $('set-msg').textContent = everything ? 'Everything, including what is tied to the data on this sheet.' : 'Formatting only.';
    copyText(ta, btn, label);
  }

  function lastCopy() {
    try { return JSON.parse(window.localStorage.getItem(SLUG + ':copied')); } catch (e) { return null; }
  }

  // Accepts a copied block, or a bare settings object. Pasted keys go over the
  // draft, so anything the block leaves out keeps this sheet's own value.
  function loadBlock(obj) {
    if (!draft) return;
    const say = (msg) => { $('set-msg').textContent = msg; };
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { say('That is not a copied settings block.'); return; }
    if (obj.chart && obj.chart !== SLUG) { say('That was copied from a different chart (' + obj.chart + ').'); return; }
    const incoming = obj.settings && typeof obj.settings === 'object' ? obj.settings : obj;
    draft = withDefaults(Object.assign({}, draft, incoming));
    populatePanel();
    say('Loaded. Click Apply to save.');
    schedulePreview();
  }

  // Everything someone needs to explain a wrong picture from a distance.
  function diagnosticsText() {
    let model = null;
    try { model = buildModel(DATA, S); } catch (e) { recordError('diagnostics', e); }
    return JSON.stringify({
      chart: NAME + ' ' + VERSION,
      time: new Date().toISOString(),
      view: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio },
      browser: navigator.userAgent,
      panel: { pinned: ui.pinned, position: ui.pos, openSections: ui.open },
      data: { rows: DATA.length, fields: DATA.length ? Object.keys(DATA[0]) : [], sample: DATA.slice(0, 4) },
      model: model ? { n: model.n, top: model.top, max: model.max } : null,
      lastDraws: trace.slice(-6),
      errors: errors.slice(-10),
      settings: S,
      unsavedDraft: draft,
    }, null, 2);
  }

  // Copying can be blocked inside an embedded frame, so try three ways and
  // say on the button what happened.
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

  // Drag the panel by its title bar. Dock returns it to the corner.
  function wireDrag() {
    const panel = $('panel');
    const head = $('panel-head');
    let drag = null;
    head.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('button') || panel.classList.contains('pinned')) return;
      const r = panel.getBoundingClientRect();
      drag = { dx: ev.clientX - r.left, dy: ev.clientY - r.top };
      try { head.setPointerCapture(ev.pointerId); } catch (e) {}
      head.classList.add('dragging');
      ev.preventDefault();
    });
    head.addEventListener('pointermove', (ev) => { if (drag) placePanel(ev.clientX - drag.dx, ev.clientY - drag.dy); });
    const end = () => {
      if (!drag) return;
      drag = null;
      head.classList.remove('dragging');
      saveUi();
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    head.addEventListener('dblclick', (ev) => { if (!ev.target.closest('button') && !panel.classList.contains('pinned')) dockPanel(true); });
    $('btn-dock').addEventListener('click', () => dockPanel(true));
    $('btn-pin').addEventListener('click', () => { ui.pinned = !ui.pinned; saveUi(); applyPanelMode(); });
    window.addEventListener('resize', () => { if (panel.style.display === 'flex') applyPanelMode(); else draw(); });
  }

  // Keep the whole panel in view, and at least its title bar when the view
  // is smaller than the panel. A panel dragged out of reach is a dead end.
  function placePanel(left, top) {
    const p = $('panel');
    const w = p.offsetWidth || 400;
    const h = p.offsetHeight || 300;
    left = clamp(left, Math.min(0, window.innerWidth - w), Math.max(0, window.innerWidth - w));
    top = clamp(top, 0, Math.max(0, window.innerHeight - Math.min(h, window.innerHeight - 8)));
    p.style.left = Math.round(left) + 'px';
    p.style.top = Math.round(top) + 'px';
    p.style.right = 'auto';
    ui.pos = { left: Math.round(left), top: Math.round(top) };
  }

  function dockPanel(forget) {
    const p = $('panel');
    p.style.left = 'auto';
    p.style.right = '8px';
    p.style.top = '8px';
    if (forget) { ui.pos = null; saveUi(); }
  }

  // Floating or pinned. Pinned makes the panel a strip down the right side,
  // moves the chart over so nothing is covered, and shows the groups as an
  // accordion. A view too small to share falls back to floating, and the
  // preference is kept for when there is room again.
  // A short view has no room for a strip either: it would be all title bar and buttons.
  function canPin() { return window.innerWidth >= 720 && window.innerHeight >= 420; }
  function applyPanelMode() {
    const p = $('panel');
    const open = p.style.display === 'flex';
    const pinned = ui.pinned && canPin();
    p.classList.toggle('pinned', pinned);
    p.classList.toggle('accordion', pinned);
    document.body.classList.toggle('panel-pinned', pinned && open);
    $('btn-pin').textContent = pinned ? 'Float' : 'Pin to side';
    $('btn-pin').disabled = !canPin();
    $('btn-pin').title = !canPin() ? 'The view is too small to pin the panel'
      : (pinned ? 'Let the panel float so it can be dragged' : 'Keep the panel down the right side, beside the chart');
    $('btn-dock').style.display = pinned ? 'none' : '';
    $('panel-head').title = pinned ? '' : 'Drag to move. Double-click to dock.';
    if (pinned) { p.style.left = ''; p.style.top = ''; p.style.right = ''; }
    else if (open) { if (ui.pos) placePanel(ui.pos.left, ui.pos.top); else dockPanel(false); }
    draw(); // the chart's width may have changed
  }

  // Give every pane a header built from its tab, and wrap its rows in a body.
  // Tabs show one pane at a time. The accordion shows every header and opens
  // as many as the person likes.
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
        const i = ui.open.indexOf(name);
        if (i === -1) ui.open.push(name); else ui.open.splice(i, 1);
        saveUi();
        reflectAccordion();
      });
      pane.appendChild(head);
      pane.appendChild(body);
    });
    reflectAccordion();
  }
  function reflectAccordion() {
    document.querySelectorAll('#panes .pane').forEach((pane) => {
      const open = ui.open.indexOf(pane.dataset.pane) !== -1;
      pane.classList.toggle('open', open);
      pane.querySelector('.acc-head').setAttribute('aria-expanded', String(open));
    });
  }

  function showTab(name) {
    document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('#panes .pane').forEach((p) => p.classList.toggle('active', p.dataset.pane === name));
  }

  function openPanel() {
    draft = clone(S);
    $('reset-note').style.display = 'none';
    ['set-text', 'set-load-row', 'diag-text'].forEach((id) => { $(id).style.display = 'none'; });
    $('set-msg').textContent = '';
    populatePanel();
    $('panel').style.display = 'flex';
    applyPanelMode();
  }

  // Fill every control from the draft. Runs on open, on Reset and after a paste.
  function populatePanel() {
    CONTROLS.forEach(([id, key, kind, fmt]) => {
      const el = $(id);
      if (!el) return;
      if (kind === 'check') el.checked = !!draft[key];
      else el.value = draft[key];
      if (kind === 'range') $('lbl-' + id.slice(4)).textContent = fmt(draft[key]);
    });
    buildNameColorList();
    updateDependentRows();
  }

  // Rows that only apply to some choices are grayed out, not hidden, so the
  // panel does not jump around.
  function updateDependentRows() {
    if (!draft) return;
    const off = (rowId, ctlId, isOff) => { $(rowId).classList.toggle('off', isOff); $(ctlId).disabled = isOff; };
    off('row-barwidth', 'rng-barwidth', draft.fit !== 'fixed');
    off('row-decimals', 'num-decimals', !draft.labels);
  }

  // A list built from the data: one row per category, stored by name.
  function buildNameColorList() {
    const list = $('name-color-list');
    while (list.firstChild) list.removeChild(list.firstChild);
    const model = buildModel(DATA, draft);
    if (!model.bars.length) {
      const h = document.createElement('div');
      h.className = 'hint';
      h.textContent = 'Categories appear here once there is data.';
      list.appendChild(h);
      return;
    }
    model.bars.forEach((b) => {
      const row = document.createElement('div');
      row.className = 'item-row';
      const col = document.createElement('input');
      col.type = 'color';
      col.value = b.color;
      col.addEventListener('input', () => { draft.nameColors[b.name] = col.value; schedulePreview(); });
      const lab = document.createElement('span');
      lab.textContent = b.name;
      row.appendChild(col);
      row.appendChild(lab);
      list.appendChild(row);
    });
  }

  // Reset changes the DRAFT only, so Cancel still backs out of it.
  function resetDraft() {
    draft = clone(DEFAULTS);
    populatePanel();
    $('reset-note').style.display = 'block';
    schedulePreview();
  }

  function closePanel() {
    draft = null;
    $('panel').style.display = 'none';
    applyPanelMode(); // gives the chart its width back and redraws with the applied settings
  }

  function applyPanel() {
    if (draft) { S = clone(draft); saveSettings(); }
    draft = null;
    $('panel').style.display = 'none';
    applyPanelMode();
  }

  // One redraw per burst of edits. 40 ms feels instant and keeps a slider smooth.
  function schedulePreview() {
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { previewTimer = null; draw(); }, 40);
  }

  // ---------------------------------------------------------------- start ---

  // Anything that escapes a try and catch still reaches Diagnostics.
  window.addEventListener('error', (ev) => recordError('window', ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => recordError('promise', ev.reason));

  // A panel problem must cost the panel, never the chart.
  try {
    loadSettings();
    loadUi();
    wirePanel();
    wireAccordion();
    wireDrag();
  } catch (e) { recordError('startup', e); }
  draw();
})();
</script>
</body>
</html>
```

## Float, dock, or pin to the side

The panel has two modes, and the person picks.

- **Floating.** It sits over the chart and drags by its title bar. **Dock**, or a double-click on the title bar, sends it back to the top-right corner and forgets the dragged position.
- **Pinned.** It becomes a full-height strip on the right. The chart area gets a right margin of the same width, so the chart redraws narrower and nothing is hidden. The gear moves left of the strip so it still closes the panel.

How the starter does it:

- One function, `applyPanelMode()`, sets everything from one preference: the `pinned` class on the panel, the `panel-pinned` class on the body, the button's label, and a redraw. It runs when the panel opens or closes, when Pin is clicked and when the window resizes.
- **The chart must redraw when the mode changes,** because its width changed. Forgetting this leaves a stretched or clipped chart.
- **A small view cannot share.** Under 720 px wide or 420 px tall the panel floats even if the person prefers it pinned, and the Pin button is disabled with a tooltip that says why. The preference is kept and comes back when there is room. The height rule matters on dashboards, where a chart often sits in a short zone and a strip would be all title bar and buttons.
- Dragging is ignored while pinned.
- Closing the panel, by Apply, Cancel or Escape, gives the chart its full width back.

Pinning is worth offering when a chart has many settings or when people tune for a long time. For a small panel, floating alone is enough.

## Accordion sections

Tabs and an accordion are two views of the same panes. The starter writes each group once, as a tab button and a pane. At startup `wireAccordion()` gives every pane a header built from its tab's label and wraps the pane's rows in a body. CSS decides which view shows: tabs when floating, accordion when pinned.

- **Several sections can be open at once.** A tall strip has the room, and comparing two groups is common. To allow only one, close the others in the header's click handler.
- **Open sections are remembered per machine,** alongside the position and the pinned choice.
- Each header is a real `<button>` with `aria-expanded`, so it works from the keyboard and reads correctly in a screen reader.
- **To use the accordion when floating too,** add the `accordion` class in `applyPanelMode()` whatever the mode. That suits a panel with many short groups.
- Order the sections like the tabs: what the chart is made of first, tools last.

## Adding a setting

Three edits. Nothing else needs wiring, because opening, filling, previewing, applying, canceling and resetting all run off `CONTROLS`.

1. **A row in the panel markup:**

```html
<div class="row"><label class="name">Corner radius</label>
  <input type="range" id="rng-radius" min="0" max="12" step="1" />
  <span class="slider-val" id="lbl-radius"></span></div>
```

2. **A default:** `radius: 3,` in `DEFAULTS`.
3. **A line in `CONTROLS`:** `['rng-radius', 'radius', 'range', (v) => v + ' px'],`

Then use `cfg.radius` in the drawing.

Ids follow a prefix so the kind is obvious from the markup:

| Prefix | Kind | Element | Value |
| --- | --- | --- | --- |
| `sel-` | `select` | `<select>` | a string |
| `chk-` | `check` | checkbox | a boolean |
| `rng-` | `range` | slider | a number. Needs `lbl-<same name>` and a label formatter. |
| `num-` | `number` | number box | a number, for values that must be exact |
| `inp-` | `text` | text box | a string. Previews on every keystroke. |
| `col-` | `color` | color input | `#rrggbb` |

Every row is a three-column grid: label, control, value. Put an empty `<span></span>` in the third column when there is nothing to show there, or the grid misaligns.

A setting with no default is a bug. So is a `CONTROLS` line that names a missing element. If the project has a build or check step, have it compare the three lists.

## Saving

**One JSON string under one key.** Do not store settings one key at a time. One string means one write, one read, and a set of settings that can be copied as text.

**Load through `withDefaults`.** It does three jobs:

- It merges the saved object over `DEFAULTS`, so something saved before a setting existed still opens.
- It brings each value back to the type of its default. Hosts that store only strings will hand back `"14"` and `"false"`. Those draw correctly once and wrong after a reopen.
- It drops keys that are not settings.

**Check a value again where it is used** when a bad one would throw. In the starter, `decimals` is clamped before `toFixed`, because a pasted or hand-edited number can be anything.

**Inside a Tableau extension,** swap the two `store` functions for these, and call `loadSettings()` only after `tableau.extensions.initializeAsync()` resolves:

```js
const store = {
  load() { return tableau.extensions.settings.get('settings'); },
  save(text) {
    try {
      tableau.extensions.settings.set('settings', text);
      const p = tableau.extensions.settings.saveAsync();
      if (p && p.catch) p.catch(() => {}); // viewers without edit rights cannot save
    } catch (e) { /* read-only context */ }
  },
};
```

A failed save must never stop the chart from drawing. Wrap the whole startup in a try and catch for the same reason: a panel problem should cost the panel, not the view.

**Panel preferences go in `localStorage`,** under their own key: where the panel floats, whether it is pinned, which sections are open. Wrap every read and write in try and catch, because some embedded frames block storage.

## Patterns for richer settings

The starter covers plain controls. Real charts need more. These are the patterns that held up.

### Rows that depend on other rows

One function, `updateDependentRows()`, runs after every edit and on every fill. It grays out and disables what does not apply. Keep all of that logic in this one function so it cannot drift.

### Lists built from the data

Some settings are per item: a color for each category, a label for each series. The starter's "One color per category" shows the pattern.

- Store them as a map **keyed by name**, never by position. A filter change reorders positions and scrambles the colors.
- Build the list from the pure model function, called with the draft.
- Rebuild it whenever something that changes it is edited.
- Give the list a "Reset these" button that clears the map.
- `withDefaults` must turn a missing or malformed map into `{}`.
- When there is nothing to list yet, say what would make it appear.

### An editable list of thresholds

Range Dot colors its dot by bands with boundaries the person defines: up to 85%, up to 100%, up to 120%, and above that. The editor is one compact line per band (number, color, label, remove) with Add, Suggest from the data, and Clear underneath. What made it work:

- **The last band has no upper number.** It reads "Above that." There is always one more band than there are boundaries.
- **Sort on `change`, not on `input`.** Sorting while someone is typing makes the row jump away mid-number. Preview on `input`, sort and rebuild when the box loses focus.
- **Clean the list on every load.** A saved or pasted list can be unsorted, duplicated or missing its last band. One function returns a clean list or an empty one.
- **Suggest from the data.** A button that fills in sensible boundaries, such as the quartiles, gives people something to edit instead of a blank list.
- **Show the data's own range in a hint.** "Load % runs from 0.4 to 1.5, shown as 40% to 150%" answers the question of what units to type.
- **Offer the tie rule as a setting.** Whether a value exactly on a boundary belongs to the band below or above is a real business decision.

### One-click setup

Range Dot has a button, "Set up as percent of a limit." It writes eight settings into the draft at once: percent format, a line at 100%, four colored bands, a title. The person sees the result immediately and changes anything they like.

A setup button is worth adding whenever one common use needs several settings to agree. It edits the draft, calls the fill function, and schedules a preview. It never saves.

### Automatic, with an override

When the chart can work something out from the data, let it, show what it found, and let the person overrule it.

- Range Dot detects the usual weekly capacity from the data and calls out only the weeks that differ. The panel shows "Detected baseline: 40" under a box where a different number can be typed.
- Its field matching offers "Auto: Capacity Hours" as the first choice in each dropdown, then "Not used," then every other field.

Always show what Automatic picked. A setting that says only "Automatic" leaves the person guessing.

### Text with placeholders

Titles, subtitles and notes accept placeholders that the chart fills from the data: `{top}`, `{n}`, `{value}`, `{baseline}`. A title written once then stays true when a filter changes. List the available placeholders in a hint under the box.

### Hints and honest empty states

- A hint line under a row says what it does in plain words. Use one wherever the label alone does not make the effect obvious.
- When a group of settings cannot do anything yet, say so and say what would change that: "Put a dimension on the Color shelf to color the dot by its names." A switch that does nothing is how a person decides the chart is broken.

### Copy formatting from one worksheet to another

Someone gets one chart looking right and wants the same look on another worksheet. Because the settings are one JSON object, this is nearly free, and the starter's Tools section has it: **Copy formatting**, **Copy everything**, and **Paste**.

What makes it hold up:

- **Split settings into the look and what is tied to the data.** Colors, sizes, fonts, formats and titles travel well. Field choices, per-category colors and a highlighted member belong to one sheet's data. List the data-tied keys in one place (`DATA_BOUND` in the starter). Copy formatting leaves them out. Copy everything keeps them, for moving a whole chart.
- **Paste over the current draft, not over the defaults.** Anything the copied block leaves out keeps the target sheet's own value. That is what makes "formatting only" safe.
- **Label the block.** It carries the chart's id, the kind of copy and the time. Paste refuses a block from a different chart and says so. It also accepts a bare settings object, for hand-edited text.
- **Run everything pasted through `withDefaults`.** Pasted text can hold anything.
- **Paste goes into the draft.** It previews at once and saves only on Apply, so trying a look costs nothing.
- **Keep the last copy in `localStorage` too.** A second worksheet running the same chart from the same address can read it, so Paste offers "Use the last copy on this machine" with no clipboard involved. This matters because embedded frames often block the clipboard. Check that the host shares storage between sheets before relying on it.

Copying to the clipboard is often blocked inside an embedded frame. Try `document.execCommand('copy')`, then the clipboard API, then leave the text selected and ask for a right-click Copy. Say on the button which one happened. Inside Tableau Desktop, never ask for Ctrl+C: there it copies the worksheet's data instead.

### Diagnostics capture

An embedded chart usually has no developer console. When it draws the wrong thing, or nothing, the only evidence is what the chart can report about itself. Build that report in from the start. The starter has it in Tools: **Show diagnostics** and **Copy**.

The report is JSON, so it can be pasted straight to Claude. Put in it:

- The chart's name and version, the time, the view's size and the browser.
- **The data as received:** how many rows, the field names and types, and a few sample rows. In Tableau, show each cell's native value and its formatted text side by side, because most "wrong number" reports are a format that did not arrive.
- **What the chart worked out:** what each automatic choice matched, and the key numbers from the model.
- **A trace of the last few draws:** when, at what size, with how many marks.
- **Recent errors.** Record them in a short list from every catch block, and from `window` `error` and `unhandledrejection` listeners, which catch what escapes.
- The applied settings, and the unsaved draft if the panel is open.

Three rules:

- **Diagnostics must work when the chart does not.** Put the same button on the empty or error screen, not only inside the panel.
- **Keep sample rows few, and say in the hint that the report includes them.** The person may be about to paste data somewhere it should not go.
- **When a new kind of question comes up,** add the answer to the report. That is cheaper than a round of guessing.

When someone reports a wrong picture, ask for this text before you guess.

## Tab order

Put what the chart is made of first, then how values read, then anything specific to this chart, then titles, colors and fonts, with fields, copy formatting and diagnostics last. The same order serves the accordion. Range Dot's tabs are Layout, Range, Dot, Values, Line, Title, Colors, Fonts, Fields. Seven to nine tabs fit; they wrap onto a second line.

## Choices you can make differently

These are options, not corrections. Ask the person which they prefer.

- **Number boxes with steppers instead of sliders,** when exact values matter more than feel. The starter supports both.
- **A panel built from helpers or a schema,** one entry per setting, once a chart passes about 60 settings. The three-edit approach gives hand control over layout; generating the panel prevents drift. Part 2 shows the helper version.
- **Saving as changes are made,** with no Apply or Cancel. Simpler, but a draft can no longer be thrown away. Part 2 shows how to do it safely.
- **Themes, text size and density as settings,** for pages that sit on dark dashboards or are read at a distance. Part 2 shows how.
- **A gear that fades** when the pointer is elsewhere, so it stays out of screenshots.

## What not to do

- Do not save on every change, unless the person chose that design.
- Do not read `S` or `draft` inside the model or drawing code. Take `cfg`.
- Do not add a setting without a default.
- Do not key per-item settings by position.
- Do not hide rows that do not apply. Gray them out.
- Do not close the panel on an outside click.
- Do not open a separate window or dialog for settings.
- Do not put controls outside the panel, other than direct interaction with the chart itself.
- Do not let a settings error stop the chart from drawing.

## Test before you call it done

Run these in a browser and report what happened for each. "It should work" is not a result.

1. Open the panel, move a slider. The chart changes within a moment, with no Apply.
2. Click Cancel. The chart returns to what it was, and nothing was saved.
3. Change several settings, click Apply, reload the page. They are still in force, and the controls show them.
4. Click Reset to defaults. The note appears and the chart shows defaults. Click Cancel. The applied settings come back.
5. Press Escape with the panel open. It closes like Cancel.
6. Click the chart while the panel is open. The panel stays open.
7. Drag the panel by its title bar far past each edge. It stays fully in view.
8. Reload. The panel opens where it was left. Click Dock. It returns to the corner and stays there after a reload.
9. Make the window short. The panes scroll, and the title bar and buttons stay visible.
10. Pick a choice that makes another row irrelevant. That row grays out and its control is disabled.
11. Click Pin to side. The panel becomes a strip on the right, the chart redraws narrower with nothing hidden, and the groups show as an accordion. Open and close sections. Reload: still pinned, same sections open.
12. While pinned, change a setting. The chart previews. Click Apply. The panel closes and the chart takes back its full width.
13. Narrow the window below 720 px, then make it shorter than 420 px. Each time the panel floats, and Pin is disabled with a reason. Restore the size. The pinned strip returns.
14. Click Float. Tabs return and the panel drags again.
15. Click Copy formatting. The block has no data-tied settings. Click Copy everything. It does.
16. Change a data-tied setting, then Paste and use the last copy. The look arrives and the data-tied setting keeps its own value.
17. Paste a block from a different chart, text that is not JSON, and settings with wrong types (`"70"` for a number, `"false"` for a switch). The first two are refused with a message. The third loads cleanly.
18. Click Show diagnostics. The report is valid JSON with data, model, draws, errors and settings.
19. Empty a number box. The chart does not jump to zero or throw.
20. Check the smallest text in the panel. Nothing is under 13 px.
21. Check the console. No errors.

Then test inside the real host, with real data. Working in a browser preview and working in the host are different claims. Say which one you verified.

---

# Part 2: the data app panel, where the choices differ

Celia built a second panel for a Tableau data app: a full-page executive summary with KPI tiles and three charts. It keeps the gear, the floating panel, the drag by the title bar, the tabs, Escape to close and the live preview. It makes six different choices, each for a reason.

Read this part when what you are building is closer to a dashboard than a single chart, or when viewers, and not only the author, will change settings.

The code below is excerpted from that working, published app. It is not a standalone file the way the Part 1 starter is.

## Which design fits

| Question | Part 1: chart extension | Part 2: data app |
| --- | --- | --- |
| Who changes settings | The author, while building | Authors and viewers |
| When it saves | On Apply. Cancel discards. | On every change, half a second later |
| Shape of the settings | One flat object | Nested by area, addressed by path |
| Panel markup | Written by hand in HTML | Built in JavaScript from helpers |
| Main controls | Dropdowns, checkboxes, sliders | Segmented buttons, switches, sliders |
| Look settings | Palette and colors | Theme, palette, font, text size, density |
| Variants | One | Editions from a preset file |

The two can be mixed. Part 1's draft, Cancel, pin to side, copy formatting and diagnostics work with Part 2's controls, look settings and editions.

## 1. Save as you go, and say where it went

There is no Apply and no Cancel. Every change is committed, saved and drawn at once. That suits a page where a viewer flips a theme or hides a tile and expects it to stick.

Two things make it safe.

**Two stores.** The browser copy is written immediately. The workbook copy is written half a second after the last change, so a slider drag is one save and not fifty.

**A status line in the panel's footer** that always tells the truth: "Changes apply live" at first, then "Saved to the workbook," or "Saved in this browser only (viewing mode)" when the person cannot edit the workbook.

```js
var saveTimer = null, saveNote = null; // saveNote is the footer's status line
function saveSettings() {
  var json = JSON.stringify(state.s);
  try { window.localStorage.setItem(STORE_KEY, json); } catch (e) { /* blocked */ }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try {
      tableau.extensions.settings.set(STORE_KEY, json);
      tableau.extensions.settings.saveAsync().then(function () {
        if (saveNote) saveNote.textContent = 'Saved to the workbook';
      }, function () {
        if (saveNote) saveNote.textContent = 'Saved in this browser only (viewing mode)';
      });
    } catch (e) { if (saveNote) saveNote.textContent = 'Saved in this browser only'; }
  }, 500);
}
```

The panel also says it in plain words on its last tab: settings save into the workbook when you edit it, and viewers can still change them, but only for their own browser.

Three things to decide if you take this route:

- **Which copy wins on load.** This app reads the workbook's copy first and uses the browser's copy only when the workbook has none. So once an author has saved a look, a viewer's changes last for the visit and the author's look returns on reload. If viewers should keep their own look across visits, read the browser copy first and add a button that returns to the workbook's look.
- **Reset has no way back.** With no draft, Reset to defaults is saved like any other change. Add a confirmation or an Undo. This app has neither, and it should.
- **Text boxes need a pause.** Each commit saves and redraws, so the text helper waits 250 ms after the last keystroke.

## 2. Nested settings, addressed by path

A dashboard has areas, and its settings follow them:

```js
var DEFAULTS = {
  title: 'Executive Summary',
  theme: 'light', palette: 'colorblind',
  font: 'poppins', textScale: 1, density: 'comfortable',
  kpi: { show: { sales: true, profit: true, orders: true }, compare: 'prior', spark: true, grain: 'quarter' },
  region: { show: true, avgLine: true, threshold: 1, labels: true, style: 'bars' },
  trend: { show: true, measure: 'sales', history: 'prior', labels: true },
};
```

Every control names its setting with a dotted path, and one function does the rest:

```js
function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a ? a[k] : undefined; }, o); }
function setPath(o, p, v) { var ks = p.split('.'), last = ks.pop(); ks.reduce(function (a, k) { return a[k]; }, o)[last] = v; }
function commit(path, v) { setPath(state.s, path, v); saveSettings(); render(); }
```

Loading merges the saved object over the defaults, all the way down. It keeps only keys the defaults have, and only values of the same type as the default:

```js
function merge(base, over) {
  var out = clone(base);
  if (!over || typeof over !== 'object') return out;
  Object.keys(over).forEach(function (k) {
    if (!(k in base)) return;
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
    else if (typeof over[k] === typeof base[k]) out[k] = over[k];
  });
  return out;
}
```

This is stricter than Part 1's `withDefaults`, which converts `"14"` to a number. Here a value of the wrong type is dropped and the default is used. Either rule is fine. Having no rule is not.

## 3. A panel built from helpers

There is no panel HTML. A handful of small functions each return a control already bound to a path: `opts` for a set of choices, `range` for a slider, `sw` for a switch, `text` for a text box. `group` starts a titled section and `row` adds a labeled line with an optional hint.

Adding a setting is then a default and one line:

```js
var c1 = group(pane, 'Profit Ratio by Region');
row(c1, 'Show', sw('region.show'));
row(c1, 'Average line', sw('region.avgLine'));
row(c1, 'Flag below', range('region.threshold', 0, 5, 0.5, function (v) { return v.toFixed(1) + ' pts'; }), 'Under average');
row(c1, 'Mark', opts('region.style', [['bars', 'Bars'], ['dots', 'Dots']]));
```

One helper, in full, shows the pattern:

```js
function opts(path, choices) {
  var wrap = h('div', 'opts'); // h(tag, className, text, parent) creates an element
  wrap.setAttribute('role', 'radiogroup');
  choices.forEach(function (c) {
    var b = h('button', null, c[1], wrap);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(getPath(state.s, path) === c[0]));
    b.addEventListener('click', function () {
      commit(path, c[0]);
      Array.prototype.forEach.call(wrap.children, function (x) { x.setAttribute('aria-checked', String(x === b)); });
    });
  });
  return wrap;
}
```

Because each helper reads its starting value when it is created, Reset empties the panes and builds them again. That is simpler than writing a second function to refill every control.

Compared with Part 1: two edits per setting, not three, and no list that can drift from the markup. The cost is less hand control over an unusual row.

## 4. Controls that show their choices

- **Segmented buttons, not dropdowns, for two to four choices.** Every choice is visible and one click away. Keep dropdowns for long lists.
- **Label an option with its result.** The number format choices are `$2.3M` and `$2,326,553`, not "Compact" and "Full."
- **Palettes are buttons with color chips,** so the person picks by looking.
- **Custom colors and named palettes stay in step.** Picking a named palette copies its colors into the custom color boxes. Editing any custom color switches the palette to Custom. The person always starts a custom palette from where they were.
- **Every chart's group starts with a Show switch,** then its own options. Hiding a part of the page is the most common request, so it comes first.
- **Hints sit under the label,** in the label column: "Blank = auto," "Under average."

## 5. Look settings through CSS variables

Theme, palette, font, text size and density are settings like any other. One function turns them into CSS variables on the root element, and the style sheet uses only the variables:

```js
function applyLook() {
  var s = state.s, t = THEMES[s.theme] || THEMES.light, p = pal(), r = document.documentElement.style;
  r.setProperty('--bg', t.bg); r.setProperty('--ink', t.ink); r.setProperty('--muted', t.muted); r.setProperty('--hair', t.hair);
  r.setProperty('--blue', p.good); r.setProperty('--orange', p.bad); r.setProperty('--context', p.context);
  r.setProperty('--font', FONTS[s.font] || FONTS.poppins);
  r.fontSize = (14 * s.textScale).toFixed(1) + 'px';
  r.setProperty('--gapx', s.density === 'compact' ? '10px' : '16px');
  document.body.style.background = t.bg;
}
```

What carries over to any project:

- **A text size slider that scales everything.** Sizes in the style sheet are in `em` or `rem`, and the slider sets the root font size from 100% to 140%. The floor in this app is 14 px, and the slider only goes up.
- **Each palette carries a dark variant.** A palette tuned for a white page loses contrast on a dark one. Picking a theme swaps in the variant without the person choosing again.
- **Colors have roles, not names.** The palette defines main, alert and context. The charts ask for a role.
- **The panel itself is always light,** whatever the theme, so it reads the same everywhere.

## 6. Editions from one code base

The app ships as several editions (light, dark, navy) with identical code. A one-line file loaded before the app gives an edition its starting look:

```js
// preset.js for the navy edition
window.SES_PRESET = { edition: 'navy', settings: { theme: 'navy', palette: 'xeomatrix' } };
```

The app folds the preset into its defaults and gives the edition its own storage key:

```js
var STORE_KEY = 'superstore-exec-settings-v1';
var PRESET = window.SES_PRESET || {};
DEFAULTS = merge(DEFAULTS, PRESET.settings);
if (PRESET.edition) STORE_KEY += '-' + PRESET.edition;
```

Two details matter. Reset returns to the edition's look, not to the base look, because the preset is part of the defaults. And the separate key stops one edition's saved look from loading into another in the same browser.

The `-v1` in the key is deliberate. When the shape of the settings changes in a way old saves cannot survive, change it to `-v2` and old saves are ignored, not misread.

## 7. A panel a keyboard and a screen reader can use

- The panel has `role="dialog"` and a label. The tabs use `tablist`, `tab` and `tabpanel` with `aria-selected`. Each set of choices is a `radiogroup` of `radio` buttons with `aria-checked`.
- Opening the panel moves focus to the selected tab. Closing it returns focus to the gear.
- Every button and input shows a visible outline on keyboard focus.
- The close button and the gear have `aria-label` text. Escape closes the panel.

Add these to a Part 1 panel too. The starter has the focus outlines, the labeled gear, Escape and `aria-expanded` on its accordion headers, but not the dialog and tab roles or the focus moves.

## What this panel leaves out

It does not remember its position, cannot be pinned, and has no Dock, no Cancel, no copy formatting, and no diagnostics. Its clamp keeps the panel 8 px inside the left, top and right edges and at least 120 px of it above the bottom edge. Its drawing code reads settings from shared state instead of taking them as an argument, which works because there is never a draft.

If a data app panel later needs Cancel or a shareable look, move it to Part 1's shape first: applied settings, a draft, and drawing code that takes `cfg`.
