#!/usr/bin/env python3
"""ctab.py: upload and manage Tableau viz extensions on C-Tableau from the command line. Python 3 standard library only.

    set CTAB_API_KEY=ctab_...                  (create one at https://c-tableau.netlify.app/account/#/keys)
    python ctab.py me
    python ctab.py upload FOLDER [--visibility public|private]
    python ctab.py update ID FOLDER
    python ctab.py list
    python ctab.py status ID
    python ctab.py visibility ID public|private
    python ctab.py trex ID -o file.trex
    python ctab.py remove ID
    python ctab.py upload MyDataApp.twbx                     (a Tableau data app: its package is unpacked and uploaded)
    python ctab.py upload BUILD_FOLDER_OR_ZIP --app          (a compiled web app, e.g. a Tableau Next data app build: no .trex needed, one is generated)
    python ctab.py vizpage publish --name "My Viz" --extension EXT_ID --csv data.csv [--settings s.json] [--map enc=Column ...] [--prefix P] [--slug my-viz] [--visibility public|private]
        [--datasource "Sample - Superstore"] [--source Returns.csv ...]   (Tableau data apps: the data source name the app looks up, extra CSVs as extra data sources)
    python ctab.py vizpage publish --name "Big Map" --extension EXT_ID --tiles TILES_DIR [--map enc=Field ...] [--settings s.json] [--slug big-map] [--visibility public|private]
    python ctab.py vizpage publish-again SLUG --tiles TILES_DIR     (a new tile package for a tile page; the old one is deleted after the swap)
        (tile pages: TILES_DIR is a ctab-tiles v1 package built by C-Tableau's tools/ctab_tiles.py; 300 MB and 20,000 files per package, 1 GB per account with the unlock)
    python ctab.py vizpage visibility SLUG public|private   (public = listed in the C-Tableau viz gallery; your link works either way)
    python ctab.py vizpage list | status SLUG | unpublish SLUG | publish-again SLUG | delete SLUG
    python ctab.py vizpage poster SLUG --capture [--size 1280x790] [--accept-unsettled]    (open the live page in Playwright, wait until it settles, upload the picture)
    python ctab.py vizpage poster SLUG --image poster.png                                (upload a PNG or JPEG you made, up to 2 MB)
    python ctab.py vizpage poster SLUG --remove                                          (take the poster off; vizpage status shows "poster": true or false)

Getting ctab.py without git (it is one file, Python 3 only):
    curl -O https://raw.githubusercontent.com/biochristy-byte/C-Tableau/main/tools/ctab.py
    Invoke-WebRequest -OutFile ctab.py https://raw.githubusercontent.com/biochristy-byte/C-Tableau/main/tools/ctab.py     (Windows PowerShell)

--app (a compiled build, no .trex): FOLDER_OR_ZIP holds index.html at its root or one level down (dist/, build/, out/). ctab.py writes a
dashboard-extension .trex whose page is that index.html (name from package.json displayName or name, then a Tableau Next app.spec.json label, else the folder name; a fresh id; no author,
the server fills that from your account), uploads the build like any extension, and it waits PENDING under your account until an admin approves it.
It is picked automatically when the folder has no .trex but has an index.html. Build with relative asset paths (Vite: base './', CRA: "homepage": ".")
because the page is served from a sub-path. File names may use letters, numbers and . _ @ + - only (hashed names like index-3fA_b.js are fine);
a name with a space, ~ $ [ ] ( ) = # % or any other character makes the upload stop and lists every such file.

A poster is a still of your viz. Tableau Public makes a gallery card by screenshotting your page in a headless browser, and a page that draws a big map onto a
canvas never settles, so the card comes out blank. With a poster set, an automated browser (navigator.webdriver true) sees the still over the whole page and the
page starts no data loads; a person sees the live viz, and ?live=1 shows the live viz to your own test browser. After setting a poster, republish the Tableau Public
workbook with the same title (answer Yes to overwrite); the card updates about 2 minutes later. --capture needs Playwright
(pip install playwright, then python -m playwright install chromium). It refuses a picture that is mostly one color or mostly empty.

A viz page is your extension plus your CSV, served at https://c-tableau-hosted.netlify.app/v/<slug>/?embed=1 for a Tableau Public Web Page object.
The CSV is up to 5 MB. --map links an extension encoding id (see the .trex) to a CSV column; with no --map, columns whose name matches an encoding id are linked.

Each file can be at most 4 MB over the API (300 files and 30 MB in all). Files upload one at a time with a progress count.
FOLDER is the folder your dev server serves as its root: it holds your .trex and the page the .trex points to.
The key comes from CTAB_API_KEY, or else from the line CTAB_API_KEY=... in ~/.secrets/ctab.env. It is never printed.
A line CTAB_VIZPAGE_VISIBILITY=public in that file (or that environment variable) makes new viz pages public by default;
--visibility still wins. Without it, new viz pages are private (link-only).
"""
import base64
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

