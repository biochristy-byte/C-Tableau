"""Every Reef setting changes the render: flip each one and assert the output changed.

  python test/settings_test.py

For each setting in the schema (all of them, read from RF.settings, not a list kept here):
  1. reset every setting to its default, set the prerequisites its `when` needs, read a render signature
  2. flip the setting to a different value, read the signature again
  3. require that the two differ.
The signature is the chart's HTML, the root and page styles, the gear position, the computed styles that carry
timing and emphasis (transition and animation durations, stroke widths, font weight), and the same again with a leaf
hovered (tooltip text and style, hover outline, dimming). A few settings only show up in behaviour, not in a static
picture, so they have their own probe: entrance animation (a fresh page load), zoom time and easing (timed),
click and Escape behaviour, selection dimming and outline, and the calls pushed to Tableau.
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
FLIP = {'colorField': 'Census region', 'fieldLevel1': 'Census region', 'fieldLevel2': 'Cause group', 'fieldLevel3': 'State', 'labelMinR': 200, 'fieldSize': 'Age-adjusted death rate',
        'numScale': '100', 'theme': 'dark', 'legendMax': 2, 'font': 'verdana', 'labelColor': '#c2185b', 'borderColor': '#c2185b', 'singleColor': '#c2185b',
        'customBg': '#c2185b', 'rampName': 'sunset', 'titleText': 'A title', 'legendTitle': 'Legend', 'rootName': 'Everything', 'numPrefix': '$', 'numSuffix': ' deaths'}
# prerequisites the `when` rules cannot express (the setting only shows with these on)
PRE = {'numThousands': {'numCompact': False}, 'rampName': {'colorMode': 'field', 'colorField': 'Age-adjusted death rate'}, 'colorField': {'colorMode': 'field'},
       'singleColor': {'colorMode': 'single'}, 'depthTint': {}, 'zoomEase': {'zoomMs': 1200}, 'selRing': {'zoomOnClick': False}, 'dimOthers': {'zoomOnClick': False},
       'selectEnabled': {'zoomOnClick': False}, 'multiSel': {'zoomOnClick': False}, 'zoomLeaf': {}, 'titleText': {'showTitle': True}}
BOOT = {'intro', 'animMs', 'animEase'}
CLICKS = {'zoomOnClick', 'zoomLeaf', 'clickOut', 'escUp', 'zoomMs', 'zoomEase', 'dimOthers', 'selRing', 'selectEnabled', 'hoverPush', 'multiSel'}

SIG = r"""() => {
  const r = RF.app.state.renderer, chart = document.getElementById('rf-chart'), rootEl = document.getElementById('rf-root');
  const svg = chart.querySelector('svg').getBoundingClientRect();
  const leaves = r.root ? r.root.leaves().filter(l => l.el && l.el.style.display !== 'none').sort((a, b) => b.r - a.r) : [];
  const lf = leaves[0], other = leaves[1], grp = r.root ? r.root.children.find(n => n.children && n.el.style.display !== 'none') : null;
  const cs = (el, p) => el ? getComputedStyle(el)[p] : '';
  const gear = document.querySelector('.cp-gear').getBoundingClientRect();
  const calm = () => ({
    html: (() => { const cl = chart.cloneNode(true), t = cl.querySelector('.rf-tip'); if (t) t.remove(); return cl.outerHTML; })(), root: rootEl.getAttribute('style') + '|' + rootEl.className, page: document.body.style.cssText + '|' + document.documentElement.style.cssText,
    gear: [gear.left, gear.top].map(Math.round).join(','),
    css: [cs(lf && lf.el, 'transitionDuration'), cs(chart.querySelector('.rf-labels'), 'animationDuration'), cs(chart.querySelector('.rf-chip text'), 'fontWeight'), cs(chart.querySelector('.rf-chip text'), 'fill'),
          cs(chart.querySelector('.rf-crumb'), 'backgroundColor'), cs(lf && lf.el, 'strokeDasharray')].join('|')
  });
  const out = { calm: calm() };
  if (lf) {
    const sr = document.querySelector('.rf-svg').getBoundingClientRect(), cx = sr.left + +lf.el.getAttribute('cx'), cy = sr.top + +lf.el.getAttribute('cy');
    lf.el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: cx, clientY: cy }));
    out.hover = { tip: r.tip.outerHTML, ring: cs(lf.el, 'strokeWidth'), others: cs(other && other.el, 'opacity'), cls: lf.el.getAttribute('class') + '|' + r.gCircles.getAttribute('class') };
    document.querySelector('.rf-svg').dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
  }
  return JSON.stringify(out);
}"""


def settle(pg, ms=140):
    pg.wait_for_timeout(ms)


def apply(pg, obj):
    pg.evaluate("(o) => RF.app.state.store.setMany(o)", obj)
    settle(pg)


def reset(pg):
    pg.evaluate("() => { const st = RF.app.state.store; st.reset(); }")
    settle(pg)
    pg.evaluate("() => { const r = RF.app.state.renderer; if (r.root && r.focus !== r.root) { r.focus = r.root; r.anim = null; } RF.app.redraw(); }")
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
    if t == 'field': return 'Census region'
    raise Exception('no flip for %s %s' % (k, t))


def newpage(b, query='', init=None, w=900, h=560):
    ctx = b.new_context(viewport={'width': w, 'height': h})
    pg = ctx.new_page(); pg.errs = []
    pg.on('console', lambda m: pg.errs.append(m.text) if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.on('dialog', lambda d: (pg.errs.append('dialog ' + d.message), d.dismiss()))
    if init: pg.add_init_script(init)
    pg.goto(BASE + '/test/page.html?' + query)
    pg.wait_for_selector('.rf-c', timeout=8000)
    pg.wait_for_timeout(1000)
    return ctx, pg


def wait_zoom(pg, ms=6000):
    pg.wait_for_function("() => !document.querySelector('#rf-chart').classList.contains('rf-zooming')", timeout=ms)
    pg.wait_for_timeout(120)


FOCUS = "() => RF.app.state.renderer.focus.depth"
LEAF2 = "() => { const r = RF.app.state.renderer; return r.root.leaves().filter(l => l.depth >= 2 && l.el.style.display !== 'none').sort((a, b) => b.r - a.r)[0]; }"


def probe(pg, key, cur_apply):
    """Behaviour probes. Returns a JSON-able value that depends on the setting; called once per side."""
    if key == 'zoomOnClick':
        pg.evaluate("() => { const r = RF.app.state.renderer; r._click({ target: r.root.children.find(n => n.children).el }); }")
        pg.wait_for_timeout(1500); return pg.evaluate(FOCUS)
    if key == 'zoomLeaf':
        pg.evaluate("() => { const r = RF.app.state.renderer; const l = r.root.leaves().find(l => l.depth >= 2 && l.parent.parent); r._click({ target: l.el }); }")
        pg.wait_for_timeout(1500); return pg.evaluate(FOCUS)
    if key == 'clickOut':
        pg.evaluate("() => { const r = RF.app.state.renderer; r.zoomTo(r.root.children.find(n => n.children)); }"); wait_zoom(pg)
        pg.evaluate("() => { const r = RF.app.state.renderer; r._click({ target: r.focus.el }); }"); pg.wait_for_timeout(1500); return pg.evaluate(FOCUS)
    if key == 'escUp':
        pg.evaluate("() => { const r = RF.app.state.renderer; r.zoomTo(r.root.children.find(n => n.children)); }"); wait_zoom(pg)
        pg.evaluate("() => document.querySelector('.rf-svg').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); pg.wait_for_timeout(1500); return pg.evaluate(FOCUS)
    if key == 'zoomMs':
        return round(pg.evaluate("""() => new Promise(res => { const r = RF.app.state.renderer, g = r.root.children.find(n => n.children), t0 = performance.now(); r.zoomTo(g);
          const tick = () => { if (!document.querySelector('#rf-chart').classList.contains('rf-zooming')) res(performance.now() - t0); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); })""") / 250)
    if key == 'zoomEase':
        v = pg.evaluate("""() => new Promise(res => { const r = RF.app.state.renderer, g = r.root.children.find(n => n.children); r.zoomTo(g);
          setTimeout(() => res(r.anim ? Math.round(r.anim.cur.r * 10) / 10 : -1), 300); })""")
        wait_zoom(pg); return v
    if key in ('dimOthers', 'selRing'):
        return pg.evaluate("""() => { const r = RF.app.state.renderer, ls = r.root.leaves().filter(l => l.el.style.display !== 'none').sort((a, b) => b.r - a.r);
          r._click({ target: ls[0].el, ctrlKey: false }); return [getComputedStyle(ls[1].el).opacity, getComputedStyle(ls[0].el).strokeWidth].join('|'); }""")
    if key in ('selectEnabled', 'multiSel', 'hoverPush'):
        pg.evaluate("() => { RF_MOCK.calls.length = 0; }")
        pg.evaluate("""(k) => { const r = RF.app.state.renderer, l = r.root.leaves().filter(l => l.el.style.display !== 'none').sort((a, b) => b.r - a.r)[0], sr = document.querySelector('.rf-svg').getBoundingClientRect();
          if (k === 'hoverPush') l.el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: sr.left + +l.el.getAttribute('cx'), clientY: sr.top + +l.el.getAttribute('cy') }));
          else l.el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: k === 'multiSel' })); }""", key)
        pg.wait_for_timeout(150)
        return json.dumps(pg.evaluate("() => RF_MOCK.calls.map(c => [c.call, c.mode || ''])"))
    raise Exception('no probe for ' + key)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = newpage(b, 'fresh=1&fixture=causes&bg=ffffff')
    rows = pg.evaluate("() => RF.app.state.store.rows.filter(r => r.type !== 'note').map(r => ({ key: r.key, type: r.type, tab: r.tab, opts: r.opts, min: r.min, max: r.max, when: r.when || null, def: r.def }))")
    byk = {r['key']: r for r in rows}
    first_top = pg.evaluate("() => RF.app.state.renderer.catItems()[0].key")
    print('Reef settings gate: flipping %d settings on %d tabs' % (len(rows), len({r['tab'] for r in rows})))
    for row in rows:
        k = row['key']; label = '%s.%s' % (row['tab'], k)
        try:
            if k in BOOT:
                vals = []
                for side in (0, 1):
                    cur = row['def']; v = cur if side == 0 else flip_value(row, cur, first_top)
                    seed = {'reef.' + k: str(v).lower() if isinstance(v, bool) else str(v)}
                    c2, p2 = newpage(b, 'fixture=causes&bg=ffffff', "localStorage.setItem('rf-mock-settings', %s)" % json.dumps(json.dumps(seed)))
                    vals.append(p2.evaluate("() => { const s = document.querySelector('.rf-svg'), c = getComputedStyle(s); return [s.getAttribute('class'), c.animationName, c.animationDuration, c.animationTimingFunction].join('|'); }"))
                    c2.close()
                ok = vals[0] != vals[1]; detail = vals
            else:
                reset(pg)
                cur = row['def']
                pre = dict(when_pre(row, None, byk)); pre.update(PRE.get(k, {}))
                if pre: apply(pg, pre)
                cur = pg.evaluate("(k) => RF.app.state.store.get()[k]", k)
                fv = flip_value(row, cur, first_top)
                if k in CLICKS:
                    a = probe(pg, k, None); reset(pg)
                    if pre: apply(pg, pre)
                    apply(pg, {k: fv}); c = probe(pg, k, None)
                    ok = a != c; detail = (a, c)
                else:
                    a = pg.evaluate(SIG)
                    check_changed = pg.evaluate("(a) => { const o = {}; o[a[0]] = a[1]; return RF.app.state.store.setMany(o).length; }", [k, fv])
                    settle(pg, 220)
                    c = pg.evaluate(SIG)
                    ok = a != c and check_changed >= 1
                    detail = 'store changed %d' % check_changed if a == c else ''
        except Exception as e:
            ok = False; detail = 'EXC ' + str(e)[:160]
        examined.append(k)
        if not ok:
            fails.append('%s did not change the render (%s)' % (label, str(detail)[:200]))
        # a zoomed or selected state from the previous probe must not leak into the next
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
