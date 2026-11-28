#!/usr/bin/env python3
"""ctab_next.py: turn a Tableau Next data app's SOURCE into a plain static web app for a C-Tableau viz page. Python 3 standard library only.

    python ctab_next.py build SRC_DIR --out OUT_DIR --csv data.csv [--entry src/pages/X.tsx]
    python ctab_next.py check OUT_DIR [--csv data.csv]

Then:  python ctab.py upload OUT_DIR --app   ->  (wait for approval)  ->  python ctab.py vizpage publish --extension ID --csv data.csv --datasource "<sourceName>" ...

Prerequisite: Node 18 or newer (https://nodejs.org). Everything else is fetched by npx/npm into a cache folder (~/.ctab-next-cache).
SRC_DIR is never modified. The shim in tools/ctab_next_shim/ stands in for @analytics/data-app-sdk and answers useQuery(id) from the viz page's own rows.
build writes OUT_DIR/ctab-fields.json: semantic field name -> CSV column. Edit it if a match is wrong, then re-run `check`.
"""
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ctab  # noqa: E402  (OK_EXT, NAME_OK, MAX_FILE: the same limits the uploader enforces)

ESBUILD = 'esbuild@0.25.5'
REACT = ('react@18.3.1', 'react-dom@18.3.1')
SHIM = Path(__file__).resolve().parent / 'ctab_next_shim'
CACHE = Path(os.environ.get('CTAB_NEXT_CACHE') or (Path.home() / '.ctab-next-cache'))
MIN_FILES = 2


class Fail(Exception):
    pass


def node_ok():
    exe = shutil.which('node')
    if not exe:
        raise Fail('Node.js is not installed. Install Node 18 or newer from https://nodejs.org (the LTS button), reopen the terminal, and run this again.')
    v = subprocess.run([exe, '-v'], capture_output=True, text=True).stdout.strip()
    m = re.match(r'v(\d+)', v)
    if not m or int(m.group(1)) < 18:
        raise Fail(f'Node {v or "(unknown)"} is too old. Install Node 18 or newer from https://nodejs.org and run this again.')
    return v


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if p.returncode != 0:
        raise Fail('Command failed: ' + ' '.join(map(str, cmd[:4])) + ' ...\n' + (p.stdout + p.stderr)[-1800:])
    return p


def ensure_react():
    nm = CACHE / 'node_modules'
    if (nm / 'react' / 'package.json').exists() and (nm / 'react-dom' / 'package.json').exists():
        return nm
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / 'package.json').write_text('{"name":"ctab-next-cache","private":true}', encoding='utf-8')
    print('  installing react 18.3.1 into', CACHE)
    run([shutil.which('npm') or 'npm', 'install', '--no-audit', '--no-fund', '--prefix', str(CACHE), *REACT])
    return nm