API = os.environ.get('CTAB_API_URL', 'https://c-tableau.netlify.app/api/v1').rstrip('/')
OK_EXT = set('html htm js mjs css json svg png jpg jpeg gif webp ico woff woff2 ttf otf csv txt map trex md'.split())
NAME_OK = set('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._@+/-')
MIME = {'html': 'text/html', 'htm': 'text/html', 'js': 'application/javascript', 'mjs': 'application/javascript', 'css': 'text/css', 'json': 'application/json',
        'svg': 'image/svg+xml', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp', 'ico': 'image/x-icon',
        'woff': 'font/woff', 'woff2': 'font/woff2', 'ttf': 'font/ttf', 'otf': 'font/otf', 'csv': 'text/csv', 'txt': 'text/plain', 'map': 'application/json',
        'trex': 'application/xml', 'md': 'text/markdown'}
UA = 'ctab-cli/1'


class CtabError(Exception):
    pass


def setting(name):
    """A value from the environment, else from the line NAME=... in ~/.secrets/ctab.env, else ''."""
    v = os.environ.get(name, '').strip()
    if v:
        return v
    f = Path.home() / '.secrets' / 'ctab.env'
    try:
        for line in f.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                n, val = line.split('=', 1)
                if n.strip() == name:
                    v = val.strip().strip('"').strip("'").strip()
    except OSError:
        pass
    return v


def vizpage_default_visibility():
    """CTAB_VIZPAGE_VISIBILITY=public in ~/.secrets/ctab.env makes new viz pages public unless --visibility says otherwise."""
    v = setting('CTAB_VIZPAGE_VISIBILITY').lower()
    if v and v not in ('public', 'private'):
        raise CtabError('CTAB_VIZPAGE_VISIBILITY must be public or private.')
    return v or 'private'


def key():
    k = setting('CTAB_API_KEY')
    if not k:
        raise CtabError('Set the CTAB_API_KEY environment variable (or put CTAB_API_KEY=... in ~/.secrets/ctab.env). Create a key at https://c-tableau.netlify.app/account/#/keys.')
    return k


def call(method, path, body=None, raw=False, data=None, ctype='application/json', _tries=0):
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        'Authorization': 'Bearer ' + key(), 'Content-Type': ctype, 'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            b = r.read()
            return b if raw else (json.loads(b.decode()) if b else None)
    except urllib.error.HTTPError as e:
        txt = e.read().decode(errors='replace')
        if e.code == 429 and _tries < 6 and '"rate_limited"' in txt:  # 120 requests per minute per key: wait and go on
            wait = int(e.headers.get('Retry-After') or 30)
            print(f'  rate limit reached, waiting {wait}s ...', file=sys.stderr, flush=True)
            time.sleep(wait)
            return call(method, path, None, raw, data, ctype, _tries + 1)
        try:
            j = json.loads(txt)
            msg = f"{j.get('error', e.code)}: {j.get('message', '')}"
        except Exception:
            msg = f'HTTP {e.code} {txt[:200]}'
        raise CtabError(msg)
    except urllib.error.URLError as e:
        raise CtabError(f'Could not reach {API}: {e.reason}')


def local(tag):
    return tag.rsplit('}', 1)[-1]


def find_all(el, name):
    return [x for x in el.iter() if local(x.tag) == name]


def find(el, name):
    r = find_all(el, name)
    return r[0] if r else None


def text(el):
    return (el.text or '').strip() if el is not None else ''


def read_folder(folder):
    root = Path(folder).resolve()
    if not root.is_dir():
        raise CtabError(f'Not a folder: {folder}')
    files, skipped = [], []
    for p in sorted(root.rglob('*')):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        segs = rel.split('/')
        if any(s.startswith('.') or s in ('node_modules', '__pycache__') for s in segs):
            continue
        if p.suffix.lower().lstrip('.') not in OK_EXT:
            skipped.append(rel)
            continue
        if not all(c in NAME_OK for c in rel):
            raise CtabError(f'File name not allowed (letters, numbers, dot, dash, underscore, no spaces): {rel}')
        files.append({'path': rel, 'size': p.stat().st_size, 'file': p})
    return root, files, skipped


def read_manifest(files):
    trexes = sorted((f for f in files if f['path'].lower().endswith('.trex')), key=lambda f: (f['path'].count('/'), f['path']))
    if not trexes:
        raise CtabError("No .trex manifest found, and no index.html to build one from. Include your extension's .trex file in the folder, or pass a compiled web app build (a folder or .zip with index.html) with --app.")
    tx = trexes[0]['file'].read_text(encoding='utf-8')
    try:
        doc = ET.fromstring(tx.encode('utf-8'))
    except ET.ParseError as e:
        raise CtabError(f'The manifest {trexes[0]["path"]} is not valid XML: {e}')
    w, d = find(doc, 'worksheet-extension'), find(doc, 'dashboard-extension')
    x = w if w is not None else d
    if x is None:
        raise CtabError('The manifest needs a worksheet-extension (viz extension) or dashboard-extension element.')
    res = {r.get('id'): text(find(r, 'text')) for r in find_all(doc, 'resource')}
    nm = find(x, 'name')
    name = (res.get(nm.get('resource-id')) if nm is not None else '') or text(nm) or x.get('id') or ''
    encs = []
    for e in find_all(x, 'encoding'):
        dn, tip, role = find(e, 'display-name'), find(e, 'tooltip'), text(find(e, 'role-type'))
        encs.append({'name': text(dn) or res.get(dn.get('resource-id') if dn is not None else '', '') or e.get('id'),
                     'role': 'Dimension' if 'dimension' in role else 'Measure',
                     'tip': text(tip) or (res.get(tip.get('resource-id'), '') if tip is not None else '')})
    if w is not None and not 1 <= len(encs) <= 4:
        raise CtabError(f'A viz extension needs 1 to 4 encodings; the manifest has {len(encs)}.')
    if find(x, 'min-api-version') is None:
        raise CtabError('The manifest is missing min-api-version.')
    url_el = find(find(x, 'source-location'), 'url') if find(x, 'source-location') is not None else None
    entry = urllib.parse.unquote(urllib.parse.urlparse(text(url_el)).path.lstrip('/'))
    if not entry or not any(f['path'] == entry for f in files):
        raise CtabError(f'Your manifest points to "{entry}" but that file is not in the folder. Pass the folder your dev server serves as its root.')
    return {'name': name[:60], 'description': text(find(x, 'description'))[:600], 'ext_id': x.get('id') or '',
            'version': x.get('extension-version') or '1.0.0', 'entry_path': entry, 'encodings': encs}


