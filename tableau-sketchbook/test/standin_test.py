"""Viz pages compatibility gate: runs Sketchbook on the hub's REAL stand-in
(viz-extensions-hub/hosted/public/_vz/standin.js), not on our own mock.
Checks the ways visitors reach it: data + encodings only, nested pasted settings
with and without a prefix (what Copy settings produces), and flat prefixed string
settings. Also the Exit pill must not cover the chart. SKIP (not PASS) if the hub
file is missing. Run: python test/standin_test.py"""
import csv, json, pathlib, socket, subprocess, sys, time, urllib.parse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
STANDIN = pathlib.Path('C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js')
PORT = 8773
fails, checks = [], 0


def check(name, cond, detail=''):
    global checks
    checks += 1
    if not cond:
        fails.append(f'{name} {detail}'.strip())


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    if not STANDIN.exists():
        print(f'SKIP  stand-in not found at {STANDIN}')
        return 0
    s = socket.socket()
    if s.connect_ex(('127.0.0.1', PORT)) == 0:
        print(f'RED  port {PORT} already has a server: refusing an inherited server')
        return 1
    s.close()
    rows = list(csv.DictReader(open(ROOT / 'data' / 'life-expectancy-sample.csv', encoding='utf-8')))
    V = 'Life expectancy (years)'
    data = {'columns': ['Country', 'Year', V], 'numeric': [False, False, True], 'rows': [[r['Country'], r['Year'], float(r[V])] for r in rows]}
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    enc = [{'id': 'category', 'field': 'Year'}, {'id': 'value', 'field': V}, {'id': 'series', 'field': 'Country'}]
    cases = {
        'data and encodings only': {'settings': {}, 'prefix': ''},
        'nested pasted settings, no prefix': {'settings': {'chartType': 'line', 'seed': 7, 'roughness': 2.5, 'fillStyle': 'zigzag'}, 'prefix': ''},
        'nested pasted settings, prefix': {'settings': {'chartType': 'dot', 'seed': 7}, 'prefix': 'sketchbook.'},
        'flat string settings': {'settings': {'sketchbook.chartType': 'line', 'sketchbook.seed': '7'}, 'prefix': ''},
    }
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            for name, c in cases.items():
                ctx = b.new_context(viewport={'width': 900, 'height': 650})
                ctx.route('**/_vz/standin.js', lambda r: r.fulfill(body=STANDIN.read_text(encoding='utf-8'), content_type='application/javascript'))
                ctx.route('**/_vz/data.json', lambda r: r.fulfill(body=json.dumps(data), content_type='application/json'))
                page = ctx.new_page()
                errs = []
                page.on('console', lambda m: errs.append(m.text) if m.type == 'error' or '[SB]' in m.text else None)
                page.on('pageerror', lambda e: errs.append(str(e)))
                page.add_init_script('window.SB_STILL = true')
                cfg = {'dataUrl': '/_vz/data.json', 'encodings': enc, 'settings': c['settings'], 'prefix': c['prefix'], 'title': 'Tumours', 'home': 'https://c-tableau.netlify.app/'}
                page.goto(f'http://127.0.0.1:{PORT}/test/standin.html?cfg=' + urllib.parse.quote(json.dumps(cfg)))
                try:
                    page.wait_for_selector('#sb-root[data-ready="1"]', timeout=8000)
                except Exception:
                    pass
                marks = int(page.get_attribute('#sb-root', 'data-marks') or 0)
                check(f'[{name}] drew marks via the real stand-in ({marks})', marks == 54)
                check(f'[{name}] 0 console errors', not errs, str(errs[:2]))
                check(f'[{name}] tableau.extensions is the stand-in', page.evaluate('tableau.extensions.environment.tableauVersion') == 'none')
                st = page.evaluate('SB.app.state.store.get()')
                want = c['settings'] if not any(k.startswith('sketchbook.') for k in c['settings']) else {k.split('.', 1)[1]: (int(v) if v.isdigit() else v) for k, v in c['settings'].items()}
                for k, v in want.items():
                    check(f'[{name}] pasted setting {k}={v!r} reached the chart (got {st[k]!r})', st[k] == v)
                if want.get('chartType') == 'line':
                    check(f'[{name}] line chart: one sketched path per series', page.locator('.sb-path').count() == 6)
                else:
                    check(f'[{name}] chart type {st["chartType"]}: no line paths unless Line', (page.locator('.sb-path').count() == 0) == (st['chartType'] != 'line'))
                check(f'[{name}] series legend shows the 6 countries', page.locator('.sb-chip').count() == 6)
                pill = page.locator('.ctab-exit')
                check(f'[{name}] Exit pill is shown solo', pill.count() == 1)
                if pill.count():
                    pb = pill.bounding_box()
                    rb = page.locator('#sb-root').bounding_box()
                    check(f'[{name}] chart starts below the Exit pill ({rb["y"]:.0f} >= {pb["y"] + pb["height"]:.0f})', rb['y'] >= pb['y'] + pb['height'] - 0.5)
                page.click('.cp-gear')
                page.click(".cp-tab[data-t='sketch']")
                page.click('[data-a=inc][data-k=roughness]')
                page.wait_for_timeout(500)
                check(f'[{name}] a visitor stepper click works on the stand-in', int(page.get_attribute('#sb-root', 'data-marks')) == 54 and not errs, str(errs[:2]))
                page.click('[data-f=copyall]')
                page.wait_for_function("document.querySelector('.cp-status').textContent.indexOf('Copied') === 0 || document.querySelector('.cp-status').textContent.indexOf('clipboard') > 0", timeout=5000)
                copied = json.loads(page.evaluate('SB.app.state.panel.lastCopied'))["settings"]
                check(f'[{name}] Copy settings gives the flat JSON the Viz pages flow reads ({len(copied)} keys)', len(copied) >= 90 and copied['seed'] == page.evaluate('SB.app.state.store.get().seed') and 'chartType' in copied and 'roughness' in copied)
                page.click('[data-a=close]')
                band = page.locator('.sb-hit').nth(3).bounding_box()
                page.mouse.click(band['x'] + band['width'] / 2, band['y'] + band['height'] / 2)
                page.wait_for_timeout(150)
                check(f'[{name}] mark click with no selectTuplesAsync in the host does not throw', not errs, str(errs[:2]))
                ctx.close()
            b.close()
    finally:
        srv.terminate()
    if fails:
        print(f'RED  {len(fails)} failed of {checks} checks')
        for f in fails:
            print('  FAIL', f)
        return 1
    print(f'GREEN  {len(cases)} stand-in scenarios, {checks} checks, 0 failed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