# ---- field map: semantic names (Orders.Sub_Category7) -> CSV captions (Sub-Category)
def norm(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def match_key(semantic):
    """normalised forms to try, most exact first: the name without its Object. prefix, then also without its trailing digits"""
    base = semantic.split('.', 1)[-1]
    return [norm(base), norm(re.sub(r'[0-9]+$', '', base))]


def spec_fields(spec):
    seen = {}
    for q in spec.get('queries', []):
        qq = q.get('query', {})
        qq = qq.get('query', qq)
        for f in qq.get('fields', []) + qq.get('filters', []):
            if f.get('field'):
                seen[f['field']] = 1
    return list(seen)


def csv_header(path):
    with open(path, newline='', encoding='utf-8-sig') as fh:
        return next(csv.reader(fh))


def build_field_map(fields, header):
    by = {}
    for h in header:
        by.setdefault(norm(h), []).append(h)
    ok, bad = {}, []
    for f in fields:
        pick = None
        for k in match_key(f):
            hit = by.get(k, [])
            if len(hit) == 1:
                pick = hit[0]
                break
            if len(hit) > 1:
                bad.append((f, 'ambiguous: ' + ', '.join(hit)))
                pick = False
                break
        if pick is None:
            bad.append((f, 'no CSV column matches'))
        elif pick:
            ok[f] = pick
    return ok, bad


def find_entry(src, entry):
    if entry:
        p = Path(entry) if Path(entry).is_absolute() else (src / entry)
        if not p.exists():
            raise Fail(f'--entry {entry} does not exist under {src}.')
        return p.resolve()
    for n in ('src/app.tsx', 'src/app.jsx', 'src/main.tsx', 'src/main.jsx'):
        if (src / n).exists():
            return (src / n).resolve()
    pd = src / 'src' / 'pages'
    pages = sorted(p for p in pd.glob('*') if p.suffix in ('.tsx', '.jsx')) if pd.is_dir() else []
    if len(pages) == 1:
        return pages[0].resolve()
    raise Fail('Cannot pick the page: ' + (f'{len(pages)} files in src/pages ({", ".join(p.name for p in pages)}). ' if pages else 'no src/pages/*.tsx. ')
               + 'Pass --entry src/pages/YourPage.tsx.')


def build(src, out, entry_arg, csv_path, sabotage=False):
    node = node_ok()
    src, out = Path(src).resolve(), Path(out).resolve()
    if not src.is_dir():
        raise Fail(f'SRC_DIR {src} is not a folder.')
    if out == src or src in out.parents or out in src.parents:
        raise Fail('OUT_DIR must be a separate folder, outside SRC_DIR (and not holding it).')
    spec_p = src / 'src' / 'app.spec.json'
    if not spec_p.exists():
        spec_p = next(iter(src.rglob('app.spec.json')), None)
    if not spec_p:
        raise Fail('No app.spec.json found in SRC_DIR. A Tableau Next data app has one at src/app.spec.json.')
    spec = json.loads(spec_p.read_text(encoding='utf-8'))
    page = find_entry(src, entry_arg)
    print(f'build: node {node}, spec {spec_p.relative_to(src)}, page {page.relative_to(src)}, queries {[q.get("id") for q in spec.get("queries", [])]}')
    fields = spec_fields(spec)
    fmap = {}
    if csv_path:
        header = csv_header(csv_path)
        fmap, bad = build_field_map(fields, header)
        print(f'field map ({len(fmap)} of {len(fields)} matched against {len(header)} CSV columns):')
        for f in fields:
            print(f'  {f:34} -> {fmap.get(f, "???")}')
        if bad:
            raise Fail('RED: these fields have no single CSV column:\n' + '\n'.join(f'  {f}  ({why})' for f, why in bad)
                       + '\nThe CSV header is: ' + ', '.join(header)
                       + '\nFix the CSV header, or build without --csv, write the mapping yourself in OUT_DIR/ctab-fields.json and run `check --csv`.')
    else:
        for f in fields:
            fmap[f] = f.split('.', 1)[-1]
        print('field map UNVERIFIED (no --csv given): guessed names written; run `check OUT_DIR --csv data.csv` before upload.')
    nm = ensure_react()
    npx = shutil.which('npx') or 'npx'
    tmp = Path(tempfile.mkdtemp(prefix='ctab-next-'))
    try:
        (tmp / 'spec.js').write_text('export default ' + json.dumps(spec) + ';', encoding='utf-8')
        (tmp / 'entry.jsx').write_text(
            "import React from 'react';\nimport { createRoot } from 'react-dom/client';\n"
            f"import * as Page from {json.dumps(page.as_posix())};\n"
            "var C = Page.default || Object.keys(Page).map(function (k) { return Page[k]; }).filter(function (v) { return typeof v === 'function'; })[0];\n"
            "if (!C) throw new Error('C-Tableau: the page file exports no component.');\n"
            "createRoot(document.getElementById('root')).render(React.createElement(C));\n", encoding='utf-8')
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        env = dict(os.environ, NODE_PATH=str(nm))
        cmd = [npx, '--yes', ESBUILD, str(tmp / 'entry.jsx'), '--bundle', '--minify', '--format=iife', '--target=es2019', '--jsx=automatic',
               f'--outfile={out / "index.js"}', '--asset-names=assets/[name]-[hash]',
               '--loader:.woff=file', '--loader:.woff2=file', '--loader:.ttf=file', '--loader:.otf=file', '--loader:.png=file', '--loader:.jpg=file',
               '--loader:.svg=file', '--loader:.gif=file', '--loader:.webp=file', '--public-path=.', '--log-level=warning',
               f'--alias:@analytics/data-app-sdk/react={SHIM / "react.js"}', f'--alias:@analytics/data-app-sdk={SHIM / "sdk.js"}',
               f'--alias:@ctab/spec={tmp / "spec.js"}', f'--define:__CTAB_SABOTAGE__={"true" if sabotage else "false"}',
               '--define:process.env.NODE_ENV="production"']
        run(cmd, env=env, cwd=str(tmp))
        for d in ('public', 'src/assets', 'assets'):   # plain assets the page loads by URL at run time
            if (src / d).is_dir():
                shutil.copytree(src / d, out / ('.' if d == 'public' else 'assets'), dirs_exist_ok=True)
        title = re.sub(r'[<>&]', '', str(spec.get('label') or spec.get('name') or 'Tableau Next app'))
        (out / 'index.html').write_text(
            '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{title}</title>'
            + ('<link rel="stylesheet" href="./index.css">' if (out / 'index.css').exists() else '')
            + '</head><body><div id="root"></div><script src="./index.js"></script></body></html>\n', encoding='utf-8')
        (out / 'ctab-fields.json').write_text(json.dumps(fmap, indent=2), encoding='utf-8')
        (out / 'app.spec.json').write_text(json.dumps(spec, indent=2), encoding='utf-8')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f'built {out}: ' + ', '.join(sorted(p.relative_to(out).as_posix() for p in out.rglob('*') if p.is_file())))


