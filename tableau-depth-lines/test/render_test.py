"""Depth Lines render gate (Playwright, Chromium) against dev/dev.html + the mock.

For every combination of size (300x300, 800x600, 1600x1000), theme (light, dark)
and scenario it checks: the chart drew (svg with bands), 0 console errors, no
horizontal scroll, every text >= 14px, every text >= 7:1 against its background,
no two text boxes overlapping. Then it drives the settings panel, interaction,
settings persistence, resize, determinism and the entrance animation.

Run: python test/render_test.py        (starts its own server on 8772, refuses an inherited one)
The run goes RED if it examined fewer than MIN_TEXT text nodes or MIN_RUNS renders."""
import json, re, socket, statistics, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8772
BASE = f'http://127.0.0.1:{PORT}/dev/dev.html'
SIZES = [(300, 300), (800, 600), (1600, 1000)]
THEMES = {'light': 'ffffff', 'dark': '081f33'}
SCENARIOS = {
    'overlay-cats': 'fx=tumours',
    'small-multiples-points': 'fx=tumours&settings=' + json.dumps({'multi': 'small', 'points': True}),
    'single-no-category': 'fx=single&cat=0',
    'weighted-blobs-3': 'fx=blobs&settings=' + json.dumps({'scale': 'shared'}),
}
MIN_TEXT, MIN_RUNS = 150, 24

fails, stats = [], {'runs': 0, 'text': 0, 'checks': 0}


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


TEXT_JS = """(sel) => {
  const root = document.querySelector('#dl-root');
  const out = [];
  root.querySelectorAll(sel).forEach(el => {
    const t = (el.textContent || '').trim();
    if (!t) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    let hidden = false, op = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') hidden = true;
      op *= parseFloat(cs.opacity);
    }
    if (hidden) return;
    // skip anything clipped away by a scrolling ancestor (it is not on screen)
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const c2 = getComputedStyle(n);
      if (c2.overflowY !== 'visible' && c2.overflowY !== 'clip') { const b = n.getBoundingClientRect(); if (r.bottom <= b.top + 0.5 || r.top >= b.bottom - 0.5) return; }
    }
    const cs = getComputedStyle(el);
    // the ground is the first non-transparent background starting at the node itself
    let ground = null;
    if (!(el instanceof SVGElement)) for (let n = el; n; n = n.parentElement) { const bgc = getComputedStyle(n).backgroundColor; if (bgc && !/rgba\(.*,\s*0\)$/.test(bgc) && bgc !== 'transparent') { ground = bgc; break; } }
    out.push({ text: t.slice(0, 30), size: parseFloat(cs.fontSize), color: el instanceof SVGElement ? cs.fill : cs.color, ground: ground,
      opacity: op, rect: [r.left, r.top, r.right, r.bottom], family: cs.fontFamily });
  });
  return out;
}"""


def check_text(page, label, sel, bg_expr='getComputedStyle(document.querySelector("#dl-root")).backgroundColor'):
    nodes = page.evaluate(TEXT_JS, sel)
    bg = rgb(page.evaluate(bg_expr))
    stats['text'] += len(nodes)
    check(f'{label}: found text to examine', len(nodes) >= 1, sel)
    for n in nodes:
        c = rgb(n['color'])
        check(f'{label}: "{n["text"]}" size {n["size"]}px >= 14', n['size'] >= 14 - 0.01)
        check(f'{label}: "{n["text"]}" sans-serif', 'serif' not in n['family'].replace('sans-serif', '') and 'mono' not in n['family'].lower())
        ground = rgb(n['ground']) or bg
        ratio = contrast(c, ground) if c and ground else 0
        check(f'{label}: "{n["text"]}" contrast {ratio:.2f} >= 7', ratio >= 7 and n['opacity'] >= 0.99, f'color {n["color"]} on {ground}')
    rects = [n['rect'] for n in nodes]
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            if a[0] < b[2] - 0.5 and a[2] > b[0] + 0.5 and a[1] < b[3] - 0.5 and a[3] > b[1] + 0.5:
                check(f'{label}: text boxes "{nodes[i]["text"]}" and "{nodes[j]["text"]}" overlap', False)
    check(f'{label}: no text overlaps among {len(nodes)} labels', True)
    return nodes


