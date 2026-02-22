# CookFlow (MVP Web)

CookFlow is a high-contrast guided-cooking website designed for cooks who want to execute one clear step at a time without constant scrolling.

## Design constraints implemented

- **Color palette:** white, black, and Japanese-flag red (`#BC002D`)
- **No filters/categories in v1:** one single global recipe list
- **Recipe detail includes:**
  - name
  - dish photo
  - summary + historical context
  - prep/rest/cook time split
  - full ingredient list
  - **"Cook this dish"** button
- **Cooking flow includes:**
  - portion selection first
  - ingredient scaling in metric units
  - **"Cook now"** button
  - vertical timeline with chronological steps
  - automatic step switching by time
  - pause/resume + manual previous/next controls

## Data scope (v1)

- 50 globally popular dishes (TasteAtlas-focused seed list)
- Each dish has:
  - internet source link (Serious Eats recipe page)
  - prep / rest / cook timings scraped from Serious Eats schema metadata
  - detailed cooking instructions scraped from Serious Eats recipe steps
  - explicit ingredient staging step that mentions all listed ingredients
  - step durations automatically retimed to match scraped totals
  - chef-curated instruction pass for top 10 dishes (more actionable wording)
  - ingredients in metric units
  - enriched summary/history text

See [`docs/data-collection.md`](./docs/data-collection.md) for details.

## Run locally

No build system is required.

1. Start a local static server from the project root:
   - `python3 -m http.server 8080`
2. Open:
   - `http://localhost:8080`

## Validate data integrity

Run:

```bash
npm run validate-data
```

It checks:

- exactly 50 recipes
- required fields present
- each recipe has step timings
- each recipe has prep/rest/cook split
- metric-only units

## Refresh Serious Eats timing scrape

```bash
npm run scrape-serious-eats
```

This updates:

- `data/serious-eats-scraped.json` (audit output)
- `data/serious-eats-overrides.js` (runtime timing overrides)

Some dishes have no exact Serious Eats equivalent; those are flagged as
`matchType: "proxy"` with a note.

## Refresh Serious Eats instruction scrape

```bash
npm run scrape-serious-eats-content
```

This updates:

- `data/serious-eats-content.js` (source ingredient + instruction content)

## File overview

- `index.html` – app shell
- `styles.css` – high-contrast UI system
- `app.js` – app state machine and timed cooking flow
- `data/recipes.js` – seed dataset + timing template retiming
- `data/curated-chef-steps.js` – manual chef-curated top 10 step packs
- `data/serious-eats-overrides.js` – scraped timing/source overrides
- `data/serious-eats-content.js` – scraped source instructions/ingredients
- `docs/data-collection.md` – sourcing and enrichment notes
- `scripts/scrape-serious-eats.mjs` – Serious Eats scraping pipeline
- `scripts/scrape-serious-eats-content.mjs` – instruction scraping pipeline
- `scripts/validate-data.mjs` – dataset validation script

