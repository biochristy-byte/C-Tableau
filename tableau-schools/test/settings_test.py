"""Every Schools setting changes the render: flip each one and assert the output changed.

  python test/settings_test.py

For each setting in the schema (all of them, read from the live store, not a list kept here):
  1. reset every setting to its default, set the prerequisites its `when` needs, read a render signature twice
     (the two reads must agree, or the comparison proves nothing)
  2. flip the setting to a different value, wait for the layout job and any morph to finish, read the signature again
  3. require that the two differ.
The signature is the chart's HTML (circles, chips, legend, title, rings), the root and page styles, the gear position,
the computed styles that carry timing and emphasis (transition and animation durations, font weight, dashes), and the
same again with the largest circle hovered (tooltip text and style, hover outline, dimming of the other clusters).
A few settings only show up in behaviour, not in a static picture, so they have their own probe: entrance animation
(a fresh page load, timed from the morph class), selection dimming and outline, and the calls pushed to Tableau.
Starts its OWN server. Exit 1 and a RED line on a failure; RED too if it examined fewer settings than the floor.
"""
import sys, json, threading, http.server, socketserver, functools, pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
MIN_SETTINGS = 85
fails, examined = [], []


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass


socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

# flips that the generic rule (far end of the range, or the other choice) would not make visible on this data
FLIP = {'fieldItem': 'Region', 'fieldCluster': 'Income group', 'fieldSize': 'Life expectancy', 'fieldColor': 'Region', 'labelMinR': 200, 'capMedian': 2, 'ticks': 100, 'clusterPos': 'below',
        'numScale': '100', 'theme': 'dark', 'legendMax': 2, 'font': 'verdana', 'labelColor': '#c2185b', 'borderColor': '#c2185b', 'singleColor': '#c2185b',
        'customBg': '#c2185b', 'titleText': 'A title', 'legendTitle': 'Legend', 'numPrefix': '$', 'numSuffix': ' people'}
LEG = {'colorMode': 'field'}
# prerequisites the `when` rules cannot express (the setting only shows with these on)
PRE = {'numThousands': {'numCompact': False}, 'fieldColor': {'colorMode': 'field'}, 'singleColor': {'colorMode': 'single'}, 'titleText': {'showTitle': True},
       'legend': LEG, 'legendPos': LEG, 'legendMax': LEG, 'legendShape': LEG, 'legendTitle': LEG}
BOOT = {'intro', 'animMs', 'animEase'}
CLICKS = {'selDim', 'selRing', 'selectEnabled', 'multiSel', 'hoverPush'}

SIG = r"""() => {
  const r = SC.app.state.renderer, chart = document.getElementById('sc-chart'), rootEl = document.getElementById('sc-root');
  const nodes = r.nodes.slice().sort((a, b) => b.r - a.r);
  const lf = nodes[0], other = lf && nodes.find(n => n.cl !== lf.cl);
  const cs = (el, p) => el ? getComputedStyle(el)[p] : '';
  const gear = document.querySelector('.cp-gear').getBoundingClientRect();
  const calm = () => ({
    html: (() => { const cl = chart.cloneNode(true), t = cl.querySelector('.sc-tip'); if (t) t.remove(); return cl.outerHTML; })(), root: rootEl.getAttribute('style') + '|' + rootEl.className, page: document.body.style.cssText + '|' + document.documentElement.style.cssText,
    gear: [gear.left, gear.top].map(Math.round).join(','),
    css: [cs(lf && lf.el, 'transitionDuration'), cs(chart.querySelector('.sc-labels'), 'animationDuration'), cs(chart.querySelector('.sc-chip text'), 'fontWeight'), cs(chart.querySelector('.sc-chip text'), 'fill'),
          cs(lf && lf.el, 'strokeDasharray')].join('|')
  });
  const out = { calm: calm() };
  if (lf) {
    const b = lf.el.getBoundingClientRect(), cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    lf.el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
    out.hover = { tip: r.tip.outerHTML, ring: cs(lf.el, 'strokeWidth'), others: cs(other && other.el.parentNode, 'opacity'), cls: lf.el.getAttribute('class') + '|' + r.gCircles.getAttribute('class') };
    document.querySelector('.sc-svg').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
  }
  return JSON.stringify(out);
}"""