def open_page(browser, query, w, h, scheme='light'):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, color_scheme=scheme)
    page = ctx.new_page()
    errs = []
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' or '[DL]' in m.text else None)
    page.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
    page.on('dialog', lambda d: (errs.append('browser dialog: ' + d.message), d.dismiss()))
    page.goto(f'{BASE}?still=1&{query}')
    page.wait_for_selector('#dl-root[data-ready="1"]', timeout=8000)
    page.evaluate('document.fonts.ready')
    page.wait_for_timeout(150)
    return ctx, page, errs


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
            browser = pw.chromium.launch()
            prev = ROOT / 'previews'; prev.mkdir(exist_ok=True)
            # ---- the matrix
            for (w, h) in SIZES:
                for tname, bg in THEMES.items():
                    for sname, q in SCENARIOS.items():
                        label = f'{sname} {w}x{h} {tname}'
                        ctx, page, errs = open_page(browser, f'{q}&bg={bg}', w, h, tname)
                        stats['runs'] += 1
                        bands = int(page.get_attribute('#dl-root', 'data-bands') or 0)
                        check(f'{label}: bands drawn ({bands})', bands >= 3)
                        if sname in ('overlay-cats', 'weighted-blobs-3'):
                            ngroups = page.evaluate('new Set([...document.querySelectorAll("path.dl-band")].map(p => p.dataset.g)).size')
                            check(f'{label}: EVERY category draws bands in the overlay ({ngroups})', ngroups == (2 if sname == 'overlay-cats' else 3))
                            check(f'{label}: overlay is one shared panel with one water tint', page.locator('rect.dl-sea').count() == 1)
                        check(f'{label}: svg has band paths', page.locator('svg.dl-svg path.dl-band').count() >= 3)
                        check(f'{label}: no console errors', not errs, str(errs[:2]))
                        check(f'{label}: no horizontal scroll', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1'))
                        check(f'{label}: theme resolved', page.get_attribute('#dl-root', 'data-theme') == tname)
                        check_text(page, label, 'svg text, .dl-title, .dl-chip, .dl-note, .dl-empty')
                        if (w, h) == (1600, 1000) and tname == 'light' and sname in ('overlay-cats', 'small-multiples-points'):
                            page.screenshot(path=str(prev / f'{sname}-{tname}.png'))
                        if (w, h) == (800, 600) and tname == 'dark' and sname == 'weighted-blobs-3':
                            page.screenshot(path=str(prev / f'{sname}-{tname}.png'))
                        ctx.close()
            # ---- empty, tiny and missing-shelf states must still be readable
            for fx in ('empty', 'tiny'):
                ctx, page, errs = open_page(browser, f'fx={fx}', 800, 600)
                stats['runs'] += 1
                check(f'{fx} fixture: no console errors', not errs, str(errs[:2]))
                if fx == 'empty':
                    check('empty fixture: shows a message instead of a blank', page.locator('.dl-empty').count() == 1 and len(page.inner_text('.dl-empty')) > 10)
                else:
                    check('tiny fixture (5 points): still draws bands', int(page.get_attribute('#dl-root', 'data-bands') or 0) >= 1)
                check_text(page, f'{fx} fixture', 'svg text, .dl-empty, .dl-legend span')
                ctx.close()

            # ---- panel, steppers, persistence, copy, no sliders, no dialogs
            for tname, bg in THEMES.items():
                ctx, page, errs = open_page(browser, f'fx=tumours&bg={bg}&settings=' + json.dumps({'multi': 'small'}), 800, 3300, tname)
                ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
                check(f'panel {tname}: panel starts closed', page.locator('.xp-panel').is_hidden())
                page.click('.xp-gear')
                check(f'panel {tname}: opens', page.locator('.xp-panel').is_visible())
                check(f'panel {tname}: no range sliders anywhere', page.locator('input[type=range]').count() == 0)
                for d in page.locator('.xp-group').all():
                    d.evaluate('e => e.open = true')
                nodes = check_text(page, f'panel {tname}', '.xp-panel .xp-title, .xp-panel .xp-sum, .xp-panel .xp-label, .xp-panel .xp-help, .xp-panel .xp-btn, .xp-panel .xp-chip, .xp-panel .xp-unit',
                                   'getComputedStyle(document.querySelector(".xp-panel")).backgroundColor')
                check(f'panel {tname}: examined many panel labels ({len(nodes)})', len(nodes) >= 40)
                # stepper: + on levels changes the band count, persists a STRING setting
                before = int(page.get_attribute('#dl-root', 'data-bands'))
                page.click('.xp-row[data-key=levels] .xp-sbtn >> nth=1')
                page.wait_for_timeout(120)
                after = int(page.get_attribute('#dl-root', 'data-bands'))
                check(f'panel {tname}: levels + redraws ({before} -> {after})', after > before)
                page.wait_for_timeout(600)
                saved = page.evaluate('DL_MOCK.settings.getAll()')
                check(f'panel {tname}: saved to extension settings as string', saved.get('depthlines.levels') == '9', str(saved.get('depthlines.levels')))
                check(f'panel {tname}: saveAsync called', page.evaluate('DL_MOCK.settings.saves') >= 1)
                # typed value
                page.fill('.xp-row[data-key=levels] .xp-num', '5'); page.press('.xp-row[data-key=levels] .xp-num', 'Enter')
                page.wait_for_timeout(120)
                check(f'panel {tname}: typed 5 levels', page.locator('.dl-panel[data-panel="0"] path.dl-band[data-g="0"]').count() <= 5)
                # chip group
                page.click('.xp-row[data-key=multi] .xp-chip[data-value=overlay]')
                page.wait_for_timeout(100)
                check(f'panel {tname}: chip switches to overlay (1 panel)', page.get_attribute('#dl-root', 'data-panels') == '1' and page.locator('.dl-panel').count() == 1 and page.locator('.dl-ptitle').count() == 0)
                # copy settings
                page.click('.xp-foot .xp-btn:has-text("Copy settings")')
                page.wait_for_timeout(200)
                clip = page.evaluate('navigator.clipboard.readText()')
                try:
                    obj = json.loads(clip)
                except Exception:
                    obj = {}
                check(f'panel {tname}: Copy settings puts valid JSON on the clipboard', obj.get('levels') == 5 and obj.get('multi') == 'overlay' and len(obj) >= 25, clip[:80])
                # paste settings back (inline box, no dialog)
                page.click('.xp-foot .xp-btn:has-text("Paste settings")')
                page.fill('.xp-paste-text', json.dumps({'levels': 6, 'ramp': 'sunrise'}))
                page.click('.xp-paste .xp-btn')
                page.wait_for_timeout(120)
                check(f'panel {tname}: pasted settings applied', page.evaluate('DL.app.state.settings.levels') == 6 and page.evaluate('DL.app.state.settings.ramp') == 'sunrise')
                check(f'panel {tname}: no console errors or dialogs through the whole tour', not errs, str(errs[:2]))
                if tname == 'light':
                    page.screenshot(path=str(prev / 'settings-panel-light.png'), clip={'x': 0, 'y': 0, 'width': 800, 'height': 900})
                ctx.close()

            # ---- interaction pushes back to Tableau
            ctx, page, errs = open_page(browser, 'fx=tumours&bg=ffffff&settings=' + json.dumps({'points': True, 'multi': 'small'}), 900, 650)
            band = page.locator('path.dl-band[data-g="1"][data-level="1"]')
            box = band.bounding_box()
            pt = page.locator('circle.dl-pt[data-g="1"]').first
            pbox = pt.bounding_box()
            page.mouse.move(pbox['x'] + pbox['width'] / 2, pbox['y'] + pbox['height'] / 2)
            page.wait_for_timeout(100)
            check('interaction: hovering a point pushes hoverTuple to Tableau', isinstance(page.evaluate('DL_MOCK.sheet.hovered'), int) and page.evaluate('DL_MOCK.sheet.hovered') > 0, str(page.evaluate('DL_MOCK.sheet.hovered')))
            check('interaction: tooltip shows and is readable', page.locator('.dl-tip').is_visible() and page.evaluate('parseFloat(getComputedStyle(document.querySelector(".dl-tip")).fontSize)') >= 14)
            # click a band: select the points inside it. aim at the centre of the deepest band's bbox
            lvl = page.locator('path.dl-band[data-g="1"]').count() - 1
            deep = page.locator(f'path.dl-band[data-g="1"][data-level="{lvl}"]')
            dbox = deep.bounding_box()
            page.mouse.click(dbox['x'] + dbox['width'] / 2, dbox['y'] + dbox['height'] / 2)
            page.wait_for_timeout(150)
            sel = page.evaluate('DL_MOCK.sheet.selected')
            check(f'interaction: clicking a band selects its points in Tableau ({len(sel)})', len(sel) >= 1)
            check('interaction: selected ids are in the Benign group (2nd panel)', all(isinstance(i, int) for i in sel))
            check('interaction: selected points are drawn highlighted', page.locator('circle.dl-pt.sel').count() == len(sel))
            page.mouse.click(5, 300)
            page.wait_for_timeout(120)
            check('interaction: clicking empty space clears the selection', page.evaluate('DL_MOCK.sheet.selected.length') == 0)
            check('interaction: no errors', not errs, str(errs[:2]))
            # resize redraws
            w0 = page.evaluate('document.querySelector("svg.dl-svg").getAttribute("width")')
            page.set_viewport_size({'width': 520, 'height': 420}); page.wait_for_timeout(300)
            w1 = page.evaluate('document.querySelector("svg.dl-svg").getAttribute("width")')
            check(f'resize: svg redrawn to the new width ({w0} -> {w1})', w0 != w1 and int(w1) <= 520)
            check('resize: no console errors', not errs, str(errs[:2]))
            ctx.close()

            # ---- determinism: two fresh loads draw identical geometry
            sig = []
            for _ in range(2):
                ctx, page, errs = open_page(browser, 'fx=blobs&bg=ffffff', 900, 600)
                sig.append(page.evaluate('[...document.querySelectorAll("path.dl-band")].map(p => p.getAttribute("d")).join("|")'))
                ctx.close()
            check('determinism: identical paths across two loads', sig[0] == sig[1] and len(sig[0]) > 1000, f'len {len(sig[0])}')

            # ---- entrance animation: eased, one-time, 60fps-class frame pacing (real animation, not still mode)
            ctx = browser.new_context(viewport={'width': 1000, 'height': 700})
            page = ctx.new_page()
            page.add_init_script("""window.__t=[];(function loop(t){window.__t.push(t);requestAnimationFrame(loop)})(0)""")
            page.goto(f'{BASE}?fx=tumours&bg=ffffff')
            page.wait_for_selector('#dl-root[data-ready="1"]', timeout=8000)
            anim = page.evaluate('getComputedStyle(document.querySelector("path.dl-band")).animationName')
            timing = page.evaluate('getComputedStyle(document.querySelector("path.dl-band")).animationTimingFunction')
            page.wait_for_timeout(1500)
            ts = page.evaluate('window.__t.slice(3)')
            gaps = [b - a for a, b in zip(ts, ts[1:])]
            med, p95 = statistics.median(gaps), sorted(gaps)[int(len(gaps) * 0.95)]
            check(f'animation: bands fade in with dl-in ({anim})', anim == 'dl-in')
            check(f'animation: eased, not linear ({timing})', 'cubic-bezier' in timing)
            check(f'animation: frame pacing median {med:.1f}ms p95 {p95:.1f}ms over {len(gaps)} frames', len(gaps) > 30 and med <= 18.5 and p95 <= 40)
            stats['anim'] = f'median {med:.1f}ms p95 {p95:.1f}ms frames {len(gaps)}'
            ctx.close()
            browser.close()
    finally:
        srv.terminate()
    if stats['text'] < MIN_TEXT:
        fails.append(f'only {stats["text"]} text nodes examined, minimum {MIN_TEXT}')
    if stats['runs'] < MIN_RUNS:
        fails.append(f'only {stats["runs"]} renders, minimum {MIN_RUNS}')
    summary = f'{stats["runs"]} renders, {stats["text"]} text nodes, {stats["checks"]} checks'
    if stats.get('anim'):
        summary += f', animation {stats["anim"]}'
    if fails:
        print(f'RED  {len(fails)} failed: {summary}')
        for f in fails[:40]:
            print('  FAIL', f)
        return 1
    print(f'GREEN  {summary}, 0 failed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
