# Deal PnL Reconciliation

A browser-based tool for reconciling Databricks and ACFT PnL exports by Managed Deal. All processing happens locally in your browser — no data is uploaded to any server.

## Features

- Upload CSV or Excel files from both Databricks and ACFT
- Auto-detects key columns (deal ID, instrument type, PnL columns, currency)
- Configurable column mapping with support for multiple PnL column pairs
- FX handling: non-USD deals automatically exclude CURR-type rows from Databricks
- Deal-level status: **Match**, **Tolerance** (<1% diff), **Break**, **Missing DB/ACFT**
- Drill-down to instrument-type level for any deal
- Filter by status, scope (All / USD / Non-USD), and search by deal name
- Copy results to clipboard (tab-separated, paste directly into Excel)

## Live App

👉 **https://magreporting.github.io/PNL-Reconciliation/**

## Local Development

```bash
npm install
npm run dev
```

## Deploy

Deployment is fully automated via GitHub Actions. Every push to `main` triggers a build and deploys to GitHub Pages.

**One-time setup required in your repo:**
1. Go to **Settings → Pages**
2. Set **Source** to `GitHub Actions`

That's it — the workflow handles everything else.

## Tech Stack

- React 18 + Vite
- PapaParse (CSV parsing)
- SheetJS / xlsx (Excel parsing)
- Zero external UI dependencies
