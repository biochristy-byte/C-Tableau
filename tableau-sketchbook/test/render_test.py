"""Sketchbook render gate (Playwright, Chromium) against dev/dev.html + the mock.

For every combination of size (300x300, 800x600, 1600x1000), theme (light, dark)
and scenario (bar, grouped bar, line, dot, negatives + zigzag, long labels + title)
it checks: the chart drew, 0 console errors, no horizontal scroll, every text is
Inter, >= 14px, >= 7:1 against its ground, and no two text boxes overlap. Then it
drives interaction, resize and
determinism (a redraw, a reload and a resize cycle must draw the SAME strokes),
and the entrance animation.

Run: python test/render_test.py        (starts its own server on 8773, refuses an inherited one)
RED if it examined fewer than MIN_TEXT text nodes or MIN_RUNS renders."""
import hashlib, json, re, socket, statistics, subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PORT = 8773
BASE = f'http://127.0.0.1:{PORT}/dev/dev.html'
SIZES = [(300, 300), (800, 600), (1600, 1000)]
THEMES = {'light': 'ffffff', 'dark': '081f33'}
SCENARIOS = {
    'bars-single-values': 'fx=bars&settings=' + json.dumps({'labels': 'value'}),
    'grouped-bars': 'fx=life',
    'line-series': 'fx=life&settings=' + json.dumps({'chartType': 'line'}),
    'dots-series': 'fx=life&settings=' + json.dumps({'chartType': 'dot'}),
    'negatives-zigzag': 'fx=negative&settings=' + json.dumps({'fillStyle': 'zigzag'}),
    'long-labels-title': 'fx=long&settings=' + json.dumps({'title': 'Scores by place', 'underline': True, 'labels': 'value', 'fillStyle': 'solid'}),
}
MIN_TEXT, MIN_RUNS = 200, 36

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
  const root = document.querySelector('#sb-root');
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
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const c2 = getComputedStyle(n);
      if (c2.overflowY !== 'visible' && c2.overflowY !== 'clip') { const b = n.getBoundingClientRect(); if (r.bottom <= b.top + 0.5 || r.top >= b.bottom - 0.5) return; }
    }
    const cs = getComputedStyle(el);
    let ground = null;
    if (!(el instanceof SVGElement)) for (let n = el; n; n = n.parentElement) { const bgc = getComputedStyle(n).backgroundColor; if (bgc && !/rgba\\(.*,\\s*0\\)$/.test(bgc) && bgc !== 'transparent') { ground = bgc; break; } }
    out.push({ text: t.slice(0, 30), size: parseFloat(cs.fontSize), color: el instanceof SVGElement ? cs.fill : cs.color, ground: ground,
      opacity: op, rect: [r.left, r.top, r.right, r.bottom], family: cs.fontFamily });
  });
  return out;
}"""


def check_text(page, label, sel, bg_expr='getComputedStyle(document.querySelector("#sb-root")).backgroundColor', inter=True):
    nodes = page.evaluate(TEXT_JS, sel)
    bg = rgb(page.evaluate(bg_expr))
    stats['text'] += len(nodes)
    check(f'{label}: found text to examine', len(nodes) >= 1, sel)
    for n in nodes:
        c = rgb(n['color'])
        check(f'{label}: "{n["text"]}" size {n["size"]}px >= 14', n['size'] >= 14 - 0.01)
        fam = n['family'].lower()
        check(f'{label}: "{n["text"]}" is Inter ({n["family"][:30]})', fam.startswith('inter') or fam.startswith('"inter"'))
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
    page.on('console', lambda m: errs.append(m.text) if m.type == 'error' or '[SB]' in m.text else None)
    page.on('pageerror', lambda e: errs.append('pageerror ' + str(e)))
    page.on('dialog', lambda d: (errs.append('browser dialog: ' + d.message), d.dismiss()))
    page.goto(f'{BASE}?still=1&{query}')
    page.wait_for_selector('#sb-root[data-ready="1"]', timeout=8000)
    page.evaluate('document.fonts.ready')
    page.wait_for_timeout(150)
    return ctx, page, errs


SIG_JS = "(() => { const a = document.querySelector('.sb-title'); const b = document.querySelector('.sb-svg'); return (a ? a.innerHTML : '') + '||' + (b ? b.innerHTML : ''); })()"


def sig(page):
    return hashlib.sha1(page.evaluate(SIG_JS).encode('utf-8')).hexdigest()


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
                t.close()
                break
            t.close()
            time.sleep(0.15)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            prev = ROOT / 'previews'
            prev.mkdir(exist_ok=True)
            # ---- the matrix
            for (w, h) in SIZES:
                for tname, bg in THEMES.items():
                    for sname, q in SCENARIOS.items():
                        label = f'{sname} {w}x{h} {tname}'
                        ctx, page, errs = open_page(browser, f'{q}&bg={bg}', w, h, tname)
                        stats['runs'] += 1
                        marks = int(page.get_attribute('#sb-root', 'data-marks') or 0)
                        check(f'{label}: marks drawn ({marks})', marks >= 4)
                        check(f'{label}: rough strokes in the svg', page.locator('svg.sb-svg .sb-marks path').count() >= marks)
                        check(f'{label}: no console errors', not errs, str(errs[:2]))
                        check(f'{label}: no horizontal scroll', page.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1'))
                        check(f'{label}: theme resolved', page.get_attribute('#sb-root', 'data-theme') == tname)
                        check(f'{label}: Inter is loaded', page.evaluate('document.fonts.check("14px Inter")'))
                        check_text(page, label, 'svg text, .sb-title-text, .sb-chip, .sb-empty')
                        if (w, h) == (1600, 1000) and tname == 'light' and sname in ('bars-single-values', 'grouped-bars'):
                            page.screenshot(path=str(prev / f'{sname}-{tname}.png'))
                        if (w, h) == (800, 600) and tname == 'dark' and sname in ('line-series', 'dots-series'):
                            page.screenshot(path=str(prev / f'{sname}-{tname}.png'))
                        ctx.close()
            # ---- empty and single-category states
            for fx in ('empty', 'one'):
                ctx, page, errs = open_page(browser, f'fx={fx}', 800, 600)
                stats['runs'] += 1
                check(f'{fx} fixture: no console errors', not errs, str(errs[:2]))
                if fx == 'empty':
                    check('empty fixture: shows a message instead of a blank', page.locator('.sb-empty').count() == 1 and len(page.inner_text('.sb-empty')) > 10)
                else:
                    check('one-category fixture: still draws its mark', int(page.get_attribute('#sb-root', 'data-marks') or 0) == 1)
                check_text(page, f'{fx} fixture', 'svg text, .sb-empty')
                ctx.close()

            # ---- the settings panel has its own gate (test/panel_test.py); this tour keeps the SEED DETERMINISM checks on the new panel
            def tab(pg, tid):
                pg.click(".cp-tab[data-t='%s']" % tid)
                pg.wait_for_function("document.querySelector(\".cp-tab[data-t='%s']\").getAttribute('aria-selected') === 'true'" % tid)
            for tname, bg in THEMES.items():
                ctx, page, errs = open_page(browser, f'fx=life&bg={bg}', 1000, 800, tname)
                page.click('.cp-gear')
                check(f'panel {tname}: opens', page.locator('.cp-panel').is_visible())
                tab(page, 'chart')
                check(f'panel {tname}: starts as bars', page.locator('.sb-path').count() == 0)
                page.click('.cp-chip[data-k=chartType][data-v=line]')
                page.wait_for_timeout(150)
                check(f'panel {tname}: Line chip draws one sketched line per series', page.locator('.sb-path').count() == 6, str(page.locator('.sb-path').count()))
                page.click('.cp-chip[data-k=chartType][data-v=dot]')
                page.wait_for_timeout(150)
                check(f'panel {tname}: Dot chip draws dots (circle hit areas)', page.locator('.sb-hit').count() == 54 and page.locator('.sb-path').count() == 0)
                page.click('.cp-chip[data-k=chartType][data-v=bar]')
                page.wait_for_timeout(150)
                base = sig(page)
                tab(page, 'sketch')
                page.click('[data-a=inc][data-k=roughness]')
                page.wait_for_timeout(150)
                changed = sig(page)
                check(f'panel {tname}: roughness + redraws a different sketch', changed != base)
                page.wait_for_timeout(600)
                saved = page.evaluate('SB_MOCK.settings.getAll()')
                check(f'panel {tname}: roughness saved as the string "1.3"', saved.get('sketchbook.roughness') == '1.3', str(saved.get('sketchbook.roughness')))
                check(f'panel {tname}: saveAsync called', page.evaluate('SB_MOCK.settings.saves') >= 1)
                page.click('[data-a=dec][data-k=roughness]')
                page.wait_for_timeout(150)
                check(f'panel {tname}: roughness back to 1.2 redraws the IDENTICAL sketch (seeded)', sig(page) == base)
                page.fill('input[data-k=seed]', '7'); page.press('input[data-k=seed]', 'Enter')
                page.wait_for_timeout(150)
                seven = sig(page)
                check(f'panel {tname}: typing seed 7 changes the sketch', seven != base)
                page.fill('input[data-k=seed]', '42'); page.press('input[data-k=seed]', 'Enter')
                page.wait_for_timeout(150)
                check(f'panel {tname}: seed 42 again draws the original', sig(page) == base)
                sigs = {}
                for fill in ('hachure', 'solid', 'zigzag'):
                    page.click(f'.cp-chip[data-k=fillStyle][data-v={fill}]')
                    page.wait_for_timeout(120)
                    sigs[fill] = sig(page)
                check(f'panel {tname}: hachure, solid and zigzag are three different drawings', len(set(sigs.values())) == 3)
                page.click('.cp-chip[data-k=fillStyle][data-v=hachure]')
                page.wait_for_timeout(120)
                check(f'panel {tname}: back to hachure equals the start', sig(page) == base)
                page.click('[data-a=inc][data-k=bowing]')
                page.wait_for_timeout(120)
                check(f'panel {tname}: bowing stepper redraws', sig(page) != base)
                page.click('[data-a=dec][data-k=bowing]')
                page.wait_for_timeout(120)
                check(f'panel {tname}: bowing back restores the identical sketch', sig(page) == base)
                check(f'panel {tname}: no console errors or dialogs through the tour', not errs, str(errs[:2]))
                ctx.close()

            # ---- interaction pushes back to Tableau
            ctx, page, errs = open_page(browser, 'fx=bars&bg=ffffff', 900, 650)
            bar = page.locator('.sb-mark[data-ci="2"] .sb-hit')
            bb = bar.bounding_box()
            page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.wait_for_timeout(120)
            hv = page.evaluate('SB_MOCK.sheet.hovered')
            check(f'interaction: hovering a bar pushes hoverTuple to Tableau ({hv})', isinstance(hv, int) and hv > 0)
            check('interaction: tooltip shows, 14px', page.locator('.sb-tip').is_visible() and page.evaluate('parseFloat(getComputedStyle(document.querySelector(".sb-tip")).fontSize)') >= 14)
            check('interaction: other marks dim while one is hot', page.locator('.sb-mark.sb-hot').count() == 1 and page.locator('.sb-hovering').count() == 1)
            page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.wait_for_timeout(150)
            sel = page.evaluate('SB_MOCK.sheet.selected')
            check(f'interaction: clicking a bar selects its tuple in Tableau ({sel})', len(sel) == 1)
            check('interaction: the other 5 bars dim to 0.3', page.locator('.sb-mark[opacity="0.3"]').count() == 5, str(page.locator('.sb-mark[opacity="0.3"]').count()))
            bb = page.locator('.sb-mark[data-ci="2"] .sb-hit').bounding_box()
            page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.wait_for_timeout(150)
            check('interaction: clicking the same bar again clears the selection', page.evaluate('SB_MOCK.sheet.selected.length') == 0 and page.locator('.sb-mark[opacity="0.3"]').count() == 0)
            bb = page.locator('.sb-mark[data-ci="1"] .sb-hit').bounding_box()
            page.mouse.click(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2)
            page.wait_for_timeout(100)
            page.mouse.click(5, 300)
            page.wait_for_timeout(120)
            check('interaction: clicking empty space clears the selection', page.evaluate('SB_MOCK.sheet.selected.length') == 0)
            check('interaction: no errors', not errs, str(errs[:2]))
            ctx.close()

            # ---- determinism across loads, resize cycles, seeds
            sigs = []
            for _ in range(2):
                ctx, page, errs = open_page(browser, 'fx=life&bg=ffffff&settings=' + json.dumps({'title': 'Life', 'underline': True}), 900, 600)
                sigs.append(sig(page))
                if len(sigs) == 1:
                    page.set_viewport_size({'width': 520, 'height': 420}); page.wait_for_timeout(300)
                    small = sig(page)
                    check('determinism: resize to a new size really redraws', small != sigs[0])
                    page.set_viewport_size({'width': 900, 'height': 600}); page.wait_for_timeout(300)
                    check('determinism: resize away and back draws the identical sketch', sig(page) == sigs[0])
                    check('resize: no console errors', not errs, str(errs[:2]))
                ctx.close()
            check('determinism: two separate page loads draw the identical sketch (title underline included)', sigs[0] == sigs[1])
            ctx, page, errs = open_page(browser, 'fx=life&bg=ffffff&settings=' + json.dumps({'title': 'Life', 'underline': True, 'seed': 43}), 900, 600)
            check('determinism: a different seed draws a different sketch', sig(page) != sigs[0])
            check('title underline: a sketched path exists under the title', page.locator('.sb-ul path').count() >= 1)
            ctx.close()

            # ---- entrance animation: eased, one-time, 60fps-class frame pacing
            ctx = browser.new_context(viewport={'width': 1000, 'height': 700})
            page = ctx.new_page()
            page.add_init_script("""window.__t=[];(function loop(t){window.__t.push(t);requestAnimationFrame(loop)})(0)""")
            page.goto(f'{BASE}?fx=life&bg=ffffff')
            page.wait_for_selector('#sb-root[data-ready="1"]', timeout=8000)
            anim = page.evaluate('getComputedStyle(document.querySelector(".sb-mark")).animationName')
            timing = page.evaluate('getComputedStyle(document.querySelector(".sb-mark")).animationTimingFunction')
            page.wait_for_timeout(1500)
            ts = page.evaluate('window.__t.slice(3)')
            gaps = [b - a for a, b in zip(ts, ts[1:])]
            med, p95 = statistics.median(gaps), sorted(gaps)[int(len(gaps) * 0.95)]
            check(f'animation: marks fade in with sb-in ({anim})', anim == 'sb-in')
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
