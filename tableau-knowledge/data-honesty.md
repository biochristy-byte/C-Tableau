# Data honesty: what a chart is allowed to claim

Lessons from storytelling workbooks built on survey data, scraped news and
published studies. None of them fail loudly: the chart renders, the numbers look
fine, and the claim is still wrong. Rules 40 to 42 in
[house-style.md](house-style.md) are the short form; this page is the method.

## 1. Quote provenance: carry a `verbatim` flag

About half of one "quote" column was a researcher's summary ("theme synthesis",
"paraphrase", "see above"), not the person's words, and no upstream field said
which. A word count over that column counted the researcher's vocabulary.

- Carry a `verbatim` flag from the source notes into the data (a method note per
  source file says which files are summaries and which are transcripts).
- Count words only inside the person's own text (first-person text, else quoted
  fragments).
- Never caption a chart "in their own words" unless the flag proves it. Check the
  title, the subtitle and the story page.
- Look for delimiter bugs too: an escaped pipe in a split left a stray trailing
  backslash on cells.
- Dedupe sources before quoting N (705 became 698 after reposts were found).
  Keep a count that "did not reproduce" out of copy until it does.

## 2. Significance before color

Color a word, bar or category as "different" only after a test says it is.

| Step | What was done |
|---|---|
| Test | Length-aware exact test per word |
| Multiple comparisons | Benjamini-Hochberg at 10% over the whole word set |
| Result | 2 of 29 words colored |
| Fragile verdict | Adjusted p of .0949 was disclosed as fragile on the page |
| Second implementation | A second implementation of the test cross-checks the first |

Code each lexicon hit by meaning, not by spelling. A word-senses table of 266 rows
dropped 35 hits ("no regrets" is not regret). Drop repeated posts. State the
known limit in the method note: negations ("never got burned out") still count.

## 3. Name categories by what happened, not by a verdict

For a sensitive-incident dataset every chart ran on five "who acted" bands and
never on "real versus hoax". A police response does not mean there was a shooter.
"Hoax call" (a person's decision) and "false alarm" (nobody's) were split into two
bands at the owner's request.

- Name bands after observable facts.
- Ask before merging two categories that differ in intent.
- Keep the page free of the author's own situation: the dataset is about a
  pattern, not about any one place or person.

## 4. Collect every published number

For a dataset that must contain every published case or figure:

1. **Harvest** with many phrasings across monthly windows (a single search
   saturates and rate-limits).
2. **Drop** off-topic headlines.
3. **Triage** with a cheaper model: group events, pick 1 to 2 links each.
4. **Decode** only the picked links.
5. **Classify** with agents that read the source and write schema rows. Unblock
   sites that return 403 through a text-proxy reader.
6. **Verify** in an independent full pass: one agent per 25 rows, with a quoted
   sentence from the source backing every value.

Rules of the road:

- Before the full verify, hand-check two random 15-row samples. They found about
  25% of rows with a wrong field, mostly classification edges and casualty counts
  from same-day articles later revised.
- After any verify apply, confirm every duplicate-drop's twin survived (a twin
  once lived only in another row's notes).
- Keep a corrections file. Never hand-edit merged outputs; re-run the merge.
- `KNOWN_MISCODED` style allowlists stay EMPTY so the label function goes RED on
  the first new miscode (see [gate-designs.md](gate-designs.md)).

## 5. Weighted public-use survey data

- Validate your weighted shares against the publisher's codebook tables to within
  0.05 points before charting (74 shares matched in the build that taught this).
- Know the variance method per wave: one wave used 100 jackknife replicates at
  0.99, the next used 80 SDR replicates at 4/80.
- A wave's "year" may be the anchor-date year. A wave anchored at the 12/31 job
  puts departures in the NEXT year.
- Government sites may refuse requests that lack a browser User-Agent.
- Importing a build script with no `__main__` guard RUNS it and can overwrite your
  master CSV. Rebuild after any import.
- Route intent-to-leave rows into an intent measure, never into actual events (25
  rows moved).
- A selection-bias caveat belongs on the page when a cohort is self-selected
  (social posters over-represent career-move exits): use survey % for prevalence.

## 6. Wording rules for studies

- A later, larger study of the same kind is not "a re-analysis of the same
  sample". Label it a separate, larger study (122,129 dives versus 45,614) and
  never call it a re-analysis.
- Flag any word that is your own (a "Deep" in a site label) on the Method page.
- Never draw an interpolated point that looks like data (see rule 46).
