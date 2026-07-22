# synapse.nimblebrain.ai

The developer front door for Synapse — the Astro site for `synapse.nimblebrain.ai`.

## Develop

```bash
cd web
npm install
npm run dev      # local dev server
npm run build    # static build to ./dist
npm run preview  # serve the build
```

Astro 5, static output. Dark theme only. The design system (tokens, the signal-arcs
background, the interop demo) lives in `src/styles/app.css`; fonts are in `public/fonts/`.
The favicon and nav mark are the traced circuit-`S`.

## Deploy

`.github/workflows/web-pages.yml` builds `web/` and publishes to GitHub Pages on push to
`main` (custom domain via `public/CNAME`). To go live: enable Pages (Settings → Pages →
Source: GitHub Actions) and point DNS for `synapse.nimblebrain.ai` per the domain runbook.

## Status

This is **step 1 of the build plan** (the landing page). Still to come, per the site brief:

- `/docs` — Starlight, migrating and extending this repo's `docs/`.
- `/gallery` — the existing `gallery/` app, productized as a shareable playground.
- `/examples` — "Built with Synapse" (Bassethound, synapse-hello, …).

Positioning and the full plan: `gtm/strategy/SYNAPSE_POSITIONING.md`,
`SYNAPSE_SITE_BRIEF.md`, and `SYNAPSE_DESIGN.md` in the `hq` meta-repo.
