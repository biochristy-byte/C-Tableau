"""Reef render gate: the shipping code against the mock Tableau API, in headless Chromium.

  python test/render_test.py            run every check, exit 1 on any failure
  python test/render_test.py --shots    also write preview PNGs and the hub thumbnail

Starts its OWN static server on a free port (never adopts one already listening).
Prints how many subjects each check examined; goes RED below MIN_SUBJECTS.
"""
import sys, json, threading, http.server, socketserver, functools, pathlib, math, statistics, io

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = '--shots' in sys.argv
MIN_SUBJECTS = 300
SIZES = [(300, 300), (900, 560), (1600, 1000)]
THEMES = {'light': 'ffffff', 'dark': '0d2b45'}
BANNED_FONTS = ('georgia', 'times', 'courier', 'consolas', 'monospace', 'cambria', 'garamond', 'palatino')

fails, subjects = [], 0
def check(name, cond, detail=''):
    global subjects
    subjects += 1
    if not cond:
        fails.append(name + ((' :: ' + str(detail)) if detail != '' else ''))
def count(n):
    global subjects
    subjects += n

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a, **k): pass
handler = functools.partial(Quiet, directory=str(ROOT))
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from audit import AUDIT, contrast, lum

def audit(page, tag):
    a = page.evaluate(AUDIT)
    check(tag + ': circles drawn (non-empty)', a['shown'] >= 5, a['shown'])
    check(tag + ': no horizontal scroll', not a['hscroll'])
    check(tag + ': no slider inputs', a['ranges'] == 0)
    wide = page.viewport_size['width'] >= 500   # a 300 px stage has no circle big enough for a whole name, so it may show none
    check(tag + ': chip labels present', len(a['chips']) >= 1 or not wide, len(a['chips']))
    p = pills(page, tag)
    check(tag + ': chip labels never overlap (%d chips)' % len(a['chips']), a['overlaps'] == 0, a['overlaps'])
    count(len(a['chips']))
    check(tag + ': breadcrumb, legend and gear never overlap (%d boxes)' % a['htmlCount'], a['htmlOverlaps'] == 0, a['htmlOverlaps'])
    bad = [c for c in a['chips'] if not (c['inside'] and c['inStage'] and c['textFits'])]
    check(tag + ': every chip inside its circle, the stage, and wide enough for its text', not bad, bad[:2])
    small = [t for t in a['text'] if t['size'] < 14]
    check(tag + ': all %d text runs are 14px or more' % len(a['text']), not small and len(a['text']) > 0, small[:3])
    low = [(t['s'], round(contrast(t['fg'], t['bg']), 2)) for t in a['text'] if contrast(t['fg'], t['bg']) < 7]
    check(tag + ': all text clears 7:1 contrast', not low, low[:3])
    fams = [t['family'] for t in a['text'] if any(b in t['family'].lower().split(',')[0] for b in BANNED_FONTS)]
    check(tag + ': first font in every stack is sans-serif', not fams and all('sans-serif' in t['family'].lower() for t in a['text']), fams[:2])
    count(len(a['text']))
    return a

PILLS = r"""() => {
  const r = RF.app.state.renderer, f = r.focus, out = [];
  document.querySelectorAll('.rf-chip').forEach(g => {
    const n = r.nodes[+g.getAttribute('data-i')], rc = g.querySelector('rect').getBoundingClientRect();
    out.push({ text: g.querySelector('text').textContent, l: rc.left, r: rc.right, t: rc.top, b: rc.bottom,
               level: n === f ? 'focus' : (n.parent === f ? 'child' : 'deeper'), groupKids: n.children ? n.children.length : 0 });
  });
  const groups = r.nodes.filter(n => n.parent && n.children);
  return { pills: out, oneKid: groups.filter(n => n.children.length === 1).map(n => n.data.name), crumbs: [...document.querySelectorAll('.rf-crumb')].map(e => e.textContent) };
}"""
def pills(page, tag):
    """The three label rules, measured on every visible pill: whole text or none, only the focus level
    and its direct children carry a pill, and no pill overlaps any other pill. Returns the pill count."""
    d = page.evaluate(PILLS); ps = d['pills']
    stubs = [q['text'] for q in ps if '…' in q['text'] or '...' in q['text']]
    check(tag + ': no pill carries an ellipsis (%d pills)' % len(ps), not stubs, stubs[:3])
    deeper = [q['text'] for q in ps if q['level'] == 'deeper']
    check(tag + ': only the focus circle and its direct children are labelled', not deeper, deeper[:3])
    lap = sum(1 for i in range(len(ps)) for j in range(i + 1, len(ps)) if ps[i]['l'] < ps[j]['r'] and ps[i]['r'] > ps[j]['l'] and ps[i]['t'] < ps[j]['b'] and ps[i]['b'] > ps[j]['t'])
    check(tag + ': zero pill-on-pill overlaps over all %d pairs' % (len(ps) * (len(ps) - 1) // 2), lap == 0, lap)
    check(tag + ': no group circle has exactly one child (no hugging ring)', not d['oneKid'], d['oneKid'])
    count(len(ps))
    return len(ps)

def open_page(browser, w, h, query, scheme='light'):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, permissions=['clipboard-read', 'clipboard-write'])
    page = ctx.new_page(); errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + '/test/page.html?fresh=1&' + query)
    page.wait_for_selector('.rf-c', timeout=8000)
    page.wait_for_timeout(1100)   # entrance animation (800 ms) settles before any measuring
    return ctx, page, errs

