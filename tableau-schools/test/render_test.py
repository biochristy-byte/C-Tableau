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

CHIP_GAP_MAX = 8
CHIP_GAP = """() => {
  const st = document.querySelector('.sc-stage').getBoundingClientRect(), out = [];
  SC.app.state.renderer.clusters.forEach(c => {
    const g = document.querySelector('.sc-cchip[data-k="c' + c.idx + '"]'); if (!g || g.style.display === 'none') return;
    const b = g.querySelector('rect').getBoundingClientRect(), L = b.left - st.left, T = b.top - st.top, R = L + b.width, B = T + b.height;
    let best = Infinity;
    c.nodes.forEach(n => { const dx = Math.max(L - n.x, 0, n.x - R), dy = Math.max(T - n.y, 0, n.y - B); best = Math.min(best, Math.hypot(dx, dy) - n.r); });
    out.push([String(c.name), Math.round(best * 10) / 10]);
  });
  return out; }"""

CHIP_ON_OTHER = """() => {
  const st = document.querySelector('.sc-stage').getBoundingClientRect(), r = SC.app.state.renderer, out = [];
  r.clusters.forEach(c => {
    const g = document.querySelector('.sc-cchip[data-k="c' + c.idx + '"]'); if (!g || g.style.display === 'none') return;
    const b = g.querySelector('rect').getBoundingClientRect(), L = b.left - st.left, T = b.top - st.top, R = L + b.width, B = T + b.height;
    r.nodes.forEach(n => { if (n.cl === c) return; const dx = Math.max(L - n.x, 0, n.x - R), dy = Math.max(T - n.y, 0, n.y - B);
      if (Math.hypot(dx, dy) < n.r - 0.5) out.push(String(c.name) + ' label on ' + n.name); });
  });
  return out; }"""

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
    # a cluster label sits WITH its cluster: the gap from the chip to the nearest circle of its own cluster. Placed off the
    # bounding circle, a lopsided cluster (South Asia, India dominant) put its label 58.7 px from its circles at 1280x800.
    gaps = page.evaluate(CHIP_GAP)
    far = [g for g in gaps if g[1] > CHIP_GAP_MAX]
    check(tag + ': every one of %d cluster labels within %d px of its own circles (worst %.1f px)' % (len(gaps), CHIP_GAP_MAX, max([g[1] for g in gaps] or [0])), not far, far[:3])
    count(len(gaps))
    wrong = page.evaluate(CHIP_ON_OTHER)
    check(tag + ': no cluster label covers a circle of another cluster', not wrong, wrong[:3])
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

MORPH = """(arg) => new Promise((done) => {
  // arg.s: the settings that trigger the morph. arg.giveUp: if no morph has started this many ms after the trigger, the probe stops
  // waiting and reports it (a gate must fail fast, not hang: page.evaluate itself never times out).
  const o = arg.s;
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
      if ((started === null || ended === null) && performance.now() - m > arg.giveUp) {
        if (obs) obs.disconnect();
        done({ gaveUp: true, startMs: started === null ? -1 : started - m, waitedMs: performance.now() - m });
        return;
      }
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
  setTimeout(() => { m = performance.now(); { const st = SC.app.state.store; st.reset(); st.setMany(o); } }, 120);
})"""

