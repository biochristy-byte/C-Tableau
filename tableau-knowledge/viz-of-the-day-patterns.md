# What themed Viz of the Day winners do

Studied when designing a dive-safety story: I wanted to know how winning
dashboards carry a theme (ocean, plants) without bending the data. About 36
winners were viewed. The patterns are the useful part; they back house-style
rules 20 to 22 in [house-style.md](house-style.md) and rule 37.

## Getting the archive

- The Viz of the Day list is a public JSON feed:
  `public.tableau.com/public/apis/bff/discover/v2/vizzes/viz-of-the-day?startIndex=N&limit=12`.
  A limit above 12 returns 400, and the older `/api/gallery` path is gone. The
  archive held about 3,000 entries from 2013 on, each with title, author and a
  description that names the technique.
- A workbook's full dashboard thumbnail needs no sign-in:
  `public.tableau.com/static/images/<first two characters of the workbook>/<workbook>/<sheet>/1.png`.
  The "curated image" field is often null or forbidden.
- Page through the feed, save the JSON, then build contact sheets of the
  thumbnails for the theme you care about and look at them side by side. The
  description text is a fast way to find which winners used a given technique.

## Ocean-themed examples

| Winner (author, year) | What carries the theme |
|---|---|
| A Holiday Reef (Laura Elliot, 2024) | navy to black depth gradient, a fish school as the title frame, coral and seaweed silhouettes on the seabed, glowing gold dots on a dark world map |
| Garbage in the Ocean (Kasia Gasiewska-Holc, 2019) | waterline across the top with boats, items hang from the surface on lines like nets and buoys, and the Y axis IS depth: the chart is the scene |
| Shark Attacks in Australia (George Koursaros, 2025) | coastline glow halos for fatal zones, shark-fin custom shapes as marks |
| Shark Attacks in the US (Daniel Heemann, 2021) | a unit chart where every unit is a fin icon stacked into columns by year |
| Sea Ice Extent (Bea Katona, 2023) | a dot matrix and one white line over a single photo of ice: restraint |
| Sustainable seafood (Brittany Rosenau, 2025) | wave-shaped section breaks, a ship porthole as a circular frame, a timeline drawn as a rope with buoys |
| Coral Bleaching (Shweta Randive, 2021) | engraved coral dividers, coral-branch icons as unit marks |
| Titanic (Simon Rowe, 2020) | the ship drawn from people-dots: a unit chart in a meaningful shape |

## Plant and flow examples

A tree with one leaf per person (a unit chart); botanical trees with flower
glyphs standing in for bars; lotus petals one per dish with petal length encoding
a nutrient (small multiples); Sankey bands in water blues as rivers into oceans;
a dark ground with a flower photo on the edge and stems as lollipops; radial
ribbons around a calendar ring.

## Six patterns that repeat

1. **The scene carries the theme and the marks carry the data.** Silhouettes, a
   waterline, a seabed and depth gradients sit BEHIND plain, exact marks.
2. **Swap a generic mark for a thematic one of the same geometry.** Lollipop to a
   stem with a bloom or an anchor line, bar to a coral column or kelp, unit to a
   fin or a leaf, line to a river or current band. Length or position still
   encodes the value exactly, so nothing is lost.
3. **Make an axis literal.** Depth runs down from a surface line.
4. **One hero illustration or photo, not many.** Restraint keeps it from
   reading as clip art.
5. **Theme the frames too:** portholes, ropes with buoys, wave-shaped section
   edges.
6. **Glow on a dark ground** for points of interest.

## How to use this in a build

Build the scene PNG first (see rules 8 to 10 and 20), then place plain sheets on
it. If you replace a mark with a themed shape, check it still reads at the
smallest size and that its anchor point sits on the data position. Keep a
single hero element and let everything else be quiet.
