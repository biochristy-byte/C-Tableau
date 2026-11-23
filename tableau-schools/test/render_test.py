"""Schools render gate: the shipping code against the mock Tableau API, in headless Chromium.

  python test/render_test.py            run every check, exit 1 on any failure
  python test/render_test.py --shots    also write preview PNGs and the hub thumbnail

Starts its OWN static server on a free port (never adopts one already listening).
Prints how many subjects each check examined; goes RED below MIN_SUBJECTS.
"""
import sys, json, threading, http.server, socketserver, functools, pathlib, math, statistics, io

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = '--shots' in sys.argv
MIN_SUBJECTS = 3000
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
    ncl = page.evaluate("() => SC.app.state.renderer.clusters.length")
    nchips = len(a['chips']) + len(a['cchips'])
    check(tag + ': circles drawn (non-empty)', a['shown'] >= 1, a['shown'])
    check(tag + ': no horizontal scroll', not a['hscroll'])
    check(tag + ': no slider inputs', a['ranges'] == 0)
    check(tag + ': chip labels present', nchips >= 1, nchips)
    check(tag + ': chip labels never overlap (%d chips)' % nchips, a['overlaps'] == 0, a['overlaps'])
    count(nchips)
    check(tag + ': every one of %d clusters is labelled' % ncl, len(a['cchips']) == ncl, (len(a['cchips']), ncl))
    check(tag + ': no two of %d circles overlap (%d pairs measured from the DOM)' % (a['circleCount'], a['circlePairs']), a['circleOverlaps'] == 0, a['circleOverlaps'])
    count(a['circlePairs'])
    check(tag + ': every circle inside the stage', a['circleOutside'] == 0, a['circleOutside'])
    check(tag + ': legend and gear never overlap (%d boxes)' % a['htmlCount'], a['htmlOverlaps'] == 0, a['htmlOverlaps'])
    bad = [c for c in a['chips'] if not (c['inside'] and c['inStage'] and c['textFits'])] + [c for c in a['cchips'] if not (c['inStage'] and c['textFits'])]
    check(tag + ': every chip inside the stage, wide enough for its text, circle chips inside their circle', not bad, bad[:2])
    small = [t for t in a['text'] if t['size'] < 14]
    check(tag + ': all %d text runs are 14px or more' % len(a['text']), not small and len(a['text']) > 0, small[:3])
    low = [(t['s'], round(contrast(t['fg'], t['bg']), 2)) for t in a['text'] if contrast(t['fg'], t['bg']) < 7]
    check(tag + ': all text clears 7:1 contrast', not low, low[:3])
    fams = [t['family'] for t in a['text'] if any(b in t['family'].lower().split(',')[0] for b in BANNED_FONTS)]
    check(tag + ': first font in every stack is sans-serif', not fams and all('sans-serif' in t['family'].lower() for t in a['text']), fams[:2])
    count(len(a['text']))
    return a

def open_page(browser, w, h, query, scheme='light', **kw):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme, permissions=['clipboard-read', 'clipboard-write'], **kw)
    page = ctx.new_page(); errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errs.append(str(e)))
    page.goto(BASE + '/test/page.html?fresh=1&' + query)
    page.wait_for_selector('.sc-c', timeout=8000)
    page.wait_for_function("() => !SC.app.state.renderer.job && !document.querySelector('#sc-chart').classList.contains('sc-moving') && document.querySelectorAll('.sc-chip').length > 0", timeout=8000)
    page.wait_for_timeout(250)
    return ctx, page, errs

def settle(page, extra=300):
    # idle = no layout job pending (it runs in slices across frames) and no morph running
    page.wait_for_function("() => !SC.app.state.renderer.job && !document.querySelector('#sc-chart').classList.contains('sc-moving')", timeout=8000)
    page.wait_for_timeout(extra)