MAX_FILE = 4 * 1024 * 1024  # the API takes up to 4 MB per file; the web uploader takes larger ones


def put_all(ext_id, files):
    """Upload file by file through PUT /extensions/{id}/files/{path} (storage rules apply as for the web app)."""
    n = len(files)
    for i, f in enumerate(files, 1):
        rel = '/'.join(urllib.parse.quote(seg) for seg in f['path'].split('/'))
        call('PUT', f'/extensions/{ext_id}/files/{rel}', data=f['file'].read_bytes(), ctype='application/octet-stream')
        print(f'  uploaded {i}/{n}  {f["path"]}', flush=True)


def unpack_data_app(path):
    """A Tableau data app ships as a .twbx (a zip): Packages/<package id>/content/... is the app and Packages/<id>/extensions/*.trex
    its manifest, whose url is relative to content/. Lay that one package out as the app's own root in a temp folder; the workbook,
    Data/ and Resources/ stay behind (the data goes on a viz page as a CSV)."""
    import re, tempfile, zipfile
    pkg = re.compile(r'^(?:[^/]+/)?Packages/([^/]+)/(content|extensions)/(.+)$')
    with zipfile.ZipFile(path) as z:
        found = {}
        for n in z.namelist():
            m = pkg.match(n)
            if m and not n.endswith('/'):
                found.setdefault(m.group(1), []).append((n, m.group(2), m.group(3)))
        ids = [k for k, v in found.items() if any(kind == 'extensions' and rest.lower().endswith('.trex') for _, kind, rest in v)]
        if not ids:
            raise CtabError(f'{path} has no Packages/<id>/extensions/*.trex inside, so it is not a data app package. Pass the folder your extension serves instead.')
        if len(ids) > 1:
            raise CtabError(f'{path} holds {len(ids)} extension packages ({", ".join(ids)}). Upload one data app at a time.')
        out = Path(tempfile.mkdtemp(prefix='ctab_dataapp_'))
        for n, kind, rest in found[ids[0]]:
            if kind == 'extensions' and not rest.lower().endswith('.trex'):
                continue
            rel = rest.split('/')[-1] if kind == 'extensions' else rest
            if any(seg in ('', '.', '..') for seg in rel.split('/')):
                raise CtabError(f'Unsafe path inside the package: {n}')
            dest = out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(z.read(n))
        print(f'Data app package {ids[0]} unpacked from {Path(path).name}.')
        return str(out)


APP_DIRS = ('dist', 'build', 'out', 'www', 'public')


def has_trex(folder):
    root = Path(folder)
    for p in root.rglob('*.trex'):
        segs = p.relative_to(root).parts
        if p.is_file() and not any(s.startswith('.') or s in ('node_modules', '__pycache__') for s in segs):
            return True
    return False


def find_build_root(folder):
    """The folder that holds index.html: the folder itself, else one level down (dist/, build/, ... first), else None."""
    root = Path(folder)
    if (root / 'index.html').is_file():
        return root
    subs = [d for d in sorted(root.iterdir()) if d.is_dir() and not d.name.startswith('.') and d.name not in ('node_modules', '__pycache__') and (d / 'index.html').is_file()]
    subs.sort(key=lambda d: (APP_DIRS.index(d.name) if d.name in APP_DIRS else 99, d.name))
    return subs[0] if subs else None


def zip_is_data_app(path):
    import zipfile
    with zipfile.ZipFile(path) as z:
        return any(re.match(r'^(?:[^/]+/)?Packages/[^/]+/extensions/[^/]+\.trex$', n, re.I) for n in z.namelist())


def unpack_build_zip(path):
    """A zipped build: extract it to a temp folder (paths are checked so nothing lands outside it)."""
    import tempfile, zipfile
    out = Path(tempfile.mkdtemp(prefix='ctab_build_')).resolve()
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith('/'):
                continue
            segs = n.split('/')
            if any(sg in ('', '.', '..') or ':' in sg for sg in segs) or '\\' in n:
                raise CtabError(f'Unsafe path inside the zip: {n}')
            dest = out / n
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(z.read(n))
    print(f'Build unpacked from {Path(path).name}.')
    return str(out)


