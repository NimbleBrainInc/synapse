/**
 * The host-supplied font-face channel.
 *
 * A CSS custom property can name a font family but cannot load one, so a host
 * that sends only tokens is naming a typeface the app has no way to render.
 * These tests pin the contract that closes that gap:
 *
 *  - the SDK ships no font data, and an app with no host still renders in a
 *    web-safe stack (the "works out of the box" guarantee);
 *  - a host can name faces by relative path OR absolute URL;
 *  - malformed input degrades to fallback typography instead of throwing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractFontFaces, FONT_FACES_CONTEXT_KEY } from "../detection.js";
import { applyTheme, applyThemeFontFaces, resetAppliedFontFaces } from "../theme-defaults.js";
import { tokens } from "../ui/tokens.js";

/** Every file under a directory, excluding tests and dependencies. */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "__tests__" || entry === "node_modules") return [];
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

/** Every `.ts`/`.tsx` under a directory, excluding tests. */
function sourceFiles(dir: string): string[] {
  return allFiles(dir).filter((f) => /\.tsx?$/.test(f));
}

/** Minimal stand-in for the CSS Font Loading API — jsdom ships no FontFace. */
class FakeFontFace {
  constructor(
    public family: string,
    public source: string,
    public descriptors: Record<string, unknown> = {},
  ) {
    // Mirror the real constructor: reject a descriptor that isn't a `src`.
    if (!/^\s*(url\(|local\()/.test(source)) {
      throw new SyntaxError(`invalid src descriptor: ${source}`);
    }
  }
}

function installFontStub(): Set<FakeFontFace> {
  const added = new Set<FakeFontFace>();
  vi.stubGlobal("FontFace", FakeFontFace);
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      add: (f: FakeFontFace) => added.add(f),
      delete: (f: FakeFontFace) => added.delete(f),
    },
  });
  return added;
}

beforeEach(() => {
  resetAppliedFontFaces();
  vi.unstubAllGlobals();
});

describe("web-safe defaults — the no-host guarantee", () => {
  it("ships no font data and fetches from no font CDN", () => {
    // The regression guard for the deleted `ui/fonts` module, which injected a
    // Fontshare stylesheet for one host's brand from inside a general-purpose
    // library — and silently went stale when that host rebranded. A library
    // that hardcodes a consumer's brand doesn't just couple to it, it rots.
    const src = join(import.meta.dirname, "..");

    // No font CDN may be named anywhere in the library.
    const fetchers = sourceFiles(src).filter((f) =>
      /fontshare|fonts\.googleapis|fonts\.gstatic|use\.typekit/i.test(readFileSync(f, "utf8")),
    );
    expect(fetchers, `SDK must fetch from no font CDN: ${fetchers.join(", ")}`).toEqual([]);

    // Nor may it carry font binaries.
    const binaries = allFiles(src).filter((f) => /\.(woff2?|otf|ttf|eot)$/i.test(f));
    expect(binaries, `SDK must ship no font files: ${binaries.join(", ")}`).toEqual([]);

    // ...and the module must be gone from the published export map, which is
    // what consumers actually resolve.
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8"),
    );
    expect(Object.keys(pkg.exports)).not.toContain("./ui/fonts");
  });

  it("falls back to web-safe stacks with no host and no faces", () => {
    // Every font token resolves to a stack present on the platform, so an app
    // with no host, no network and no font files still renders correctly.
    expect(tokens.fontSans).toContain("system-ui");
    expect(tokens.fontMono).toContain("ui-monospace");
    expect(tokens.fontHeading).toContain("Georgia");

    // ...and carries no brand, current or historical.
    for (const value of [tokens.fontSans, tokens.fontMono, tokens.fontHeading]) {
      expect(value).not.toMatch(/Satoshi|Erode|Hanken|Newsreader/);
    }
  });

  it("no-ops where the CSS Font Loading API is absent", () => {
    // Older DOMs and SSR. Must not throw — the app keeps its fallbacks.
    expect(() => applyThemeFontFaces([{ family: "X", src: "url('/x.woff2')" }])).not.toThrow();
  });
});

describe("host-supplied faces", () => {
  it("accepts both relative paths and absolute URLs", () => {
    const added = installFontStub();
    applyThemeFontFaces([
      { family: "Local", src: "url('/fonts/local.woff2') format('woff2')" },
      { family: "Remote", src: "url('https://cdn.example/remote.woff2')" },
    ]);

    const byFamily = [...added].map((f) => f.family).sort();
    expect(byFamily).toEqual(["Local", "Remote"]);
  });

  it("passes weight/style through and defaults display to swap", () => {
    const added = installFontStub();
    applyThemeFontFaces([
      { family: "V", src: "url('/v.woff2')", weight: "400 700", style: "italic" },
    ]);

    const [face] = [...added];
    expect(face.descriptors.weight).toBe("400 700");
    expect(face.descriptors.style).toBe("italic");
    // `swap` paints text in the fallback immediately rather than blocking.
    expect(face.descriptors.display).toBe("swap");
  });

  it("ignores an unrecognised display instead of dropping the face", () => {
    const added = installFontStub();
    applyThemeFontFaces([{ family: "V", src: "url('/v.woff2')", display: "bogus" as never }]);

    const [face] = [...added];
    expect(face).toBeDefined();
    expect(face.descriptors.display).toBe("swap");
  });

  it("replaces the previous set rather than accumulating", () => {
    const added = installFontStub();
    applyThemeFontFaces([{ family: "First", src: "url('/1.woff2')" }]);
    applyThemeFontFaces([{ family: "Second", src: "url('/2.woff2')" }]);

    expect([...added].map((f) => f.family)).toEqual(["Second"]);
  });

  it("no-ops when re-applied with an unchanged set", () => {
    const added = installFontStub();
    const faces = [{ family: "Stable", src: "url('/s.woff2')" }];
    applyThemeFontFaces(faces);
    const first = [...added][0];

    // A dark-mode toggle re-runs the funnel; fonts don't change with mode, so
    // the face must not be evicted and re-fetched (which would flash).
    applyThemeFontFaces([{ family: "Stable", src: "url('/s.woff2')" }]);
    expect([...added][0]).toBe(first);
  });

  it("skips a malformed face but keeps the rest", () => {
    const added = installFontStub();
    applyThemeFontFaces([
      { family: "Good", src: "url('/good.woff2')" },
      { family: "Bad", src: "}; body { display: none }" },
      { family: "AlsoGood", src: "url('/also.woff2')" },
    ]);

    expect([...added].map((f) => f.family).sort()).toEqual(["AlsoGood", "Good"]);
  });

  it("never concatenates host input into CSS text", () => {
    // The CSSOM constructor takes family and src as separate arguments, so a
    // value containing `}` cannot escape a rule and inject styles into the app.
    const added = installFontStub();
    applyThemeFontFaces([
      {
        family: "Evil} body { display: none } @font-face { font-family: X",
        src: "url('/x.woff2')",
      },
    ]);

    const [face] = [...added];
    expect(face.family).toContain("}");
    expect(face.source).toBe("url('/x.woff2')");
  });
});

