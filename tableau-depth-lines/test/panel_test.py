"""Depth Lines settings-panel gate (Playwright, Chromium) against dev/dev.html + the mock Tableau.

  python test/panel_test.py [--shots DIR] [--only panel,sheet,legacy,flip]

Proves the shared ctab-panel is wired in correctly: the gear opens it, drag by the title bar clamps to the frame, minimize,
close, Escape, Copy and Paste round-trip, a setting change re-renders live and is saved as a string, no range input, no
browser dialog, every panel text >= 14px and >= 7:1 on every tab, the full-frame sheet at 390 wide.
Then FLIPS EVERY SETTING (one at a time, from a baseline that satisfies its `when`) and requires the render to change:
the chart markup, or the tooltip and highlight after a hover, or the mock Tableau calls after a hover and a click.
A setting the markup cannot show (select, hover push) is named in BEHAVIOUR and proved through the mock calls.
Last, the old (pre ctab-panel) saved keys: a workbook saved by the old panel loads with the same look.
RED if it examined fewer than MIN_SETTINGS settings or MIN_CHECKS checks."""
import json, pathlib, re, socket, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8772
BASE = f'http://127.0.0.1:{PORT}/dev/dev.html'
MIN_SETTINGS, MIN_CHECKS, MIN_TABS = 90, 50, 16
fails, stats = [], {'checks': 0, 'flipped': 0, 'texts': 0}
shots = None
if '--shots' in sys.argv:
    shots = pathlib.Path(sys.argv[sys.argv.index('--shots') + 1]); shots.mkdir(parents=True, exist_ok=True)


def check(name, cond, detail=''):
    stats['checks'] += 1
    if not cond:
        fails.append(f'{name} {detail}'.strip())


def rgb(s):
    m = re.findall(r'[\d.]+', s or '')
    return tuple(float(x) for x in m[:3]) if len(m) >= 3 else None


def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


RECT = "(sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return {l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height}; }"
TEXTS = """() => {
  const out = [];
  document.querySelectorAll('.cp-panel *').forEach(el => {
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    const isField = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && el.type !== 'checkbox' && el.type !== 'color';
    if (!own && !isField) return;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    for (let n = el; n && n.classList !== undefined; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden') return; }
    const cs = getComputedStyle(el); let g = null;
    for (let n = el; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\\(.*,\\s*0\\)$/.test(b) && b !== 'transparent') { g = b; break; } }
    out.push({ tag: el.tagName, text: (el.textContent || el.value || '').trim().slice(0, 24), size: parseFloat(cs.fontSize), fg: cs.color, bg: g });
  });
  return out;
}"""


def new_page(browser, port_query='', w=1000, h=700, perms=False, color='light'):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, color_scheme=color, permissions=['clipboard-read', 'clipboard-write'] if perms else [])
    pg = ctx.new_page()
    pg.errs, pg.dialogs = [], []
    pg.on('console', lambda m: pg.errs.append(m.text) if m.type == 'error' or '[DL]' in m.text else None)
    pg.on('pageerror', lambda e: pg.errs.append('pageerror ' + str(e)))
    pg.on('dialog', lambda d: (pg.dialogs.append(d.type), d.dismiss()))
    pg.add_init_script("window.__dlg = 0; ['alert','confirm','prompt'].forEach(function(n){ window[n] = function(){ window.__dlg++; return n === 'confirm'; }; });")
    pg.goto(f'{BASE}?still=1&{port_query}')
    pg.wait_for_selector('#dl-root[data-ready="1"]', timeout=10000)
    pg.evaluate('document.fonts.ready')
    pg.ctx = ctx
    return pg


def open_panel(pg):
    pg.click('.cp-gear')
    pg.wait_for_selector('.cp-panel:not([hidden])', timeout=5000)


def tab(pg, tid):
    pg.click(".cp-tab[data-t='%s']" % tid)
    pg.wait_for_function("document.querySelector(\".cp-tab[data-t='%s']\").getAttribute('aria-selected') === 'true'" % tid)


def val(pg, key):
    return pg.evaluate('(k) => DL.app.state.store.get()[k]', key)