def app_meta(build_root, given):
    """Name and description for a generated manifest: package.json (in the build, or next to dist/build/out), then the folder name."""
    cands = [build_root / 'package.json']
    if build_root.name in APP_DIRS:
        cands.append(build_root.parent / 'package.json')
    pkg = {}
    for c in cands:
        try:
            pkg = json.loads(c.read_text(encoding='utf-8-sig'))
            if isinstance(pkg, dict):
                break
        except (OSError, ValueError):
            pkg = {}
        pkg = {}
    nm = pkg.get('displayName') or pkg.get('name') or ''
    if not isinstance(nm, str) or not nm.strip():
        try:  # a ctab_next.py build carries the Tableau Next app.spec.json: use its label, then its name
            sp = json.loads((build_root / 'app.spec.json').read_text(encoding='utf-8-sig'))
            nm = (sp.get('label') or sp.get('name') or '') if isinstance(sp, dict) else ''
        except (OSError, ValueError):
            nm = ''
    if not isinstance(nm, str) or not nm.strip():
        g = Path(given).resolve()
        nm = (g.parent.name if g.name in APP_DIRS else g.name) or 'Tableau app'
    nm = nm.strip().split('/')[-1].strip()[:60] or 'Tableau app'
    ds = pkg.get('description') if isinstance(pkg.get('description'), str) else ''
    return nm, (ds.strip() or 'Tableau Next data app build')[:600]


def bump_version(v):
    """Next patch version: 1.0.0 -> 1.0.1; anything unparsable -> 1.0.1."""
    m = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)', str(v or '').strip())
    return f'{m[1]}.{m[2]}.{int(m[3]) + 1}' if m else '1.0.1'


def make_trex(name, description, entry, ext_id, version='1.0.0'):
    from xml.sax.saxutils import escape
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            '<manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">\n'
            f'  <dashboard-extension id="{escape(ext_id)}" extension-version="{escape(version)}">\n'
            '    <default-locale>en_US</default-locale>\n'
            '    <name resource-id="name" />\n'
            f'    <description>{escape(description)}</description>\n'
            '    <min-api-version>1.11</min-api-version>\n'
            f'    <source-location><url>{escape(entry)}</url></source-location>\n'
            '    <permissions><permission>full data</permission></permissions>\n'
            '  </dashboard-extension>\n'
            f'  <resources><resource id="name"><text locale="en_US">{escape(name)}</text></resource></resources>\n'
            '</manifest>\n')


def read_app_folder(folder, version='1.0.0'):
    """A compiled build with no .trex: find its index.html, check the names, add a generated app.trex. Returns (root, files, skipped)."""
    import tempfile, uuid
    b = find_build_root(folder)
    if b is None:
        raise CtabError('No .trex manifest and no index.html found (looked in the folder and one level down). Pass your build output folder (dist/ or build/), or a folder with a .trex.')
    root = b.resolve()
    bad = []
    for p in sorted(root.rglob('*')):
        if not p.is_file():
            continue
        rel = p.relative_to(root).as_posix()
        if any(s.startswith('.') or s in ('node_modules', '__pycache__') for s in rel.split('/')) or p.suffix.lower().lstrip('.') not in OK_EXT:
            continue
        badc = sorted({c for c in rel if c not in NAME_OK})
        if badc:
            bad.append((rel, badc))
    if bad:
        lines = '\n'.join(f'  {r}   bad characters: {" ".join(repr(c) for c in cs)}' for r, cs in bad[:20])
        raise CtabError(f'{len(bad)} file name(s) use characters the upload does not allow (only letters, numbers and . _ @ + - are allowed). Rename them in your build config, then rebuild:\n{lines}')
    root, files, skipped = read_folder(root)
    name, desc = app_meta(root, folder)
    ext_id = 'ctab-app-' + uuid.uuid4().hex[:16]
    tf = Path(tempfile.mkdtemp(prefix='ctab_trex_')) / 'app.trex'
    tf.write_text(make_trex(name, desc, 'index.html', ext_id, version), encoding='utf-8')
    files.append({'path': 'app.trex', 'size': tf.stat().st_size, 'file': tf})
    html = (root / 'index.html').read_text(encoding='utf-8', errors='replace')
    if re.search(r'''(?:src|href)\s*=\s*["']/(?!/)''', html):
        print('  note: index.html loads files with absolute paths (/assets/...). The page is served from a sub-path, so those will 404. Rebuild with relative paths (Vite: base: "./", CRA: "homepage": ".").')
    if skipped:
        exts = sorted({Path(x).suffix.lower() or x for x in skipped})
        print(f'  note: {len(skipped)} files of types the upload does not take were left out ({", ".join(exts)}).')
    print(f'Compiled build detected in {root}: generated app.trex (dashboard-extension "{name}", id {ext_id}).')
    return root, files, skipped


