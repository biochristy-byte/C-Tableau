# Writing a business-preferences file for Tableau's AI agents

From a user-group talk by Celia Fryar on "making agents learn our business" for
Tableau Cloud and Tableau Next. The short version is a section in
[house-style.md](house-style.md). This is the full version, and most of it
applies to any context file you give an AI agent that sits on top of data
(Tableau, Pulse, or your own agent).

## The order of operations

A preferences file is the last mile, not the main meal. Do these first:

1. Clean labels and real field descriptions.
2. Governed calculations for your KPIs, so the agent never has to invent a
   formula.
3. Hide the noise fields. Hiding is a hard stop for the agent, and it matters
   more on Cloud because its semantic model is thinner.
4. Only then write preferences for jargon, thresholds, defaults and behavior.

The metadata is what the agent actually reads. Cloud reads a field's comment
field; Next reads its description field. Next accepts 255 characters; beta
testers on Cloud report that text past about 150 characters is not absorbed. Write
real descriptions, not tiny labels.

## Where the file lives and its limits

| | Tableau Cloud | Tableau Next |
|---|---|---|
| Scope | one file per dashboard | one file per semantic model |
| Format | `.md`, each rule starts with `# ` (pound and a space) | same idea |
| Size | at most 50 rules and 8,000 characters | 30,000 characters (an 18,000 character file worked) |
| To take effect | the dashboard must be PUBLISHED | n/a |
| Check | the upload shows a rule count | n/a |
| Editing | not editable in place yet | n/a |

Cloud currently ignores geographic roles, number formatting and fiscal years, so
sorting by fiscal period has to be asked for in the question. Next also has a
modeling agent and a built-in table download; Cloud did not yet.

Collect vendor demo preference files and keep them as templates.

## What to put in a rule

- **Meaning.** Example: a field called `revenue` on a customer table is the size
  of the customer's company, not revenue you earned from them.
- **Policy thresholds.** Never let the agent infer them. Unprompted, one agent
  called every discount over 20 percent a "violation": the 20 was invented. After
  a policy rule written in markdown, it was accurate.
- **Interpretation defaults.** What period, what grain, what to do with ties.
- **Behavior.** "Never fabricate", "no unsupported assumptions", "state the limits
  of causal claims".

## What to keep out of a rule

- **Math and formatting.** A rule that asked for currency formatting made the
  agent wrap the number in `TO_CHAR`, the field became text, and the arithmetic
  broke. Put formatting on the field, not in the rule.
- **Narration.** Agents follow any filters you left on a dashboard, so tell them
  to clear filters before applying their own. Command it ("remove filters before
  applying"). Do not write "I took the filter off": the agent reads that as an
  instruction and burns cycles on it.

## How to check it

- The worst failures are invented thresholds, double-counted totals and
  silently dropped filters or criteria. Keep your own independent tallies and
  compare before anyone decides from an answer.
- Have a second LLM (any free tier is fine) audit the rule file for conflicts
  and ambiguity: the same label meaning two things on different accounts, or
  overlapping country scopes.
- Use the agent's visible process as an audit trail: it states what it
  understood, its plan, the SQL, the run and its verification, and lists the
  limits it hit and the data it used. Vague questions now work, so test with one.

## Applying it outside Tableau

The same shape works for any agent context file: labels and descriptions first,
rules last, rules cover meaning, thresholds, defaults and behavior, no math or
formatting inside them, audit with a second model, verify totals independently.
