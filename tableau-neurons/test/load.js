/* Loads the vendored d3 modules and the pure source files into one vm context, the way the browser page does. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');

function load(files) {
  const sandbox = { console, Math, Date, Object, Array, String, Number, JSON, isFinite, parseFloat, parseInt, Set, Map, Promise };
  sandbox.window = undefined;
  const ctx = vm.createContext(sandbox);
  const list = ['lib/ctab-panel/ctab-panel.js', 'lib/d3/d3-path.min.js', 'lib/d3/d3-shape.min.js', 'lib/d3/d3-hierarchy.min.js'].concat(files || []);
  list.forEach(f => vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  return ctx;
}

function csv(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const head = text.shift().split(',');
  return text.map(l => { const c = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = c[i]; }); return o; });
}

module.exports = { load, csv, root };