def cmd_upload(folder, visibility='private', ext_id=None, app=False):
    if Path(folder).is_file() and Path(folder).suffix.lower() in ('.twbx', '.zip'):
        if Path(folder).suffix.lower() == '.zip' and not zip_is_data_app(folder):
            folder = unpack_build_zip(folder)
        else:
            folder = unpack_data_app(folder)
    if not Path(folder).is_dir():
        raise CtabError(f'Not a folder: {folder}')
    if has_trex(folder):
        if app:
            print('  --app: a .trex is already in the folder, so it is used as is.')
        root, files, skipped = read_folder(folder)
    elif app or find_build_root(folder) is not None:
        ver = '1.0.0'
        if ext_id:  # a new version of a generated-manifest app: the next patch after the live one, so the list tells versions apart
            cur = call('GET', f'/extensions/{ext_id}')
            ver = bump_version(cur.get('version') if isinstance(cur, dict) else None)
        root, files, skipped = read_app_folder(folder, ver)
    else:
        root, files, skipped = read_folder(folder)  # no .trex and no index.html: read_manifest refuses with the full message
    m = read_manifest(files)
    big = [f for f in files if f['size'] > MAX_FILE]
    if big:
        raise CtabError(f'{big[0]["path"]} is {big[0]["size"] / 1048576:.1f} MB. Over the API each file can be at most 4 MB; use the web uploader for bigger files.')
    body = dict(m, visibility=visibility, files=[{'path': f['path'], 'size': f['size']} for f in files])
    print(f'{len(files)} files, {sum(f["size"] for f in files) // 1024} KB, "{m["name"]}", opens {m["entry_path"]}' + (f' ({len(skipped)} files of other types skipped)' if skipped else ''))
    if ext_id:
        t = call('POST', f'/extensions/{ext_id}/versions', {k: body[k] for k in ('version', 'entry_path', 'encodings', 'files')})
    else:
        t = call('POST', '/extensions', body)
    put_all(t['id'], files)
    row = call('POST', f'/extensions/{t["id"]}/submit')
    print(f'Submitted. id {t["id"]}  status {row["status"]}  visibility {row["visibility"]}')
    print('It waits for approval: an admin (Chris) approves it before it goes live. Check later with:  python ctab.py status ' + t['id'])


def cmd_list():
    rows = call('GET', '/extensions')['extensions']
    if not rows:
        print('No extensions yet.')
    for r in rows:
        print(f'{r["id"]}  {r["status"]:9} {r["visibility"]:8} v{r["version"]}  {r["name"]}' + (f'  (reason: {r["reject_reason"]})' if r.get('reject_reason') else ''))


def csv_data(path):
    import csv, re
    num = re.compile(r'^-?\d+(\.\d+)?([eE][-+]?\d+)?$')
    raw = Path(path).read_bytes()
    if len(raw) > 5 * 1024 * 1024:
        raise CtabError('The CSV is over 5 MB.')
    rows = list(csv.reader(raw.decode('utf-8-sig').splitlines(), strict=False))
    rows = [r for r in rows if r and any(c != '' for c in r)]
    if len(rows) < 2:
        raise CtabError('The CSV needs a header row and at least one data row.')
    cols = [c.strip() for c in rows[0]]
    if not all(cols) or len(set(cols)) != len(cols):
        raise CtabError('Every column needs a unique name in the header row.')
    body = [r + [''] * (len(cols) - len(r)) for r in rows[1:]]
    numeric = [any(r[i].strip() for r in body) and all(r[i].strip() == '' or num.match(r[i].strip()) for r in body) for i in range(len(cols))]
    out = [[(None if r[i].strip() == '' else float(r[i]) if numeric[i] else r[i]) if numeric[i] else r[i] for i in range(len(cols))] for r in body]
    out = [[(int(v) if isinstance(v, float) and v.is_integer() else v) for v in r] for r in out]
    return {'columns': cols, 'numeric': numeric, 'rows': out}


TILE_PATH = re.compile(r'^(manifest[.]json|null/0[.]json[.]gz|L[0-9]{1,2}/-?[0-9]{1,6}_-?[0-9]{1,6}[.]json[.]gz|D/-?[0-9]{1,6}_-?[0-9]{1,6}[.]json[.]gz)$')


def tile_files(folder):
    root = Path(folder)
    if not (root / 'manifest.json').is_file():
        raise CtabError(f'{folder} has no manifest.json: it is not a ctab-tiles package. Build one with tools/ctab_tiles.py build.')
    out = []
    for f in sorted(root.rglob('*')):
        if not f.is_file():
            continue
        rel = f.relative_to(root).as_posix()
        if not TILE_PATH.match(rel):
            continue
        b = f.read_bytes()
        out.append({'path': rel, 'bytes': len(b), 'sha256': hashlib.sha256(b).hexdigest()})
    return root, out


def put_tile(url, data, rel):
    ctype = 'application/json' if rel.endswith('.json') else 'application/gzip'
    last = None
    for attempt in range(5):
        req = urllib.request.Request(url, data=data, method='PUT', headers={'Content-Type': ctype, 'User-Agent': UA, 'x-upsert': 'true'})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                r.read()
                return
        except urllib.error.HTTPError as e:
            last = f'HTTP {e.code} {e.read().decode(errors="replace")[:160]}'
            if e.code in (400, 401, 403, 413):
                break
        except (urllib.error.URLError, OSError) as e:
            last = str(e)
        time.sleep(1.5 * (attempt + 1))
    raise CtabError(f'Could not upload {rel}: {last}')


