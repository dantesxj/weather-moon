# Weather & Moon

Global Thymer plugin: weather + moon phase on journal pages.

## Features

- **Title cluster** (Logseq-style): weather + moon icons injected to the left of the journal date title; data matches **that journal page’s date** (historical archive when needed).
- **Status bar**: compact readout for **today** — high/low, condition, days to full or new moon.
- **Popover** (Dashboard Status Shortcuts style): hourly strip, 10-day outlook, precip timing; click status bar or title icons.
- **Settings**: city search via Open-Meteo geocoding (manual location only); °F/°C; synced via **Plugin Backend**.

## Install

1. Create a **Global** custom plugin in Thymer.
2. Paste `plugin.js` into Custom Code and `plugin.json` into Configuration.
3. Command palette: **Weather & Moon: Configure** — search for your city and save.
4. Optional: **Weather & Moon: Storage location…** for Plugin Backend sync.

## Privacy

- No GPS; you choose a city/coordinates in settings.
- Weather: [Open-Meteo](https://open-meteo.com/) (no API key).
- Moon phase: computed locally (no network).
