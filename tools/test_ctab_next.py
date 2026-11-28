"""Proof for ctab_next.py. Builds the fixture Next app (tools/fixtures/next-app), loads it in Playwright on a local static server with the
C-Tableau stand-in (standin.js + vds.js) and a generated Superstore-like CSV, and compares what the page drew with sums and averages
computed in Python from the same CSV. A sabotaged build (the shim ignores filters) must make the same comparison FAIL.

    python tools/test_ctab_next.py            needs Node 18+, Python playwright (+ chromium)

standin.js and vds.js come from $CTAB_HUB/hosted/public/_vz (the hub checkout) or, failing that, from https://c-tableau-hosted.netlify.app/_vz/."""
import csv
import functools
import http.server
import json
import os
import random
import re
import shutil
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import ctab_next  # noqa: E402

FIX = HERE / 'fixtures' / 'next-app'
HUB = Path(os.environ.get('CTAB_HUB') or 'C:/Users/bioch/projects/viz-extensions-hub')
MIN_CHECKS = 20
RES = []


def chk(name, ok, detail=''):
    RES.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  :: {detail}'))


def make_csv(path, rows=120):
    rnd = random.Random(20261127)
    regions = ['Central', 'East', 'South', 'West']
    subs = {'Furniture': ['Chairs', 'Tables'], 'Technology': ['Phones', 'Copiers'], 'Office Supplies': ['Binders', 'Paper']}
    out = []
    for i in range(rows):
        cat = rnd.choice(list(subs))
        out.append({'Order ID': f'CA-2026-{100 + i // 2}', 'Order Date': f'2026-{rnd.randint(1, 12):02d}-{rnd.randint(1, 28):02d}',
                    'Customer Name': rnd.choice(['Ann', 'Bo', 'Cy', 'Di']), 'Region': regions[i % 4] if i < 40 else rnd.choice(regions),
                    'Category': cat, 'Sub-Category': rnd.choice(subs[cat]), 'Product Name': f'Prod {rnd.randint(1, 9)}',
                    'Sales': round(rnd.uniform(5, 900), 2), 'Profit': round(rnd.uniform(-80, 200), 2),
                    'Discount': rnd.choice([0, 0.1, 0.2, 0.4]), 'Quantity': rnd.randint(1, 9)})
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    return out


def vz_files(dest):
    dest.mkdir(parents=True, exist_ok=True)
    for n in ('standin.js', 'vds.js'):
        src = HUB / 'hosted' / 'public' / '_vz' / n
        if src.exists():
            shutil.copy(src, dest / n)
        else:
            urllib.request.urlretrieve('https://c-tableau-hosted.netlify.app/_vz/' + n, dest / n)


def stage(out_dir, csv_path, rows, site):
    """what the hosted viz page does: the app's index.html with the stand-in loaded first, and the CSV as the page's data"""
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(out_dir, site)
    vz_files(site / '_vz')
    cols = list(rows[0])
    numeric = [c in ('Sales', 'Profit', 'Discount', 'Quantity') for c in cols]
    data = {'name': 'Superstore', 'columns': cols, 'numeric': numeric, 'rows': [[r[c] for c in cols] for r in rows]}
    (site / 'data.json').write_text(json.dumps(data), encoding='utf-8')
    html = (site / 'index.html').read_text(encoding='utf-8')
    inject = ('<script>window.__CTAB_VIZ={dataUrl:"./data.json",title:"Superstore",encodings:[],settings:{},prefix:"",preview:false}</script>'
              '<script src="./_vz/vds.js"></script><script src="./_vz/standin.js"></script>')
    (site / 'index.html').write_text(html.replace('</head>', inject + '</head>', 1), encoding='utf-8')


def serve(site):
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(site))
    h.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def draw(url):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(url)
        try:
            pg.wait_for_selector('body[data-drawn="1"], #err', timeout=20000)
        except Exception as e:
            errs.append('timeout: ' + str(e)[:80])
        got = pg.evaluate('''() => ({
          regions: [...document.querySelectorAll('#regions tr')].map(r => ({region: r.dataset.region, sales: +r.dataset.sales, disc: +r.dataset.disc, qty: +r.dataset.qty})),
          lines: [...document.querySelectorAll('#lines tr')].map(r => ({region: r.dataset.lregion, sales: +r.dataset.lsales, n: +r.dataset.lcount})),
          sample: document.querySelector('#sample') ? +document.querySelector('#sample').dataset.count : null,
          firstDate: document.querySelector('#sample') ? document.querySelector('#sample').dataset.firstDate : null,
          err: document.querySelector('#err') ? document.querySelector('#err').textContent : null})''')
        b.close()
    got['pageerrors'] = errs
    return got


