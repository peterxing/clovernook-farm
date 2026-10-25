# Clovernook Farm

**An open planning platform for turning 18 Clovernook Drive, Cundletown NSW into a layered farm: agrivoltaic solar over grazing, a battery, a GPU compute platform, a heat-recovery greenhouse and rental homes, sized for the highest return the site supports.**

**Live:** https://peterxing.github.io/clovernook-farm/

![Overview of the recommended plan](docs/screenshots/overview.jpg)

## What it does

The site is Lot 43 DP825601: 13.2 ha (32.7 acres) of flat paddock on the Manning River floodplain near Taree, with a 4-bedroom homestead on a small rise. The platform models every hour of a typical year (8,760 hours) and 25 years of cash flow for any combination of:

| Layer | What's modelled |
|---|---|
| **Solar** | Elevated fixed tilt, high-clearance single-axis trackers or vertical bifacial fences, laid out row by row inside the real cadastral boundary. Bifacial gain, row shading/backtracking, temperature, clipping. |
| **Battery** | Day-ahead price-aware dispatch on the last 12 months of NSW1 prices: stores otherwise-curtailed solar, shifts energy to the evening peak, keeps a reserve so the GPUs never exceed the grid import limit, never exports at negative prices. |
| **GPU compute** | B300, B200, H200, RTX PRO 6000 or L40S servers with temperature-dependent PUE, utilisation, interruptible jobs on cheap energy, yearly price decline and hardware refreshes. |
| **Farm** | Sheep, cattle or hens under the panels (pasture shading effect), grazing or hay on open paddock, beehives, and a greenhouse heated by GPU waste heat. |
| **Homes** | Lease the homestead, add a granny flat and farm-stay cabins on flood-raised floors. |
| **Money** | Capex by item, opex, escalation, debt, NPV/IRR/payback, LCOE, land purchase and resale. |

Then it **optimises**: a multi-start coordinate-descent search over 17 decisions (array type, size, ground cover, tilt, DC/AC ratio, import/export limits, battery power and duration, GPU model and count, cabins, granny flat, farm enterprises, greenhouse, hives), testing several hundred full-year designs a second in a Web Worker, under a budget, grid limits, a minimum farmed share and flood-safety rules.

![Generated layout on NSW aerial imagery](docs/screenshots/site-layout.jpg)

## What the site data says

Pulled from NSW government services when the data is built (`npm run data`):

- **Floodplain.** The 5 m LiDAR DEM puts the paddock at 1.0-2.2 m AHD (median 1.42 m). Design floods at Cundletown from the [Manning River Floodplain Risk Management Study and Plan](https://data.nsw.gov.au/data/dataset/fdp-reports-manning-river-frms-p) (MidCoast Council, 2020): 20% AEP 2.0 m, 5% 3.1 m, 1% 4.1 m, PMF 7.3 m AHD; the 2100 defined flood event is 4.6 m, so the flood planning level is about **5.1 m AHD**. The plan puts modules, the equipment platform, new floors and a livestock refuge mound at or above it, on piles rather than fill to keep floodplain storage.
- **Zoning.** 91.8% RU1 Primary Production (40 ha minimum lot size), 8.2% R5 Large Lot Residential (the house block), Greater Taree LEP 2010.
- **Overlays.** Acid sulfate soils class 2a/2b over ~95% of the lot, bush fire prone grassland (category 3), Koala Management Area, Coastal Environment Area, and Taree Airport 2.3 km south (glint and glare).

## Headline result (default assumptions, October 2026)

The recommended plan comes straight from the optimiser with every element of the brief required: a 1.08 MWp high-clearance tracker array with cattle grazing underneath, a 1.5 MW / 1.5 MWh battery, 16 × B300 servers (128 GPUs) on a flood-raised platform, a 2,000 m² greenhouse heated by their waste heat, 40 hives, the leased homestead and six farm-stay cabins.

- Capex about **A$22.7M** including the land; year-1 EBITDA about **A$6.5M**; NPV about break-even at 8% (IRR ~8.1%).
- GPU compute carries most of the value and most of the risk: the Monte Carlo puts the chance of a positive NPV at about one in three, because GPU rental prices and their rate of decline dominate.
- Exporting solar into the NSW midday market doesn't pay at elevated-structure costs, so the array is sized to feed the site. The no-GPU "Agrivoltaic farm & homes" plan comes out at roughly −A$3.4M NPV once the land purchase is included.

Change any assumption and these numbers update instantly.

![Energy flows](docs/screenshots/energy.jpg)

## Run it locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine, optimiser, risk and share-link tests
npm run build      # static site in dist/
npm run data       # rebuild src/data from the public sources (cached in scripts/.cache)
```

Everything runs client-side; there is no server. Plans are shareable: the link encodes every change you make.

## How it's built

- `src/engine/` – pure TypeScript model: `solar.ts` (sun position, transposition, bifacial, shading, flood curve), `layout.ts` (row layout in the real lot), `dispatch.ts` (hourly energy balance and battery), `landuse.ts` (farm and homes), `model.ts` (capex, cash flow, metrics), `optimize.ts`, `risk.ts` (tornado, Monte Carlo, NPV contributions), `params.ts` (every assumption with its source and range).
- `src/ui/` – React + ECharts + Leaflet front end, heavy jobs in a Web Worker.
- `scripts/build-data.mjs` – fetches the cadastre, zoning, overlays, LiDAR, PVGIS weather and AEMO prices and writes compact JSON.
- GitHub Actions runs the tests and deploys to GitHub Pages on every push to `main`.

![Optimiser](docs/screenshots/optimiser.jpg)

## Data sources and licences

- Cadastre, address, 5 m LiDAR DEM, aerial imagery and base maps: © Spatial Services NSW (CC BY 4.0).
- Zoning, lot size, height, acid sulfate soils, bush fire prone land: NSW Department of Planning Planning Portal spatial data (CC BY 4.0).
- Design flood levels: Manning River Floodplain Risk Management Study and Plan, BMT for MidCoast Council, 2020 (CC BY 4.0).
- Weather: PVGIS 5.3 TMY (PVGIS-ERA5), © European Commission JRC; beam/diffuse split calibrated to NASA POWER climatology.
- Electricity prices: AEMO aggregated price and demand data, NSW1, October 2025 to September 2026 (used with acknowledgement under AEMO's copyright permissions).
- Costs and market prices: cited per assumption in the app (GPU rental indices, server quotes, battery and solar build costs, Essential Energy tariffs, LGC prices, NSW DPI gross margins, local rental data, RBA exchange rate).

## Disclaimer

A concept study for discussion. It is not financial, engineering, planning or legal advice, and it isn't affiliated with the owner, vendor or selling agent of the property. Flood levels, layout features and planning pathways must be confirmed with MidCoast Council, Essential Energy and qualified consultants.

Code is MIT licensed; data keeps its source licence.
