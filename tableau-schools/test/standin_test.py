"""Viz pages compatibility gate: drive Schools with the REAL C-Tableau stand-in, not our mock.

Builds the same shell the hub's edge function builds (base href, window.__CTAB_VIZ, the stand-in script,
tableau library tag removed) around src/index.html, serves the owner's CSV as {columns, numeric, rows},
and checks that the page renders, takes its settings, zooms and stays free of console errors.
SKIPs (exit 3, not green) when the stand-in file is missing.

  python test/standin_test.py
"""
import sys, re, json, csv, threading, http.server, socketserver, pathlib

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from audit import AUDIT, contrast

STANDIN = pathlib.Path('C:/Users/bioch/projects/viz-extensions-hub/hosted/public/_vz/standin.js')
CSV = ROOT / 'example' / 'countries-population-life-expectancy-2021.csv'
MAPPING = {'item': 'Country', 'cluster': 'Region', 'size': 'Population', 'color': 'Income group'}
PREFIX = 'schools.'
# what the panel's Copy settings button produces (flat, typed keys), and what a workbook saved before the panel change holds
SETTINGS_COPY = {'palette': 'sunset', 'fontSize': 16, 'colorMode': 'field', 'areaFill': 50, 'animMs': 500, 'theme': 'dark',
                 'labelCase': 'upper', 'hoverMs': 120, 'font': 'verdana', 'numCompact': False}
SETTINGS_OLD = {'palette': 'sunset', 'fontSize': 16, 'colorMode': 'field', 'areaFill': 50, 'animMs': 500, 'theme': 'dark',
                'fontFamily': 'Verdana, Geneva, sans-serif', 'valueFormat': 'plain'}
MIN_SUBJECTS = 40

if not STANDIN.exists():
    print('SKIP: stand-in not found at %s, so nothing was examined' % STANDIN); sys.exit(3)

rows = list(csv.reader(open(CSV, encoding='utf-8')))
head, body = rows[0], rows[1:]
numeric = []
data_rows = []
for c in range(len(head)):
    numeric.append(all(re.fullmatch(r'-?\d+(\.\d+)?', r[c]) for r in body))
for r in body:
    data_rows.append([float(v) if numeric[i] else v for i, v in enumerate(r)])
DATA = {'columns': head, 'numeric': numeric, 'rows': data_rows}

fails, subjects = [], 0
def check(name, cond, detail=''):
    global subjects
    subjects += 1
    if not cond: fails.append(name + ((' :: ' + str(detail)) if detail != '' else ''))

