# Real-Time Air Quality Monitoring System (Flask + ML)

A production-style AQI dashboard that combines:
- Live AQI feeds (WAQI proxy with resilient fallback)
- Area-level station discovery
- Geolocation-aware nearest-station lookup
- ML-based AQI prediction
- Health and guidance insights

## Marine Architecture

This project uses a **Marine Architecture** model where each layer has a clear role, like an ocean ecosystem.

```text
┌──────────────────────────────────────────────────────────────┐
│ Surface Deck (UI Layer)                                     │
│ templates/*.html + static/js + static/css                   │
│ - Dashboard, search, locate-me, map, cinematic visuals      │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Tide Controller (API Layer)                                 │
│ Flask routes in app (1).py                                  │
│ - /api/live/*, /api/current-aqi, /api/predict, analytics    │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Reef Resolver (Live Reliability Layer)                      │
│ - Alias normalization (uk, usa, us)                         │
│ - Search fallback + UID station resolution                  │
│ - Payload normalization + in-memory live cache              │
└──────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ Deep Data Layer                                              │
│ Sample_Dataset/globalAirQuality.csv                          │
│ ML-Model/*.pkl                                                │
│ - Historical fallback, ranking, heatmap, prediction model    │
└──────────────────────────────────────────────────────────────┘
```

## Key Features

- Reliable live AQI route resolution (`direct -> alias -> search -> uid`)
- Area AQI chips sorted from low to high
- Nearby station resolution using map bounds + distance ranking
- Better location labels (`Area, City, Country`)
- Search suggestions with loading/empty/error states
- AQI guidance API for health precautions
- CSV + ML fallback paths to avoid blank dashboards

## Project Structure

```text
Air project/
├── app (1).py
├── requirements.txt
├── README.md
├── .gitignore
├── ML-Model/
│   ├── aqi_model_random_forest.pkl
│   ├── aqi_scaler.pkl
│   ├── aqi_encoders.pkl
│   └── air_quality_model_training.ipynb
├── Sample_Dataset/
│   └── globalAirQuality.csv
├── templates/
│   ├── index.html
│   ├── analytics.html
│   └── predict.html
└── static/
    ├── css/style.css
    ├── js/main.js
    ├── js/analytics.js
    ├── js/predict.js
    └── assets/hero/
```

## Tech Stack

- Backend: Flask, Requests, Pandas, NumPy
- ML: scikit-learn, joblib
- Frontend: HTML, CSS, JavaScript, Chart.js, Leaflet

## Environment Variables

You can configure runtime behavior with:

- `WAQI_API_TOKEN` or `WAQI_TOKEN` (live AQI token)
- `WAQI_BASE_URL` (default: `https://api.waqi.info`)
- `FLASK_PORT` (default: `8080`)
- `FLASK_DEBUG` (default: `False`)
- `LIVE_CACHE_TTL_SEC` (default: `1800`)

## Run Locally

1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Start server:
   ```bash
   python "app (1).py"
   ```
3. Open:
   - `http://127.0.0.1:8080/`
   - `http://127.0.0.1:8080/analytics`
   - `http://127.0.0.1:8080/predict`

## API Overview

Core live endpoints:
- `GET /api/live/<city_or_station>`
- `GET /api/live/search/<keyword>`
- `GET /api/live/areas/<city>`
- `GET /api/live/nearby?lat=<lat>&lng=<lng>`
- `GET /api/live/geo/<lat>/<lon>`
- `GET /api/live-map-bounds?lat1=&lng1=&lat2=&lng2=`

Core analytics endpoints:
- `GET /api/current-aqi?city=<city>`
- `GET /api/historical?city=<city>&hours=24`
- `GET /api/statistics`
- `GET /api/city-ranking`
- `GET /api/heatmap`
- `GET /api/city-locations`
- `GET /api/nlp/advice?...`
- `POST /api/predict`

## Reliability Notes

- If a city query fails directly, resolver retries with WAQI search and station UID.
- If top-level AQI is missing, fallback values are derived from pollutant IAQI fields.
- If local CSV city is missing, `/api/current-aqi` can fall back to live data.
- Geolocation flow prioritizes nearest live station rather than rough city-only fallback.

## License

This repository is for educational and project use. Add your preferred license if you plan public distribution.
