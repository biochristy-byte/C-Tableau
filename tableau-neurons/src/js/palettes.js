/* Neurons Viz Extension - colour palettes and colour maths.
 *
 * Categorical palettes are colourblind-conscious by default. The ramp helpers
 * interpolate in linear-light sRGB rather than naively in gamma space, so a
 * light-to-dark ramp does not go muddy through the middle.
 */
(function (global) {
  'use strict';

  /* Group colour sets. Each is tuned for a dark background; resolveTheme()
   * pulls any colour toward the ink until it clears 3 to 1 on the actual
   * background, so the same set serves a white sheet too. */
  var PALETTES = {
    diver: ['#ff6b6b', '#b9a2ff', '#7be0a7', '#6fa8ff', '#ff9ecb', '#ffb38a', '#5fd0c4', '#c9d6e0'],
    safe: ['#1170aa', '#fc7d0b', '#5fa2ce', '#c85200', '#a3acb9', '#ffbc79', '#7b848f', '#a3cce9'],
    warm: ['#ff6b6b', '#f2b84b', '#ff9e5e', '#e0518f', '#ffd98a', '#c9473f', '#ff8f7a', '#e8a33d'],
    cool: ['#3cc4d1', '#6fa8ff', '#8fe3ec', '#7be0a7', '#5f8bd6', '#4aa8c0', '#a7c7ff', '#58d6b8']
  };

  function clamp (n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }

  function hexToRgb (hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHex (r, g, b) {
    var f = function (v) {
      var s = Math.round(clamp(v, 0, 255)).toString(16);
      return s.length === 1 ? '0' + s : s;
    };
    return '#' + f(r) + f(g) + f(b);
  }

  /* sRGB 0-255 to linear-light 0-1 and back. */
  function toLinear (c) {
    var v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function fromLinear (v) {
    var c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return c * 255;
  }

  /* Interpolate two hex colours at t in [0,1], in linear light. */
  function mix (fromHex, toHex, t) {
    t = clamp(t, 0, 1);
    var a = hexToRgb(fromHex), b = hexToRgb(toHex);
    var r = fromLinear(toLinear(a.r) + (toLinear(b.r) - toLinear(a.r)) * t);
    var g = fromLinear(toLinear(a.g) + (toLinear(b.g) - toLinear(a.g)) * t);
    var bl = fromLinear(toLinear(a.b) + (toLinear(b.b) - toLinear(a.b)) * t);
    return rgbToHex(r, g, bl);
  }

  /* WCAG relative luminance. */
  function luminance (hex) {
    var c = hexToRgb(hex);
    return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
  }

  /* Contrast ratio between two colours, 1 to 21. */
  function contrast (a, b) {
    var la = luminance(a), lb = luminance(b);
    var hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  /* Pick black or white text for the strongest contrast on `bg`. */
  function readableOn (bg) {
    return contrast(bg, '#ffffff') >= contrast(bg, '#000000') ? '#ffffff' : '#000000';
  }

  /* Stable categorical assignment: same key always gets the same colour for a
   * given ordered key list, so re-sorting the chart does not reshuffle hues. */
  function categorical (paletteName, keys) {
    var pal = PALETTES[paletteName] || PALETTES.colorblind10;
    var map = {};
    keys.forEach(function (k, i) { map[k] = pal[i % pal.length]; });
    return map;
  }

  function darken (hex, amount) { return mix(hex, '#000000', amount); }
  function lighten (hex, amount) { return mix(hex, '#ffffff', amount); }

  /* ------------------------------------------------- settings panel theme */

  function isHex (v) { return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '')); }
  function hex (v, fallback) { return isHex(v) ? String(v) : fallback; }

  /* Hex plus an alpha, for the two places that genuinely need translucency:
   * the idle gear sitting over the chart, and the scrim behind the panel. */
  function rgba (hexStr, a) {
    var c = hexToRgb(hexStr);
    return 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')';
  }

  /* Fade `ink` toward `surface` until the contrast ratio lands on `target`.
   *
   * A fixed mix cannot do this job. `mix` interpolates in linear light, which
   * is right for a colour ramp and badly wrong for grey text: a 38% mix of
   * near-black into white lands at 2.4:1, well under the 4.5:1 a reader needs.
   * Solving for the ratio instead means secondary text is legible on white, on
   * navy, and on whatever a workbook's background happens to be.
   *
   * Contrast falls monotonically as t goes 0 to 1, so a bisection is exact
   * enough in 24 steps and cannot get stuck. If there is no room to fade, the
   * original colour is returned rather than something unreadable.
   */
  function fadeToContrast (ink, surface, target) {
    if (contrast(ink, surface) <= target) return ink;
    var lo = 0, hi = 1;
    for (var i = 0; i < 24; i++) {
      var t = (lo + hi) / 2;
      if (contrast(mix(ink, surface, t), surface) > target) lo = t;
      else hi = t;
    }
    return mix(ink, surface, lo);
  }

  var PANEL_PRESETS = {
    light: { surface: '#ffffff', ink: '#1b1f24' },
    dark: { surface: '#20262e', ink: '#eef1f5' }
  };

  /* Every colour in the settings panel, derived from one surface and one ink.
   *
   * Returned as a map of CSS custom property name to value, so applying a
   * theme is a loop of setProperty and nothing else knows the maths. Pure, so
   * the headless tests can check contrast without a browser.
   *
   *   light / dark    fixed presets
   *   match           takes the chart background, picks readable ink for it
   *   custom          both colours come from the settings
   *
   * The two derived greys (soft ink, hairline) are mixes of ink into surface
   * rather than fixed greys, which is what keeps the panel legible on a dark
   * navy or a warm cream instead of only on white.
   */
  function panelVars (s, chartBg) {
    var theme = (s && s.panelTheme) || 'light';
    var surface, ink;

    if (theme === 'custom') {
      surface = hex(s.panelBg, '#ffffff');
      /* An explicitly picked text colour is honoured as picked. */
      ink = hex(s.panelText, readableOn(surface));
    } else if (theme === 'match') {
      surface = hex(chartBg, '#ffffff');
      /* Nobody chose this pair, so it has to be readable by construction.
       * Pure black or white on a light or dark surface is harsh, so step it
       * back 8% toward the surface, but only while that still clears WCAG AA
       * for body text. On a mid tone there is no contrast to spare, so the
       * pure colour is kept and legibility beats softness. */
      var pure = readableOn(surface);
      var softened = mix(pure, surface, 0.08);
      ink = contrast(softened, surface) >= 4.5 ? softened : pure;
    } else {
      var preset = PANEL_PRESETS[theme] || PANEL_PRESETS.light;
      surface = preset.surface;
      ink = preset.ink;
    }

    /* What decides the chrome is which way the ink runs, not how dark the
     * surface is. A mid grey reads as "dark" by luminance but takes black
     * text, and treating it as dark lifted the second surface toward the
     * ink, which quietly cost the derived greys a point of contrast. */
    var inkIsLight = luminance(ink) > luminance(surface);
    var surfaceIsDark = luminance(surface) < 0.35;
    var accent = hex(s && s.panelAccent, '#3cc4d1');

    /* Group headers and the footer sit on surface-2, which is always a step
     * toward the ink. That makes it the harder background of the two, so the
     * greys are solved against it rather than against the panel surface.
     * Solved against the surface instead, secondary text measured 4.37 on a
     * group header: under the floor, on the row a reader looks at most. */
    var surface2 = inkIsLight ? lighten(surface, 0.07) : darken(surface, 0.035);

    return {
      '--nx-surface': surface,
      '--nx-surface-2': surface2,
      '--nx-surface-3': inkIsLight ? lighten(surface, 0.14) : darken(surface, 0.08),
      '--nx-field': inkIsLight ? lighten(surface, 0.04) : '#ffffff',
      '--nx-ink': ink,
      /* Each of these is a contrast target, not a mix amount:
       *   7    secondary text, the house 7 to 1 floor
       *   2.2  scrollbar thumb and an off switch, easy to see furniture
       *   1.35 hairline rules, present but not loud */
      '--nx-ink-soft': fadeToContrast(ink, surface2, 7),
      '--nx-line': fadeToContrast(ink, surface2, 1.35),
      '--nx-thumb': fadeToContrast(ink, surface2, 2.2),
      '--nx-switch-off': fadeToContrast(ink, surface2, 2.0),
      '--nx-knob': inkIsLight ? '#e8ecf1' : '#ffffff',
      '--nx-accent': accent,
      '--nx-accent-ink': readableOn(accent),
      /* Whichever red is easier to read on this particular surface. */
      '--nx-danger': contrast('#ff7a6b', surface) > contrast('#c0392b', surface)
        ? '#ff7a6b' : '#c0392b',
      '--nx-gear-bg': rgba(surface, 0.72),
      '--nx-scrim': rgba(surfaceIsDark ? '#000000' : '#14181e', surfaceIsDark ? 0.34 : 0.12),
      '--nx-shadow': surfaceIsDark
        ? '0 6px 26px rgba(0, 0, 0, 0.45)'
        : '0 6px 24px rgba(16, 22, 30, 0.18)'
    };
  }


  var NAVY = '#081f33';
  var INK_ON_DARK = '#f3f5f7';
  var INK_ON_LIGHT = '#0b1f33';

  /* Push `color` toward `toward` until it reaches `min` contrast on `bg`. */
  function ensureContrast (color, bg, min, toward) {
    if (contrast(color, bg) >= min) return color;
    var t = toward || (luminance(bg) > 0.4 ? '#000000' : '#ffffff');
    var lo = 0, hi = 1;
    for (var i = 0; i < 20; i++) {
      var m = (lo + hi) / 2;
      if (contrast(mix(color, t, m), bg) >= min) hi = m; else lo = m;
    }
    return mix(color, t, hi);
  }

  /* Everything the chart paints with, derived from the settings and the
   * worksheet background. Pure, so the node tests can prove the 7 to 1 text
   * floor without a browser.
   *
   * If the worksheet background is a mid tone where neither near-white nor
   * near-black ink reaches 7 to 1, the chart paints its own plate (white or
   * navy, whichever is nearer) rather than ship unreadable labels. `plate`
   * says when that happened. */
  function resolveTheme (s, worksheetBg) {
    var mode = (s && s.bgMode) || 'auto';
    var bg;
    if (mode === 'navy') bg = NAVY;
    else if (mode === 'white') bg = '#ffffff';
    else if (mode === 'custom') bg = hex(s.bgCustom, NAVY);
    else bg = isHex(worksheetBg) ? worksheetBg : NAVY;
    if (/^#[0-9a-f]{3}$/i.test(bg)) bg = rgbToHex.apply(null, [hexToRgb(bg).r, hexToRgb(bg).g, hexToRgb(bg).b]);

    var plate = false;
    var best = Math.max(contrast(bg, INK_ON_DARK), contrast(bg, INK_ON_LIGHT));
    if (best < 7) { bg = luminance(bg) > 0.18 ? '#ffffff' : NAVY; plate = true; }

    var autoInk = contrast(bg, INK_ON_DARK) >= contrast(bg, INK_ON_LIGHT) ? INK_ON_DARK : INK_ON_LIGHT;
    if (contrast(bg, autoInk) < 7) autoInk = contrast(bg, '#ffffff') >= contrast(bg, '#000000') ? '#ffffff' : '#000000';
    var ink = autoInk;
    if (s && s.textMode === 'custom' && isHex(s.textCustom) && contrast(s.textCustom, bg) >= 7) ink = s.textCustom;

    var dark = luminance(bg) < 0.4;
    var pal = PALETTES[(s && s.palette)] || PALETTES.diver;
    var groupColors = pal.map(function (c) { return ensureContrast(c, bg, 3); });
    return {
      bg: bg, ink: ink, dark: dark, plate: plate,
      muted: fadeToContrast(ink, bg, 7),
      out: ensureContrast(hex(s && s.outColor, '#f2b84b'), bg, 3),
      inn: ensureContrast(hex(s && s.inColor, '#8fe3ec'), bg, 3),
      single: ensureContrast(hex(s && s.linkColor, '#3cc4d1'), bg, 3),
      groups: groupColors
    };
  }

  global.NX = global.NX || {};
  global.NX.palettes = {
    PALETTES: PALETTES,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    mix: mix,
    luminance: luminance,
    contrast: contrast,
    readableOn: readableOn,
    categorical: categorical,
    darken: darken,
    lighten: lighten,
    rgba: rgba,
    fadeToContrast: fadeToContrast,
    PANEL_PRESETS: PANEL_PRESETS,
    panelVars: panelVars,
    ensureContrast: ensureContrast,
    resolveTheme: resolveTheme,
    NAVY: NAVY
  };
})(typeof window !== 'undefined' ? window : globalThis);
