/**
 * Layout suite: the kit's components laid out by a real browser engine.
 *
 * Why it exists, and why it is not a vitest file: `happy-dom` has no layout engine. Every
 * width it reports is zero, so whether a table fits its pane, whether a header wraps, and
 * which column a responsive table hides are questions it cannot answer at all. Chromium can.
 *
 * Run it with `npm run layout`. It prints one row per behaviour and exits non-zero if any
 * fails. It needs a browser binary: `npx playwright install chromium`.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));

async function bundle(entry) {
  const result = await esbuild.build({
    entryPoints: [join(HERE, "pages", entry)],
    bundle: true,
    write: false,
    format: "esm",
    target: "es2022",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "warning",
  });
  return result.outputFiles[0].text;
}

const page = (script) => `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8" /><title>layout</title></head>
  <body style="margin:0; padding:16px">
    <div id="host" style="width:1200px"></div>
    <script type="module">${script.replaceAll("</script", "<\\/script")}</script>
  </body>
</html>`;

// --- Assertions -------------------------------------------------------------

const rows = [];
let failures = 0;

async function check(scenario, name, predicate) {
  let ok = false;
  let detail = "";
  try {
    const outcome = await predicate();
    ok = outcome === true;
    if (!ok && typeof outcome === "string") detail = outcome;
  } catch (e) {
    detail = String(e);
  }
  if (!ok) failures += 1;
  rows.push({ scenario, name, ok, detail });
}

// --- In-page probes ---------------------------------------------------------

/** Column keys by header title — the label each column carries in responsive mode. */
const KEY_BY_TITLE = {
  Deal: "name",
  Stage: "stage",
  Owner: "owner",
  Amount: "amount",
  "Open deals": "deals",
  "Win rate": "winRate",
  "Last updated": "updated",
  Actions: "actions",
};
/** Priority per droppable column, as declared on the page. */
const PRIORITY = { stage: 2, owner: 3, amount: 1, deals: 5, winRate: 4, updated: 6 };

/** Read what the browser laid out. Runs in the page. */
function probe() {
  const host = document.getElementById("host");
  const wrap = host.firstElementChild;
  const table = host.querySelector("table");
  const ths = [...table.querySelectorAll("thead th")];
  const lineCount = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set();
    for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
    return tops.size;
  };
  return {
    titles: ths.map((th) => th.title),
    headerLines: ths.map((th) => lineCount(th)),
    wrap: { scroll: wrap.scrollWidth, client: wrap.clientWidth },
    host: { scroll: host.scrollWidth, client: host.clientWidth },
    table: table.getBoundingClientRect().width,
    rows: [...table.tBodies[0].rows].map((tr) => tr.textContent),
    hiddenLists: [...table.querySelectorAll("tbody .nb-table__hidden")].length,
  };
}

/** Set the container width and wait two frames for the fit to settle. */
async function at(tab, width) {
  await tab.evaluate((w) => {
    document.getElementById("host").style.width = `${w}px`;
  }, width);
  await frames(tab, 2);
  const p = await tab.evaluate(probe);
  return { ...p, keys: p.titles.map((t) => KEY_BY_TITLE[t] ?? t) };
}

