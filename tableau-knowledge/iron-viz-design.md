# Iron Viz lessons: design, story, analysis and speed

From a user-group talk by Ann Pregler, an Iron Viz 2026 winner (a former math
teacher, now a senior data analyst and a three-time Tableau Ambassador who makes
long, story-driven vizzes). Rules 19 to 29 in [house-style.md](house-style.md)
are the one-line versions; this file keeps the reasoning and the numbers.

## What the contest is

- A qualifier runs for about a month with a theme (one year it was food). The top
  ten are chosen. The top three build live on stage at Tableau Conference in 20
  minutes in front of thousands of people.
- She was on her third entry. The 2026 data set was a book-reading data set with
  millions of rows and few columns.
- Judging has three parts: **design, analysis and storytelling**, and the
  storytelling is described as the part that brings everything together.
- Her winning viz: genre mashups, three dashboard pages, ending on "what mashup
  goes viral next".

## Design

- **Start with a design concept and a mood board** of reference images (hers was
  a bullet-journal look). Colors, fonts, banners and stacked pages migrate in from
  the board.
- **Three tools make the feel:** background images (the biggest payoff, built
  FIRST, in a design tool, as rotated rectangles with drop shadows), custom
  shapes, and chart choice.
- **Custom shapes keep both opacity and color.** A hand-drawn highlighter circle
  imported as a shape gives a marker-pen look. To color-code, import differently
  colored shapes rather than using a color field. A Venn diagram is a dual axis
  (layer one a plain circle, layer two the custom shape); a network chart used
  map layers.
- **Chart choice supports the vibe:** a lollipop instead of a bar looks
  hand-drawn; faint gray "pencil" lines give context with one highlighter-colored
  line for the focus.
- **Hand-drawn doodles** per category can frame the parameters.
- **Design test, four questions:** is it clean, does it add rather than distract,
  is it accessible, can it be built fast? Cut the crazier ideas that fail.
- Her worry was that the art might distract, and that the analytic depth would
  be invisible. A judge's comment: informational vizzes are common and a true data
  story is rare, and judges like hand-crafted touches inside native Tableau.

## Story

- The story was harder than the live build. Informational is not a story.
- It needs a beginning, a middle and an end, like a three-paragraph essay, with a
  conclusion that is NOT immediately obvious.
- Her flow: a hook (a fill-in-the-blank with a Venn), an intro (the basics and
  the big question), the analysis (three criteria), the answer.
- **Cut hard.** The first draft had seven pages; a mentor said it was impossible
  in three minutes. She folded the last four into one page with dynamic zone
  visibility.

## The accordion (her favorite feature)

One accordion on a presented page. The headers are clickable, and new charts,
text AND background overlays swap per state. One integer parameter (the
accordion state) drives every zone-visibility calc, the network chart's filter
(each state adds one more criterion, so connections visibly fall away) and the one
parameter action on the headers. Controls stay simple because it had to be
buildable in time. It is a guided mode, not an explore mode. Andy Kriebel's
string-state version of the same idea is in
[andy-kriebel-recipes.md](andy-kriebel-recipes.md).

## Analysis: let Prep do the thinking

- More than a thousand genres were mapped down to a clean list (Tableau's
  grouping tool, exported as a mapping file into Prep). Non-fiction and junk
  values such as a website name appearing as a genre were dropped.
- Every metric was precomputed as a flag (for example, whether a pairing has an
  above-average share of five-star ratings).
- **Six separate, tiny data sources** from one original, each shaped for one
  chart, so nothing is filtered, renamed or formatted on stage.
- **Venn geometry is computed in Prep:** radius from the item count (minus about
  10 for overlap), circle centers by trigonometry, x and y precomputed. In Tableau,
  x and y go on columns and rows, radius comes from the count on Size, marks are
  enlarged and axis scaling tweaked. It only suits a small, stable set of
  combinations.
- Show the depth of the analysis somewhere visible, or heavy math behind a
  ranking looks like it came "out of thin air".

## Speed: 50 minutes down to 20

| Move | Why it helps |
|---|---|
| Bake minor text (navigation hints, hover tips) into the background image | fewer objects to place; keep essential labels as real text for accessibility |
| Keep calculations in a text file to drag in | no typing on stage |
| Copy a finished sheet and filter it | a lollipop reused as a top ten on page three |
| Keyboard shortcuts | Alt+Shift+O color, I size, C columns, S detail, R rows built a chart in about 10 seconds |
| Plan where the mouse parks while things load | removes dead time |
| A week of rehearsal, then days of full rehearsal on site | the first run took 50 minutes |

Cut order if time runs out: the dedicated conclusion section, metric
explanations, tooltip formatting, chart styling.

Her encouragement: anyone can enter, the qualifier is usually announced in late
September, and entering teaches you and connects you.
