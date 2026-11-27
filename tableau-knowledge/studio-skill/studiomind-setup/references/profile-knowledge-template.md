# How This Author Wants Dashboards Built and Explained

This author's saved StudioMind profile: readers, teach or do mode, canvas, fonts, palette, talk style and remembered preferences.

## Scope Check

- Primary audience: the Tableau agent, working for this one author in Tableau Studio.
- Authoring outcome improved: every build starts from this author's canvas, fonts, palette and way of working instead of untuned defaults.
- In-scope reason: these preferences apply to every dashboard, chart and reply in every session.
- Out-of-scope risk: does not change StudioMind's hard rules (truth in numbers, safety, the contrast, size and palette floors, proof before done).
- Tags: profile, preferences, my style, house style, defaults, dashboard, design, canvas, font, palette, title, teach, explain, remember, studiomind profile
- Relevant user prompts/search terms: studiomind profile, my preferences, my style, how I like it, build a dashboard, design this page, explain what you did, remember this

## When to Use

Use at the start of every session and before any build, design or explanation for this author. This is the backup copy of the `studiomind-profile` skill: use it when that skill did not load.

## Best Practices

This profile changes StudioMind's defaults only. It never changes StudioMind's hard rules.

<!-- profile:start -->
### About
- Readers: {who reads the dashboards}
- Mode: {teach or do}

### Design defaults
- Canvas: {width x height} ({seen on N of M dashboards, or "told"})
- Title treatment: {font, size, color, band color}
- Body font: {font}
- Palette: {a Tableau "Color Blind" palette name}
- Text grays: {hex values, each 7:1 or better on its ground}

### Talk
- Format: {short bullets and tables, or short paragraphs}
- Em dashes: {avoid, or fine}
- Rule from the author: {the one thing that annoys them about AI help, as a rule}

### Remembered
- {YYYY-MM-DD}: {one preference per line}
<!-- profile:end -->

## Common Mistakes

- Using Tableau's defaults when this profile sets a value.
- Treating a profile line as permission to break a hard rule. The hard rules win.
- Updating this copy without the `studiomind-profile` skill copy, or the other way round.

## Implementation

1. Load this profile before the first build or reply in a session.
2. Use each value in place of the matching StudioMind default.
3. To change a value, run `studiomind-setup` ("remember this"), which updates both copies.