async function frames(tab, n) {
  await tab.evaluate(
    (count) =>
      new Promise((resolve) => {
        let left = count;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    n,
  );
}

const ALL = Object.values(KEY_BY_TITLE);
const hiddenOf = (keys) => ALL.filter((k) => !keys.includes(k));

// --- Run --------------------------------------------------------------------

const script = await bundle("table.tsx");
const { DEAL_VALUES } = await (async () => {
  // The values each hidden column must still show, read from the same fixture the page renders.
  const fixture = await esbuild.build({
    entryPoints: [join(HERE, "pages", "table-fixture.ts")],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "warning",
  });
  const mod = await import(
    `data:text/javascript;base64,${Buffer.from(fixture.outputFiles[0].text).toString("base64")}`
  );
  return mod;
})();

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const tab = await ctx.newPage();
  const errors = [];
  tab.on("pageerror", (e) => errors.push(String(e)));
  tab.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await tab.setContent(page(script));
  await tab.waitForFunction(() => window.__layout?.ready === true, null, { timeout: 15000 });

  const S = "Table, responsive mode";
  const WIDTHS = [1200, 924, 800, 600, 400];
  const seen = {};
  for (const w of WIDTHS) seen[w] = await at(tab, w);

  for (const w of WIDTHS) {
    const p = seen[w];
    await check(S, `${w}px: the table does not overflow its container`, () => {
      if (p.wrap.scroll > p.wrap.client)
        return `wrapper scrollWidth ${p.wrap.scroll} > clientWidth ${p.wrap.client}`;
      if (p.host.scroll > p.host.client)
        return `container scrollWidth ${p.host.scroll} > clientWidth ${p.host.client}`;
      return true;
    });
    await check(S, `${w}px: every header is one line`, () => {
      // An empty header (an action column's) has no line boxes at all, which is not a wrap.
      const bad = p.titles.filter((_, i) => p.headerLines[i] > 1);
      return bad.length === 0 || `wrapped: ${bad.join(", ")} (${p.headerLines.join(",")})`;
    });
    await check(S, `${w}px: lower-priority columns hide before higher ones`, () => {
      const hidden = hiddenOf(p.keys).filter((k) => k in PRIORITY);
      const shown = p.keys.filter((k) => k in PRIORITY);
      for (const h of hidden)
        for (const s of shown)
          if (PRIORITY[h] < PRIORITY[s])
            return `${h} (priority ${PRIORITY[h]}) hidden while ${s} (priority ${PRIORITY[s]}) shows`;
      return true;
    });
    await check(
      S,
      `${w}px: the primary column and unprioritised columns stay`,
      () =>
        (p.keys.includes("name") && p.keys.includes("actions")) || `shown: ${p.keys.join(", ")}`,
    );
    await check(S, `${w}px: each hidden column's value is in its row's text`, () => {
      const hidden = hiddenOf(p.keys);
      if (hidden.length === 0)
        return p.hiddenLists === 0 || "a hidden-values line with none hidden";
      for (const [i, text] of p.rows.entries()) {
        for (const key of hidden) {
          const value = DEAL_VALUES[i][key];
          if (!text.includes(value)) return `row ${i} lacks ${key} = "${value}"`;
          const label = Object.entries(KEY_BY_TITLE).find(([, k]) => k === key)?.[0];
          if (!text.includes(label)) return `row ${i} lacks the label "${label}"`;
        }
      }
      return true;
    });
  }

  await check(
    S,
    "1200px shows every column",
    () => seen[1200].keys.length === ALL.length || `shown: ${seen[1200].keys.join(", ")}`,
  );
  await check(
    S,
    "400px hides at least one column",
    () => seen[400].keys.length < ALL.length || "nothing hidden at 400px",
  );
  await check(S, "narrower never shows a column a wider width hides", () => {
    for (let i = 1; i < WIDTHS.length; i++) {
      const extra = seen[WIDTHS[i]].keys.filter((k) => !seen[WIDTHS[i - 1]].keys.includes(k));
      if (extra.length) return `${WIDTHS[i]}px shows ${extra} that ${WIDTHS[i - 1]}px hides`;
    }
    return true;
  });

  const widened = await at(tab, 1200);
  await check(
    S,
    "widening from 400px back to 1200px restores every column",
    () => widened.keys.length === ALL.length || `shown: ${widened.keys.join(", ")}`,
  );

  // The narrowest width that shows every column: the threshold for the last column to hide.
  let lo = 400;
  let hi = 1200;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await at(tab, mid)).keys.length === ALL.length) hi = mid;
    else lo = mid;
  }
  const threshold = hi;
  const atThreshold = (await at(tab, threshold)).keys.join(",");
  const below = (await at(tab, threshold - 1)).keys.join(",");
  await check(S, `stepping across the threshold (${threshold}px) is stable`, async () => {
    for (let i = 0; i < 5; i++) {
      const up = (await at(tab, threshold)).keys.join(",");
      const down = (await at(tab, threshold - 1)).keys.join(",");
      if (up !== atThreshold) return `round ${i}: at ${threshold}px showed ${up}`;
      if (down !== below) return `round ${i}: at ${threshold - 1}px showed ${down}`;
    }
    return atThreshold !== below || "the threshold did not change the columns";
  });
  await check(S, "resting at the threshold changes nothing", async () => {
    await at(tab, threshold);
    await tab.evaluate(() => {
      window.__mutations = 0;
      const head = document.querySelector("#host thead");
      window.__observer = new MutationObserver((m) => {
        window.__mutations += m.length;
      });
      window.__observer.observe(head, { childList: true, subtree: true });
    });
    await frames(tab, 20);
    const n = await tab.evaluate(() => {
      window.__observer.disconnect();
      return window.__mutations;
    });
    const p = await tab.evaluate(probe);
    if (p.wrap.scroll > p.wrap.client) return "overflows at the threshold";
    return n === 0 || `${n} header mutations while resting`;
  });

  await check(S, "a resize is fitted before it is painted", async () => {
    // A `ResizeObserver` created after the table's runs after the table's in the same frame,
    // and microtasks run between them — so if the refit is synchronous, this observer
    // already sees the fitted table. Nothing is painted between the two.
    await at(tab, 1200);
    const result = await tab.evaluate(
      () =>
        new Promise((resolve) => {
          const host = document.getElementById("host");
          const wrap = host.firstElementChild;
          // The first callback is the observation every new observer gets. Resize only after
          // it, in a later frame, so the next callback is the resize and nothing else.
          let primed = false;
          const ro = new ResizeObserver(() => {
            if (!primed) {
              primed = true;
              requestAnimationFrame(() => {
                host.style.width = "500px";
              });
              return;
            }
            ro.disconnect();
            resolve({ scroll: wrap.scrollWidth, client: wrap.clientWidth });
          });
          ro.observe(wrap);
          setTimeout(() => resolve({ timeout: true }), 5000);
        }),
    );
    if (result.timeout) return "the resize was never observed";
    return (
      result.scroll <= result.client ||
      `in the resize frame: scrollWidth ${result.scroll} > clientWidth ${result.client}`
    );
  });

  // A web font finishing late changes text widths without resizing anything. Simulate it:
  // widen the text, confirm the table now overflows, then announce a font load.
  await check(S, "a late font load refits the table", async () => {
    const start = await at(tab, threshold);
    if (start.keys.length !== ALL.length) return "precondition: not every column shown";
    await tab.evaluate(() => {
      const s = document.createElement("style");
      s.id = "late-font";
      s.textContent = "#host td { letter-spacing: 0.2em; }";
      document.head.appendChild(s);
    });
    await frames(tab, 2);
    const stale = await tab.evaluate(probe);
    if (stale.wrap.scroll <= stale.wrap.client) return "precondition: wider text did not overflow";
    await tab.evaluate(() => document.fonts.dispatchEvent(new Event("loadingdone")));
    await frames(tab, 2);
    const refit = await tab.evaluate(probe);
    if (refit.wrap.scroll > refit.wrap.client) return "still overflows after loadingdone";
    if (refit.titles.length >= ALL.length) return "nothing hidden after the wider text";
    // And back: narrower text after a load restores what the wider text hid.
    await tab.evaluate(() => {
      document.getElementById("late-font")?.remove();
      document.fonts.dispatchEvent(new Event("loadingdone"));
    });
    await frames(tab, 2);
    const restored = await tab.evaluate(probe);
    return restored.titles.length === ALL.length || `restored: ${restored.titles.join(", ")}`;
  });

  // Fallback: nothing left to hide.
  const F = "Table, responsive fallback";
  await tab.evaluate(() => window.__layout.render({ minWidth: 480 }));
  const scroller = await at(tab, 240);
  await check(F, "with minWidth, a pane too narrow for the rest scrolls inside the table", () => {
    if (scroller.keys.some((k) => k in PRIORITY))
      return `droppable still shown: ${scroller.keys.join(", ")}`;
    if (scroller.wrap.scroll <= scroller.wrap.client) return "the scroller did not engage";
    return (
      scroller.host.scroll <= scroller.host.client ||
      `the container overflows: ${scroller.host.scroll} > ${scroller.host.client}`
    );
  });
  const wideAgain = await at(tab, 1200);
  await check(F, "with minWidth, a wide pane shows every column and does not scroll", () => {
    if (wideAgain.keys.length !== ALL.length) return `shown: ${wideAgain.keys.join(", ")}`;
    return wideAgain.wrap.scroll <= wideAgain.wrap.client || "scrolls at 1200px";
  });

  await check("page", "no console errors", () => errors.length === 0 || errors.join("\n"));
  await ctx.close();
} finally {
  await browser.close();
}

// --- Report -----------------------------------------------------------------

const width = Math.max(...rows.map((r) => r.name.length));
let last = "";
for (const r of rows) {
  if (r.scenario !== last) {
    console.log(`\n${r.scenario}`);
    last = r.scenario;
  }
  console.log(
    `  ${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}${r.detail ? `  — ${r.detail}` : ""}`,
  );
}
console.log(`\n${rows.length - failures}/${rows.length} passed`);
process.exit(failures === 0 ? 0 : 1);
