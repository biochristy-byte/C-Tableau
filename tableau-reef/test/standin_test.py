"""Viz pages compatibility gate: drive Reef with the REAL C-Tableau stand-in, not our mock.

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
CSV = ROOT / 'example' / 'us-deaths-by-cause-2017.csv'
MAPPING = {'level1': 'Cause group', 'level2': 'Cause', 'level3': 'Census region', 'size': 'Deaths'}
PREFIX = 'reef.'
SETTINGS_COPY = {'palette': 'sunset', 'fontSize': 16, 'colorMode': 'field', 'colorField': 'Age-adjusted death rate', 'rampName': 'lagoon', 'zoomMs': 500, 'theme': 'dark'}
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
        m = re.fullmatch(r'/v/test/(nopref|pref)/', path)
        if m:
            cfg = {'dataUrl': '/v/test/d/data.json', 'encodings': [{'id': k, 'field': v} for k, v in MAPPING.items()],
                   'settings': ({PREFIX + k: str(v) for k, v in SETTINGS_COPY.items()} if m.group(1) == 'pref' else SETTINGS_COPY),
                   'prefix': PREFIX if m.group(1) == 'pref' else '', 'title': 'Standin test', 'home': 'https://c-tableau.netlify.app/'}
            return self.send(shell(cfg), 'text/html; charset=utf-8')
        m = re.fullmatch(r'/v/test/(?:nopref|pref)/x/(.+)', path) or re.fullmatch(r'/v/test/x/(.+)', path)
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
    for variant in ('nopref', 'pref'):
        for (w, h) in [(300, 300), (900, 560), (1600, 1000)]:
            ctx = browser.new_context(viewport={'width': w, 'height': h}); page = ctx.new_page(); errs = []
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None); page.on('pageerror', lambda e: errs.append(str(e)))
            page.goto(BASE + '/v/test/%s/' % variant)
            tag = 'standin %s %dx%d' % (variant, w, h)
            try: page.wait_for_selector('.rf-c', timeout=8000)
            except Exception: check(tag + ': circles appeared', False, 'timeout'); ctx.close(); continue
            page.wait_for_timeout(1100)
            st = page.evaluate("() => RF.app.state.settings")
            check(tag + ': owner settings reached the extension (palette, size, colour field)', st['palette'] == 'sunset' and st['fontSize'] == 16 and st['colorMode'] == 'field' and st['colorField'] == 'Age-adjusted death rate' and st['zoomMs'] == 500, {k: st[k] for k in ('palette', 'fontSize', 'colorMode', 'colorField', 'zoomMs')})
            check(tag + ': dark theme setting applied', page.evaluate("() => getComputedStyle(document.getElementById('rf-root')).getPropertyValue('--rf-bg').trim()") == '#0d2b45')
            levels = page.evaluate("() => RF.app.state.model.levelFields")
            check(tag + ': encodings mapped to the owner columns', levels == ['Cause group', 'Cause', 'Census region'], levels)
            leaves = page.evaluate("() => RF.app.state.renderer.root.leaves().length")
            check(tag + ': 510 CSV rows folded into 40 leaves', leaves == 40, leaves)
            colors = page.evaluate("() => new Set(RF.app.state.renderer.root.leaves().map(l => l.el.getAttribute('fill'))).size")
            check(tag + ': numeric colour field shows a ramp', colors >= 8, colors)
            a = page.evaluate(AUDIT)
            check(tag + ': text 14px+, 7:1 contrast, no chip overlaps, Exit pill clear', not [t for t in a['text'] if t['size'] < 14] and not [t for t in a['text'] if contrast(t['fg'], t['bg']) < 7] and a['overlaps'] == 0 and a['htmlOverlaps'] == 0 and not a['hscroll'], (a['overlaps'], a['htmlOverlaps']))
            check(tag + ': Exit pill present on a solo page', page.evaluate("() => !!document.querySelector('.ctab-exit')"))
            if (w, h) == (900, 560):
                page.click('.rf-gear'); page.wait_for_timeout(350)
                check(tag + ': gear panel opens and lists the colour field as a data column', page.evaluate("() => [...document.querySelectorAll('select[aria-label=\"Colour field\"] option')].map(o => o.value).includes('Age-adjusted death rate')"))
                page.click('.rf-iconbtn'); page.wait_for_timeout(300)
                page.evaluate("() => { const r = RF.app.state.renderer; r.zoomTo(r.root.children[0]); }")
                page.wait_for_function("() => !document.querySelector('#rf-chart').classList.contains('rf-zooming')", timeout=6000); page.wait_for_timeout(300)
                check(tag + ': zoom works under the stand-in', page.evaluate("() => RF.app.state.renderer.focus.depth === 1"))
                page.evaluate("() => RF.app.state.renderer.nodes[3].el.dispatchEvent(new MouseEvent('click', { bubbles: true }))")
                check(tag + ': selection call is a harmless no-op (no throw)', True)
            check(tag + ': 0 console errors', not errs, errs[:2])
            ctx.close()
    browser.close()
srv.shutdown()
print('Reef stand-in gate: %d subjects examined, %d checks failed' % (subjects, len(fails)))
for f in fails: print(' FAIL', f)
if subjects < MIN_SUBJECTS: print('RED: fewer subjects than the declared minimum (%d)' % MIN_SUBJECTS); sys.exit(2)
sys.exit(1 if fails else 0)