def shell(cfg):
    html = (ROOT / 'src' / 'index.html').read_text(encoding='utf-8')
    html = re.sub(r'<script\b[^>]*\bsrc\s*=\s*["\'][^"\']*tableau\.extensions[^"\']*["\'][^>]*>\s*</script>', '<!-- tableau library replaced by the C-Tableau stand-in -->', html, flags=re.I)
    html = re.sub(r'<title>[\s\S]*?</title>', '', html, flags=re.I)
    head = '<base href="/v/test/x/src/">\n<script>window.__CTAB_VIZ=' + json.dumps(cfg).replace('<', '\\u003c') + ';</script>\n<script src="/_vz/standin.js?v=2"></script>\n'
    return re.sub(r'<head\b[^>]*>', lambda m: m.group(0) + '\n<title>Viz</title>\n' + head, html, count=1, flags=re.I)

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a, **k): pass
    def send(self, body, ctype):
        b = body if isinstance(body, bytes) else body.encode('utf-8')
        self.send_response(200); self.send_header('Content-Type', ctype); self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/_vz/standin.js': return self.send(STANDIN.read_bytes(), 'application/javascript')
        if path == '/v/test/d/data.json': return self.send(json.dumps(DATA), 'application/json')
        m = re.fullmatch(r'/v/test/(nopref|pref|legacy)/', path)
        if m:
            cfg = {'dataUrl': '/v/test/d/data.json', 'encodings': [{'id': k, 'field': v} for k, v in MAPPING.items()],
                   'settings': ({PREFIX + k: (str(v).lower() if isinstance(v, bool) else str(v)) for k, v in SETTINGS_COPY.items()} if m.group(1) == 'pref' else {PREFIX + k: str(v) for k, v in SETTINGS_OLD.items()} if m.group(1) == 'legacy' else SETTINGS_COPY),
                   'prefix': PREFIX if m.group(1) in ('pref', 'legacy') else '', 'title': 'Standin test', 'home': 'https://c-tableau.netlify.app/'}
            return self.send(shell(cfg), 'text/html; charset=utf-8')
        m = re.fullmatch(r'/v/test/(?:nopref|pref|legacy)/x/(.+)', path) or re.fullmatch(r'/v/test/x/(.+)', path)
        f = (ROOT / m.group(1)) if m else None
        if f and f.is_file() and ROOT in f.resolve().parents:
            ct = {'.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html'}.get(f.suffix, 'application/octet-stream')
            return self.send(f.read_bytes(), ct)
        self.send_response(404); self.end_headers()

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(('127.0.0.1', 0), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:%d' % srv.server_address[1]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for variant in ('nopref', 'pref', 'legacy'):
        for (w, h) in [(300, 300), (900, 560), (1600, 1000)]:
            ctx = browser.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page(); errs = []
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '/v/test/%s/' % variant)
            tag = 'standin %s %dx%d' % (variant, w, h)
            try: page.wait_for_selector('.sc-c', timeout=8000)
            except Exception: check(tag + ': circles appeared', False, 'timeout'); ctx.close(); continue
            page.wait_for_function("() => !(window.SC && SC.app && SC.app.state.renderer && SC.app.state.renderer.job) && !document.querySelector('#sc-chart').classList.contains('sc-moving') && document.querySelectorAll('.sc-chip').length > 0", timeout=8000)
            page.wait_for_timeout(300)
            st = page.evaluate("() => SC.app.state.settings")
            check(tag + ': owner settings reached the extension (palette, size, colour mode, area, animation)', st['palette'] == 'sunset' and st['fontSize'] == 16 and st['colorMode'] == 'field' and st['areaFill'] == 50 and st['animMs'] == 500, {k: st[k] for k in ('palette', 'fontSize', 'colorMode', 'areaFill', 'animMs')})
            if variant == 'legacy':
                check(tag + ': a pre-panel workbook (fontFamily stack, valueFormat plain) reads as font verdana, numCompact false', st['font'] == 'verdana' and st['numCompact'] is False, (st['font'], st['numCompact']))
            else:
                check(tag + ': Copy-settings keys reached the extension (font, letter case, hover time, compact numbers)', st['font'] == 'verdana' and st['labelCase'] == 'upper' and st['hoverMs'] == 120 and st['numCompact'] is False, {k: st[k] for k in ('font', 'labelCase', 'hoverMs', 'numCompact')})
                up = (w < 900) or page.evaluate("() => { const t = [...document.querySelectorAll('.sc-chip:not(.sc-cchip) text')]; return t.length > 0 && t.every(x => x.textContent === x.textContent.toUpperCase()); }")
                check(tag + ': the upper-case label setting changed the drawn chips', up)
            check(tag + ': dark theme setting applied', page.evaluate("() => getComputedStyle(document.getElementById('sc-root')).getPropertyValue('--sc-bg').trim()") == '#0d2b45')
            m = page.evaluate("() => ({ item: SC.app.state.model.itemField, cluster: SC.app.state.model.clusterField, color: SC.app.state.model.colorField, size: SC.app.state.model.valueName })")
            check(tag + ': encodings mapped to the owner columns', m == {'item': 'Country', 'cluster': 'Region', 'color': 'Income group', 'size': 'Population'}, m)
            n = page.evaluate("() => SC.app.state.renderer.nodes.length")
            check(tag + ': 217 CSV rows became 217 circles', n == 217, n)
            ncl = page.evaluate("() => SC.app.state.renderer.clusters.length")
            check(tag + ': 7 regions became 7 clusters', ncl == 7, ncl)
            colors = page.evaluate("() => new Set(SC.app.state.renderer.nodes.map(n => n.el.getAttribute('fill'))).size")
            check(tag + ': Colour shelf field (Income group) gives 4 colours', colors == 4, colors)
            a = page.evaluate(AUDIT)
            check(tag + ': text 14px+, 7:1 contrast, no chip or circle overlaps, every cluster labelled, Exit pill clear', not [t for t in a['text'] if t['size'] < 14] and not [t for t in a['text'] if contrast(t['fg'], t['bg']) < 7] and a['overlaps'] == 0 and a['circleOverlaps'] == 0 and len(a['cchips']) == ncl and a['htmlOverlaps'] == 0 and not a['hscroll'], (a['overlaps'], a['circleOverlaps'], len(a['cchips']), a['htmlOverlaps']))
            fr = page.evaluate("() => new Promise(res => { const read = () => [...document.querySelectorAll('.sc-c')].map(c => c.getAttribute('cx') + c.getAttribute('cy') + c.getAttribute('r')).join('|'); const o = []; const f = () => { o.push(read()); if (o.length < 20) requestAnimationFrame(f); else res(o); }; requestAnimationFrame(f); })")
            check(tag + ': positions identical across 20 consecutive frames (no jitter)', len(set(fr)) == 1)
            check(tag + ': Exit pill present on a solo page', page.evaluate("() => !!document.querySelector('.ctab-exit')"))
            if (w, h) == (900, 560):
                page.click('.cp-gear'); page.wait_for_timeout(350)
                check(tag + ': gear panel opens and has the Colour by dropdown', page.evaluate("() => !!document.querySelector('select[data-k=colorMode]')"))
                page.click('[data-a=close]'); page.wait_for_timeout(300)
                page.evaluate("() => SC.app.state.renderer.nodes[3].el.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
                page.wait_for_timeout(150)
                check(tag + ': clicking a circle marks it and the Tableau selection call is a harmless no-op (no throw)', page.evaluate("() => document.querySelectorAll('.sc-c.sc-sel').length") == 1)
            check(tag + ': 0 console errors', not errs, errs[:2])
            ctx.close()
    browser.close()
srv.shutdown()
print('Schools stand-in gate: %d subjects examined, %d checks failed' % (subjects, len(fails)))
for f in fails: print(' FAIL', f)
if subjects < MIN_SUBJECTS: print('RED: fewer subjects than the declared minimum (%d)' % MIN_SUBJECTS); sys.exit(2)
sys.exit(1 if fails else 0)
