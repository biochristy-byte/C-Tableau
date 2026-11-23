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

    # ---- 3. the shared settings panel (ctab-panel): gear, drag clamped to the frame, minimize, close, Escape, copy and paste, live re-render
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=causes&bg=ffffff')
    dialogs = []; page.on('dialog', lambda d: (dialogs.append(d.type), d.dismiss()))
    RECT = "(sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }"
    def inside(r, f, tol=1.5): return r['l'] >= f['l'] - tol and r['t'] >= f['t'] - tol and r['r'] <= f['r'] + tol and r['b'] <= f['b'] + tol
    def head_point(): r = page.evaluate(RECT, '.cp-head'); return r['l'] + 40, r['t'] + r['h'] / 2
    check('the panel starts closed and the gear is on screen', page.evaluate("() => document.querySelector('.cp-panel').hidden") and page.is_visible('.cp-gear'))
    page.click('.cp-gear'); page.wait_for_selector('.cp-panel:not([hidden])', timeout=5000)
    check('the gear opens the floating panel', page.is_visible('.cp-panel') and page.evaluate("() => !document.querySelector('.cp-panel').hidden"))
    tabs = page.evaluate("() => [...document.querySelectorAll('.cp-tab')].map(t => t.textContent)")
    check('14 tabs plus Panel: Colors, Packing, Depth, Zoom, Rings, Labels, Legend, Number format, Tooltip, Fonts, Background, Animation, Interaction, Fields', len(tabs) == 15 and tabs[:2] == ['Colors', 'Packing'] and 'Fields' in tabs and tabs[-1] == 'Panel', tabs)
    nset = page.evaluate("() => RF.app.state.store.rows.filter(r => r.type !== 'note').length")
    check('at least 40 settings (%d)' % nset, nset >= 40)
    ranges = 0
    for tid in page.evaluate("() => [...document.querySelectorAll('.cp-tab')].map(t => t.dataset.t)"):
        page.click(".cp-tab[data-t='%s']" % tid)
        ranges += page.evaluate("() => document.querySelectorAll('input[type=range]').length")
        small = page.evaluate("() => [...document.querySelectorAll('.cp-panel *')].filter(e => e.getBoundingClientRect().width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 14).map(e => e.textContent.slice(0, 20))")
        check('panel tab %s: every text is 14px or more' % tid, not small, small[:3])
        low = page.evaluate("""() => { const parse = s => (s.match(/[\\d.]+/g) || []).map(Number); const bgOf = e => { for (let n = e; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c.length < 4 || c[3] > 0.95)) return c.slice(0, 3); } return [255, 255, 255]; };
          return [...document.querySelectorAll('.cp-panel *')].filter(e => e.getBoundingClientRect().width > 0 && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !e.matches('option,select,input,textarea')).map(e => ({ t: e.textContent.slice(0, 20), fg: parse(getComputedStyle(e).color).slice(0, 3), bg: bgOf(e) })); }""")
        bad = [x['t'] for x in low if contrast(x['fg'], x['bg']) < 7]
        check('panel tab %s: text clears 7:1 (%d runs)' % (tid, len(low)), not bad, bad[:3]); count(len(low))
    check('no range input on any of the %d tabs' % len(tabs), ranges == 0, ranges)
    page.click(".cp-tab[data-t='colors']")
    audit(page, 'panel open')
    f = page.evaluate(RECT, '#rf-root')
    pr = page.evaluate(RECT, '.cp-panel')
    check('the panel sits inside the frame', inside(pr, f), pr)
    # drag by the title bar, clamped to the frame
    x, y = head_point()
    page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x - 100, y + 60, steps=6); page.mouse.move(x - 200, y + 150, steps=6); page.mouse.up()
    r1 = page.evaluate(RECT, '.cp-panel')
    check('drag by the title bar moves the panel by the pointer delta (down as far as the frame allows)', abs((pr['l'] - r1['l']) - 200) <= 2 and abs((r1['t'] - pr['t']) - min(150, f['b'] - pr['b'])) <= 2, (pr['l'], r1['l'], pr['t'], r1['t']))
    x, y = head_point(); page.mouse.move(x, y); page.mouse.down(); page.mouse.move(-3000, -3000, steps=8); page.mouse.up()
    r2 = page.evaluate(RECT, '.cp-panel')
    check('dragged far up-left clamps to the frame corner', abs(r2['l'] - f['l']) <= 1.5 and abs(r2['t'] - f['t']) <= 1.5, (r2, f))
    x, y = head_point(); page.mouse.move(x, y); page.mouse.down(); page.mouse.move(4000, 4000, steps=8); page.mouse.up()
    r3 = page.evaluate(RECT, '.cp-panel')
    check('dragged far down-right clamps to the frame corner', abs(r3['r'] - f['r']) <= 1.5 and abs(r3['b'] - f['b']) <= 1.5, (r3, f))
    check('the panel never leaves the frame at either extreme', inside(r2, f) and inside(r3, f))
    # minimize and restore
    full = page.evaluate(RECT, '.cp-panel')['h']
    page.click('[data-a=min]'); page.wait_for_function("() => document.querySelector('.cp-panel').classList.contains('cp-min')")
    check('minimize leaves just the title bar', page.evaluate(RECT, '.cp-panel')['h'] < full / 4 and not page.is_visible('.cp-tabs') and page.is_visible('.cp-title'))
    page.click('[data-a=min]'); page.wait_for_function("() => !document.querySelector('.cp-panel').classList.contains('cp-min')")
    check('restore brings the tabs back', page.is_visible('.cp-tabs'))
    # a setting change re-renders the chart live, and is saved as a string
    page.click(".cp-tab[data-t='packing']")
    r0 = page.evaluate("() => RF.app.state.renderer.root.children[0].r")
    page.fill('input[data-k=gap]', '18'); page.press('input[data-k=gap]', 'Enter'); page.wait_for_timeout(700)
    check('typing a gap re-packs the circles live', abs(r0 - page.evaluate("() => RF.app.state.renderer.root.children[0].r")) > 0.01)
    check('the typed value is saved as the STRING "18" under reef.gap', page.evaluate("() => RF_MOCK.settings.get('reef.gap')") == '18' and page.evaluate("() => RF_MOCK.settings.saves") >= 1)
    page.click(".cp-tab[data-t='colors']"); page.select_option('select[data-k=palette]', 'sunset'); page.wait_for_timeout(300)
    check('the palette select re-colours and saves reef.palette', page.evaluate("() => RF_MOCK.settings.get('reef.palette')") == 'sunset' and page.evaluate("() => RF.app.state.renderer.root.children[0].el.getAttribute('fill')") in ('#e8873a', '#f08f8f', '#f2b84b', '#c79bf2'))
    # copy and paste round trip
    page.click('[data-a=copy]')
    page.wait_for_function("() => document.querySelector('.cp-status').textContent.indexOf('Copied') === 0", timeout=5000)
    copied = json.loads(page.evaluate("() => RF.app.state.panel.lastCopied"))
    check('Copy settings makes flat JSON with every setting (%d keys)' % len(copied), len(copied) == nset and copied['gap'] == 18 and copied['palette'] == 'sunset', len(copied))
    page.select_option('select[data-k=palette]', 'kelp'); page.click(".cp-tab[data-t='packing']"); page.fill('input[data-k=gap]', '3'); page.press('input[data-k=gap]', 'Enter'); page.wait_for_timeout(500)
    check('the settings really changed before the paste', page.evaluate("() => RF.app.state.store.get().palette") == 'kelp' and page.evaluate("() => RF.app.state.store.get().gap") == 3)
    page.click('[data-a=paste]'); page.wait_for_selector('textarea[data-f=paste]')
    page.fill('textarea[data-f=paste]', '{this is not json'); page.click('[data-a=pasteapply]')
    check('bad JSON shows an inline message, not a dialog, and changes nothing', 'not valid' in page.inner_text('.cp-msg[role=alert]') and not dialogs and page.evaluate("() => RF.app.state.store.get().gap") == 3)
    page.fill('textarea[data-f=paste]', json.dumps(copied)); page.click('[data-a=pasteapply]'); page.wait_for_timeout(600)
    back = page.evaluate("() => RF.app.state.store.snapshot()")
    check('pasting the copied JSON restores every setting (round trip over %d keys)' % len(copied), back == copied, [k for k in copied if back.get(k) != copied[k]][:4])
    check('the paste re-rendered the chart (sunset palette, gap 18)', page.evaluate("() => RF.app.state.store.get().palette") == 'sunset' and abs(r0 - page.evaluate("() => RF.app.state.renderer.root.children[0].r")) > 0.01)
    page.fill('.cp-q', 'palette'); page.wait_for_timeout(200)
    check('search filters rows across tabs', page.evaluate("() => document.querySelectorAll('.cp-row').length") <= 4)
    page.fill('.cp-q', '')
    page.click('[data-a=resetall]'); page.click('[data-a=confirmyes]'); page.wait_for_timeout(500)
    check('Reset all (inline confirm) restores the defaults', page.evaluate("() => RF.app.state.store.get().palette") == 'reef' and page.evaluate("() => RF.app.state.store.get().gap") == 5)
    # close, Escape, focus return
    page.click('[data-a=close]')
    check('the close button hides the panel and focus returns to the gear', page.evaluate("() => document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    page.click('.cp-gear'); page.wait_for_selector('.cp-panel:not([hidden])'); page.keyboard.press('Escape')
    check('Escape closes the panel and focus returns to the gear', page.evaluate("() => document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    check('no browser dialog appeared anywhere', not dialogs, dialogs)
    check('panel session: 0 console errors', not errs, errs[:2])
    page.evaluate("() => { RF_MOCK.settings.set('reef.gap','9'); RF_MOCK.settings.set('reef.fontSize','18'); RF_MOCK.settings.set('reef.labels','true'); RF_MOCK.settings.saveAsync(); }")
    ls = page.evaluate("() => localStorage.getItem('rf-mock-settings')")
    page.goto(BASE + '/test/page.html?fixture=causes&bg=ffffff'); page.wait_for_selector('.rf-c'); page.wait_for_timeout(900)
    rs = page.evaluate("() => RF.app.state.store.get()")
    check('string settings survive a reload and come back typed', rs['gap'] == 9 and rs['fontSize'] == 18 and rs['labels'] is True, (rs['gap'], rs['fontSize'], ls[:60]))
    ctx.close()

    # ---- 3b. the panel at 390 wide is a full-frame sheet, and every control stays inside it
    ctx, page, errs = open_page(browser, 390, 700, 'fixture=causes&bg=ffffff')
    page.click('.cp-gear'); page.wait_for_selector('.cp-panel:not([hidden])'); page.wait_for_timeout(300)
    sh = page.evaluate(RECT, '.cp-panel'); fr = page.evaluate(RECT, '#rf-root')
    check('at 390 wide the panel is a full-frame sheet', sh['w'] >= fr['w'] - 2 and inside(sh, fr), (sh, fr))
    check('the sheet has no horizontal scroll', not page.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.cp-panel').scrollWidth > document.querySelector('.cp-panel').clientWidth + 1"))
    check('390 wide: 0 console errors', not errs, errs[:2]); ctx.close()

    # ---- 4. colour by a Detail field: numeric ramp and categorical
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=causes&bg=ffffff')
    page.evaluate("() => RF.app.state.store.setMany({colorMode:'field', colorField:'Age-adjusted death rate'})"); page.wait_for_timeout(300)
    fills = page.evaluate("() => new Set(RF.app.state.renderer.root.leaves().map(l => l.el.getAttribute('fill'))).size")
    check('numeric colour field gives many ramp colours (%d)' % fills, fills >= 8, fills)
    check('numeric colour field shows a ramp legend', page.evaluate("() => !!document.querySelector('.rf-ramp')"))
    page.evaluate("() => RF.app.state.store.setMany({colorMode:'field', colorField:'Census region'})"); page.wait_for_timeout(300)
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
