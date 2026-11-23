/* Reef - layout math. Pure functions, no DOM, so node can test them.
 * Needs d3-hierarchy (lib/d3-hierarchy.min.js) as global d3.
 *
 *   buildTree   rows -> d3 hierarchy (1 to 3 levels, same path merged and summed)
 *   pack        nested circle packing in a fixed 1000-unit square
 *   viewFor     focus node -> scale and offset onto the screen
 *   lerpFocus   zoom interpolation between two focus circles
 *   planLabels  chip labels that sit inside their own circle and never overlap
 */
(function (global) {
  'use strict';
  var d3 = global.d3;
  var SPAN = 1000;

  function nameOf(v) { return v === null || v === undefined || v === '' ? '(blank)' : String(v); }

  /* Same word, ignoring case, spacing and a plural s: keep the parent's name. */
  function foldName(parent, child) {
    var stem = function (t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/(es|s)$/, ''); };
    var a = stem(parent), b = stem(child);
    if (child === '(blank)' || !b || a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0) return parent;
    return parent + ': ' + child;
  }

  /* rows: [{ path: [l1, l2, l3], value, color, tuple }]. Returns { root, dropped }. */
  function buildTree(rows, levels, sortMode) {
    var top = { name: 'All', depthIdx: -1, kids: new Map(), pathNames: [] };
    var dropped = 0;
    rows.forEach(function (r) {
      var v = Number(r.value);
      if (!isFinite(v) || v <= 0) { dropped++; return; }
      var node = top;
      for (var i = 0; i < levels; i++) {
        var nm = nameOf(r.path[i]);
        var next = node.kids.get(nm);
        if (!next) {
          next = { name: nm, depthIdx: i, kids: new Map(), pathNames: node.pathNames.concat([nm]) };
          node.kids.set(nm, next);
        }
        node = next;
      }
      node.leafValue = (node.leafValue || 0) + v;
      node.tuples = (node.tuples || []).concat(r.tuple === undefined ? [] : [r.tuple]);
      if (typeof r.color === 'number' && isFinite(r.color)) { node.cw = (node.cw || 0) + v; node.cs = (node.cs || 0) + v * r.color; }
      else if (r.color !== null && r.color !== undefined && r.color !== '') {
        node.cat = node.cat || {};
        var ck = String(r.color);
        node.cat[ck] = (node.cat[ck] || 0) + v;
      }
    });
    /* A group with exactly one child draws a ring hugging its only circle. Fold the two
     * into one circle (the child's children and path), named for the parent, or
     * "Parent: Child" when the child's name adds something. The root is never folded. */
    function collapse(d, isRoot) {
      while (!isRoot && d.children && d.children.length === 1) {
        var kid = d.children[0];
        kid.name = foldName(d.name, kid.name);
        d = kid;
      }
      if (d.children) d.children = d.children.map(function (c) { return collapse(c, false); });
      return d;
    }
    function plain(n) {
      var o = { name: n.name, pathNames: n.pathNames, depthIdx: n.depthIdx };
      if (n.kids.size) o.children = Array.from(n.kids.values()).map(plain);
      else { o.leafValue = n.leafValue || 0; o.tuples = n.tuples || []; o.cw = n.cw; o.cs = n.cs; o.cat = n.cat; }
      return o;
    }
    var data = collapse(plain(top), true);
    var root = d3.hierarchy(data, function (d) { return d.children; }).sum(function (d) { return d.children ? 0 : d.leafValue; });
    if (sortMode === 'size') root.sort(function (a, b) { return b.value - a.value || (a.data.name < b.data.name ? -1 : 1); });
    else if (sortMode === 'name') root.sort(function (a, b) { return a.data.name < b.data.name ? -1 : (a.data.name > b.data.name ? 1 : 0); });
    return { root: root, dropped: dropped };
  }

  function pack(root, gap) {
    d3.pack().size([SPAN, SPAN]).padding(gap)(root);
    return root;
  }

  /* Screen mapping for a focus circle. `top` reserves room for the breadcrumb, `bottom` for the legend. */
  function viewFor(focus, w, h, top, bottom, margin) {
    var availH = Math.max(40, h - top - bottom), avail = Math.max(40, Math.min(w, availH));
    var k = Math.max(0.0001, (avail / 2 - margin) / focus.r);
    return { k: k, ox: w / 2 - focus.x * k, oy: top + availH / 2 - focus.y * k };
  }
  /* Interpolate focus {x,y,r}: width geometric, centre moved so the zoom feels anchored (van Wijk style, simplified). */
  function lerpFocus(a, b, e) {
    var r = a.r * Math.pow(b.r / a.r, e);
    var denom = a.r - b.r;
    var u = Math.abs(denom) < 1e-9 ? e : (a.r - r) / denom;
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, r: r };
  }
  function easeInOut(t) { t = t < 0 ? 0 : (t > 1 ? 1 : t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* ---- labels ----
   * cands: [{ id, group, x, y, r, text, prio }] in screen px.
   * measure(text) -> text width in px at the label font. Returns placed chips.
   * A chip sits wholly inside its circle (corner test) and wholly inside bounds, and
   * never touches another chip. Group chips prefer the top of their circle so they
   * leave the middle to the children. */
  function planLabels(cands, bounds, measure, fontPx, padX, padY) {
    var h = Math.round(fontPx * 1.0 + padY * 2), placed = [];
    var order = cands.slice().sort(function (a, b) { return (a.prio - b.prio) || (b.r - a.r); });
    function inside(cx, cy, r, left, top, w, hh) {
      var rr = r - 2, xs = [left, left + w], ys = [top, top + hh];
      for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
        var dx = xs[i] - cx, dy = ys[j] - cy;
        if (dx * dx + dy * dy > rr * rr) return false;
      }
      return true;
    }
    function hit(l, t, w, hh) {
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];
        if (l < p.x + p.w + 3 && l + w + 3 > p.x && t < p.y + p.h + 3 && t + hh + 3 > p.y) return true;
      }
      return false;
    }
    order.forEach(function (c) {
      var variants = c.texts || [c.text];
      for (var vi = 0; vi < variants.length; vi++) {
        var text = variants[vi];
        var tw = Math.ceil(measure(text)) + padX * 2;
        var spots = [];
        if (c.group) {
          var half = tw / 2, rr = c.r - 2;
          if (half < rr) spots.push(c.y - Math.sqrt(rr * rr - half * half) + 1);   // as high as the circle allows
          spots.push(c.y - h / 2);
        } else spots.push(c.y - h / 2);
        for (var s = 0; s < spots.length; s++) {
          var left = c.x - tw / 2, top = spots[s];
          if (!inside(c.x, c.y, c.r, left, top, tw, h)) continue;
          if (left < bounds.x0 || left + tw > bounds.x1 || top < bounds.y0 || top + h > bounds.y1) continue;
          if (hit(left, top, tw, h)) continue;
          placed.push({ id: c.id, x: left, y: top, w: tw, h: h, text: text });
          return;
        }
      }
    });
    return placed;
  }

  global.RF = global.RF || {};
  global.RF.layout = { SPAN: SPAN, buildTree: buildTree, pack: pack, viewFor: viewFor, lerpFocus: lerpFocus, easeInOut: easeInOut, planLabels: planLabels, nameOf: nameOf };
})(typeof window !== 'undefined' ? window : globalThis);