def publish_tiles(slug, folder, create=None):
    """begin -> sign (500 at a time) -> PUT every file (8 at a time, retried) -> commit. Returns the commit result."""
    root, files = tile_files(folder)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    total = sum(f['bytes'] for f in files)
    print(f'Tiles: {len(files)} files, {total / 1048576:.1f} MB', flush=True)
    b = call('POST', f'/vizpages/{slug}/tiles/begin', {'manifest': manifest, 'files': files, 'create': create})
    ver, slug = b['version'], b['slug']
    done = 0
    try:
        for i in range(0, len(files), b.get('max_sign_batch', 500)):
            batch = files[i:i + b.get('max_sign_batch', 500)]
            urls = call('POST', f'/vizpages/{slug}/tiles/{ver}/sign', {'paths': [f['path'] for f in batch]})['urls']
            with concurrent.futures.ThreadPoolExecutor(max_workers=b.get('upload_concurrency', 8)) as ex:
                futs = [ex.submit(put_tile, urls[f['path']], (root / f['path']).read_bytes(), f['path']) for f in batch]
                for fu in futs:
                    fu.result()
            done += len(batch)
            print(f'  uploaded {done}/{len(files)}', flush=True)
        return call('POST', f'/vizpages/{slug}/tiles/{ver}/commit', {})
    except BaseException:
        try:
            call('DELETE', f'/vizpages/{slug}/tiles/{ver}')
        except Exception:
            pass
        raise


POSTER_MAX = 2 * 1024 * 1024
STATS_JS = """async ([b64, mime]) => {
  const bmp = await createImageBitmap(await (await fetch('data:' + mime + ';base64,' + b64)).blob());
  const c = document.createElement('canvas'); c.width = 160; c.height = 100;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0, 160, 100);
  const d = x.getImageData(0, 0, 160, 100).data, n = 160 * 100, m = new Map();
  for (let i = 0; i < d.length; i += 4) { const k = (d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4); m.set(k, (m.get(k) || 0) + 1); }
  const counts = [...m.values()].sort((a, b) => b - a);
  let cover = 0, acc = 0; while (acc < 0.95 * n && cover < counts.length) acc += counts[cover++];
  return { w: bmp.width, h: bmp.height, top: counts[0] / n, colors: counts.length, cover };
}"""


def poster_kind(data):
    if data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR':
        return 'image/png'
    if data[:3] == b'\xff\xd8\xff' and len(data) >= 100:
        return 'image/jpeg'
    return None


def poster_blank(p, data, mime):
    """None when the picture looks like a real viz, else the reason. Refuses a picture that is mostly one color (more than 92 percent in one 4-bit color bucket)
    or whose 5 most common color buckets cover 95 percent of it (a near-empty page). Counting buckets that EACH hold half a percent wrongly refused a
    busy picture (a gradient or a photo-like map spreads over hundreds of small buckets), so the test is how many buckets it takes to cover the picture.
    Decoded in Chromium (Playwright) so ctab.py needs no image library."""
    b = p.chromium.launch()
    try:
        try:
            st = b.new_page().evaluate(STATS_JS, [base64.b64encode(data).decode(), mime])
        except Exception:
            return 'the picture could not be decoded (a damaged or truncated file)'
    finally:
        b.close()
    print(f'  picture {st["w"]}x{st["h"]}, biggest single color {st["top"] * 100:.1f}%, {st["colors"]} colors, {st["cover"]} cover 95%')
    if st['top'] > 0.92:
        return f'{st["top"] * 100:.0f}% of the picture is one color'
    if st['cover'] < 6:
        return f'only {st["cover"]} colors make up 95% of the picture, so it is mostly empty'
    return None


def poster_playwright():
    try:
        from playwright.sync_api import sync_playwright
        return sync_playwright
    except ImportError:
        return None


def poster_capture(slug, size, accept):
    sp = poster_playwright()
    if not sp:
        raise CtabError('--capture needs Playwright. Install it with: pip install playwright   then: python -m playwright install chromium   (or make the picture yourself and use --image)')
    w, h = size
    page = call('GET', f'/vizpages/{slug}')
    url = page['url'] + ('&' if '?' in page['url'] else '?') + 'live=1'
    print(f'Opening {url} at {w}x{h} ...')
    with sp() as p:
        b = p.chromium.launch()
        try:
            pg = b.new_page(viewport={'width': w, 'height': h}, device_scale_factor=1)
            pending = {'n': 0}
            pg.on('request', lambda r: pending.__setitem__('n', pending['n'] + 1))
            pg.on('requestfinished', lambda r: pending.__setitem__('n', pending['n'] - 1))
            pg.on('requestfailed', lambda r: pending.__setitem__('n', pending['n'] - 1))
            pg.goto(url, wait_until='load', timeout=120000)
            t0, last, same_since, quiet_since, shot = time.time(), None, None, None, None
            while True:
                shot = pg.screenshot(type='png')
                digest = hashlib.sha256(shot).hexdigest()
                now = time.time()
                if digest != last:
                    last, same_since = digest, now
                if pending['n'] > 0:
                    quiet_since = None
                elif quiet_since is None:
                    quiet_since = now
                if now - same_since >= 2.0 and quiet_since is not None and now - quiet_since >= 2.0:
                    break
                if now - t0 > 120:
                    if not accept:
                        raise CtabError('The page did not settle in 120 seconds (it kept loading or changing). Nothing was uploaded. Use --accept-unsettled to take the picture anyway.')
                    print('  warning: the page did not settle in 120 seconds; using the last picture')
                    break
                time.sleep(0.5)
            print(f'  settled after {time.time() - t0:.1f}s')
            if len(shot) > POSTER_MAX:
                shot = pg.screenshot(type='jpeg', quality=88)
        finally:
            b.close()
    return shot


