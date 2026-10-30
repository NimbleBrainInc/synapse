# Layout suite

```bash
npx playwright install chromium
npm run layout
```

The kit's components, from source, laid out by real Chromium. `happy-dom` has no layout
engine: every width it reports is zero, so whether a table fits its pane, whether a header
wraps, and which column a responsive table hides cannot be asserted in a vitest file. They
can here.

It is separate from `npm run ci` for the reason `conformance` is: it needs a browser
binary, and the documented verification command must pass on a fresh clone. CI runs it as
its own job.

## What it covers

`pages/table.tsx` mounts `Table` in responsive mode with a realistic list: a long
truncating primary column, a status badge, an owner, three numeric columns, a timestamp,
and an action column without a priority. `run.mjs` sets the container's width and reads
the result off the DOM:

- at 1200, 924, 800, 600 and 400px: the table never overflows its container, every header
  is one line, a column hides only after every column with a higher priority number, the
  primary and unprioritised columns stay, and each hidden column's label and value are in
  its row's text;
- widening restores every column, and a narrower width never shows a column a wider one
  hides;
- at the exact width where the last column hides, stepping a pixel either way gives the
  same two states every time, and resting there causes no header mutations;
- a resize is fitted in the frame it happens, before paint (a `ResizeObserver` created
  after the table's sees the fitted table);
- a late font load (wider text, then `loadingdone` on `document.fonts`) refits, and a
  narrower one restores;
- with `minWidth`, a pane too narrow even after hiding scrolls inside the table, and a wide
  one does not scroll.

The fixture's rows and the text each column renders are in `pages/table-fixture.ts`, which
the runner reads to check a hidden value is still in its row.

## Adding a row

Add a `check(scenario, name, predicate)` in `run.mjs`. A predicate returns `true` or a
string saying what it saw instead. Measure in the page with `probe()` or your own
`tab.evaluate`; assert on what the browser laid out, not on what the component was told.
