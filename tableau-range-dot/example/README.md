# Example workbook: Dot Plot - Capacity Planning

One dashboard that uses Range Dot: a person's weekly load against the range of their team, with a note under any week where their capacity is not the usual one.

## Open it

1. Get Tableau's library once (see [`../lib/README.md`](../lib/README.md)), then start the server: `node serve.js` in `tableau-range-dot/`, or double-click `Start-RangeDot.bat`.
2. Open `Dot Plot - Capacity Planning.twbx` in Tableau Desktop 2026.3 or later. Allow the extension when Tableau asks.
3. Pick a person in **Select Resource**. The chart, the title and the notes follow.

The workbook loads the extension from `http://localhost:8771/index.html`, so the server has to be running first.

## What is in it

- **Data:** invented for this example. 24 people in 6 pools over 13 weeks, packaged in the workbook. No real people or projects.
- **Sheet `Person vs Team Range`:** `Week Start` on Category (exact date, discrete), `Load %` on Value, `Resource` on Member. `Is Selected Person` and `Available Capacity` are on Detail.
- **Filters:** the selected person's own pool, the weeks in view, and the total line.

The calculations worth copying:

```
// Is Selected Person
[Resource] = [Selected Resource]

// In Selected Pool
[Resource Pool] = { FIXED : MAX(IF [Resource] = [Selected Resource] THEN [Resource Pool] END) }

// Available Capacity: weekly capacity less out-of-office hours
SUM(IF [Line] = "Total" THEN [Weekly Capacity] - ZN([Leave This Week]) END)
```

`Available Capacity` is what makes a short week show a note such as "24 h cap". In this data a person's weekly capacity never changes, and holidays and leave are stored as out-of-office hours.

## Things to know

- `Load %` divides by the full weekly capacity, so a week of leave can read far over 100%.
- This copy differs from the author's original in one way: the author email inside the embedded extension manifest was blanked. It has not been reopened in Tableau since that edit.