describe("applyTheme keeps colour and typography on one funnel", () => {
  it("applies variables and faces together", () => {
    const added = installFontStub();
    applyTheme("dark", { "--color-text-primary": "#fff" }, [
      { family: "Both", src: "url('/both.woff2')" },
    ]);

    expect(document.documentElement.style.getPropertyValue("--color-text-primary")).toBe("#fff");
    expect([...added].map((f) => f.family)).toEqual(["Both"]);
  });

  it("applies variables normally when the host sends no faces", () => {
    installFontStub();
    expect(() => applyTheme("light", { "--color-text-primary": "#000" })).not.toThrow();
    expect(document.documentElement.style.getPropertyValue("--color-text-primary")).toBe("#000");
  });
});

describe("wire format", () => {
  it("reads faces off the synapse/fontFaces host-context extension", () => {
    const faces = extractFontFaces({
      [FONT_FACES_CONTEXT_KEY]: [{ family: "Wire", src: "url('/w.woff2')" }],
    });
    expect(faces).toEqual([{ family: "Wire", src: "url('/w.woff2')" }]);
  });

  it("returns undefined when the host sends nothing", () => {
    // The supported no-fonts configuration — not a degraded one.
    expect(extractFontFaces({})).toBeUndefined();
    expect(extractFontFaces(undefined)).toBeUndefined();
  });

  it("drops entries missing family or src rather than rejecting the batch", () => {
    const faces = extractFontFaces({
      [FONT_FACES_CONTEXT_KEY]: [
        { family: "Keep", src: "url('/k.woff2')" },
        { family: "NoSrc" },
        { src: "url('/nofamily.woff2')" },
        null,
        "not-an-object",
      ],
    });
    expect(faces).toEqual([{ family: "Keep", src: "url('/k.woff2')" }]);
  });

  it("treats an all-malformed batch as unchanged, not as a clear", () => {
    // A host that means to send fonts but gets the shape wrong (`fontFamily`
    // for `family`) must not have its typo read as "drop my typeface". N
    // garbage entries are neither absent nor an explicit empty list.
    const faces = extractFontFaces({
      [FONT_FACES_CONTEXT_KEY]: [
        { fontFamily: "Brand", source: "url('/b.woff2')" },
        { fontFamily: "Other", source: "url('/o.woff2')" },
      ],
    });
    expect(faces).toBeUndefined();
  });

  it("still clears on an explicit empty list", () => {
    expect(extractFontFaces({ [FONT_FACES_CONTEXT_KEY]: [] })).toEqual([]);
  });

  it("keeps usable entries when only some are malformed", () => {
    const faces = extractFontFaces({
      [FONT_FACES_CONTEXT_KEY]: [{ family: "Keep", src: "url('/k.woff2')" }, { fontFamily: "Bad" }],
    });
    expect(faces).toEqual([{ family: "Keep", src: "url('/k.woff2')" }]);
  });

  it("ignores a non-array payload", () => {
    expect(extractFontFaces({ [FONT_FACES_CONTEXT_KEY]: "nope" })).toBeUndefined();
  });
});

describe("the public applyHostTheme sink normalises like the wire", () => {
  it("keeps loaded faces when every entry is mis-shaped", () => {
    // Reachable from `@nimblebrain/synapse/host`, where a host may build
    // `fontFaces` from untrusted JSON — so the input is not necessarily typed.
    // A shape mistake must not read as "drop my typeface".
    const added = installFontStub();
    applyThemeFontFaces([{ family: "Brand", src: "url('/b.woff2')" }]);
    applyThemeFontFaces([{ fontFamily: "Brand", source: "url('/b.woff2')" }] as never);
    expect([...added].map((f) => f.family)).toEqual(["Brand"]);
  });

  it("keeps loaded faces when handed a non-array", () => {
    const added = installFontStub();
    applyThemeFontFaces([{ family: "Brand", src: "url('/b.woff2')" }]);
    applyThemeFontFaces("nope" as never);
    expect([...added].map((f) => f.family)).toEqual(["Brand"]);
  });

  it("still clears on an explicit empty list", () => {
    const added = installFontStub();
    applyThemeFontFaces([{ family: "Brand", src: "url('/b.woff2')" }]);
    applyThemeFontFaces([]);
    expect([...added]).toEqual([]);
  });
});