def cmd_poster(rest):
    if not rest or rest[0].startswith('-'):
        print(__doc__); return 2
    slug, opt, i, capture, remove, accept = rest[0], {}, 1, False, False, False
    while i < len(rest):
        k = rest[i]
        if k in ('--image', '--size') and i + 1 < len(rest):
            opt[k[2:]] = rest[i + 1]; i += 2
        elif k == '--capture':
            capture = True; i += 1
        elif k == '--remove':
            remove = True; i += 1
        elif k == '--accept-unsettled':
            accept = True; i += 1
        else:
            raise CtabError(f'Unknown or incomplete option: {k}')
    if remove:
        if capture or 'image' in opt:
            raise CtabError('--remove stands alone.')
        call('DELETE', f'/vizpages/{slug}/poster')
        print('Poster removed.')
        return 0
    if capture == ('image' in opt):
        raise CtabError('Give exactly one of --capture, --image FILE or --remove.')
    m = re.fullmatch(r'(\d{3,4})x(\d{3,4})', opt.get('size', '1280x790'))
    if not m:
        raise CtabError('--size is WIDTHxHEIGHT, for example 1280x790.')
    sp = poster_playwright()
    if capture:
        data = poster_capture(slug, (int(m.group(1)), int(m.group(2))), accept)
    else:
        data = Path(opt['image']).read_bytes()
    mime = poster_kind(data)
    if not mime:
        raise CtabError('The poster must be a PNG or JPEG picture (the file itself is checked, not its name).')
    if len(data) > POSTER_MAX:
        raise CtabError(f'The poster is {len(data) / 1048576:.1f} MB; the limit is 2 MB. Save it as a JPEG or make it smaller.')
    if sp:
        with sp() as p:
            why = poster_blank(p, data, mime)
        if why:
            raise CtabError(f'Refused: {why}. Nothing was uploaded.')
    else:
        print('  note: Playwright is not installed, so the picture was not checked for a blank page. Install it (pip install playwright) for that check.')
    r = call('PUT', f'/vizpages/{slug}/poster', data=data, ctype=mime)
    print(f'Poster set for {r["slug"]} ({len(data)} bytes, {mime}).')
    print(r.get('poster_url') or '')
    print('Now republish the Tableau Public workbook with the same title (Yes to overwrite). The card updates about 2 minutes later.')
    return 0