def lines_py(rows, region):
    g = {}
    for r in rows:
        if r['Region'] == region:
            k = (r['Order ID'], r['Order Date'], r['Region'], r['Sub-Category'])
            g[k] = g.get(k, 0) + r['Sales']
    return g


def compare(got, rows, label):
    """returns a list of mismatches (empty = the page drew exactly what Python computes)"""
    bad = []
    if got['err'] or got['pageerrors']:
        bad.append(f'{label}: page error {got["err"] or got["pageerrors"]}')
    exp = {}
    for r in rows:
        e = exp.setdefault(r['Region'], {'sales': 0, 'disc': [], 'qty': 0})
        e['sales'] += r['Sales']
        e['disc'].append(r['Discount'])
        e['qty'] += r['Quantity']
    drawn = {r['region']: r for r in got['regions']}
    if set(drawn) != set(exp):
        bad.append(f'{label}: regions {sorted(drawn)} != {sorted(exp)}')
    for k, e in exp.items():
        d = drawn.get(k)
        if not d:
            continue
        if abs(d['sales'] - e['sales']) > 0.01:
            bad.append(f'{label}: {k} SUM(Sales) {d["sales"]} != {e["sales"]:.2f}')
        if abs(d['disc'] - sum(e['disc']) / len(e['disc'])) > 1e-9:
            bad.append(f'{label}: {k} AVG(Discount) {d["disc"]} != {sum(e["disc"]) / len(e["disc"])}')
        if d['qty'] != e['qty']:
            bad.append(f'{label}: {k} SUM(Quantity) {d["qty"]} != {e["qty"]}')
    lines = {r['region']: r for r in got['lines']}
    if set(lines) != {'Central', 'East'}:
        bad.append(f'{label}: line regions {sorted(lines)} != [Central, East] (the "in" filter did not hold)')
    for reg in ('Central', 'East'):
        py = lines_py(rows, reg)
        l = lines.get(reg)
        if not l:
            continue
        if l['n'] != len(py):
            bad.append(f'{label}: {reg} line groups {l["n"]} != {len(py)}')
        if abs(l['sales'] - sum(py.values())) > 0.01:
            bad.append(f'{label}: {reg} line sales {l["sales"]} != {sum(py.values()):.2f}')
    if got['sample'] != 5:
        bad.append(f'{label}: limit 5 drew {got["sample"]} rows')
    first = next((r['Order Date'] for r in rows if r['Region'] == 'Central'), None)
    if got['firstDate'] != first:
        bad.append(f'{label}: first Central date {got["firstDate"]} != {first}')
    return bad


