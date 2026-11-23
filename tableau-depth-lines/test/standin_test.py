"""Viz pages compatibility gate: runs Depth Lines on the hub's REAL stand-in
(viz-extensions-hub/hosted/public/_vz/standin.js), not on our own mock.
Checks the ways visitors reach it: data + encodings only, nested pasted settings
with and without a prefix (what Copy settings produces), and flat prefixed string
settings. Also the Exit pill must not cover the chart. SKIP (not PASS) if the hub
file is missing. Run: python test/standin_test.py"""
import csv, json, pathlib, socket, subprocess, sys, time, urllib.parse
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
STANDIN = pathlib.Path('C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js')
PORT = 8772
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
    rows = list(csv.DictReader(open(ROOT / 'data' / 'wisconsin-tumors.csv', encoding='utf-8')))
    data = {'columns': ['Sample', 'Diagnosis', 'Mean radius', 'Mean concave points'], 'numeric': [True, False, True, True],
            'rows': [[int(r['Sample']), r['Diagnosis'], float(r['Mean radius']), float(r['Mean concave points'])] for r in rows]}
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)
    enc = [{'id': 'x', 'field': 'Mean radius'}, {'id': 'y', 'field': 'Mean concave points'}, {'id': 'category', 'field': 'Diagnosis'}]
    cases = {
        'data and encodings only': {'settings': {}, 'prefix': ''},
        'nested pasted settings, no prefix': {'settings': {'multi': 'small', 'levels': 6, 'ramp': 'sunrise', 'points': True}, 'prefix': ''},
        'nested pasted settings, prefix': {'settings': {'multi': 'small', 'levels': 6}, 'prefix': 'depthlines.'},
        'flat string settings': {'settings': {'depthlines.multi': 'small', 'depthlines.levels': '6'}, 'prefix': ''},
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
                page.on('console', lambda m: errs.append(m.text) if m.type == 'error' or '[DL]' in m.text else None)
                page.on('pageerror', lambda e: errs.append(str(e)))
                page.add_init_script('window.DL_STILL = true')
                cfg = {'dataUrl': '/_vz/data.json', 'encodings': enc, 'settings': c['settings'], 'prefix': c['prefix'], 'title': 'Tumors', 'home': 'https://c-tableau.netlify.app/'}
                page.goto(f'http://127.0.0.1:{PORT}/test/standin.html?cfg=' + urllib.parse.quote(json.dumps(cfg)))
                try:
                    page.wait_for_selector('#dl-root[data-ready="1"]', timeout=8000)
                except Exception:
                    pass
                bands = int(page.get_attribute('#dl-root', 'data-bands') or 0)
                check(f'[{name}] drew bands via the real stand-in ({bands})', bands >= 3)
                check(f'[{name}] 0 console errors', not errs, str(errs[:2]))
                check(f'[{name}] tableau.extensions is the stand-in', page.evaluate('tableau.extensions.environment.tableauVersion') == 'none')
                if 'small' in json.dumps(c['settings']):
                    check(f'[{name}] pasted settings reached the chart: small multiples', page.locator('.dl-ptitle').count() == 2)
                    check(f'[{name}] pasted settings reached the chart: 6 levels', page.evaluate('DL.app.state.settings.levels') == 6)
                else:
                    check(f'[{name}] defaults apply: overlay of both categories', page.locator('.dl-ptitle').count() == 0 and page.evaluate('new Set([...document.querySelectorAll("path.dl-band")].map(p=>p.dataset.g)).size') == 2)
                if 'sunrise' in json.dumps(c['settings']):
                    check(f'[{name}] pasted ramp applied', page.evaluate('DL.app.state.settings.ramp') == 'sunrise')
                pill = page.locator('.ctab-exit')
                check(f'[{name}] Exit pill is shown solo', pill.count() == 1)
                if pill.count():
                    pb = pill.bounding_box()
                    rb = page.locator('#dl-root').bounding_box()
                    check(f'[{name}] chart starts below the Exit pill ({rb["y"]:.0f} >= {pb["y"] + pb["height"]:.0f})', rb['y'] >= pb['y'] + pb['height'] - 0.5)
                page.click('.xp-gear')
                page.click('.xp-row[data-key=levels] .xp-sbtn >> nth=1')
                page.wait_for_timeout(500)
                check(f'[{name}] a visitor stepper click works on the stand-in', int(page.get_attribute('#dl-root', 'data-bands')) >= 3 and not errs, str(errs[:2]))
                page.click('.xp-close')
                band = page.locator('path.dl-band').nth(3).bounding_box()
                page.mouse.click(band['x'] + band['width'] / 2, band['y'] + band['height'] / 2)
                page.wait_for_timeout(150)
                check(f'[{name}] band click with no selectTuplesAsync in the host does not throw', not errs, str(errs[:2]))
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