READY = "() => { const r = SC.app.state.renderer; return !r.job && !r.anim && !document.querySelector('#sc-chart').classList.contains('sc-moving'); }"


def settle(pg, ms=140):
    pg.wait_for_timeout(90)
    pg.wait_for_function(READY, timeout=20000)
    pg.wait_for_timeout(ms)


def apply(pg, obj):
    pg.evaluate("(o) => SC.app.state.store.setMany(o)", obj)
    settle(pg)


def reset(pg):
    pg.evaluate("() => { const st = SC.app.state.store; st.reset(); }")
    settle(pg)
    pg.evaluate("() => { const r = SC.app.state.renderer; r._select(null); r._hover(null); }")
    settle(pg)


def when_pre(row, defs, byk):
    pre = {}
    ws = row.get('when'); ws = [] if not ws else ws if isinstance(ws, list) else [ws]
    for w in ws:
        k = w['key']
        if 'eq' in w: pre[k] = w['eq']
        elif 'truthy' in w: pre[k] = True
        elif 'ne' in w:
            r = byk[k]; pre[k] = next(o['value'] for o in r['opts'] if o['value'] != w['ne'])
        elif 'in' in w: pre[k] = w['in'][0]
    return pre


def flip_value(row, cur, first_top):
    k = row['key']
    if k in FLIP: return FLIP[k]
    t = row['type']
    if t == 'check': return not cur
    if t in ('select', 'chips'): return next(o['value'] for o in row['opts'] if o['value'] != str(cur))
    if t == 'number': return row['max'] if cur < (row['min'] + row['max']) / 2 else row['min']
    if t == 'color': return '#c2185b'
    if t == 'text': return 'Zed'
    if t == 'list': return [{'key': first_top, 'name': 'Renamed group', 'color': '#c2185b', 'hidden': False}]
    if t == 'field': return 'Region'
    raise Exception('no flip for %s %s' % (k, t))


# the entrance animation is timed from a fresh load: when the morph class appears, how long it stays, and where the first circle is 300 ms in
BOOT_INIT = """(function () {
  window.__mv = { start: null, end: null, x300: null, ever: false };
  function loop(t) {
    var ch = document.getElementById('sc-chart'), m = ch && ch.classList.contains('sc-moving'), M = window.__mv;
    if (m) { M.ever = true; if (M.start === null) M.start = t; var c = ch.querySelector('.sc-c'); if (c && M.x300 === null && t - M.start >= 300) M.x300 = c.getAttribute('cx') + ',' + c.getAttribute('cy'); }
    else if (M.start !== null && M.end === null) M.end = t;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();"""