def inside(r, f, tol=1.5):
    return r['l'] >= f['l'] - tol and r['t'] >= f['t'] - tol and r['r'] <= f['r'] + tol and r['b'] <= f['b'] + tol


def head_point(pg):
    r = pg.evaluate(RECT, '.cp-head')
    return r['l'] + 40, r['t'] + r['h'] / 2


def frame(pg):
    return pg.evaluate(RECT, '#dl-root')


def audit_texts(pg, label):
    bad, n = [], 0
    for t in pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.dataset.t)"):
        tab(pg, t)
        for x in pg.evaluate(TEXTS):
            n += 1
            cr = contrast(rgb(x['fg']), rgb(x['bg'])) if rgb(x['fg']) and rgb(x['bg']) else 0
            if x['size'] < 13.99 or cr < 7:
                bad.append((label, t, x['tag'], x['text'], x['size'], round(cr, 2)))
    stats['texts'] += n
    return n, bad


# ------------------------------------------------------------------ panel behaviour

def panel_behaviour(b):
    pg = new_page(b, 'fx=tumors&bg=ffffff', 1000, 800, perms=True)
    check('panel starts hidden, gear visible', pg.evaluate("document.querySelector('.cp-panel').hidden") and pg.is_visible('.cp-gear'))
    check('the old panel is gone (no .xp-gear)', pg.locator('.xp-gear, .xp-panel').count() == 0)
    open_panel(pg)
    f = frame(pg)
    check('gear opens the panel inside the frame', pg.is_visible('.cp-panel') and inside(pg.evaluate(RECT, '.cp-panel'), f))
    tabs = pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.textContent)")
    check('tabs: 7 chart tabs, the nine standard ones, Panel (%d)' % len(tabs), len(tabs) >= MIN_TABS and tabs[:7] == ['Contours', 'Bands', 'Points', 'Category', 'Axes', 'Grid', 'Legend'] and 'Fields' in tabs and 'Number format' in tabs, str(tabs))
    n = pg.evaluate("DL.app.state.store.rows.filter(r => !['note', 'preview', 'action'].includes(r.type)).length")
    check('at least 40 settings (%d)' % n, n >= 40)
    stats['settings'] = n
    # drag clamps to the frame
    r0 = pg.evaluate(RECT, '.cp-panel'); x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(x - 150, y + 100, steps=6); pg.mouse.up()
    r1 = pg.evaluate(RECT, '.cp-panel')
    check('drag by the title bar moves the panel by the pointer delta', abs((r0['l'] - r1['l']) - 150) <= 2 and abs((r1['t'] - r0['t']) - 100) <= 2, (r0, r1))
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(-3000, -3000, steps=8); pg.mouse.up()
    r2 = pg.evaluate(RECT, '.cp-panel')
    check('dragged far up-left clamps to the frame corner', abs(r2['l'] - f['l']) <= 1.5 and abs(r2['t'] - f['t']) <= 1.5, r2)
    x, y = head_point(pg)
    pg.mouse.move(x, y); pg.mouse.down(); pg.mouse.move(4000, 4000, steps=8); pg.mouse.up()
    r3 = pg.evaluate(RECT, '.cp-panel')
    check('dragged far down-right clamps to the frame corner', abs(r3['r'] - f['r']) <= 1.5 and abs(r3['b'] - f['b']) <= 1.5 and inside(r3, f), (r3, f))
    # minimize, restore
    pg.click('[data-a=min]')
    pg.wait_for_function("document.querySelector('.cp-panel').classList.contains('cp-min')")
    check('minimize leaves just the title bar', pg.evaluate(RECT, '.cp-panel')['h'] < 80 and pg.is_visible('.cp-title') and not pg.is_visible('.cp-tabs'))
    pg.click('[data-a=min]')
    pg.wait_for_function("!document.querySelector('.cp-panel').classList.contains('cp-min')")
    check('restore brings the body back inside the frame', pg.is_visible('.cp-tabs') and inside(pg.evaluate(RECT, '.cp-panel'), f))
    # close and focus return, Escape
    pg.click('[data-a=close]')
    check('close hides the panel and returns focus to the gear', pg.evaluate("document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    open_panel(pg)
    pg.keyboard.press('Escape')
    check('Escape closes the panel and focuses the gear', pg.evaluate("document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    open_panel(pg)
    # live re-render, saved as a string, one debounced save
    tab(pg, 'contours')
    b0 = int(pg.get_attribute('#dl-root', 'data-bands'))
    pg.click('[data-a=inc][data-k=levels]')
    pg.wait_for_function('+document.querySelector("#dl-root").dataset.bands !== %d' % b0, timeout=4000)
    b1 = int(pg.get_attribute('#dl-root', 'data-bands'))
    check('a setting change re-renders the chart live (%d -> %d bands)' % (b0, b1), b1 > b0)
    pg.wait_for_function('DL_MOCK.settings.saves >= 1', timeout=8000)
    check('the change is saved to Tableau settings as the string "9" under depthlines.', pg.evaluate("DL_MOCK.settings.getAll()['depthlines.levels']") == '9')
    pg.fill('input[data-k=levels]', '4'); pg.press('input[data-k=levels]', 'Enter')
    pg.wait_for_function('DL.app.state.store.get().levels === 4')
    pg.wait_for_function('''document.querySelectorAll('path.dl-band[data-g="0"]').length === 4''', timeout=4000)  # the store updates before the redraw lands
    check('a typed value draws 4 bands per group', pg.locator('path.dl-band[data-g="0"]').count() == 4)
    # copy and paste round trip
    pg.click('[data-f=copyall]')
    pg.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied') === 0", timeout=5000)
    txt = pg.evaluate('DL.app.state.panel.lastCopied'); obj = json.loads(txt)['settings']  # 1.1.0: a labeled block { ctab, chart, name, kind, copied, settings }
    check('Copy settings gives flat JSON with every setting (%d keys)' % len(obj), len(obj) >= n and obj['levels'] == 4 and 'bandwidth' in obj and 'labelSize' in obj and isinstance(obj['catColors'], list), len(obj))
    clip = pg.evaluate('navigator.clipboard.readText()')
    check('the clipboard holds the same text', clip.replace('\r\n', '\n') == txt)
    pg.click('[data-a=inc][data-k=levels]'); pg.click('[data-a=inc][data-k=levels]')
    check('settings changed after the copy', val(pg, 'levels') == 6)
    pg.click('[data-a=paste]'); pg.wait_for_selector('textarea[data-f=paste]')
    pg.fill('textarea[data-f=paste]', '{bad'); pg.click('[data-a=pasteapply]')
    check('bad JSON shows an inline message, not a dialog', 'not valid JSON' in pg.inner_text('.cp-msg[role=alert]') and not pg.dialogs)
    pg.fill('textarea[data-f=paste]', txt); pg.click('[data-a=pasteapply]')
    pg.wait_for_function('DL.app.state.store.get().levels === 4', timeout=4000)
    check('pasting the copied text round-trips (levels back to 4)', val(pg, 'levels') == 4)
    # no slider, no dialog, 14px, 7:1
    rng = 0
    for t in pg.evaluate("[...document.querySelectorAll('.cp-tab')].map(t => t.dataset.t)"):
        tab(pg, t); rng += pg.evaluate("document.querySelectorAll('input[type=range]').length")
    check('no range input on any tab', rng == 0 and pg.evaluate("document.querySelectorAll('input[type=range]').length") == 0)
    check('no browser dialog was raised', not pg.dialogs and pg.evaluate('window.__dlg') == 0)
    check('0 console errors in the panel session', not pg.errs, str(pg.errs[:3]))
    pg.ctx.close()
    for scheme, bg, theme in (('light', 'ffffff', 'match'), ('dark', '081f33', 'match'), ('light', 'ffffff', 'dark'), ('dark', '081f33', 'light')):
        pg = new_page(b, 'fx=tumors&bg=%s&settings=%s' % (bg, json.dumps({'_panel': json.dumps({'theme': theme})})), 1000, 800, color=scheme)
        open_panel(pg)
        label = f'{bg} panel-{theme}'
        n_t, bad = audit_texts(pg, label)
        check(f'{label}: every panel text >= 14px and >= 7:1 on all tabs ({n_t} texts examined)', n_t >= 250 and not bad, str(bad[:3]))
        pg.ctx.close()


def sheet_and_shots(b):
    for (w, h) in ((390, 844), (300, 300)):
        pg = new_page(b, 'fx=tumors&bg=ffffff', w, h)
        open_panel(pg)
        f = frame(pg); r = pg.evaluate(RECT, '.cp-panel')
        check(f'{w}x{h}: the panel is a full-frame sheet', pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-sheet')") and abs(r['w'] - f['w']) <= 1 and abs(r['h'] - f['h']) <= 1, (r, f))
        check(f'{w}x{h}: no horizontal scroll', pg.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
        pg.evaluate("(() => { const m = document.querySelector('.cp-main'); m.scrollTop = m.scrollHeight; })()")
        fr = pg.evaluate(RECT, '.cp-foot'); pr = pg.evaluate(RECT, '.cp-panel')
        check(f'{w}x{h}: footer buttons are reachable', fr['b'] <= pr['b'] + 1 and fr['t'] >= pr['t'])
        if shots and w == 390:
            pg.evaluate("(() => { const m = document.querySelector('.cp-main'); m.scrollTop = 0; })()")
            pg.screenshot(path=str(shots / 'settings-panel-mobile-390.png'))
        pg.ctx.close()
    pg = new_page(b, 'fx=tumors&bg=ffffff&settings=' + json.dumps({'multi': 'small', 'points': True}), 1280, 800)
    open_panel(pg)
    tab(pg, 'contours')
    check('1280x800: floating panel, inside the frame', not pg.evaluate("document.querySelector('.cp-panel').classList.contains('cp-sheet')") and inside(pg.evaluate(RECT, '.cp-panel'), frame(pg)))
    if shots:
        pg.screenshot(path=str(shots / 'settings-panel-1280x800.png'))
    pg.ctx.close()


# ------------------------------------------------------------------ every setting changes the render

FLIP_JS = """(cfg) => {
  const st = DL.app.state, store = st.store, rows = store.rows.filter(r => !['note', 'preview', 'action'].includes(r.type));
  const byKey = {}; rows.forEach(r => byKey[r.key] = r);
  const optVals = r => (r.opts || []).map(o => Array.isArray(o) ? o[0] : o.value);
  const defaults = {}; rows.forEach(r => defaults[r.key] = JSON.parse(JSON.stringify(r.def)));
  function sat(row, vals) {
    [].concat(row.when || []).forEach(c => {
      if (typeof c !== 'object') return; const p = byKey[c.key]; if (!p) return;
      if ('eq' in c) vals[c.key] = c.eq; else if ('truthy' in c) vals[c.key] = true; else if ('in' in c) vals[c.key] = c.in[0];
      else if ('ne' in c) vals[c.key] = optVals(p).find(v => v !== c.ne);
      sat(p, vals);
    });
  }
  function flipped(r) {
    if (cfg.special[r.key] !== undefined) return cfg.special[r.key];
    const d = r.def;
    switch (r.type) {
      case 'check': return !d;
      case 'number': return d !== r.max ? r.max : r.min;
      case 'chips': case 'select': return optVals(r).find(v => v !== d);
      case 'color': return '#ff00aa';
      case 'text': return 'Zed';
      case 'font': return CTabPanel.FONTS.find(f => f.id !== d).id;
      case 'palette': return CTabPanel.PALETTES.find(p => p.id !== d).id;
      default: return undefined;
    }
  }
  return { keys: rows.map(r => r.key), types: rows.map(r => r.type),
    apply(key, doFlip) {
      const r = byKey[key], vals = JSON.parse(JSON.stringify(defaults));
      Object.assign(vals, cfg.base); sat(r, vals); Object.assign(vals, cfg.extra[key] || {});
      if (doFlip) vals[key] = flipped(r);
      store.setMany(vals);
      return doFlip ? vals[key] : null;
    } };
}"""
PROBE = """() => {
  const c = document.querySelector('.dl-chart');
  return { html: c.outerHTML, gear: document.querySelector('.cp-gear').style.display };
}"""
CENTERS = """() => {
  const mid = e => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const bands = [...document.querySelectorAll('path.dl-band[data-g="0"]')];
  const deep = bands[bands.length - 1], pt = document.querySelector('.dl-pt');
  return { band: mid(deep), pt: mid(pt) };
}"""
AFTER = """() => { const c = document.querySelector('.dl-chart'), t = document.querySelector('.dl-tip');
  return { html: c.outerHTML, tip: t.outerHTML, hovered: DL_MOCK.sheet.hovered, selected: DL_MOCK.sheet.selected.slice() }; }"""


def fingerprint(pg):
    """The chart at rest, then after hovering a band, after hovering a point and after clicking a band."""
    pg.evaluate('DL.app.state.renderer.clearSelection(); DL.app.redraw(); DL_MOCK.sheet.hovered = null; DL_MOCK.sheet.selected = []')
    pg.mouse.move(2, 2)
    parts = [json.dumps(pg.evaluate(PROBE))]
    cs = pg.evaluate(CENTERS)
    if cs['band']:
        pg.mouse.move(*cs['band'], steps=2)
        parts.append(json.dumps(pg.evaluate(AFTER)))
    if cs['pt']:
        pg.mouse.move(*cs['pt'], steps=2)
        parts.append(json.dumps(pg.evaluate(AFTER)))
    if cs['band']:
        pg.mouse.move(*cs['band'], steps=2); pg.mouse.click(*cs['band'])
        parts.append(json.dumps(pg.evaluate(AFTER)))
    pg.mouse.move(2, 2)
    return '\n'.join(parts)


LONG = 'A very long category name that has to wrap onto several lines because it keeps going and going and going and going and going on and on'
SPECIAL = {'cols': 1, 'majorEvery': 2, 'xMin': '8', 'xMax': '25', 'yMin': '0.01', 'yMax': '0.15', 'fieldX': 'Mean texture', 'fieldY': 'Mean texture', 'fieldWeight': 'Mean texture',
           'fieldCategory': 'Diagnosis', 'catColors': [{'key': 'Malignant', 'name': 'Zed', 'color': '#ff00aa', 'hidden': False}], 'labelLines': 4, 'numScale': '100'}
EXTRA = {'showTitle': {'titleText': 'Hello'}, 'numThousands': {'numScale': '100'}, 'numCompact': {'numScale': '100'}, 'numDecimals': {'valueLabels': True}, 'numScale': {}, 'numPrefix': {}, 'numSuffix': {},
         'ramp': {'multi': 'small'}, 'reverse': {'multi': 'small'}, 'lineInk': {'multi': 'small'}, 'rampWidth': {'multi': 'small'},
         'labelLines': {'multi': 'small', 'catColors': [{'key': 'Malignant', 'name': LONG * 1, 'hidden': False}, {'key': 'Benign', 'name': LONG, 'hidden': False}]}}
# settings the markup cannot show, and the mock call or DOM that proves them (the generic flip below would also catch them in the hover fingerprint)
BEHAVIOUR = {'selectOn': 'a band click selects nothing in Tableau', 'hoverPush': 'a point hover sends nothing to Tableau', 'hoverOn': 'the band highlight and dimming do not start',
             'tipOn': 'no tooltip', 'tipFollow': 'the tooltip sits in the corner', 'tipSize': 'tooltip font size', 'tipMaxW': 'tooltip max width', 'tipSwatch': 'the swatch beside the category name'}


def flip_every_setting(b):
    base_q = 'fx=tumors&bg=081f33'
    pg = new_page(b, base_q, 1000, 700)
    h = pg.evaluate_handle(FLIP_JS, {'special': SPECIAL, 'base': {'points': True}, 'extra': EXTRA})
    keys = h.evaluate('h => h.keys'); types = h.evaluate('h => h.types')
    check('the flip harness sees every settable row (%d)' % len(keys), len(keys) >= MIN_SETTINGS, len(keys))
    stats['settings_flipped_of'] = len(keys)
    unchanged, nocat = [], None
    for key, typ in zip(keys, types):
        if key == 'fieldCategory':
            if nocat is None:
                nocat = new_page(b, 'fx=tumors&bg=081f33&cat=0', 1000, 700)
                nh = nocat.evaluate_handle(FLIP_JS, {'special': SPECIAL, 'base': {'points': True}, 'extra': EXTRA})
            p, hh = nocat, nh
        else:
            p, hh = pg, h
        hh.evaluate('(h, k) => h.apply(k, false)', key)
        p.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        a = fingerprint(p)
        v = hh.evaluate('(h, k) => h.apply(k, true)', key)
        p.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        c = fingerprint(p)
        stats['flipped'] += 1
        if a == c:
            unchanged.append('%s (%s -> %r)' % (key, typ, v))
    check('EVERY setting changes the render when flipped (%d of %d flipped, each from a baseline that shows it)' % (stats['flipped'], len(keys)), not unchanged, 'NO CHANGE: ' + '; '.join(unchanged))
    # the behaviour-only ones, proved directly through the mock Tableau calls
    pg.evaluate('(() => { DL.app.state.store.setMany(Object.assign({}, DL.app.state.store.snapshot(), { selectOn: true, hoverOn: true, hoverPush: true, points: true, tipOn: true })); })()')
    pg.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    cs = pg.evaluate(CENTERS)
    pg.mouse.move(*cs['pt'], steps=2)
    check('hoverPush on: a point hover reaches Tableau (hoverTupleAsync)', isinstance(pg.evaluate('DL_MOCK.sheet.hovered'), int) and pg.evaluate('DL_MOCK.sheet.hovered') > 0)
    check('hover shows the tooltip with the category name and the numbers', pg.is_visible('.dl-tip') and 'Mean radius' in pg.inner_text('.dl-tip'))
    pg.mouse.move(*cs['band'], steps=2); pg.mouse.click(*cs['band'])
    check('selectOn on: a band click selects its points in Tableau', len(pg.evaluate('DL_MOCK.sheet.selected')) >= 1)
    for k, why in (('selectOn', 'selects'), ('hoverPush', 'hover')):
        pg.evaluate('(k) => DL.app.state.store.set(k, false)', k)
        pg.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
        pg.evaluate('DL_MOCK.sheet.selected = []; DL_MOCK.sheet.hovered = null; DL.app.state.renderer.clearSelection()')
        cs = pg.evaluate(CENTERS)
        pg.mouse.move(*cs['pt'], steps=2); pg.mouse.move(*cs['band'], steps=2); pg.mouse.click(*cs['band'])
        if k == 'selectOn':
            check('selectOn off: the same click selects nothing', pg.evaluate('DL_MOCK.sheet.selected.length') == 0)
        else:
            check('hoverPush off: the same hover sends nothing', pg.evaluate('DL_MOCK.sheet.hovered') is None)
        pg.evaluate('(k) => DL.app.state.store.set(k, true)', k)
    check('0 console errors through the flip test', not pg.errs, str(pg.errs[:3]))
    pg.ctx.close()
    if nocat:
        nocat.ctx.close()


# ------------------------------------------------------------------ old saved keys keep their look

def legacy(b):
    old = {'fontSize': '20', 'title': 'Old workbook', 'theme': 'dark', 'catPalette': 'okabe', 'selectEnabled': 'false', 'hoverEnabled': 'false', 'levels': '6', 'multi': 'small', 'fill': 'false'}
    pg = new_page(b, 'fx=tumors&bg=ffffff&settings=' + json.dumps(old), 1000, 700)
    g = pg.evaluate('DL.app.state.store.get()')
    check('legacy fontSize 20 -> labelSize 20 and titleSize 26', g['labelSize'] == 20 and g['titleSize'] == 26, (g['labelSize'], g['titleSize']))
    check('legacy title -> shown title text', g['showTitle'] is True and g['titleText'] == 'Old workbook' and pg.inner_text('.dl-title') == 'Old workbook')
    check('legacy theme dark -> a dark chart even on a white worksheet', pg.evaluate("getComputedStyle(document.querySelector('.dl-chart')).backgroundColor") == 'rgb(8, 31, 51)' and pg.get_attribute('#dl-root', 'data-theme') == 'dark')
    check('legacy catPalette okabe -> the Okabe-Ito palette', g['palette'] == 'okabe')
    check('legacy selectEnabled false -> selectOn false, hoverEnabled false -> hoverPush false', g['selectOn'] is False and g['hoverPush'] is False)
    check('keys that kept their name still load (levels 6, small multiples, no fill)', g['levels'] == 6 and g['multi'] == 'small' and g['fill'] is False and pg.locator('.dl-ptitle').count() == 2)
    check('the chart text is 20px (the old fontSize drove every text)', pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.dl-chart')).fontSize)") == 20 and pg.evaluate("parseFloat(getComputedStyle(document.querySelector('.dl-tick')).fontSize)") == 20)
    saved = pg.evaluate('DL_MOCK.settings.getAll()')
    check('the carried values are written under the new keys', saved.get('depthlines.labelSize') == '20' and saved.get('depthlines.palette') == 'okabe' and saved.get('depthlines.bgMode') == 'custom', str({k: v for k, v in saved.items() if k.startswith('depthlines.')}))
    check('legacy: 0 console errors', not pg.errs, str(pg.errs[:3]))
    pg.ctx.close()
    pg = new_page(b, 'fx=tumors&bg=ffffff&settings=' + json.dumps({'fontSize': '20', 'labelSize': '16', 'theme': 'light', 'bgMode': 'worksheet'}), 1000, 700)
    g = pg.evaluate('DL.app.state.store.get()')
    check('a new key already saved wins over the old one', g['labelSize'] == 16 and g['bgMode'] == 'worksheet', (g['labelSize'], g['bgMode']))
    pg.ctx.close()
    pg = new_page(b, 'fx=tumors&bg=ffffff&settings=' + json.dumps({'bandwidth': '9', 'lines': 'false', 'sea': 'false', 'pointOpacity': '0.4', 'ramp': 'sunrise', 'axes': 'false'}), 1000, 700)
    g = pg.evaluate('DL.app.state.store.get()')
    check('unchanged old keys load as typed values (bandwidth 9, lines off, sea off, opacity 0.4, sunrise, axes off)', g['bandwidth'] == 9 and g['lines'] is False and g['sea'] is False and g['pointOpacity'] == 0.4 and g['ramp'] == 'sunrise' and g['axes'] is False)
    pg.ctx.close()


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    s = socket.socket()
    if s.connect_ex(('127.0.0.1', PORT)) == 0:
        print(f'RED  port {PORT} already has a server: refusing an inherited server')
        return 1
    s.close()
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            t = socket.socket()
            if t.connect_ex(('127.0.0.1', PORT)) == 0:
                t.close(); break
            t.close(); time.sleep(0.15)
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            only = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else ['panel', 'sheet', 'legacy', 'flip']
            for name, fn in (('panel', panel_behaviour), ('sheet', sheet_and_shots), ('legacy', legacy), ('flip', flip_every_setting)):
                if name not in only:
                    continue
                try:
                    fn(b)
                except Exception as e:   # a crash inside a group is a RED, with its own line, never a silent pass
                    fails.append('group %s crashed after %d checks: %s' % (name, stats['checks'], str(e).splitlines()[0][:160]))
            b.close()
    finally:
        srv.terminate()
    if '--only' not in sys.argv and stats['checks'] < MIN_CHECKS:
        fails.append(f'only {stats["checks"]} checks examined, minimum {MIN_CHECKS}')
    if 'flip' in (sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else ['flip']) and stats['flipped'] < MIN_SETTINGS:
        fails.append(f'only {stats["flipped"]} settings flipped, minimum {MIN_SETTINGS}')
    summary = f'{stats["checks"]} checks, {stats["flipped"]} settings flipped (of {stats.get("settings", "?")} panel rows), {stats["texts"]} panel texts audited'
    if fails:
        print(f'RED  {len(fails)} failed: {summary}')
        for f in fails[:30]:
            print('  FAIL', f)
        return 1
    print(f'GREEN  {summary}, 0 failed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