def cmd_vizpage(a):
    if not a:
        print(__doc__); return 2
    sub, rest = a[0], a[1:]
    if sub == 'poster':
        return cmd_poster(rest)
    if sub == 'list':
        for r in call('GET', '/vizpages')['vizpages']:
            print(f'{r["slug"]:30} {r["status"]:12} {r.get("visibility", ""):8} {r["rows"]} rows  {r["url"]}')
        return 0
    if sub == 'publish-again' and len(rest) == 3 and rest[1] == '--tiles':
        r = publish_tiles(rest[0], rest[2])
        print(f'Published a new tile package for {r["slug"]}')
        print(r['url'])
        return 0
    if sub in ('status', 'unpublish', 'publish-again', 'delete') and len(rest) == 1:
        s = rest[0]
        if sub == 'status':
            print(json.dumps(call('GET', f'/vizpages/{s}'), indent=2))
        elif sub == 'delete':
            call('DELETE', f'/vizpages/{s}'); print('Deleted.')
        else:
            r = call('PATCH', f'/vizpages/{s}', {'status': 'unpublished' if sub == 'unpublish' else 'live'}); print(f'{r["slug"]} is now {r["status"]}')
        return 0
    if sub == 'visibility' and len(rest) == 2 and rest[1] in ('public', 'private'):
        r = call('PATCH', f'/vizpages/{rest[0]}', {'visibility': rest[1]}); print(f'{r["slug"]} is now {r["visibility"]}')
        return 0
    if sub == 'publish':
        opt, maps, srcs, i = {}, {}, [], 0
        while i < len(rest):
            k = rest[i]
            if k in ('--name', '--extension', '--csv', '--tiles', '--settings', '--prefix', '--slug', '--visibility', '--datasource') and i + 1 < len(rest):
                opt[k[2:]] = rest[i + 1]; i += 2
            elif k == '--source' and i + 1 < len(rest):
                srcs.append(rest[i + 1]); i += 2
            elif k == '--map' and i + 1 < len(rest) and '=' in rest[i + 1]:
                e, c = rest[i + 1].split('=', 1); maps[e] = c; i += 2
            else:
                raise CtabError(f'Unknown or incomplete option: {k}')
        if 'tiles' in opt:
            if 'csv' in opt or srcs:
                raise CtabError('A page holds a CSV or a tile package, not both: use --tiles OR --csv.')
            for need in ('name', 'extension'):
                if need not in opt:
                    raise CtabError(f'--{need} is required.')
            if opt.get('visibility', vizpage_default_visibility()) not in ('public', 'private'):
                raise CtabError('--visibility must be public or private.')
            settings = {}
            if 'settings' in opt:
                try:
                    settings = json.loads(Path(opt['settings']).read_text(encoding='utf-8'))
                except ValueError:
                    raise CtabError('The settings file is not valid JSON.')
            slug = opt.get('slug') or re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', opt['name'].lower())).strip('-')[:60]
            mfp = Path(opt['tiles']) / 'manifest.json'
            mf = json.loads(mfp.read_text(encoding='utf-8')) if mfp.is_file() else {}
            fields = [d.get('caption') for d in (mf.get('dims') or []) + (mf.get('detail_dims') or [])] or [mf.get('lat')]
            if not maps and fields and fields[0]:   # a page needs one mapping; with no --map, link the first dimension to itself
                maps = {fields[0]: fields[0]}
            r = publish_tiles(slug, opt['tiles'], {'name': opt['name'], 'extension': opt['extension'], 'mapping': maps, 'settings': settings,
                                                    'prefix': opt.get('prefix', ''), 'visibility': opt.get('visibility', vizpage_default_visibility())})
            print(f'Published {r["slug"]}: {r.get("rows", 0)} rows in tiles, {r.get("visibility", "private")}')
            print('Paste this into a Tableau Web Page object:')
            print(r['url'])
            return 0
        for need in ('name', 'extension', 'csv'):
            if need not in opt:
                raise CtabError(f'--{need} is required.')
        d = csv_data(opt['csv'])
        if not maps and 'datasource' in opt and d.get('columns'):   # a data app reads queries, not encodings: the server still wants one mapping
            maps = {'field': d['columns'][0]}
        body = {'name': opt['name'], 'extension': opt['extension'], 'mapping': maps, **d}
        # Tableau data apps: --datasource names the main CSV's data source as the app looks it up; each --source CSV is one more
        # data source, named by its file name (Returns.csv -> "Returns").
        if 'datasource' in opt:
            body['datasource'] = opt['datasource']
        if len(srcs) > 7:
            raise CtabError('Up to 7 --source CSVs.')
        if srcs:
            body['sources'] = [dict(csv_data(f), name=Path(f).stem[:100]) for f in srcs]
        if 'settings' in opt:
            try:
                body['settings'] = json.loads(Path(opt['settings']).read_text(encoding='utf-8'))
            except ValueError:
                raise CtabError('The settings file is not valid JSON.')
        if opt.get('visibility', vizpage_default_visibility()) not in ('public', 'private'):
            raise CtabError('--visibility must be public or private.')
        for k in ('prefix', 'slug', 'visibility'):
            if k in opt:
                body[k] = opt[k]
        body.setdefault('visibility', vizpage_default_visibility())
        r = call('POST', '/vizpages', body)
        print(f'Published {r["slug"]}: {len(d["rows"])} rows, {r.get("visibility", "private")}')
        print('Paste this into a Tableau Web Page object:')
        print(r['url'])
        return 0
    print(__doc__); return 2


def main(argv):
    if not argv or argv[0] in ('-h', '--help', 'help'):
        print(__doc__)
        return 0
    c, a = argv[0], argv[1:]
    if c == 'vizpage':
        return cmd_vizpage(a)
    out = None
    if '-o' in a:
        i = a.index('-o'); out = a[i + 1]; a = a[:i] + a[i + 2:]
    app = '--app' in a
    a = [x for x in a if x != '--app']
    vis = 'private'
    if '--visibility' in a:
        i = a.index('--visibility'); vis = a[i + 1]; a = a[:i] + a[i + 2:]
    if c == 'me':
        j = call('GET', '/me')
        print(f'{j["email"]}: {j["quota"]["used"]} of {j["quota"]["limit"]} free extensions used' + ('; C-Tableau Unlimited is on' if j['unlocked'] else ''))
    elif c == 'upload' and len(a) == 1:
        cmd_upload(a[0], vis, app=app)
    elif c == 'update' and len(a) == 2:
        cmd_upload(a[1], vis, ext_id=a[0])
    elif c == 'list':
        cmd_list()
    elif c == 'status' and len(a) == 1:
        print(json.dumps(call('GET', f'/extensions/{a[0]}'), indent=2))
    elif c == 'visibility' and len(a) == 2 and a[1] in ('public', 'private'):
        r = call('PATCH', f'/extensions/{a[0]}', {'visibility': a[1]})
        print(f'{r["name"]} is now {r["visibility"]}')
    elif c == 'trex' and len(a) == 1:
        data = call('GET', f'/extensions/{a[0]}/trex', raw=True)
        Path(out or 'extension.trex').write_bytes(data)
        print('Saved ' + (out or 'extension.trex') + '. It carries a link made for you and this extension: keep it to yourself.')
    elif c == 'remove' and len(a) == 1:
        call('DELETE', f'/extensions/{a[0]}')
        print('Removed.')
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except CtabError as e:
        print('ctab: ' + str(e), file=sys.stderr)
        sys.exit(1)