def main():
    tmp = Path(tempfile.mkdtemp(prefix='ctab-next-test-'))
    try:
        csvp = tmp / 'superstore.csv'
        rows_raw = make_csv(csvp)
        rows = rows_raw
        srcsnap = {p: p.stat().st_mtime_ns for p in FIX.rglob('*') if p.is_file()}
        # field matching, unit level
        ok, bad = ctab_next.build_field_map(['Orders.Sub_Category7', 'Orders.Order_ID1', 'Orders.Region8', 'Orders.Nope9'], ctab_next.csv_header(csvp))
        chk('field map: Sub_Category7 -> Sub-Category', ok.get('Orders.Sub_Category7') == 'Sub-Category', ok)
        chk('field map: Order_ID1 -> Order ID', ok.get('Orders.Order_ID1') == 'Order ID', ok)
        chk('field map: an unknown field is reported unmatched', [b[0] for b in bad] == ['Orders.Nope9'], bad)
        # real build
        out = tmp / 'out'
        rc = ctab_next.main(['build', str(FIX), '--out', str(out), '--csv', str(csvp)])
        files = sorted(p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file())
        print('  built files:', files)
        chk('build exits 0 (build + check GREEN)', rc == 0, rc)
        chk('OUT_DIR holds index.html, index.js, ctab-fields.json', all(f in files for f in ('index.html', 'index.js', 'ctab-fields.json')), files)
        chk('no .tsx/.ts in OUT_DIR', not [f for f in files if f.endswith(('.tsx', '.ts'))], files)
        chk('SRC_DIR untouched (every file mtime unchanged, no new file)', srcsnap == {p: p.stat().st_mtime_ns for p in FIX.rglob('*') if p.is_file()})
        fm = json.loads((out / 'ctab-fields.json').read_text(encoding='utf-8'))
        chk('ctab-fields.json maps all 7 fields the spec uses', len(fm) == 7 and fm['Orders.Sub_Category7'] == 'Sub-Category', fm)
        js = (out / 'index.js').read_text(encoding='utf-8')
        chk('bundle holds no @analytics import and no remote URL', '@analytics/data-app-sdk' not in js and not re.search(r'https?://(?!www\.w3\.org|reactjs\.org|react\.dev)', js), '')
        # check(): each refusal, each with the same control (the good build is GREEN above)
        for name, mut in (('a .tsx leftover', lambda d: (d / 'Leftover.tsx').write_text('x', encoding='utf-8')),
                          ('an absolute /assets path', lambda d: (d / 'index.html').write_text('<script src="/assets/a.js"></script>', encoding='utf-8')),
                          ('a remote script URL', lambda d: (d / 'index.html').write_text('<script src="https://cdn.example.com/a.js"></script>', encoding='utf-8')),
                          ('a refused file type (.wasm)', lambda d: (d / 'a.wasm').write_bytes(b'\0asm')),
                          ('a file name ctab.py refuses', lambda d: (d / 'bad name.js').write_text('1', encoding='utf-8')),
                          ('a field-map column not in the CSV', lambda d: (d / 'ctab-fields.json').write_text('{"Orders.X1":"Nope"}', encoding='utf-8'))):
            d = tmp / 'mut'
            if d.exists():
                shutil.rmtree(d)
            shutil.copytree(out, d)
            mut(d)
            chk(f'check refuses {name}', ctab_next.check(d, csvp) == 1)
        e = tmp / 'empty'
        e.mkdir()
        (e / 'index.html').write_text('<html></html>', encoding='utf-8')
        chk('check is RED on a one-file folder (minimum 2 files)', ctab_next.check(e) == 1)
        # a CSV with a missing column: build must refuse
        short = tmp / 'short.csv'
        short.write_text(csvp.read_text(encoding='utf-8').replace('Sub-Category', 'Subcat'), encoding='utf-8')
        chk('build is RED when a field has no CSV column', ctab_next.main(['build', str(FIX), '--out', str(tmp / 'out2'), '--csv', str(short)]) == 1)
        # run in the browser
        site = tmp / 'site'
        stage(out, csvp, rows, site)
        srv = serve(site)
        got = draw(f'http://127.0.0.1:{srv.server_port}/index.html')
        srv.shutdown()
        print('  drawn:', json.dumps(got)[:400])
        bad = compare(got, rows, 'real')
        chk('page drew 4 regions', len(got['regions']) == 4, got['regions'])
        for b in bad:
            print('   ', b)
        chk('every drawn number equals the Python sum/avg/count (SUM Sales, AVG Discount, SUM Quantity x4 regions; "in" filter; limit; dates)', not bad, bad)
        chk('control: the comparison itself can fail (a tampered expectation is caught)', compare(dict(got, regions=[dict(r, sales=r['sales'] + 1) for r in got['regions']]), rows, 'tamper') != [])
        # sabotage: the shim ignores filters
        outs = tmp / 'out_sab'
        rc = ctab_next.main(['build', str(FIX), '--out', str(outs), '--csv', str(csvp), '--sabotage-ignore-filters'])
        stage(outs, csvp, rows, tmp / 'site_sab')
        srv = serve(tmp / 'site_sab')
        gots = draw(f'http://127.0.0.1:{srv.server_port}/index.html')
        srv.shutdown()
        bads = compare(gots, rows, 'sabotage')
        for b in bads[:4]:
            print('   ', b)
        chk('SABOTAGE (shim ignores the filter) goes RED', rc == 0 and len(bads) > 0, bads)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    passed = sum(1 for _, ok in RES if ok)
    print(f'\n{passed}/{len(RES)} checks passed (minimum {MIN_CHECKS})')
    if len(RES) < MIN_CHECKS or passed != len(RES):
        print('RED')
        return 1
    print('GREEN')
    return 0


if __name__ == '__main__':
    sys.exit(main())