def settle(page):
    page.wait_for_function("() => !document.querySelector('#rf-chart').classList.contains('rf-zooming') && document.querySelectorAll('.rf-chip').length >= 0")
    page.wait_for_timeout(350)

def click_group_point(page, depth=1):
    """A screen point where the topmost element is a group circle of the given depth (not a child)."""
    return page.evaluate("""(depth) => {
      const st = RF.app.state.renderer, rect = document.querySelector('.rf-svg').getBoundingClientRect();
      const node = st.focus.children.filter(n => n.children)[0];
      const cx = +node.el.getAttribute('cx'), cy = +node.el.getAttribute('cy'), r = +node.el.getAttribute('r');
      for (let k = 0; k < 400; k++) {
        const a = k * 2.399963, d = r * 0.97 * Math.sqrt((k + 1) / 400);
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const e = document.elementFromPoint(rect.left + x, rect.top + y);
        if (e && e === node.el) return { x: rect.left + x, y: rect.top + y, name: node.data.name };
      }
      return null; }""", depth)

with sync_playwright() as p:
    browser = p.chromium.launch()
    shots = {}

    # ---- 1. three sizes x light and dark: structure, labels, text, contrast
    for (w, h) in SIZES:
        for theme, bg in THEMES.items():
            ctx, page, errs = open_page(browser, w, h, 'fixture=causes&bg=' + bg, theme)
            tag = '%dx%d %s' % (w, h, theme)
            a = audit(page, tag)
            check(tag + ': 0 console errors', not errs, errs[:2])
            ink = page.evaluate("getComputedStyle(document.getElementById('rf-root')).getPropertyValue('--rf-bg').trim()")
            check(tag + ': worksheet background respected (' + ink + ')', ink.lower() == '#' + bg, ink)
            if (w, h) == (900, 560) and SHOTS: shots['reef-' + theme] = page.screenshot()
            ctx.close()

    # ---- 2. zoom: real click, eased, 60 fps, breadcrumb, climb back
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=causes&bg=ffffff')
    pt = click_group_point(page)
    check('found a click point on a group circle', pt is not None)
    page.evaluate("""() => { window.__fr = []; window.__rec = true; let last = 0; const f = (t) => { if (last) window.__fr.push(t - last); last = t; if (window.__rec) requestAnimationFrame(f); }; requestAnimationFrame(f);
                            RF.app.state.renderer.frameMs.length = 0; }""")
    page.mouse.click(pt['x'], pt['y'])
    page.wait_for_function("() => document.querySelector('#rf-chart').classList.contains('rf-zooming')", timeout=3000)
    page.wait_for_function("() => !document.querySelector('#rf-chart').classList.contains('rf-zooming')", timeout=6000)
    page.evaluate("() => { window.__rec = false; }")
    fr = page.evaluate("() => window.__fr"); cost = page.evaluate("() => RF.app.state.renderer.frameMs")
    fr = [x for x in fr[1:-1]]
    check('zoom ran for at least 20 frames (%d)' % len(fr), len(fr) >= 20, len(fr))
    med, p95, mx = statistics.median(fr), sorted(fr)[int(len(fr) * 0.95) - 1], max(fr)
    print('  zoom frames: n=%d median %.1f ms, p95 %.1f ms, max %.1f ms; script cost per frame mean %.2f ms max %.2f ms' % (len(fr), med, p95, mx, statistics.mean(cost), max(cost)))
    check('zoom frame median <= 17.5 ms (60 fps)', med <= 17.5, med)
    check('zoom frame p95 <= 25 ms', p95 <= 25, p95)
    check('zoom no frame over 50 ms (no jank)', mx <= 50, mx)
    check('zoom script cost per frame <= 4 ms on average', statistics.mean(cost) <= 4, statistics.mean(cost))
    count(len(fr))
    settle(page)
    crumbs = page.evaluate("() => [...document.querySelectorAll('.rf-crumb')].map(e => e.textContent)")
    check('breadcrumb shows All then the zoomed group', len(crumbs) == 2 and crumbs[0] == 'All' and crumbs[1] == pt['name'], crumbs)
    hid = page.evaluate("() => RF.app.state.renderer.nodes.filter(n => n.el.style.display === 'none').length")
    check('circles outside the focus are hidden after the zoom', hid > 5, hid)
    audit(page, 'after zoom')
    sel = page.evaluate("() => RF_MOCK.calls.filter(c => c.call === 'select').length")
    check('clicking a group pushed a selection into Tableau', sel >= 1, sel)
    page.click('.rf-crumb:first-child'); page.wait_for_function("() => !document.querySelector('#rf-chart').classList.contains('rf-zooming')"); settle(page)
    check('breadcrumb All climbs back to the root', page.evaluate("() => RF.app.state.renderer.focus === RF.app.state.renderer.root"))
    # Escape zooms out one level
    page.mouse.click(pt['x'], pt['y']); page.wait_for_timeout(200); settle(page)
    page.focus('.rf-svg'); page.keyboard.press('Escape'); page.wait_for_timeout(200); settle(page)
    check('Escape zooms out one level', page.evaluate("() => RF.app.state.renderer.focus === RF.app.state.renderer.root"))
    # clicking a leaf selects with field/value pairs for every level
    page.evaluate("() => { RF_MOCK.calls.length = 0; }")
    lp = page.evaluate("""() => { const r = RF.app.state.renderer, rect = document.querySelector('.rf-svg').getBoundingClientRect();
      const leaf = r.root.leaves().filter(l => !l.el.style.display || l.el.style.display !== 'none').sort((a, b) => b.r - a.r)[0];
      return { x: rect.left + +leaf.el.getAttribute('cx'), y: rect.top + +leaf.el.getAttribute('cy'), path: leaf.data.pathNames }; }""")
    page.mouse.click(lp['x'], lp['y']); page.wait_for_timeout(100); settle(page)
    calls = page.evaluate("() => RF_MOCK.calls.filter(c => c.call === 'select')")
    check('clicking a leaf selects by value on all three level fields', calls and [s['fieldName'] for s in calls[0]['sel']] == ['Cause group', 'Cause', 'Census region'] and [s['value'][0] for s in calls[0]['sel']] == lp['path'], calls[:1])
    page.mouse.click(5, 300)   # empty space clears
    page.wait_for_timeout(100)
    check('clicking empty space clears the selection in Tableau', page.evaluate("() => RF_MOCK.calls.some(c => c.call === 'clear')"))
    # hover
    page.mouse.move(lp['x'], lp['y']); page.wait_for_timeout(120)
    tip = page.evaluate("() => { const t = document.querySelector('.rf-tip'); return { shown: t.style.display !== 'none', text: t.textContent }; }")
    check('hover shows a tooltip with the value', tip['shown'] and 'Deaths' in tip['text'], tip)
    check('hover pushes a hover tuple to Tableau', page.evaluate("() => RF_MOCK.calls.some(c => c.call === 'hover' && c.tuple > 0)"))
    audit(page, 'with tooltip')
    check('zoom flow: 0 console errors', not errs, errs[:2])
    ctx.close()

    # ---- 3. settings panel: gear, steppers, persistence as strings, copy and paste, no dialogs
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=causes&bg=ffffff')
    dialogs = []; page.on('dialog', lambda d: (dialogs.append(d.type), d.dismiss()))
    page.click('.rf-gear'); page.wait_for_timeout(400)
    check('panel opens', page.evaluate("() => document.querySelector('.rf-panel').classList.contains('open')"))
    audit(page, 'panel open')
    r0 = page.evaluate("() => RF.app.state.renderer.root.children[0].r")
    page.fill('input[aria-label="Gap between circles"]', '18'); page.press('input[aria-label="Gap between circles"]', 'Enter')
    page.dispatch_event('input[aria-label="Gap between circles"]', 'change'); page.wait_for_timeout(600)
    stored = page.evaluate("() => RF_MOCK.settings.getAll()")
    check('typed stepper value saved as a STRING under reef.gap', stored.get('reef.gap') == '18' and page.evaluate("() => RF_MOCK.settings.saves") >= 1, stored)
    r1 = page.evaluate("() => RF.app.state.renderer.root.children[0].r")
    check('changing the gap re-packed the circles', abs(r0 - r1) > 0.01, (r0, r1))
    page.select_option('select[aria-label="Palette"]', 'sunset'); page.wait_for_timeout(300)
    check('palette dropdown applied and saved', page.evaluate("() => RF_MOCK.settings.get('reef.palette')") == 'sunset')
    page.click('button:has-text("Copy settings")'); page.wait_for_timeout(300)
    clip = page.evaluate("() => navigator.clipboard.readText()")
    parsed = json.loads(clip)
    check('Copy settings puts valid JSON on the clipboard with typed values', parsed.get('gap') == 18 and parsed.get('palette') == 'sunset' and parsed.get('labels') is True, list(parsed)[:4])
    check('copied JSON covers every setting', len(parsed) == page.evaluate("() => Object.keys(RF.schema.DEFAULTS).length"), len(parsed))
    page.click('button:has-text("Paste settings")'); page.fill('.rf-pastebox textarea', '{"palette":"kelp","fontSize":"16","labels":"true"}'); page.click('.rf-pastebox button:has-text("Apply")'); page.wait_for_timeout(300)
    check('Paste settings applies JSON inline (no dialog)', page.evaluate("() => RF.app.state.settings.palette === 'kelp' && RF.app.state.settings.fontSize === 16") and not dialogs, dialogs)
    page.click('button:has-text("Paste settings")') if page.evaluate("() => document.querySelector('.rf-pastebox').style.display === 'none'") else None
    page.fill('.rf-pastebox textarea', 'not json'); page.click('.rf-pastebox button:has-text("Apply")')
    check('invalid paste is refused with a message', 'not valid' in page.evaluate("() => document.querySelector('.rf-msg').textContent"))
    page.fill('.rf-search', 'palette'); page.wait_for_timeout(150)
    check('settings search filters the panel', page.evaluate("() => document.querySelectorAll('.rf-row').length") <= 3)
    page.fill('.rf-search', '')
    page.click('.rf-btn:has-text("Reset all")'); check('reset needs a second press', page.evaluate("() => RF.app.state.settings.palette") == 'kelp'); page.click('.rf-btn:has-text("Press again")'); page.wait_for_timeout(300)
    check('reset restores defaults', page.evaluate("() => RF.app.state.settings.palette") == 'reef')
    check('no browser dialog appeared anywhere', not dialogs)
    check('settings flow: 0 console errors', not errs, errs[:2])
    page.evaluate("() => { RF_MOCK.settings.set('reef.gap','9'); RF_MOCK.settings.set('reef.fontSize','18'); RF_MOCK.settings.set('reef.labels','true'); RF_MOCK.settings.saveAsync(); }")
    ls = page.evaluate("() => localStorage.getItem('rf-mock-settings')")
    page.goto(BASE + '/test/page.html?fixture=causes&bg=ffffff'); page.wait_for_selector('.rf-c'); page.wait_for_timeout(900)
    rs = page.evaluate("() => RF.app.state.settings")
    check('string settings survive a reload and come back typed', rs['gap'] == 9 and rs['fontSize'] == 18 and rs['labels'] is True, (rs['gap'], rs['fontSize'], ls[:60]))
    ctx.close()

    # ---- 4. colour by a Detail field: numeric ramp and categorical
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=causes&bg=ffffff')
    page.evaluate("() => { RF_MOCK.settings.set('reef.colorMode','field'); RF_MOCK.settings.set('reef.colorField','Age-adjusted death rate'); }")
    page.evaluate("() => { RF.app.state.settings = RF.schema.resolve({colorMode:'field', colorField:'Age-adjusted death rate'}); RF.app.redraw(); }"); page.wait_for_timeout(300)
    fills = page.evaluate("() => new Set(RF.app.state.renderer.root.leaves().map(l => l.el.getAttribute('fill'))).size")
    check('numeric colour field gives many ramp colours (%d)' % fills, fills >= 8, fills)
    check('numeric colour field shows a ramp legend', page.evaluate("() => !!document.querySelector('.rf-ramp')"))
    page.evaluate("() => { RF.app.state.settings = RF.schema.resolve({colorMode:'field', colorField:'Census region'}); RF.app.redraw(); }"); page.wait_for_timeout(300)
    fills = page.evaluate("() => new Set(RF.app.state.renderer.root.leaves().map(l => l.el.getAttribute('fill'))).size")
    check('categorical colour field gives one colour per region', fills == 4, fills)
    audit(page, 'colour by field')
    check('colour flow: 0 console errors', not errs, errs[:2]); ctx.close()

    # ---- 5. fixtures that break things
    for key, expect in [('two', 'ok'), ('one', 'ok'), ('single', 'ok'), ('bad', 'ok'), ('long', 'ok'), ('noenc', 'ok'), ('empty', 'msg')]:
        for (w, h) in [(300, 300), (900, 560)]:
            ctx, page, errs = open_page(browser, w, h, 'fixture=%s&bg=ffffff' % key) if key != 'empty' else (None, None, None)
            if key == 'empty':
                ctx = browser.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page(); errs = []
                page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); page.on('pageerror', lambda e: errs.append(str(e)))
                page.goto(BASE + '/test/page.html?fresh=1&fixture=empty'); page.wait_for_selector('.rf-empty', state='visible', timeout=5000)
                check('empty data shows a message, not a blank', 'Drop a dimension' in page.inner_text('.rf-empty'))
            else:
                a = page.evaluate(AUDIT)
                check('fixture %s %dx%d: draws, no overlaps, text ok' % (key, w, h), a['shown'] >= 1 and a['overlaps'] == 0 and not [t for t in a['text'] if t['size'] < 14] and not a['hscroll'], (a['shown'], a['overlaps']))
                low = [t for t in a['text'] if contrast(t['fg'], t['bg']) < 7]
                check('fixture %s %dx%d: contrast 7:1' % (key, w, h), not low, low[:2])
            check('fixture %s %dx%d: 0 console errors' % (key, w, h), not errs, errs[:2]); ctx.close()
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=bad&bg=ffffff')
    check('bad data: 2 invalid rows reported', '2 rows skipped' in page.inner_text('.rf-legend'), page.inner_text('.rf-legend')); ctx.close()

    # ---- 6. stress: 1,200 leaves, draw time and zoom smoothness
    ctx, page, errs = open_page(browser, 1600, 1000, 'fixture=big&bg=ffffff')
    t = page.evaluate("""() => { RF.app.state.renderer.treeKey = ''; const t0 = performance.now(); RF.app.redraw(); return performance.now() - t0; }""")
    print('  stress: 1,200 leaves full rebuild + pack + draw %.0f ms' % t)
    check('1,200 leaves redraw in under 400 ms', t < 400, t)
    a = audit(page, 'stress 1200')
    page.evaluate("() => { window.__fr = []; window.__rec = true; let last = 0; const f = (t) => { if (last) window.__fr.push(t - last); last = t; if (window.__rec) requestAnimationFrame(f); }; requestAnimationFrame(f); RF.app.state.renderer.frameMs.length = 0; }")
    page.evaluate("() => { const r = RF.app.state.renderer; r.zoomTo(r.root.children[0]); }")
    page.wait_for_function("() => !document.querySelector('#rf-chart').classList.contains('rf-zooming')", timeout=8000)
    page.evaluate("() => { window.__rec = false; }")
    fr = page.evaluate("() => window.__fr")[1:-1]; cost = page.evaluate("() => RF.app.state.renderer.frameMs")
    print('  stress zoom: n=%d median %.1f p95 %.1f max %.1f ms; script cost mean %.2f max %.2f ms' % (len(fr), statistics.median(fr), sorted(fr)[int(len(fr) * .95) - 1], max(fr), statistics.mean(cost), max(cost)))
    check('stress zoom: median frame <= 17.5 ms', statistics.median(fr) <= 17.5, statistics.median(fr))
    check('stress zoom: script cost per frame <= 6 ms', statistics.mean(cost) <= 6, statistics.mean(cost))
    check('stress: 0 console errors', not errs, errs[:2]); ctx.close()

    # ---- 7. reader serialization under an event burst, and an in-flight resize
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=causes&bg=ffffff')
    page.evaluate("() => { for (let i = 0; i < 6; i++) RF_MOCK.sheet.emit('summary-data-changed'); }"); page.wait_for_timeout(800)
    check('event burst: no reader error (one reader at a time) and still drawn', not errs and page.evaluate("() => document.querySelectorAll('.rf-c').length") > 40, errs[:2])
    page.set_viewport_size({'width': 420, 'height': 640}); page.wait_for_timeout(500)
    a = audit(page, 'resized to 420x640')
    page.set_viewport_size({'width': 1280, 'height': 700}); page.wait_for_timeout(500)
    audit(page, 'resized to 1280x700')
    # reduced motion: zoom is instant
    ctx.close()
    ctx = browser.new_context(viewport={'width': 900, 'height': 560}, reduced_motion='reduce'); page = ctx.new_page()
    page.goto(BASE + '/test/page.html?fresh=1&fixture=causes&bg=ffffff'); page.wait_for_selector('.rf-c'); page.wait_for_timeout(300)
    page.evaluate("() => { const r = RF.app.state.renderer; r.zoomTo(r.root.children[0]); }")
    check('reduced motion: zoom completes in the same frame', page.evaluate("() => !document.querySelector('#rf-chart').classList.contains('rf-zooming') && RF.app.state.renderer.focus.depth === 1"))
    ctx.close()

    # ---- 9. label rules at the root and after zooming into EACH group, 3 sizes x light and dark
    for (w, h) in SIZES:
        for theme, bg in THEMES.items():
            ctx, page, errs = open_page(browser, w, h, 'fixture=causes&bg=' + bg, theme)
            tag = 'sweep %dx%d %s' % (w, h, theme)
            total = pills(page, tag + ' root')
            names = page.evaluate("() => RF.app.state.renderer.root.children.map(n => n.data.name)")
            check(tag + ': five top-level groups to zoom into', len(names) == 5, names)
            check(tag + ': collapsed chain is one circle (Cancers, no Cancer ring)', page.evaluate("() => { const n = RF.app.state.renderer.nodes.map(x => x.data.name); return n.indexOf('Cancers') >= 0 && n.indexOf('Cancer') < 0; }"))
            for i, nm in enumerate(names):
                page.evaluate("(i) => { const r = RF.app.state.renderer; r.zoomTo(r.root.children[i]); }", i)
                page.wait_for_timeout(100); settle(page)
                total += pills(page, tag + ' zoomed into ' + nm)
                if nm == 'Cancers':
                    d = page.evaluate(PILLS)
                    check(tag + ': zooming into the folded group shows one crumb step: ' + str(d['crumbs']), d['crumbs'] == ['All', 'Cancers'], d['crumbs'])
                page.evaluate("() => { const r = RF.app.state.renderer; r.zoomTo(r.root); }"); page.wait_for_timeout(100); settle(page)
            check(tag + ': sweep examined pills (%d)' % total, total >= (10 if w >= 900 else 0), total)
            check(tag + ': 0 console errors', not errs, errs[:2]); ctx.close()

    # ---- 8. dark worksheet + preview shots
    if SHOTS:
        ctx, page, errs = open_page(browser, 1280, 800, 'fixture=causes&bg=0d2b45', 'dark')
        shots['reef-dark-1280'] = page.screenshot()
        pt = click_group_point(page); page.mouse.click(pt['x'], pt['y']); page.wait_for_timeout(1200)
        shots['reef-zoomed-1280'] = page.screenshot(); ctx.close()
        ctx, page, errs = open_page(browser, 1280, 800, 'fixture=causes&bg=ffffff', 'light')
        shots['reef-light-1280'] = page.screenshot(); ctx.close()
        ctx, page, errs = open_page(browser, 1280, 790, 'fixture=causes&bg=0d2b45', 'dark')
        shots['thumb'] = page.screenshot(); ctx.close()
    browser.close()

if SHOTS:
    from PIL import Image
    out = ROOT / 'preview'; out.mkdir(exist_ok=True)
    for k in ('reef-light-1280', 'reef-dark-1280', 'reef-zoomed-1280'):
        (out / (k.replace('-1280', '') + '.png')).write_bytes(shots[k])
    Image.open(io.BytesIO(shots['thumb'])).convert('RGB').save(out / 'thumbnail.jpg', 'JPEG', quality=88, optimize=True)
    print('wrote previews to', out)

srv.shutdown()
print('Reef render gate: %d subjects examined, %d checks failed' % (subjects, len(fails)))
for f in fails: print(' FAIL', f)
if subjects < MIN_SUBJECTS:
    print('RED: fewer subjects than the declared minimum (%d), so this run proves nothing' % MIN_SUBJECTS); sys.exit(2)
sys.exit(1 if fails else 0)