JITTER = """(n) => new Promise((res) => {
  const read = () => [...document.querySelectorAll('.sc-c')].map(c => c.getAttribute('cx') + ',' + c.getAttribute('cy') + ',' + c.getAttribute('r')).join('|') + '#' +
    [...document.querySelectorAll('.sc-chip rect')].map(r => r.getAttribute('x') + ',' + r.getAttribute('y') + ',' + r.getAttribute('width')).join('|');
  const frames = []; const f = () => { frames.push(read()); if (frames.length < n) requestAnimationFrame(f); else res(frames); };
  requestAnimationFrame(f); })"""
def jitter(page, tag, n=30):
    fr = page.evaluate(JITTER, n)
    distinct = len(set(fr))
    check(tag + ': positions identical across %d consecutive frames (no jitter)' % n, distinct == 1 and len(fr) == n and len(fr[0]) > 20, distinct)
    count(n)
    return fr

MORPH = """(o) => new Promise((done) => {
  // Records EVERY animation frame from the trigger to the end of the morph. The trigger runs in a plain task (as a Tableau event does),
  // and the window is every rAF interval that ends after it, so the frame that contains the trigger and the morph's first frame are
  // both inside it whichever way the scheduling falls. A long-animation-frame observer is the second witness.
  const r = SC.app.state.renderer, chart = document.querySelector('#sc-chart'), ts = [], loaf = [], held = [];
  let m = null, started = null, ended = null, tail = 0;
  let obs = null; try { obs = new PerformanceObserver((l) => l.getEntries().forEach((e) => loaf.push([e.startTime, e.duration]))); obs.observe({ type: 'long-animation-frame' }); } catch (e) { obs = null; }
  const sample = () => { const cs = document.querySelectorAll('.sc-c'), out = []; for (let i = 0; i < Math.min(12, cs.length); i++) out.push(cs[i].getAttribute('cx') + ',' + cs[i].getAttribute('cy') + ',' + cs[i].getAttribute('r')); return out.join('|'); };
  const f = (t) => {
    ts.push(t);
    if (m !== null) {
      if (started === null && r.anim) started = performance.now();
      if (started === null) held.push(sample());          // the old picture, while the new layout is computed
      if (started !== null && ended === null && !r.anim && !r.job) ended = performance.now();
      if (ended !== null && ++tail > 2) {
        if (obs) obs.disconnect();
        const iv = []; for (let i = 1; i < ts.length; i++) if (ts[i] > m) iv.push(ts[i] - ts[i - 1]);
        done({ iv, loaf: loaf.filter((e) => e[0] + e[1] > m).map((e) => e[1]), loafOk: !!obs, held, startMs: started - m, endMs: ended - m, cost: r.frameMs.slice() });
        return;
      }
    }
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  setTimeout(() => { m = performance.now(); SC.app.state.settings = SC.schema.resolve(o); SC.app.redraw(); }, 120);
})"""

def morph_gate(page, tag, settings, start_limit):
    """One re-layout morph, measured from its trigger to its end. Every check covers the whole window, first frame included."""
    d = page.evaluate(MORPH, settings)
    iv, loaf, held = d['iv'], d['loaf'], d['held']
    med, p95, mx = statistics.median(iv), sorted(iv)[max(0, int(len(iv) * 0.95) - 1)], max(iv)
    morph_frames = len(d['cost'])
    print('  %s: %d frames from trigger to end; first %.1f ms, median %.1f, p95 %.1f, max %.1f ms; morph started %.0f ms after the trigger, ended at %.0f ms; %d frames held the old picture; long animation frames: %s; script cost per morph frame mean %.2f max %.2f ms'
          % (tag, len(iv), iv[0], med, p95, mx, d['startMs'], d['endMs'], len(held), loaf if d['loafOk'] else 'observer unsupported', statistics.mean(d['cost']), max(d['cost'])))
    check(tag + ': the morph ran for at least 20 frames (%d)' % morph_frames, morph_frames >= 20, morph_frames)
    check(tag + ': no frame over 50 ms anywhere from the trigger to the end, first frame included (%d frames, max %.1f ms)' % (len(iv), mx), mx <= 50, mx)
    check(tag + ': the frame that contains the trigger is under 50 ms (%.1f ms)' % iv[0], iv[0] <= 50, iv[0])
    check(tag + ': frame median <= 17.5 ms (60 fps)', med <= 17.5, med)
    check(tag + ': frame p95 <= 25 ms', p95 <= 25, p95)
    check(tag + ': long-animation-frame observer available (second witness)', d['loafOk'])
    check(tag + ': no long animation frame (over 50 ms) in the window', d['loafOk'] and not loaf, loaf)
    check(tag + ': the old picture holds perfectly still while the new layout is computed (%d frames)' % len(held), len(held) >= 2 and len(set(held)) == 1, (len(held), len(set(held))))
    check(tag + ': morph starts within %d ms of the trigger (%.0f ms)' % (start_limit, d['startMs']), d['startMs'] <= start_limit, d['startMs'])
    count(len(iv))
    return d

