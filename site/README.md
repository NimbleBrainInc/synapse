# synapse.nimblebrain.ai

The developer front door for Synapse — the Astro site for `synapse.nimblebrain.ai`.

## Develop

```bash
cd site
npm install
npm run dev      # local dev server
npm run build    # static build to ./dist
npm run preview  # serve the build
```

Astro 5, static output. Dark theme only. The design system (tokens, the signal-arcs
background, the interop demo) lives in `src/styles/app.css`; the fonts (Space Grotesk)
are inlined there. The favicon is the circuit-`S` mark.

## Status

This is **step 1 of the build plan** (the landing page). The page is ported from the
approved concept and wired to real links (the GitHub repo stands in for docs until the
docs site ships). Still to come, per the site brief:

- `/docs` — Starlight, migrating and extending this repo's `docs/`.
- `/gallery` — the existing `gallery/` app, productized as a shareable playground.
- `/examples` — "Built with Synapse" (Bassethound, synapse-hello, …).
- Deploy to `synapse.nimblebrain.ai` and the SEO/OG/JSON-LD polish.

Positioning and the full plan: `gtm/strategy/SYNAPSE_POSITIONING.md`,
`SYNAPSE_SITE_BRIEF.md`, and `SYNAPSE_DESIGN.md` in the `hq` meta-repo.