def morph_gate(page, tag, settings, start_limit):
    """One re-layout morph, measured from its trigger to its end. Every check covers the whole window, first frame included."""
    give_up = max(8000, 5 * start_limit)   # the start check below still holds the morph to start_limit; this only bounds the wait
    d = page.evaluate(MORPH, {'s': settings, 'giveUp': give_up})
    if d.get('gaveUp'):
        what = 'never started' if d['startMs'] < 0 else 'started at %.0f ms but never ended' % d['startMs']
        check(tag + ': a setting change starts and finishes a morph (it %s within %.0f ms of the trigger)' % (what, d['waitedMs']), False)
        print('Schools render gate: STOPPED EARLY at "%s", %d subjects examined, %d checks failed' % (tag, subjects, len(fails)))
        for f in fails: print(' FAIL', f)
        sys.exit(1)
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
            check(tag + ': no dialog or modal element in the page', page.evaluate("() => Array.from(document.querySelectorAll('dialog, [role=dialog], [role=alertdialog]')).filter(e => !e.closest('.cp-panel') && !e.classList.contains('cp-panel')).length") == 0)
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

    # ---- 3. the shared settings panel (ctab-panel): gear, drag clamped to the frame, minimize, close, Escape, copy and paste, live re-render
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=countries&bg=ffffff')
    dialogs = []; page.on('dialog', lambda d: (dialogs.append(d.type), d.dismiss()))
    RECT = "(sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }"
    def inside(r, f, tol=1.5): return r['l'] >= f['l'] - tol and r['t'] >= f['t'] - tol and r['r'] <= f['r'] + tol and r['b'] <= f['b'] + tol
    def head_point(): r = page.evaluate(RECT, '.cp-head'); return r['l'] + 40, r['t'] + r['h'] / 2
    check('the panel starts closed and the gear is on screen', page.evaluate("() => document.querySelector('.cp-panel').hidden") and page.is_visible('.cp-gear'))
    page.click('.cp-gear'); page.wait_for_selector('.cp-panel:not([hidden])', timeout=5000)
    check('the gear opens the floating panel', page.is_visible('.cp-panel') and page.evaluate("() => !document.querySelector('.cp-panel').hidden"))
    tabs = page.evaluate("() => [...document.querySelectorAll('.cp-tab')].map(t => t.textContent)")
    check('15 tabs plus Panel: Colors, Cluster layout, Collisions, Size scale, Circles, Labels, Cluster labels, Legend, Number format, Tooltip, Fonts, Background, Animation, Interaction, Fields', len(tabs) == 16 and tabs[:2] == ['Colors', 'Cluster layout'] and 'Fields' in tabs and tabs[-1] == 'Panel', tabs)
    nset = page.evaluate("() => SC.app.state.store.rows.filter(r => r.type !== 'note').length")
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
    f = page.evaluate(RECT, '#sc-root')
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
    page.click(".cp-tab[data-t='collision']")
    r0 = page.evaluate("() => SC.app.state.renderer.nodes.map(n => n.r).reduce((a, b) => a + b, 0)")
    page.fill('input[data-k=pad]', '18'); page.press('input[data-k=pad]', 'Enter'); page.wait_for_timeout(1500)
    check('typing the gap between circles re-lays the circles live', abs(r0 - page.evaluate("() => SC.app.state.renderer.nodes.map(n => n.r).reduce((a, b) => a + b, 0)")) > 0.01)
    check('the typed value is saved as the STRING "18" under schools.pad', page.evaluate("() => SC_MOCK.settings.get('schools.pad')") == '18' and page.evaluate("() => SC_MOCK.settings.saves") >= 1)
    page.click(".cp-tab[data-t='colors']"); page.select_option('select[data-k=palette]', 'sunset'); page.wait_for_timeout(300)
    check('the palette select re-colours and saves schools.palette', page.evaluate("() => SC_MOCK.settings.get('schools.palette')") == 'sunset' and page.evaluate("() => SC.colors.palette('sunset').indexOf(SC.app.state.renderer.nodes[0].el.getAttribute('fill')) > -1"))
    # copy and paste round trip
    page.click('[data-a=copy]')
    page.wait_for_function("() => document.querySelector('.cp-status').textContent.indexOf('Copied') === 0", timeout=5000)
    copied = json.loads(page.evaluate("() => SC.app.state.panel.lastCopied"))
    check('Copy settings makes flat JSON with every setting (%d keys)' % len(copied), len(copied) == nset and copied['pad'] == 18 and copied['palette'] == 'sunset', len(copied))
    page.select_option('select[data-k=palette]', 'kelp'); page.click(".cp-tab[data-t='collision']"); page.fill('input[data-k=pad]', '3'); page.press('input[data-k=pad]', 'Enter'); page.wait_for_timeout(1200)
    check('the settings really changed before the paste', page.evaluate("() => SC.app.state.store.get().palette") == 'kelp' and page.evaluate("() => SC.app.state.store.get().pad") == 3)
    page.click('[data-a=paste]'); page.wait_for_selector('textarea[data-f=paste]')
    page.fill('textarea[data-f=paste]', '{this is not json'); page.click('[data-a=pasteapply]')
    check('bad JSON shows an inline message, not a dialog, and changes nothing', 'not valid' in page.inner_text('.cp-msg[role=alert]') and not dialogs and page.evaluate("() => SC.app.state.store.get().pad") == 3)
    page.fill('textarea[data-f=paste]', json.dumps(copied)); page.click('[data-a=pasteapply]'); page.wait_for_timeout(1200)
    back = page.evaluate("() => SC.app.state.store.snapshot()")
    check('pasting the copied JSON restores every setting (round trip over %d keys)' % len(copied), back == copied, [k for k in copied if back.get(k) != copied[k]][:4])
    check('the paste re-rendered the chart (sunset palette, pad 18)', page.evaluate("() => SC.app.state.store.get().palette") == 'sunset' and abs(r0 - page.evaluate("() => SC.app.state.renderer.nodes.map(n => n.r).reduce((a, b) => a + b, 0)")) > 0.01)
    page.fill('.cp-q', 'palette'); page.wait_for_timeout(200)
    check('search filters rows across tabs', page.evaluate("() => document.querySelectorAll('.cp-row').length") <= 4)
    page.fill('.cp-q', '')
    page.click('[data-a=resetall]'); page.click('[data-a=confirmyes]'); page.wait_for_timeout(1200)
    check('Reset all (inline confirm) restores the defaults', page.evaluate("() => SC.app.state.store.get().palette") == 'reef' and page.evaluate("() => SC.app.state.store.get().pad") == 3)
    # close, Escape, focus return
    page.click('[data-a=close]')
    check('the close button hides the panel and focus returns to the gear', page.evaluate("() => document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    page.click('.cp-gear'); page.wait_for_selector('.cp-panel:not([hidden])'); page.keyboard.press('Escape')
    check('Escape closes the panel and focus returns to the gear', page.evaluate("() => document.querySelector('.cp-panel').hidden && document.activeElement === document.querySelector('.cp-gear')"))
    check('no browser dialog appeared anywhere', not dialogs, dialogs)
    check('panel session: 0 console errors', not errs, errs[:2])
    page.evaluate("() => { SC_MOCK.settings.set('schools.pad','9'); SC_MOCK.settings.set('schools.fontSize','18'); SC_MOCK.settings.set('schools.labels','true'); SC_MOCK.settings.saveAsync(); }")
    ls = page.evaluate("() => localStorage.getItem('sc-mock-settings')")
    page.goto(BASE + '/test/page.html?fixture=countries&bg=ffffff'); page.wait_for_selector('.sc-c'); page.wait_for_timeout(900)
    rs = page.evaluate("() => SC.app.state.store.get()")
    check('string settings survive a reload and come back typed', rs['pad'] == 9 and rs['fontSize'] == 18 and rs['labels'] is True, (rs['pad'], rs['fontSize'], ls[:60]))
    ctx.close()

    # ---- 3b. the panel at 390 wide is a full-frame sheet, and every control stays inside it
    ctx, page, errs = open_page(browser, 390, 700, 'fixture=countries&bg=ffffff')
    page.click('.cp-gear'); page.wait_for_selector('.cp-panel:not([hidden])'); page.wait_for_timeout(300)
    sh = page.evaluate(RECT, '.cp-panel'); fr = page.evaluate(RECT, '#sc-root')
    check('at 390 wide the panel is a full-frame sheet', sh['w'] >= fr['w'] - 2 and inside(sh, fr), (sh, fr))
    check('the sheet has no horizontal scroll', not page.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.cp-panel').scrollWidth > document.querySelector('.cp-panel').clientWidth + 1"))
    check('390 wide: 0 console errors', not errs, errs[:2]); ctx.close()

    # ---- 4. colour: by cluster (default), by the Colour shelf, one colour
    ctx, page, errs = open_page(browser, 900, 560, 'fixture=countries&bg=ffffff')
    fills = page.evaluate("() => [new Set(SC.app.state.renderer.nodes.map(n => n.el.getAttribute('fill'))).size, SC.app.state.renderer.clusters.length, SC.colors.palette('reef').length]")
    check('colour by cluster: one colour per cluster (%d of %d)' % (fills[0], fills[1]), fills[0] == min(fills[1], fills[2]), fills)
    page.evaluate("() => { { const st = SC.app.state.store; st.reset(); st.setMany({ colorMode: 'field' }); } }"); settle(page, 500)
    fills = page.evaluate("() => new Set(SC.app.state.renderer.nodes.map(n => n.el.getAttribute('fill'))).size")
    check('colour shelf (Income group): 4 colours', fills == 4, fills)
    keys = page.evaluate("() => document.querySelectorAll('.sc-key').length")
    check('colour shelf shows a legend with the 4 groups', keys == 4, keys)
    audit(page, 'colour shelf'); jitter(page, 'colour shelf')
    page.evaluate("() => { { const st = SC.app.state.store; st.reset(); st.setMany({ colorMode: 'single', singleColor: '#e0457b' }); } }"); settle(page, 500)
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
        page.evaluate("() => { { const st = SC.app.state.store; st.reset(); st.setMany({ colorMode: 'field' }); } }"); settle(page, 600)
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
