# AirTrack marathon route analysis

An interactive look at modelled air quality along four marathon courses — Paris, London,
Bangkok and Accra — plus a Dakar running corridor, for the hours each event was actually
on the road.

**Live site:** https://air-aware-labs.github.io/wef-marathon-air-quality/

Built by [Air Aware Labs](https://www.airawarelabs.com/airtrack) with the AirTrack
modelling engine.

## What the site shows

- Route-average and along-route concentrations for PM₂.₅, NO₂, ozone and PM₁₀.
- A modelled 500 m concentration field for each city, with the course drawn on top and
  OpenStreetMap road and water context for orientation.
- Route replay and a distance scrubber linked to a kilometre-by-kilometre profile.
- The same course over the 15 days around the event, to show whether event day was
  typical for the time of year.
- Per-city evidence labels: how many reference monitors support the local estimate, and
  where the model is running without nearby measurements.

## Scope and limitations

These are **modelled background** concentrations at 500 m resolution, for the event
hours. They are not route measurements.

- Event-day road closures are not modelled: the estimates reflect typical conditions for
  those hours, not the temporarily traffic-free course.
- The immediate roadside increment (the last few metres to the kerb) is not included, so
  values beside a busy road are conservative.
- Accra and Dakar have **no reference monitors** inside the modelled area. Those two
  cities are labelled indicative throughout, and the Dakar corridor is a running route,
  not a marathon course.
- The whole Bangkok course falls inside a single global-model cell, so within-route
  contrast there comes from downscaling rather than from independent observations.

Confidence labels on each city reflect exactly this: `high` where a dense reference
network supports the estimate, down to `indicative` where none is available.

## Data sources

| Input | Source |
|-------|--------|
| European priors (Paris, London) | [Copernicus Atmosphere Monitoring Service](https://atmosphere.copernicus.eu/) forecasts |
| Global priors (Bangkok, Accra, Dakar) | [NASA GEOS-CF](https://gmao.gsfc.nasa.gov/weather_prediction/GEOS-CF/) |
| Reference measurements | EEA reference network (Europe), public monitor networks elsewhere |
| Road and water context | © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL |
| Health reference values | [WHO global air quality guidelines (2021)](https://www.who.int/publications/i/item/9789240034228) |

Courses are official published routes (GPX or KML) where available; the Dakar line is a
Corniche Ouest running corridor.

## Running it locally

```bash
npm install
npm run build      # static site into docs/
npx vite preview   # or serve docs/ with any static file server
npm run dev        # development server
```

The site is a single-page app with no backend: `public/data/*.json` holds the precomputed
model output and is fetched at runtime. Paths are relative, so `docs/` can be served from
any sub-path.

`npm run build:single` writes a one-file, fully offline copy of the site (CSS, JS, fonts
and data inlined) to `marathon-air-quality.html`, for embedding or emailing.

## Social preview card

`public/og.png` is the link preview. It is built from real model output, not an
illustration: `tools/og-card/` holds the card markup and the Paris NO₂ map panel it
crops from the rendered site. Re-render it at 1200×630 after serving that folder:

```bash
npx serve tools/og-card    # or any static server
# then screenshot the page at exactly 1200x630 into public/og.png
```

## Deployment

GitHub Pages serves `docs/` on the `main` branch. To publish a change: edit the source,
run `npm run build`, and commit the regenerated `docs/`.

---

© 2026 Air Aware Labs. Model output and site content all rights reserved; third-party
data is used under the licences noted above.
