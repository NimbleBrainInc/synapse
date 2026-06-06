# Synapse UI — Brand Book & Gallery

A living reference for `@nimblebrain/synapse/ui`: every design token, layout
primitive, and component rendered in one page, with a light/dark toggle. It
**dogfoods the built library** (imports `@nimblebrain/synapse/ui` from `dist/`)
and plays the role of the host by injecting the NimbleBrain brand token map onto
`:root` — so the light/dark switch exercises the var-based theming exactly as a
real host mode-flip would.

## Run

```bash
# from the repo root — build the library first so dist/ui/* exists
npm run build

# then the gallery
cd gallery
npm install
npm run dev        # http://localhost:5173 (or --port)
```

## Build (static, for GitHub Pages)

```bash
cd gallery && npm run build   # → gallery/dist (base: "./", relative assets)
```

## Layout

- **Foundations** — color swatches, the type scale (Erode / Satoshi / JetBrains
  Mono), radius and shadow specimens.
- **Primitives** — Stack, Inline, Spacer, Divider.
- **Components** — buttons & links, badges & status, inputs, list rows, cards &
  avatars, pagination, prose, empty state.

The demo brand theme is duplicated in `src/demo-theme.ts` only so the gallery is
self-contained; the source of truth for those values lives in `nimblebrain/code`
and reaches apps by host injection.