def newpage(b, query='', init=None, w=900, h=560):
    ctx = b.new_context(viewport={'width': w, 'height': h})
    pg = ctx.new_page(); pg.errs = []
    pg.on('console', lambda m: pg.errs.append(m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('dialog', lambda d: (pg.errs.append('dialog ' + d.message), d.dismiss()))
    if init: pg.add_init_script(init)
    pg.goto(BASE + '/test/page.html?' + query)
    pg.wait_for_selector('.sc-c', timeout=15000)
    pg.wait_for_function(READY, timeout=20000)
    pg.wait_for_timeout(500)
    return ctx, pg


def probe(pg, key):
    """Behaviour probes. Returns a JSON-able value that depends on the setting; called once per side."""
    if key in ('selDim', 'selRing'):
        return pg.evaluate("""() => { const r = SC.app.state.renderer, ns = r.nodes.slice().sort((a, b) => b.r - a.r);
          ns[0].el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return [getComputedStyle(ns[1].el).opacity, getComputedStyle(ns[0].el).strokeWidth].join('|'); }""")
    if key in ('selectEnabled', 'multiSel', 'hoverPush'):
        pg.evaluate("() => { SC_MOCK.calls.length = 0; }")
        pg.evaluate("""(k) => { const r = SC.app.state.renderer, l = r.nodes.slice().sort((a, b) => b.r - a.r)[0], b = l.el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
          if (k === 'hoverPush') l.el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
          else l.el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: k === 'multiSel', clientX: x, clientY: y })); }""", key)
        pg.wait_for_timeout(150)
        return json.dumps(pg.evaluate("() => SC_MOCK.calls.map(c => [c.call, c.mode || ''])"))
    raise Exception('no probe for ' + key)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = newpage(b, 'fresh=1&fixture=countries&bg=ffffff')
    rows = pg.evaluate("() => SC.app.state.store.rows.filter(r => r.type !== 'note').map(r => ({ key: r.key, type: r.type, tab: r.tab, opts: r.opts, min: r.min, max: r.max, when: r.when || null, def: r.def }))")
    byk = {r['key']: r for r in rows}
    first_top = pg.evaluate("() => SC.app.state.renderer.catItems()[0].key")
    print('Schools settings gate: flipping %d settings on %d tabs' % (len(rows), len({r['tab'] for r in rows})))
    for row in rows:
        k = row['key']; label = '%s.%s' % (row['tab'], k)
        try:
            if k in BOOT:
                vals = []
                for side in (0, 1):
                    cur = row['def']; v = cur if side == 0 else flip_value(row, cur, first_top)
                    seed = {'schools.' + k: str(v).lower() if isinstance(v, bool) else str(v)}
                    init = BOOT_INIT + "localStorage.setItem('sc-mock-settings', %s);" % json.dumps(json.dumps(seed))
                    c2, p2 = newpage(b, 'fixture=countries&bg=ffffff', init)
                    m = p2.evaluate("() => window.__mv")
                    dur = None if m['end'] is None or m['start'] is None else round((m['end'] - m['start']) / 100)
                    vals.append([m['ever'], dur, m['x300']])
                    c2.close()
                ok = vals[0] != vals[1]; detail = vals
            else:
                reset(pg)
                pre = dict(when_pre(row, None, byk)); pre.update(PRE.get(k, {}))
                if pre: apply(pg, pre)
                cur = pg.evaluate("(k) => SC.app.state.store.get()[k]", k)
                fv = flip_value(row, cur, first_top)
                if k in CLICKS:
                    a = probe(pg, k); reset(pg)
                    if pre: apply(pg, pre)
                    apply(pg, {k: fv}); c = probe(pg, k)
                    ok = a != c; detail = (a, c)
                else:
                    pg.evaluate(SIG)   # warm-up: the first hover leaves the tooltip's inline position behind, which is not a setting
                    a = pg.evaluate(SIG); a2 = pg.evaluate(SIG)
                    if a != a2:
                        ok = False; detail = 'signature is unstable before the flip, so the comparison would prove nothing'
                    else:
                        check_changed = pg.evaluate("(a) => { const o = {}; o[a[0]] = a[1]; return SC.app.state.store.setMany(o).length; }", [k, fv])
                        settle(pg, 220)
                        c = pg.evaluate(SIG)
                        ok = a != c and check_changed >= 1
                        detail = 'store changed %d' % check_changed if a == c else ''
        except Exception as e:
            ok = False; detail = 'EXC ' + str(e)[:160]
        examined.append(k)
        if not ok:
            fails.append('%s did not change the render (%s)' % (label, str(detail)[:200]))
    errs = pg.errs
    ctx.close(); b.close()

srv.shutdown()
print('examined %d settings; %d did not change the render' % (len(examined), len(fails)))
for f in fails: print(' FAIL', f)
if errs: print(' console:', errs[:3]); fails.append('console errors')
if len(examined) < MIN_SETTINGS:
    print('RED: examined %d settings, fewer than the floor of %d' % (len(examined), MIN_SETTINGS)); sys.exit(2)
if fails:
    print('RED: %d settings do not change the render' % len(fails)); sys.exit(1)
print('GREEN: all %d settings change the render' % len(examined))
