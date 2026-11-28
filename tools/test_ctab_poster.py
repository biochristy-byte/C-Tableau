#!/usr/bin/env python3
"""Tests for `ctab.py vizpage poster` against a local stub of the C-Tableau API (no network, no account). Needs Playwright for the blank-picture and --capture checks
(SKIP, exit 2, without it). Run:  python -P tools/test_ctab_poster.py

The stub answers GET /vizpages/SLUG, PUT and DELETE /vizpages/SLUG/poster. A static page served locally plays the live viz for --capture."""
import http.server, json, os, struct, subprocess, sys, threading, zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
CTAB = HERE / 'ctab.py'
MIN_CHECKS = 20
RES = []
STATE = {'puts': [], 'deletes': 0, 'poster': False}


def ck(ok, label, detail=''):
    RES.append(bool(ok))
    print(('  ok   ' if ok else '  RED  ') + label + ('' if ok else '  :: ' + str(detail)[:300]), flush=True)


def png(w, h, pixel):
    raw = b''.join(b'\x00' + b''.join(pixel(x, y) for x in range(w)) for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


PAL = [bytes(c) for c in ((200, 40, 40), (40, 160, 70), (40, 80, 200), (230, 190, 40), (120, 40, 160), (30, 30, 30), (240, 240, 240), (20, 170, 180))]
STRIPES = png(320, 200, lambda x, y: PAL[((x // 40) + 3 * (y // 50)) % 8])   # blocks of 8 flat colors, like a real viz
BLANK = png(320, 200, lambda x, y: b'\xff\xff\xff')
BUSY = png(320, 200, lambda x, y: bytes(((x * 7) % 256, (y * 5) % 256, ((x + y) * 3) % 256)))   # a gradient: no color bucket holds 0.5%
FEW = png(320, 200, lambda x, y: PAL[(x // 80) % 4])   # 4 flat colors, none over 92%: still a near-empty page
NEARLY = png(320, 200, lambda x, y: b'\xff\xff\xff' if x > 6 else b'\x10\x20\x30')   # one thin stripe on white
STATIC_PAGE = b'<!doctype html><meta charset=utf-8><body style="margin:0"><div id=a style="height:100vh;background:linear-gradient(90deg,#c33,#36c 40%,#3c6 70%,#fc3)"></div><script>setTimeout(()=>{document.body.insertAdjacentHTML("beforeend","<h1 style=\\"position:fixed;top:30px;left:30px;color:#fff\\">late paint</h1>")},800)</script>'


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, obj=None, raw=None, ctype='application/json'):
        b = raw if raw is not None else (json.dumps(obj).encode() if obj is not None else b'')
        self.send_response(code); self.send_header('Content-Type', ctype); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith('/page'):
            return self._send(200, raw=STATIC_PAGE, ctype='text/html')
        if self.path == '/api/v1/vizpages/demo':
            return self._send(200, {'slug': 'demo', 'url': f'http://127.0.0.1:{self.server.server_port}/page?embed=1', 'poster': STATE['poster']})
        self._send(404, {'error': 'NOT_FOUND', 'message': 'no'})

    def do_PUT(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n)
        if self.path == '/api/v1/vizpages/demo/poster':
            STATE['puts'].append((self.headers.get('Content-Type'), len(body), self.headers.get('Authorization')))
            STATE['poster'] = True
            return self._send(200, {'slug': 'demo', 'poster': True, 'poster_url': 'https://example.test/v/demo/p/0123456789abcdef.png'})
        self._send(404, {'error': 'NOT_FOUND', 'message': 'no'})

    def do_DELETE(self):
        if self.path == '/api/v1/vizpages/demo/poster':
            STATE['deletes'] += 1; STATE['poster'] = False
            return self._send(200, {'slug': 'demo', 'poster': False})
        self._send(404, {'error': 'NOT_FOUND', 'message': 'no'})


def ctab(*a, env_extra=None):
    env = dict(os.environ, CTAB_API_URL=f'http://127.0.0.1:{PORT}/api/v1', CTAB_API_KEY='ctab_' + 'k' * 43, HOME=str(HERE), USERPROFILE=str(HERE))
    env.update(env_extra or {})
    r = subprocess.run([sys.executable, '-P', str(CTAB), *a], capture_output=True, text=True, env=env, timeout=300)
    return r.returncode, r.stdout, r.stderr


def main():
    global PORT, CTAB
    if '--sabotage' in sys.argv:   # a copy of ctab.py whose picture checks never refuse: the run must go RED
        src = CTAB.read_text(encoding='utf8')
        bad = src.replace("if st['top'] > 0.92:", 'if False:').replace("if st['cover'] < 6:", 'if False:').replace("if data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR':", 'if data[:1]:')
        assert bad != src, 'sabotage changed nothing'
        CTAB = Path(os.environ.get('TEMP', '.')) / 'ctab_sabotaged.py'; CTAB.write_text(bad, encoding='utf8')
    try:
        import playwright.sync_api  # noqa: F401
    except Exception:
        print('SKIP: Playwright for Python is not installed'); return 2
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    PORT = srv.server_port
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    tmp = Path(os.environ.get('TEMP', '.')) / 'ctab_poster_test'
    tmp.mkdir(exist_ok=True)
    (tmp / 'stripes.png').write_bytes(STRIPES)
    (tmp / 'blank.png').write_bytes(BLANK)
    (tmp / 'nearly.png').write_bytes(NEARLY)
    (tmp / 'busy.png').write_bytes(BUSY)
    (tmp / 'few.png').write_bytes(FEW)
    (tmp / 'fake.png').write_bytes(b'<html>' + b'x' * 400)
    (tmp / 'big.png').write_bytes(STRIPES + b'\x00' * (2 * 1024 * 1024))
    jpg_like = b'\xff\xd8\xff\xe0' + bytes(range(256)) * 2
    (tmp / 'ok.jpg').write_bytes(jpg_like)

    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'stripes.png'))
    ck(rc == 0 and len(STATE['puts']) == 1 and STATE['puts'][0][0] == 'image/png' and STATE['puts'][0][1] == len(STRIPES), '--image: a real PNG is PUT with Content-Type image/png and its exact bytes', (rc, out, err, STATE['puts']))
    ck(STATE['puts'] and STATE['puts'][0][2].startswith('Bearer ctab_'), 'the API key goes in the Authorization header')
    ck('republish the Tableau Public workbook' in out and 'example.test/v/demo/p/' in out, 'it prints the poster URL and the republish reminder', out)
    n = len(STATE['puts'])
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'blank.png'))
    ck(rc == 1 and 'Refused' in err and 'one color' in err and len(STATE['puts']) == n, '--image: an all-white picture is refused and nothing is uploaded', (rc, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'nearly.png'))
    ck(rc == 1 and 'Refused' in err and len(STATE['puts']) == n, '--image: a picture that is 97 percent one color is refused', (rc, err, out))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'few.png'))
    ck(rc == 1 and 'Refused' in err and 'make up 95%' in err and len(STATE['puts']) == n, '--image: a picture of only 4 flat colors is refused', (rc, err, out))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'busy.png'))
    ck(rc == 0 and len(STATE['puts']) == n + 1, '--image: a busy gradient (no single color holds 0.5%) is accepted, not called empty', (rc, err, out))
    n = len(STATE['puts'])
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'fake.png'))
    ck(rc == 1 and 'PNG or JPEG' in err and len(STATE['puts']) == n, '--image: HTML named .png is refused by its bytes', (rc, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'big.png'))
    ck(rc == 1 and '2 MB' in err and len(STATE['puts']) == n, '--image: a picture over 2 MB is refused before any upload', (rc, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'missing.png'))
    ck(rc != 0 and len(STATE['puts']) == n, '--image: a missing file fails and uploads nothing', (rc, err[-120:]))
    rc, out, err = ctab('vizpage', 'poster', 'demo')
    ck(rc == 1 and 'exactly one' in err, 'no mode: asks for exactly one of --capture, --image, --remove', (rc, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--capture', '--image', 'x.png')
    ck(rc == 1 and 'exactly one' in err, '--capture with --image is refused', (rc, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--capture', '--size', '12x9')
    ck(rc == 1 and 'WIDTHxHEIGHT' in err, '--size must be WIDTHxHEIGHT', (rc, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--bogus')
    ck(rc == 1 and 'Unknown' in err, 'an unknown option is refused', (rc, err))

    rc, out, err = ctab('vizpage', 'poster', 'demo', '--capture', '--size', '640x400')
    ck(rc == 0 and len(STATE['puts']) == n + 1 and STATE['puts'][-1][0] == 'image/png', '--capture: opens the page, settles, uploads a PNG', (rc, out[-300:], err[-300:]))
    ck('live=1' in out and '640x400' in out and 'settled after' in out, '--capture: opened ?embed=1&live=1 at the --size and reported the settle time', out[:300])
    ck(STATE['puts'] and 3000 < STATE['puts'][-1][1] < 2 * 1024 * 1024, '--capture: the uploaded picture is a real PNG of plausible size', STATE['puts'][-1:] if STATE['puts'] else None)
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--image', str(tmp / 'ok.jpg'))
    ck(rc in (0, 1) and (len(STATE['puts']) == n + 2 or 'Refused' in err), '--image: a JPEG header passes the type check (the picture check may still judge the bytes)', (rc, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--remove')
    ck(rc == 0 and STATE['deletes'] == 1 and 'removed' in out.lower(), '--remove: sends DELETE /vizpages/demo/poster', (rc, out, err))
    rc, out, err = ctab('vizpage', 'poster', 'demo', '--remove', '--capture')
    ck(rc == 1 and STATE['deletes'] == 1, '--remove stands alone', (rc, err))
    doc = subprocess.run([sys.executable, '-P', str(CTAB), '--help'], capture_output=True, text=True).stdout
    ck('vizpage poster SLUG --capture' in doc and '--image' in doc and '--remove' in doc and '"poster"' in doc, 'the usage docstring lists poster --capture, --image and --remove')
    ck('—' not in CTAB.read_text(encoding='utf8'), 'no em dash in ctab.py')

    srv.shutdown()
    ck(len(RES) + 1 >= MIN_CHECKS, f'subjects: {len(RES) + 1} checks (minimum {MIN_CHECKS})')
    bad = RES.count(False)
    print(f'\n{"GREEN" if not bad else "RED"}: {len(RES) - bad}/{len(RES)} checks passed (minimum {MIN_CHECKS})')
    return 0 if not bad else 1


PORT = 0
if __name__ == '__main__':
    sys.exit(main())