with sync_playwright() as p:
    browser = p.chromium.launch()
    shots = {}

    # ---- 1. three sizes x light and dark
    for (w, h) in SIZES:
        for theme, bg in THEMES.items():
            ctx, page, errs = open_page(browser, w, h, 'fixture=countries&bg=' + bg, theme)
            tag = '%dx%d %s' % (w, h, theme)
            audit(page, tag)
            jitter(page, tag)
            check(tag + ': 0 console errors', not errs, errs[:2])
            ink = page.evaluate("getComputedStyle(document.getElementById('sc-root')).getPropertyValue('--sc-bg').trim()")
            check(tag + ': worksheet background respected (' + ink + ')', ink.lower() == '#' + bg, ink)
            check(tag + ': no dialog or modal element in the page', page.evaluate("() => document.querySelectorAll('dialog, [role=dialog], [role=alertdialog]').length") == 0)
            if (w, h) == (900, 560) and SHOTS: shots['schools-' + theme] = page.screenshot()
            ctx.close()

    # ---- 2. morph smoothness, hover, selection, clearing
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=countries&bg=ffffff')
    # 217 circles: the morph started 276, 179 and 166 ms after the trigger in three measured runs (11/22/2026, CPU 28 to 34%); 600 ms is 2.2x the slowest
    d = morph_gate(page, '217-circle morph', {'pad': 9}, 600)
    check('217-circle morph: script cost per frame <= 4 ms on average', statistics.mean(d['cost']) <= 4, statistics.mean(d['cost']))
    settle(page)
    audit(page, 'after morph'); jitter(page, 'after morph')
    big = page.evaluate("""() => { const r = SC.app.state.renderer, rect = document.querySelector('.sc-svg').getBoundingClientRect();
      const n = r.nodes.slice().sort((a, b) => b.r - a.r)[1]; return { x: rect.left + n.x, y: rect.top + n.y - n.r * 0.6, name: n.name, cl: n.cl.idx, ncl: r.clusters.length }; }""")
    page.mouse.move(big['x'], big['y']); page.wait_for_timeout(450)
    hv = page.evaluate("""() => { const gs = [...document.querySelectorAll('.sc-cl')]; return { dim: document.querySelector('.sc-circles').classList.contains('sc-dimming'),
      on: gs.filter(g => g.classList.contains('sc-on')).map(g => +g.getAttribute('data-c')), ops: gs.map(g => [+g.getAttribute('data-c'), +getComputedStyle(g).opacity]),
      tip: (() => { const t = document.querySelector('.sc-tip'); return { shown: t.style.display !== 'none', text: t.textContent }; })() }; }""")
    check('hover: the hovered circle cluster is the only one lit', hv['dim'] and hv['on'] == [big['cl']], hv['on'])
    check('hover: every other cluster dims to 0.3 opacity (%d clusters)' % big['ncl'], all(abs(o - 0.3) < 0.02 for c, o in hv['ops'] if c != big['cl']) and abs([o for c, o in hv['ops'] if c == big['cl']][0] - 1) < 0.02, hv['ops'])
    count(big['ncl'])
    check('hover: tooltip names the item and its measure', hv['tip']['shown'] and 'Population' in hv['tip']['text'] and big['name'] in hv['tip']['text'], hv['tip'])
    check('hover pushes a hover tuple to Tableau', page.evaluate("() => SC_MOCK.calls.some(c => c.call === 'hover' && c.tuple > 0)"))
    audit(page, 'with tooltip')
    page.mouse.move(2, 2); page.wait_for_timeout(450)
    check('moving off the chart restores every cluster', page.evaluate("() => !document.querySelector('.sc-circles').classList.contains('sc-dimming')"))
    for k in range(12): page.mouse.move(120 + k * 55, 150 + (k % 4) * 60)
    jitter(page, 'after pointer sweep')
    page.evaluate("() => { SC_MOCK.calls.length = 0; }")
    page.mouse.click(big['x'], big['y']); page.wait_for_timeout(150)
    calls = page.evaluate("() => SC_MOCK.calls.filter(c => c.call === 'select')")
    check('clicking a circle selects by value on Country and Region', calls and [s['fieldName'] for s in calls[0]['sel']] == ['Country', 'Region'] and calls[0]['sel'][0]['value'][0] == big['name'], calls[:1])
    check('the clicked circle is marked selected and the rest recede', page.evaluate("() => document.querySelectorAll('.sc-c.sc-sel').length") == 1 and page.evaluate("() => document.querySelector('.sc-circles').classList.contains('sc-hassel')"))
    page.mouse.click(5, 300); page.wait_for_timeout(120)
    check('clicking empty space clears the selection in Tableau', page.evaluate("() => SC_MOCK.calls.some(c => c.call === 'clear')") and page.evaluate("() => document.querySelectorAll('.sc-c.sc-sel').length") == 0)
    cc = page.evaluate("""() => { const t = document.querySelector('.sc-cchip'), g = t.querySelector('rect').getBoundingClientRect();
      return { x: g.left + g.width / 2, y: g.top + g.height / 2, idx: +t.getAttribute('data-c'), name: SC.app.state.renderer.clusters[+t.getAttribute('data-c')].name }; }""")
    page.evaluate("() => { SC_MOCK.calls.length = 0; }")
    page.mouse.click(cc['x'], cc['y']); page.wait_for_timeout(150)
    calls = page.evaluate("() => SC_MOCK.calls.filter(c => c.call === 'select')")
    check('clicking a cluster chip selects the Region field only', calls and [s['fieldName'] for s in calls[0]['sel']] == ['Region'] and calls[0]['sel'][0]['value'][0] == cc['name'], calls[:1])
    check('every circle of that cluster is marked selected, and no other', page.evaluate("(i) => { const r = SC.app.state.renderer, mine = r.nodes.filter(n => n.cl.idx === i); return mine.length > 1 && mine.every(n => n.el.classList.contains('sc-sel')) && document.querySelectorAll('.sc-c.sc-sel').length === mine.length; }", cc['idx']))
    page.evaluate("() => { SC_MOCK.calls.length = 0; }")
    page.focus('.sc-svg'); page.keyboard.press('Escape'); page.wait_for_timeout(120)
    check('Escape clears the selection', page.evaluate("() => SC_MOCK.calls.some(c => c.call === 'clear') && document.querySelectorAll('.sc-c.sc-sel').length === 0"))
    audit(page, 'after selection'); jitter(page, 'after selection')
    check('interaction flow: 0 console errors', not errs, errs[:2])
    ctx.close()

    # ---- 3. settings panel
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=countries&bg=ffffff')
    dialogs = []; page.on('dialog', lambda d: (dialogs.append(d.type), d.dismiss()))
    page.click('.sc-gear'); page.wait_for_timeout(400)
    check('panel opens', page.evaluate("() => document.querySelector('.sc-panel').classList.contains('open')"))
    audit(page, 'panel open')
    r0 = page.evaluate("() => SC.app.state.renderer.nodes.map(n => n.r).reduce((a, b) => a + b, 0)")
    sel = 'input[aria-label="Gap between circles"]'
    page.fill(sel, '18'); page.press(sel, 'Enter'); page.dispatch_event(sel, 'change'); page.wait_for_timeout(1300)
    stored = page.evaluate("() => SC_MOCK.settings.getAll()")
    check('typed stepper value saved as a STRING under schools.pad', stored.get('schools.pad') == '18' and page.evaluate("() => SC_MOCK.settings.saves") >= 1, stored)
    r1 = page.evaluate("() => SC.app.state.renderer.nodes.map(n => n.r).reduce((a, b) => a + b, 0)")
    check('changing the gap re-laid the circles', abs(r0 - r1) > 0.01, (r0, r1))
    page.select_option('select[aria-label="Palette"]', 'sunset'); page.wait_for_timeout(300)
    check('palette dropdown applied and saved', page.evaluate("() => SC_MOCK.settings.get('schools.palette')") == 'sunset')
    page.click('button:has-text("Copy settings")'); page.wait_for_timeout(300)
    parsed = json.loads(page.evaluate("() => navigator.clipboard.readText()"))
    check('Copy settings puts valid JSON on the clipboard with typed values', parsed.get('pad') == 18 and parsed.get('palette') == 'sunset' and parsed.get('labels') is True, list(parsed)[:4])
    check('copied JSON covers every setting', len(parsed) == page.evaluate("() => Object.keys(SC.schema.DEFAULTS).length"), len(parsed))
    page.click('button:has-text("Paste settings")'); page.fill('.sc-pastebox textarea', '{"palette":"kelp","fontSize":"16","labels":"true"}'); page.click('.sc-pastebox button:has-text("Apply")'); page.wait_for_timeout(300)
    check('Paste settings applies JSON inline (no dialog)', page.evaluate("() => SC.app.state.settings.palette === 'kelp' && SC.app.state.settings.fontSize === 16") and not dialogs, dialogs)
    if page.evaluate("() => document.querySelector('.sc-pastebox').style.display === 'none'"): page.click('button:has-text("Paste settings")')
    page.fill('.sc-pastebox textarea', 'not json'); page.click('.sc-pastebox button:has-text("Apply")')
    check('invalid paste is refused with a message', 'not valid' in page.evaluate("() => document.querySelector('.sc-msg').textContent"))
    page.fill('.sc-search', 'palette'); page.wait_for_timeout(150)
    check('settings search filters the panel', 1 <= page.evaluate("() => document.querySelectorAll('.sc-row').length") <= 3)
    page.fill('.sc-search', '')
    page.click('.sc-btn:has-text("Reset all")'); check('reset needs a second press', page.evaluate("() => SC.app.state.settings.palette") == 'kelp'); page.click('.sc-btn:has-text("Press again")'); page.wait_for_timeout(300)
    check('reset restores defaults', page.evaluate("() => SC.app.state.settings.palette") == 'reef')
    check('no browser dialog appeared anywhere', not dialogs)
    check('settings flow: 0 console errors', not errs, errs[:2])
    page.evaluate("() => { SC_MOCK.settings.set('schools.pad','9'); SC_MOCK.settings.set('schools.fontSize','18'); SC_MOCK.settings.set('schools.labels','true'); SC_MOCK.settings.saveAsync(); }")
    page.goto(BASE + '/test/page.html?fixture=countries&bg=ffffff'); page.wait_for_selector('.sc-c'); page.wait_for_timeout(900)
    rs = page.evaluate("() => SC.app.state.settings")
    check('string settings survive a reload and come back typed', rs['pad'] == 9 and rs['fontSize'] == 18 and rs['labels'] is True, (rs['pad'], rs['fontSize']))
    ctx.close()

    # ---- 4. colour: by cluster (default), by the Colour shelf, one colour
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=countries&bg=ffffff')
    fills = page.evaluate("() => [new Set(SC.app.state.renderer.nodes.map(n => n.el.getAttribute('fill'))).size, SC.app.state.renderer.clusters.length, SC.colors.palette('reef').length]")
    check('colour by cluster: one colour per cluster (%d of %d)' % (fills[0], fills[1]), fills[0] == min(fills[1], fills[2]), fills)
    page.evaluate("() => { SC.app.state.settings = SC.schema.resolve({ colorMode: 'field' }); SC.app.redraw(); }"); settle(page, 500)
    fills = page.evaluate("() => new Set(SC.app.state.renderer.nodes.map(n => n.el.getAttribute('fill'))).size")
    check('colour shelf (Income group): 4 colours', fills == 4, fills)
    keys = page.evaluate("() => document.querySelectorAll('.sc-key').length")
    check('colour shelf shows a legend with the 4 groups', keys == 4, keys)
    audit(page, 'colour shelf'); jitter(page, 'colour shelf')
    page.evaluate("() => { SC.app.state.settings = SC.schema.resolve({ colorMode: 'single', singleColor: '#e0457b' }); SC.app.redraw(); }"); settle(page, 500)
    fills = page.evaluate("() => [...new Set(SC.app.state.renderer.nodes.map(n => n.el.getAttribute('fill')))]")
    check('one-colour mode paints every circle the chosen colour', fills == ['#e0457b'], fills)
    check('colour flow: 0 console errors', not errs, errs[:2]); ctx.close()

    # ---- 5. fixtures that break things
    for key in ['nocolor', 'lifeexp', 'one', 'single', 'bad', 'long', 'noenc', 'empty']:
        for (w, h) in [(300, 300), (900, 560)]:
            if key == 'empty':
                ctx = browser.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page(); errs = []
                page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); page.on('pageerror', lambda e: errs.append(str(e)))
                page.goto(BASE + '/test/page.html?fresh=1&fixture=empty'); page.wait_for_selector('.sc-empty', state='visible', timeout=5000)
                check('empty data shows a message, not a blank', 'Drop a dimension' in page.inner_text('.sc-empty'))
                check('empty %dx%d: no circles drawn' % (w, h), page.evaluate("() => document.querySelectorAll('.sc-c').length") == 0)
            else:
                ctx, page, errs = open_page(browser, w, h, 'fixture=%s&bg=ffffff' % key)
                audit(page, 'fixture %s %dx%d' % (key, w, h))
                jitter(page, 'fixture %s %dx%d' % (key, w, h), 10)
            check('fixture %s %dx%d: 0 console errors' % (key, w, h), not errs, errs[:2]); ctx.close()
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=bad&bg=ffffff')
    legend = page.inner_text('.sc-legend')
    check('bad data: 2 invalid rows reported', '2 rows skipped' in legend, legend)
    names = page.evaluate("() => SC.app.state.renderer.nodes.map(n => n.name + '/' + n.cl.name + '/' + n.value)")
    check('bad data: blanks become (blank), duplicates merge, 7 circles remain', len(names) == 7 and any(n.startswith('(blank)/g2') for n in names) and any(n.startswith('no cluster/(blank)') for n in names) and 'dup/g2/20' in names, names)
    ctx.close()

    # ---- 6. stress: 1,200 and 2,000 circles
    ctx, page, errs = open_page(browser, 1600, 1000, 'fixture=big&bg=ffffff')
    t = page.evaluate("""() => new Promise((res) => { const r = SC.app.state.renderer; r.key = ''; const t0 = performance.now(); SC.app.redraw();
      const f = () => { if (!r.job) res(performance.now() - t0); else requestAnimationFrame(f); }; requestAnimationFrame(f); })""")
    print('  stress: 1,200 circles full re-layout to a committed picture %.0f ms (computed in slices, the page stays live)' % t)
    # a full 1,200-circle re-layout committed in 2,141 ms measured (11/22/2026, CPU 33.5%); 4,500 ms is 2.1x that
    check('1,200 circles re-lay-out and draw in under 4,500 ms (%.0f ms)' % t, t < 4500, t)
    settle(page, 500)
    audit(page, 'stress 1200'); jitter(page, 'stress 1200', 20)
    # the stress morph started 1,311, 1,349 and 1,804 ms after the trigger in three measured runs (11/22/2026, CPU 28 to 34%); 4,000 ms is 2.2x the slowest
    d = morph_gate(page, '1,200-circle stress morph', {'pad': 6}, 4000)
    check('stress morph: script cost per frame <= 6 ms', statistics.mean(d['cost']) <= 6, statistics.mean(d['cost']))
    check('stress: 0 console errors', not errs, errs[:2]); ctx.close()
    ctx, page, errs = open_page(browser, 1600, 1000, 'fixture=huge&bg=ffffff')
    check('2,000 circles skip per-circle animation and still draw', page.evaluate("() => SC.app.state.renderer.nodes.length") == 2000)
    audit(page, 'stress 2000'); jitter(page, 'stress 2000', 10)
    check('stress 2000: 0 console errors', not errs, errs[:2]); ctx.close()

    # ---- 7. event burst, in-flight resize, reduced motion
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=countries&bg=ffffff')
    page.evaluate("() => { for (let i = 0; i < 6; i++) SC_MOCK.sheet.emit('summary-data-changed'); }"); page.wait_for_timeout(1300)
    check('event burst: no reader error (one reader at a time) and still drawn', not errs and page.evaluate("() => document.querySelectorAll('.sc-c').length") > 100, errs[:2])
    page.set_viewport_size({'width': 420, 'height': 640}); page.wait_for_timeout(500); settle(page, 600)
    audit(page, 'resized to 420x640'); jitter(page, 'resized to 420x640')
    page.set_viewport_size({'width': 1280, 'height': 700}); page.wait_for_timeout(500); settle(page, 600)
    audit(page, 'resized to 1280x700'); jitter(page, 'resized to 1280x700')
    ctx.close()
    ctx = browser.new_context(viewport={'width': 900, 'height': 560}, reduced_motion='reduce'); page = ctx.new_page()
    page.goto(BASE + '/test/page.html?fresh=1&fixture=countries&bg=ffffff'); page.wait_for_selector('.sc-c')
    check('reduced motion: the first draw is final (no morph running)', page.evaluate("() => !document.querySelector('#sc-chart').classList.contains('sc-moving') && SC.app.state.renderer.anim === null"))
    jitter(page, 'reduced motion first draw')
    ctx.close()

    # ---- 8. preview shots
    if SHOTS:
        ctx, page, errs = open_page(browser, 1280, 800, 'fixture=countries&bg=0d2b45', 'dark')
        shots['schools-dark-1280'] = page.screenshot(); ctx.close()
        ctx, page, errs = open_page(browser, 1280, 800, 'fixture=countries&bg=ffffff', 'light')
        shots['schools-light-1280'] = page.screenshot()
        pt = page.evaluate("() => { const r = SC.app.state.renderer, rect = document.querySelector('.sc-svg').getBoundingClientRect(); const n = r.nodes.slice().sort((a, b) => b.r - a.r)[3]; return { x: rect.left + n.x, y: rect.top + n.y - n.r * 0.55 }; }")
        page.mouse.move(pt['x'], pt['y']); page.wait_for_timeout(600); shots['schools-hover-1280'] = page.screenshot(); ctx.close()
        ctx, page, errs = open_page(browser, 1280, 790, 'fixture=countries&bg=0d2b45', 'dark')
        page.evaluate("() => { SC.app.state.settings = SC.schema.resolve({ colorMode: 'field' }); SC.app.redraw(); }"); settle(page, 600)
        shots['thumb'] = page.screenshot(); ctx.close()
    browser.close()

if SHOTS:
    from PIL import Image
    out = ROOT / 'preview'; out.mkdir(exist_ok=True)
    for k in ('schools-light-1280', 'schools-dark-1280', 'schools-hover-1280'):
        (out / (k.replace('-1280', '') + '.png')).write_bytes(shots[k])
    Image.open(io.BytesIO(shots['thumb'])).convert('RGB').save(out / 'thumbnail.jpg', 'JPEG', quality=88, optimize=True)
    print('wrote previews to', out)

srv.shutdown()
print('Schools render gate: %d subjects examined, %d checks failed' % (subjects, len(fails)))
for f in fails: print(' FAIL', f)
if subjects < MIN_SUBJECTS:
    print('RED: fewer subjects than the declared minimum (%d), so this run proves nothing' % MIN_SUBJECTS); sys.exit(2)
sys.exit(1 if fails else 0)