def check(out, csv_path=None):
    out = Path(out)
    if not out.is_dir():
        raise Fail(f'{out} is not a folder.')
    files = [p for p in out.rglob('*') if p.is_file()]
    print(f'check: examined {len(files)} files in {out}')
    problems = []
    if len(files) < MIN_FILES:
        problems.append(f'RED: only {len(files)} files (a build has at least {MIN_FILES}); nothing real was examined.')
    if not (out / 'index.html').exists():
        problems.append('index.html is missing at the root.')
    total = 0
    for p in files:
        rel = p.relative_to(out).as_posix()
        total += p.stat().st_size
        ext = p.suffix.lower().lstrip('.')
        if ext in ('ts', 'tsx', 'jsx'):
            problems.append(f'{rel}: source file left in the build (.{ext}); the page must be compiled.')
        elif ext not in ctab.OK_EXT:
            problems.append(f'{rel}: type .{ext} is not accepted by ctab.py upload.')
        if not all(c in ctab.NAME_OK for c in rel):
            problems.append(f'{rel}: file name has a character ctab.py refuses (use letters, numbers and . _ @ + -).')
        if p.stat().st_size > ctab.MAX_FILE:
            problems.append(f'{rel}: over 4 MB.')
        if ext in ('html', 'htm', 'css', 'js', 'mjs'):
            t = p.read_text(encoding='utf-8', errors='replace')
            if ext in ('html', 'htm'):
                for m in re.finditer(r'''<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)''', t, re.I):
                    u = m.group(1)
                    if re.match(r'(https?:)?//', u):
                        problems.append(f'{rel}: remote URL {u} (a viz page allows its own files only).')
                    elif u.startswith('/'):
                        problems.append(f'{rel}: absolute path {u} (use ./ relative paths).')
            if ext == 'css':
                for m in re.finditer(r'''url\(\s*["']?([^"')]+)''', t):
                    u = m.group(1)
                    if re.match(r'(https?:)?//', u):
                        problems.append(f'{rel}: remote URL in css: {u}')
                    elif u.startswith('/'):
                        problems.append(f'{rel}: absolute path in css: {u}')
            if ext in ('js', 'mjs'):
                for m in re.finditer(r'''(?:import\s*\(|importScripts\s*\()\s*["'](https?://[^"']+)''', t):
                    problems.append(f'{rel}: remote script import {m.group(1)}')
                if re.search(r'''["']/assets/''', t):
                    problems.append(f'{rel}: absolute /assets path in code.')
    if len(files) > 300 or total > 30 * 1024 * 1024:
        problems.append(f'{len(files)} files / {total // 1024} KB exceeds the upload limit (300 files, 30 MB).')
    fm = out / 'ctab-fields.json'
    if fm.exists():
        fmap = json.loads(fm.read_text(encoding='utf-8'))
        if csv_path:
            header = set(csv_header(csv_path))
            print(f'check: field map {len(fmap)} entries compared with the CSV header ({len(header)} columns)')
            problems += [f'ctab-fields.json: column not in the CSV: {k} -> {v}' for k, v in fmap.items() if v not in header]
        else:
            print('check: field map NOT compared with a CSV (no --csv): SKIP')
    else:
        problems.append('ctab-fields.json is missing: the app cannot map fields to CSV columns.')
    if problems:
        print('RED')
        for x in problems:
            print('  -', x)
        return 1
    print(f'GREEN: {len(files)} files, {total // 1024} KB')
    return 0


def main(argv):
    a = list(argv)
    if len(a) < 2 or a[0] not in ('build', 'check'):
        print(__doc__)
        return 2

    def opt(name):
        if name in a:
            i = a.index(name)
            v = a[i + 1] if i + 1 < len(a) else None
            del a[i:i + 2]
            return v
        return None
    try:
        if a[0] == 'build':
            sab = '--sabotage-ignore-filters' in a
            a[:] = [x for x in a if x != '--sabotage-ignore-filters']
            out, entry, csv_p = opt('--out'), opt('--entry'), opt('--csv')
            if not out or len(a) < 2:
                raise Fail('usage: ctab_next.py build SRC_DIR --out OUT_DIR --csv data.csv [--entry src/pages/X.tsx]')
            build(a[1], out, entry, csv_p, sab)
            return check(out, csv_p)
        csv_p = opt('--csv')
        return check(a[1], csv_p)
    except Fail as e:
        print('ERROR:', e)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
