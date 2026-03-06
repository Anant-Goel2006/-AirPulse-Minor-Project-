/* ═══════════════════════════════════════════════════════
   main.js — AQI Dashboard
   Live data from /api/live/<city> (Flask → WAQI proxy)
   Analytics data from /api/* live snapshot/history endpoints
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ── AQI Config ────────────────────────────────────────── */
const CATS = [
  { max: 50, level: 'Good', color: '#009966', bg: '#e8f8f2', textClr: '#fff' },
  { max: 100, level: 'Moderate', color: '#c9a000', bg: '#fffde8', textClr: '#000' },
  { max: 150, level: 'Poor', color: '#e67e00', bg: '#fff3e0', textClr: '#fff' },
  { max: 200, level: 'Unhealthy', color: '#cc0033', bg: '#fde8ed', textClr: '#fff' },
  { max: 300, level: 'Severe', color: '#660099', bg: '#f3e8ff', textClr: '#fff' },
  { max: 999, level: 'Hazardous', color: '#7e0023', bg: '#fde8e8', textClr: '#fff' },
];
const LOCALITY_GUIDANCE_BY_LEVEL = {
  good: 'Great for outdoor plans',
  moderate: 'Sensitive groups take care',
  poor: 'Limit long outdoor exposure',
  unhealthy: 'Use a mask outdoors',
  severe: 'Avoid outdoor exercise',
  hazardous: 'Stay indoors if possible',
};
const POLL_CFG = {
  pm25: { lbl: 'PM₂.₅', unit: 'μg/m³', max: 300, color: '#e74c3c' },
  pm10: { lbl: 'PM₁₀', unit: 'μg/m³', max: 420, color: '#e67e00' },
  no2: { lbl: 'NO₂', unit: 'ppb', max: 200, color: '#8e44ad' },
  so2: { lbl: 'SO₂', unit: 'ppb', max: 100, color: '#2980b9' },
  o3: { lbl: 'O₃', unit: 'ppb', max: 200, color: '#16a085' },
  co: { lbl: 'CO', unit: 'ppm', max: 15, color: '#7f8c8d' },
};

const getCat = aqi => CATS.find(c => aqi <= c.max) || CATS[CATS.length - 1];
function getLocalityGuidance(aqi) {
  const cat = getCat(Number(aqi));
  const key = String(cat?.level || '').toLowerCase();
  return LOCALITY_GUIDANCE_BY_LEVEL[key] || 'Follow local AQI precautions';
}
const $ = id => document.getElementById(id);
const css = (k, v) => document.documentElement.style.setProperty(k, v);
const fmtAqi = v => Math.round(v);

let curCity = 'delhi', curLiveData = null;
let curCityDisplay = 'Delhi';
let currentUserCity = 'delhi';
let curHeroQueryHint = 'delhi';
let trendChartInst = null, donutChartInst = null, forecastChartInst = null;
let aqiMap = null, mapMarkers = [], markerCluster = null;
let heroActiveLayer = 'primary', heroLoadedImage = '', heroUpdateSeq = 0;
let cityLocationsCache = null;
let cityLoadSeq = 0;
let curTimeIso = '';
let heroManifestCache = null;
let heroManifestPromise = null;
let mapLoadSeq = 0;
let mapMoveTimer = null;
let areaListLoadSeq = 0;
let areaSliderBound = false;
let areaSliderSyncRaf = 0;
const DEBUG_STABILITY = false;
const AREA_CACHE_TTL_MS = 90 * 1000;
const AREA_CACHE_MAX_ITEMS = 24;
const LIVE_UI_REFRESH_MS = 45 * 1000;
const OVERVIEW_REFRESH_MS = 5 * 60 * 1000;
const areaListResponseCache = new Map();
const areaListInFlight = new Map();
const heroBgConfigCache = new Map();
const heroImageLoadCache = new Map();
const liveSnapshotCache = new Map();

function stabilityLog(msg, meta = null) {
  if (!DEBUG_STABILITY) return;
  if (meta != null) {
    console.log(`[stability] ${msg}`, meta);
    return;
  }
  console.log(`[stability] ${msg}`);
}

function isStaleReq(reqSeq) {
  const stale = reqSeq != null && reqSeq !== cityLoadSeq;
  if (stale) stabilityLog('Dropping stale request', { reqSeq, cityLoadSeq });
  return stale;
}

// fallback: hide loading screen after 12s regardless
setTimeout(() => hideLoading(), 12000);

const FALLBACK_BG = {
  imageUrl: '/static/assets/hero/default.webp',
  focalPoint: 'center'
};
const BUILD_TS = document.querySelector('meta[name="build-ts"]')?.content || '';

const HERO_MANIFEST_PATH = '/static/assets/hero/manifest.json';
const COUNTRY_ALIASES = {
  usa: 'us',
  'united-states-of-america': 'united-states',
  'united-states': 'united-states',
  'u-s': 'us',
  uk: 'united-kingdom',
  england: 'united-kingdom',
};
const LOCAL_CITY_FALLBACK = {
  delhi: 'https://upload.wikimedia.org/wikipedia/commons/e/eb/PXL_20231127_142319433_India_Gate_at_Night_Kartavya_Path%2C_New_Delhi%2C_Delhi_110001_01.jpg',
  mumbai: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/49/Gateway_of_India_at_Night_01.jpg/3840px-Gateway_of_India_at_Night_01.jpg',
  bengaluru: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/Vidhana_Soudha_LE.jpg/3840px-Vidhana_Soudha_LE.jpg',
  kolkata: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Howrah_Bridge_Evening.jpg/3840px-Howrah_Bridge_Evening.jpg',
  hyderabad: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/Charminar_at_night_%28JUNE_2019%29_2.jpg/3840px-Charminar_at_night_%28JUNE_2019%29_2.jpg',
  chennai: '/static/assets/hero/cities/chennai.webp',
  beijing: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Southeast_corner_tower_of_Forbidden_City_and_Beijing_eastern_skyline_%2820241127133425%29.jpg/3840px-Southeast_corner_tower_of_Forbidden_City_and_Beijing_eastern_skyline_%2820241127133425%29.jpg',
  shanghai: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Pudong_night_skyline_viewed_from_the_Bund_in_Shanghai_%2841199899084%29.jpg/3840px-Pudong_night_skyline_viewed_from_the_Bund_in_Shanghai_%2841199899084%29.jpg',
  london: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Big_Ben_at_Night_from_The_London_Eye%2C_2012-12-28.jpg/3840px-Big_Ben_at_Night_from_The_London_Eye%2C_2012-12-28.jpg',
  'new-york': 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Brooklyn_Diner%2C_New_York_City_%282024%29-L1006207.jpg/3840px-Brooklyn_Diner%2C_New_York_City_%282024%29-L1006207.jpg',
  tokyo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Shibuya_and_Shinjuku_from_Yebisu_Garden_Place_Tower%2C_Ebisu%2C_Tokyo%2C_Japan%2C_2024_May.jpg/3840px-Shibuya_and_Shinjuku_from_Yebisu_Garden_Place_Tower%2C_Ebisu%2C_Tokyo%2C_Japan%2C_2024_May.jpg',
  singapore: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8d/Singapore_%28SG%29%2C_Marina_Bay_--_2019_--_4439-48.jpg/3840px-Singapore_%28SG%29%2C_Marina_Bay_--_2019_--_4439-48.jpg',
  sydney: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3b/Sydney_%28AU%29%2C_Opera_House_--_2019_--_3061-4.jpg/3840px-Sydney_%28AU%29%2C_Opera_House_--_2019_--_3061-4.jpg',
  paris: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Paris_Night.jpg/3840px-Paris_Night.jpg',
  chicago: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Chicago_from_North_Avenue_Beach_June_2015_panorama_2.jpg/3840px-Chicago_from_North_Avenue_Beach_June_2015_panorama_2.jpg',
  'los-angeles': 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Hollywood%2C_Los_Angeles%2C_CA_11.JPG/3840px-Hollywood%2C_Los_Angeles%2C_CA_11.JPG',
};
const FORCED_HERO_IMAGE_OVERRIDES = {
  kolkata: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/32/Howrah_Bridge_Evening.jpg/3840px-Howrah_Bridge_Evening.jpg',
  paris: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Paris_Night.jpg/3840px-Paris_Night.jpg',
};

const CITY_BG_ALIASES = {
  bangalore: 'bengaluru',
  chenai: 'chennai',
  madras: 'chennai',
  'new-york-city': 'new-york',
  apris: 'paris',
  nyc: 'new-york',
};

/* ── Toast ──────────────────────────────────────────────── */
let lastToastMsg = '';
let lastToastTime = 0;

function toast(msg, type = 'info') {
  const now = Date.now();
  if (msg === lastToastMsg && now - lastToastTime < 3000) return;
  lastToastMsg = msg;
  lastToastTime = now;

  const icons = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-circle-xmark' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<i class="fa-solid ${icons[type] || 'fa-circle-info'}"></i> ${msg}`;
  $('toastContainer').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ── Loading ────────────────────────────────────────────── */
function hideLoading() {
  const el = $('loadingOverlay');
  if (el) { el.classList.add('hidden'); }
}

// Helper: wrap a promise with a timeout that resolves to null on timeout
function withTimeout(promise, ms = 5000) {
  if (!promise || typeof promise.then !== 'function') return Promise.resolve(null);
  return Promise.race([
    promise.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), ms))
  ]);
}

async function fetchJsonNoCache(url) {
  const u = url.includes('?') ? `${url}&_=${Date.now()}` : `${url}?_=${Date.now()}`;
  try {
    const r = await fetch(u, { cache: 'no-store' });
    const ctype = String(r.headers?.get('content-type') || '').toLowerCase();

    if (!r.ok) {
      let details = '';
      try {
        if (ctype.includes('application/json')) {
          const j = await r.json();
          details = String(j?.error || j?.data || '').trim();
        } else {
          details = String(await r.text()).trim().slice(0, 200);
        }
      } catch { }
      return { error: `HTTP ${r.status}${details ? `: ${details}` : ''}`, status: r.status };
    }

    if (!ctype.includes('application/json')) {
      let raw = '';
      try { raw = String(await r.text()).slice(0, 200); } catch { }
      return { error: 'Non-JSON response from server', status: r.status, raw };
    }

    return await r.json();
  } catch (e) {
    return { error: String(e?.message || e || 'Network request failed'), status: 0 };
  }
}

// global error capture
window.addEventListener('error', e => {
  const msg = String(e?.message || '');
  const src = String(e?.filename || '');
  const isCrossOriginScriptError = (!src && msg.toLowerCase() === 'script error.');
  const isThirdPartySource = !!src && !src.startsWith(window.location.origin) && !src.startsWith('/');
  console.error('Global error:', e.error || e.message, src || '');
  hideLoading();
  if (isCrossOriginScriptError || isThirdPartySource) return;
  toast('An unexpected error occurred.', 'error');
});
window.addEventListener('unhandledrejection', ev => {
  const reasonText = String(ev?.reason?.message || ev?.reason || '');
  const isNetworkNoise = /failed to fetch|networkerror|load failed|timeout|cancel/i.test(reasonText);
  console.error('Unhandled rejection:', ev.reason);
  hideLoading();
  if (isNetworkNoise) return;
  toast('An unexpected error occurred.', 'error');
});

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function getNearestCityFromCsv(lat, lng) {
  try {
    if (!Array.isArray(cityLocationsCache)) {
      const d = await fetchJsonNoCache('/api/city-locations');
      cityLocationsCache = d?.locations || [];
    }
    if (!cityLocationsCache.length) return null;

    let best = null;
    cityLocationsCache.forEach(loc => {
      const d = haversineKm(lat, lng, Number(loc.lat), Number(loc.lng));
      if (!Number.isFinite(d)) return;
      if (!best || d < best.distanceKm) {
        best = { ...loc, distanceKm: d };
      }
    });
    return best;
  } catch {
    return null;
  }
}

function normalizeCityKey(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function slugifyCity(raw) {
  return normalizeCityKey(raw).replace(/\s+/g, '-');
}

function titleCaseWords(raw) {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ') || 'Unknown';
}

function cleanPlaceToken(raw) {
  return String(raw || '')
    .replace(/^@+/, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*[-|]\s*(imd|monitor|station|waqi)\b.*$/i, '')
    .replace(/[^\w\s.'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeStationArea(token) {
  const t = normalizeCityKey(token);
  if (!t) return false;
  const areaHints = [
    'road', 'rd', 'street', 'st', 'station', 'market', 'sector', 'phase', 'block',
    'school', 'college', 'university', 'hospital', 'airport', 'industrial', 'park',
    'junction', 'cross', 'chowk', 'nagar', 'colony', 'district'
  ];
  if (/\d/.test(t)) return true;
  return areaHints.some(w => t.includes(w));
}

function resolveCityKey(raw) {
  const key = slugifyCity(String(raw || '').split(',')[0]);
  return key || '';
}

function resolveCountryKey(raw) {
  if (!raw) return '';
  const parts = String(raw).trim().split(',');
  const last = parts[parts.length - 1];
  const key = slugifyCity(last);
  return COUNTRY_ALIASES[key] || key || '';
}

function selectDisplayCity(parts, fallbackCity) {
  const tokens = (Array.isArray(parts) ? parts : [])
    .map(cleanPlaceToken)
    .filter(Boolean);
  if (!tokens.length) return titleCaseWords(fallbackCity || curCity);

  const fallback = normalizeCityKey(fallbackCity);
  if (fallback) {
    const exact = tokens.find(t => normalizeCityKey(t) === fallback);
    if (exact) return exact;
    const fuzzy = tokens.find(t => {
      const n = normalizeCityKey(t);
      return n && (n.includes(fallback) || fallback.includes(n));
    });
    if (fuzzy) return fuzzy;
  }

  if (tokens.length >= 3) return tokens[tokens.length - 2];

  if (tokens.length === 2) {
    if (looksLikeStationArea(tokens[0]) && !looksLikeStationArea(tokens[1])) {
      return tokens[1];
    }
  }

  return tokens[0];
}

function parseCityCountry(rawName, fallbackCity) {
  if (typeof rawName !== 'string' || !rawName.trim()) {
    return { city: titleCaseWords(fallbackCity || curCity), country: '—' };
  }

  const cleaned = rawName.replace(/\s+/g, ' ').trim();
  const parts = cleaned
    .split(',')
    .map(p => cleanPlaceToken(p))
    .filter(Boolean);
  let city = selectDisplayCity(parts, fallbackCity);

  let country = parts.length > 1 ? cleanPlaceToken(parts[parts.length - 1]) : '—';
  if (!country || country.toLowerCase() === 'global') country = '—';

  return {
    city: city ? titleCaseWords(city) : titleCaseWords(fallbackCity || curCity),
    country
  };
}

function parseMapStationLocation(rawName, fallbackCity = '') {
  const cleaned = String(rawName || '').replace(/\s+/g, ' ').trim();
  const parts = cleaned
    .split(',')
    .map(p => cleanPlaceToken(p))
    .filter(Boolean);
  const parsed = parseCityCountry(cleaned, fallbackCity);
  let area = '';
  if (parts.length >= 2) {
    const first = parts[0];
    if (normalizeCityKey(first) !== normalizeCityKey(parsed.city) && looksLikeStationArea(first)) {
      area = first;
    }
  }
  return {
    city: parsed.city,
    country: parsed.country,
    area
  };
}

function parseAqiNumber(rawVal) {
  const parsed = Number.parseFloat(rawVal);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function isUidQuery(raw) {
  return /^@?\d+$/.test(String(raw || '').trim());
}

function isDirectCityQuery(raw) {
  const txt = String(raw || '').trim().toLowerCase();
  if (!txt) return false;
  if (isUidQuery(txt)) return false;
  if (txt.startsWith('geo:')) return false;
  if (txt.includes(',')) return false;
  if (/\d/.test(txt)) return false;
  const stationHints = ['station', 'road', 'rd', 'sector', 'block', 'phase', 'airport', 'industrial', 'college', 'hospital'];
  return !stationHints.some(h => txt.includes(h));
}

function normalizeDisplayName(raw) {
  const cleaned = cleanPlaceToken(String(raw || '').trim());
  if (!cleaned || isUidQuery(cleaned)) return '';
  return titleCaseWords(cleaned);
}

function normalizeLoadCityInput(input) {
  if (input && typeof input === 'object') {
    const query = String(input.query ?? input.city ?? '').trim();
    const displayName = normalizeDisplayName(input.displayName ?? input.label ?? '');
    const bgHint = normalizeDisplayName(input.bgHint ?? input.backgroundHint ?? input.stationHint ?? '');
    return { query, displayName, bgHint };
  }
  return {
    query: String(input || '').trim(),
    displayName: '',
    bgHint: '',
  };
}

function resolveLiveAqi(data, fallbackValue = null) {
  const direct = parseAqiNumber(data?.aqi);
  if (Number.isFinite(direct)) return direct;

  const iaqi = data?.iaqi || {};
  const dominant = String(data?.dominentpol || '').toLowerCase().trim();
  const keys = [dominant, 'pm25', 'pm10', 'o3', 'no2', 'so2', 'co'];
  const seen = new Set();
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const node = iaqi?.[key];
    const raw = (node && typeof node === 'object') ? node.v : node;
    const parsed = parseAqiNumber(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Number.isFinite(fallbackValue) ? fallbackValue : null;
}

function snapshotKey(raw) {
  const normalized = normalizeCityKey(raw);
  if (normalized) return normalized;
  return String(raw || '').trim().toLowerCase();
}

function clonePayloadSafe(payload) {
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return null;
  }
}

function rememberLiveSnapshot(queryKeys, payload) {
  if (!payload || typeof payload !== 'object') return;
  const copy = clonePayloadSafe(payload);
  if (!copy) return;
  const keys = Array.isArray(queryKeys) ? queryKeys : [queryKeys];
  keys.forEach(raw => {
    const key = snapshotKey(raw);
    if (!key) return;
    liveSnapshotCache.set(key, copy);
  });
  if (liveSnapshotCache.size > 40) {
    const firstKey = liveSnapshotCache.keys().next().value;
    if (firstKey) liveSnapshotCache.delete(firstKey);
  }
}

function getLiveSnapshot(queryKeys) {
  const keys = Array.isArray(queryKeys) ? queryKeys : [queryKeys];
  for (const raw of keys) {
    const key = snapshotKey(raw);
    if (!key) continue;
    const hit = liveSnapshotCache.get(key);
    if (hit) {
      const copy = clonePayloadSafe(hit);
      if (copy) return copy;
    }
  }
  return null;
}

function extractLivePollutants(data) {
  const iaqi = data?.iaqi || {};
  const out = {};
  Object.keys(POLL_CFG).forEach(key => {
    const node = iaqi?.[key];
    const raw = (node && typeof node === 'object') ? node.v : node;
    const parsed = Number.parseFloat(raw);
    out[key] = Number.isFinite(parsed) ? parsed : null;
  });
  return out;
}

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getAreaCacheKey(rawQuery) {
  const normalized = normalizeCityKey(rawQuery);
  return normalized || slugifyCity(rawQuery);
}

function getCachedAreaResponse(rawQuery) {
  const key = getAreaCacheKey(rawQuery);
  if (!key) return null;
  const hit = areaListResponseCache.get(key);
  if (!hit) return null;
  if ((Date.now() - hit.ts) > AREA_CACHE_TTL_MS) {
    areaListResponseCache.delete(key);
    return null;
  }
  return hit.payload;
}

function storeAreaResponseCache(rawQuery, payload) {
  const key = getAreaCacheKey(rawQuery);
  if (!key || !payload) return;
  areaListResponseCache.set(key, { ts: Date.now(), payload });
  if (areaListResponseCache.size > AREA_CACHE_MAX_ITEMS) {
    const firstKey = areaListResponseCache.keys().next().value;
    if (firstKey) areaListResponseCache.delete(firstKey);
  }
}

function getAreaSliderRefs() {
  return {
    listEl: $('areaAqiList'),
    sliderEl: $('areaAqiSlider'),
    prevEl: $('areaSlidePrev'),
    nextEl: $('areaSlideNext'),
  };
}

function syncAreaSliderControls() {
  const { listEl, sliderEl, prevEl, nextEl } = getAreaSliderRefs();
  if (!listEl || !sliderEl || !prevEl || !nextEl) return;

  const maxScroll = Math.max(0, listEl.scrollWidth - listEl.clientWidth);
  const canSlide = maxScroll > 2;
  sliderEl.disabled = !canSlide;
  prevEl.disabled = !canSlide || listEl.scrollLeft <= 1;
  nextEl.disabled = !canSlide || listEl.scrollLeft >= maxScroll - 1;

  if (!canSlide) {
    sliderEl.value = '0';
    return;
  }

  const pct = Math.max(0, Math.min(100, Math.round((listEl.scrollLeft / maxScroll) * 100)));
  sliderEl.value = String(pct);
}

function scheduleAreaSliderSync() {
  if (areaSliderSyncRaf) return;
  areaSliderSyncRaf = requestAnimationFrame(() => {
    areaSliderSyncRaf = 0;
    syncAreaSliderControls();
  });
}

function bindAreaSliderControls() {
  if (areaSliderBound) return;
  const { listEl, sliderEl, prevEl, nextEl } = getAreaSliderRefs();
  if (!listEl || !sliderEl || !prevEl || !nextEl) return;

  const scrollStep = () => Math.max(180, Math.round(listEl.clientWidth * 0.72));

  prevEl.addEventListener('click', () => {
    listEl.scrollBy({ left: -scrollStep(), behavior: 'smooth' });
  });
  nextEl.addEventListener('click', () => {
    listEl.scrollBy({ left: scrollStep(), behavior: 'smooth' });
  });
  sliderEl.addEventListener('input', () => {
    const maxScroll = Math.max(0, listEl.scrollWidth - listEl.clientWidth);
    const ratio = Math.max(0, Math.min(1, Number(sliderEl.value) / 100));
    listEl.scrollLeft = maxScroll * ratio;
  });
  listEl.addEventListener('scroll', scheduleAreaSliderSync, { passive: true });
  window.addEventListener('resize', scheduleAreaSliderSync, { passive: true });

  areaSliderBound = true;
  scheduleAreaSliderSync();
}

function renderAreaAqiState(msg) {
  const listEl = $('areaAqiList');
  const metaEl = $('areaAqiMeta');
  if (!listEl) return;
  listEl.innerHTML = `<div class="area-aqi-state">${escapeHtml(msg)}</div>`;
  if (metaEl && !msg.toLowerCase().includes('loading')) {
    metaEl.textContent = '';
  }
  scheduleAreaSliderSync();
}

function renderAreaAqiList(rows, centerName = '') {
  const listEl = $('areaAqiList');
  const metaEl = $('areaAqiMeta');
  if (!listEl) return;
  if (!Array.isArray(rows) || !rows.length) {
    renderAreaAqiState('No live localities found for this city right now.');
    return;
  }

  const items = rows
    .map(item => ({
      uid: item?.uid != null ? String(item.uid).replace(/[^\d]/g, '') : '',
      station: String(item?.station_name || '').trim(),
      area: normalizeDisplayName(cleanPlaceToken(item?.area || '')),
      city: normalizeDisplayName(cleanPlaceToken(item?.city || '')),
      country: normalizeDisplayName(cleanPlaceToken(item?.country || '')),
      aqi: Number(item?.aqi),
      distance: Number(item?.distance_km),
    }))
    .filter(item => item.station && Number.isFinite(item.aqi))
    .sort((a, b) => a.aqi - b.aqi || a.distance - b.distance);

  if (!items.length) {
    renderAreaAqiState('No live localities found for this city right now.');
    return;
  }

  if (metaEl) {
    const label = centerName ? ` around ${centerName}` : '';
    metaEl.textContent = `${items.length} live areas${label} · sorted AQI low to high`;
  }

  listEl.innerHTML = items.map(item => {
    const cat = getCat(item.aqi);
    const primary = item.area || item.city || normalizeDisplayName(curCityDisplay || curCity) || titleCaseWords(curCity);
    const secondaryParts = [];
    if (item.city && normalizeCityKey(item.city) !== normalizeCityKey(primary)) secondaryParts.push(item.city);
    if (item.country) secondaryParts.push(item.country);
    const secondary = secondaryParts.join(', ') || item.station;
    const guidance = getLocalityGuidance(item.aqi);
    const thumbUrl = buildLocalityPhotoUrl(item.station || `${primary} ${item.city}`, item.country);
    return `<button class="area-aqi-chip" data-uid="${escapeHtml(item.uid)}" data-station="${escapeHtml(item.station)}" data-display="${escapeHtml(primary)}" data-bghint="${escapeHtml(item.station)}" title="${escapeHtml(item.station)}">
      <span class="area-aqi-thumb" style="background-image:url('${thumbUrl}')"></span>
      <span class="area-aqi-badge" style="background:${cat.color};color:${cat.textClr}">${Math.round(item.aqi)}</span>
      <span class="area-aqi-text">
        <span class="area-aqi-primary">${escapeHtml(primary)}</span>
        <span class="area-aqi-secondary">${escapeHtml(secondary)}</span>
        <span class="area-aqi-guidance" style="color:${cat.color}">${escapeHtml(guidance)}</span>
      </span>
    </button>`;
  }).join('');

  listEl.querySelectorAll('.area-aqi-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = String(btn.dataset.uid || '').trim();
      const station = String(btn.dataset.station || '').trim();
      const displayName = normalizeDisplayName(btn.dataset.display || station);
      const bgHint = normalizeDisplayName(btn.dataset.bghint || station || displayName);

      const areaAqi = Number(btn.querySelector('.area-aqi-badge').textContent) || 0;
      renderNlpAdvice({
        summary: `In ${displayName || station}, AQI is ${Math.round(areaAqi)}. ${getLocalityGuidance(areaAqi)}.`,
        mask_recommendation: areaAqi <= 100 ? 'Optional for most' : (areaAqi <= 200 ? 'Use N95 mask' : 'Required high-filtration mask')
      });

      if (uid) {
        loadCity({ query: `@${uid}`, displayName, bgHint });
        return;
      }
      if (station) loadCity({ query: station, displayName, bgHint });
    });
  });
  scheduleAreaSliderSync();
}

async function loadAreaAqiList(cityQuery, reqSeq = null) {
  const query = String(cityQuery || curCity || '').trim();
  if (!query) return;
  bindAreaSliderControls();
  const thisSeq = ++areaListLoadSeq;
  const cached = getCachedAreaResponse(query);
  if (cached) {
    if (thisSeq !== areaListLoadSeq) return;
    if (isStaleReq(reqSeq)) return;
    renderAreaAqiList(cached.areas, cached.centerName || query);
    return;
  }
  renderAreaAqiState('Loading locality AQI...');
  try {
    const cacheKey = getAreaCacheKey(query);
    let fetchPromise = areaListInFlight.get(cacheKey);
    if (!fetchPromise) {
      fetchPromise = fetchJsonNoCache(`/api/live/areas/${encodeURIComponent(query)}?limit=140&radius_km=32`)
        .finally(() => {
          areaListInFlight.delete(cacheKey);
        });
      areaListInFlight.set(cacheKey, fetchPromise);
    }
    const r = await fetchPromise;
    if (thisSeq !== areaListLoadSeq) return;
    if (isStaleReq(reqSeq)) return;
    if (r?.status !== 'ok' || !Array.isArray(r?.areas)) {
      renderAreaAqiState('Area AQI is temporarily unavailable.');
      return;
    }
    const centerName = String(r?.city?.name || query).trim();
    storeAreaResponseCache(query, { areas: r.areas, centerName });
    renderAreaAqiList(r.areas, centerName);
  } catch (e) {
    if (thisSeq !== areaListLoadSeq) return;
    renderAreaAqiState('Area AQI is temporarily unavailable.');
  }
}

function isRequestedCityMatch(requestedCity, returnedCity) {
  const requested = normalizeCityKey(parseCityCountry(requestedCity, requestedCity).city || requestedCity);
  const returned = normalizeCityKey(parseCityCountry(returnedCity, requestedCity).city || returnedCity);
  if (!requested || !returned) return false;
  return requested === returned || requested.includes(returned) || returned.includes(requested);
}

function resolveCityKey(cityName) {
  const normalized = slugifyCity(cityName);
  if (!normalized) return '';
  if (LOCAL_CITY_FALLBACK[normalized]) return normalized;
  if (CITY_BG_ALIASES[normalized]) return CITY_BG_ALIASES[normalized];

  const aliasMatch = Object.keys(CITY_BG_ALIASES).find(alias => normalized.includes(alias));
  if (aliasMatch) return CITY_BG_ALIASES[aliasMatch];

  const directMatch = Object.keys(LOCAL_CITY_FALLBACK).find(key => normalized.includes(key));
  return directMatch || '';
}

async function loadHeroManifest() {
  if (heroManifestCache) return heroManifestCache;
  if (!heroManifestPromise) {
    heroManifestPromise = (async () => {
      try {
        const j = await fetchJsonNoCache(HERO_MANIFEST_PATH);
        heroManifestCache = j && typeof j === 'object' ? j : {};
      } catch {
        heroManifestCache = {};
      }
      return heroManifestCache;
    })();
  }
  return heroManifestPromise;
}

function resolveCountryKey(countryName) {
  const raw = slugifyCity(countryName);
  if (!raw) return '';
  return COUNTRY_ALIASES[raw] || raw;
}

function hashSeed(raw) {
  const txt = String(raw || '').trim();
  let h = 0;
  for (let i = 0; i < txt.length; i += 1) {
    h = ((h << 5) - h) + txt.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function buildSeededHeroImage(seed) {
  const h = hashSeed(seed);
  const hueA = h % 360;
  const hueB = (hueA + 42 + (h % 19)) % 360;
  const hueC = (hueA + 214 + (h % 23)) % 360;
  const x1 = 15 + (h % 70);
  const y1 = 12 + (h % 60);
  const x2 = 62 + (h % 30);
  const y2 = 66 + (h % 24);
  const svg = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1920 1080' preserveAspectRatio='xMidYMid slice'>
  <defs>
    <linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'>
      <stop offset='0%' stop-color='hsl(${hueA}, 76%, 58%)'/>
      <stop offset='48%' stop-color='hsl(${hueB}, 72%, 48%)'/>
      <stop offset='100%' stop-color='hsl(${hueC}, 74%, 33%)'/>
    </linearGradient>
    <radialGradient id='r1' cx='${x1}%' cy='${y1}%' r='56%'>
      <stop offset='0%' stop-color='rgba(255,255,255,.34)'/>
      <stop offset='100%' stop-color='rgba(255,255,255,0)'/>
    </radialGradient>
    <radialGradient id='r2' cx='${x2}%' cy='${y2}%' r='62%'>
      <stop offset='0%' stop-color='rgba(255,255,255,.22)'/>
      <stop offset='100%' stop-color='rgba(255,255,255,0)'/>
    </radialGradient>
  </defs>
  <rect width='1920' height='1080' fill='url(#g)'/>
  <rect width='1920' height='1080' fill='url(#r1)'/>
  <rect width='1920' height='1080' fill='url(#r2)'/>
  <g opacity='.18'>
    <circle cx='1540' cy='220' r='210' fill='rgba(255,255,255,.42)'/>
    <circle cx='380' cy='900' r='260' fill='rgba(255,255,255,.34)'/>
    <circle cx='1120' cy='760' r='180' fill='rgba(255,255,255,.26)'/>
  </g>
</svg>`.trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildLocalityPhotoUrl(labelText, countryLabel = '') {
  const raw = String(labelText || '').trim();
  const cityKey = resolveCityKey(raw);
  const countryKey = resolveCountryKey(countryLabel);

  if (heroManifestCache) {
    if (cityKey && heroManifestCache.cities?.[cityKey]?.imageUrl) {
      return heroManifestCache.cities[cityKey].imageUrl;
    }
    if (countryKey && heroManifestCache.countries?.[countryKey]?.imageUrl) {
      return heroManifestCache.countries[countryKey].imageUrl;
    }
  }
  // Deterministic colour SVG fallback based on label hash
  const hash = Array.from(raw).reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
  const hue = Math.abs(hash) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='300'><rect width='480' height='300' fill='hsl(${hue},45%,38%)'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

async function resolveHeroBg(cityName, countryName, queryHint = '') {
  const cityText = String(cityName || '').trim();
  const countryText = String(countryName || '').trim();
  const hintText = String(queryHint || '').trim();
  const countryKey = resolveCountryKey(countryText) || slugifyCity(countryText);
  const cacheKey = `${slugifyCity(cityText)}|${countryKey}|${slugifyCity(hintText)}`;
  const cached = heroBgConfigCache.get(cacheKey);
  if (cached) return cached;

  const manifest = await loadHeroManifest();
  const parsedHint = parseMapStationLocation(hintText, cityText);
  const hintedCity = String(parsedHint?.city || '').trim();
  const cityKeyCandidates = [
    resolveCityKey(cityText),
    resolveCityKey(hintedCity),
    resolveCityKey(hintText),
    resolveCityKey(parseCityCountry(hintText, hintText).city),
  ].filter(Boolean);
  const cityKey = cityKeyCandidates[0] || '';
  let resolved = null;

  if (cityKey && FORCED_HERO_IMAGE_OVERRIDES[cityKey]) {
    resolved = { imageUrl: FORCED_HERO_IMAGE_OVERRIDES[cityKey], focalPoint: 'center' };
  }
  if (!resolved && cityKey && manifest?.cities?.[cityKey]?.imageUrl) resolved = manifest.cities[cityKey];
  if (!resolved && cityKey && LOCAL_CITY_FALLBACK[cityKey]) {
    resolved = { imageUrl: LOCAL_CITY_FALLBACK[cityKey], focalPoint: 'center' };
  }

  if (!resolved) {
    // Use deterministic coloured SVG fallback so there is always a background
    const seed = slugifyCity(hintText) || slugifyCity(cityText) || countryKey || slugifyCity(countryText);
    if (seed) {
      const hash = Array.from(seed).reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0);
      const hue = Math.abs(hash) % 360;
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='1920' height='1080'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='hsl(${hue},55%,28%)'/><stop offset='100%' stop-color='hsl(${(hue + 60) % 360},45%,18%)'/></linearGradient></defs><rect width='1920' height='1080' fill='url(#g)'/></svg>`;
      resolved = { imageUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, focalPoint: 'center' };
    }
  }

  if (!resolved && countryKey && manifest?.countries?.[countryKey]?.imageUrl) resolved = manifest.countries[countryKey];
  if (!resolved && manifest?.default?.imageUrl) resolved = manifest.default;
  if (!resolved) resolved = FALLBACK_BG;

  heroBgConfigCache.set(cacheKey, resolved);
  if (heroBgConfigCache.size > 120) {
    const firstKey = heroBgConfigCache.keys().next().value;
    if (firstKey) heroBgConfigCache.delete(firstKey);
  }
  return resolved;
}

function cacheBustedImageUrl(url) {
  const raw = String(url || '').trim();
  if (!raw || !raw.startsWith('/static/')) return raw;
  const sep = raw.includes('?') ? '&' : '?';
  const v = BUILD_TS || Date.now();
  return `${raw}${sep}v=${encodeURIComponent(v)}`;
}

function preloadBackgroundImage(url) {
  const safeUrl = cacheBustedImageUrl(url);
  if (!safeUrl) return Promise.resolve('');
  const cachedPromise = heroImageLoadCache.get(safeUrl);
  if (cachedPromise) return cachedPromise;

  const loadPromise = new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(safeUrl);
    img.onerror = () => resolve('');
    img.src = safeUrl;
  });
  heroImageLoadCache.set(safeUrl, loadPromise);
  if (heroImageLoadCache.size > 180) {
    const firstKey = heroImageLoadCache.keys().next().value;
    if (firstKey) heroImageLoadCache.delete(firstKey);
  }
  return loadPromise;
}

function setHeroLayerImage(el, imageUrl, focalPoint = 'center') {
  if (!el || !imageUrl) return;
  el.style.backgroundImage = `url("${imageUrl}")`;
  el.style.setProperty('--bg-pos', focalPoint || 'center');
  el.style.backgroundPosition = focalPoint || 'center';
}

function applyPageBackgroundImage(imageUrl, focalPoint = 'center') {
  const safeUrl = cacheBustedImageUrl(imageUrl);
  if (!safeUrl) return;
  css('--page-bg-image', `url("${safeUrl}")`);
  css('--page-bg-pos', focalPoint || 'center');
}

function getAqiTintAlpha(level) {
  const key = String(level || '').toLowerCase();
  if (key === 'good') return 0.11;
  if (key === 'moderate') return 0.14;
  if (key === 'poor') return 0.16;
  if (key === 'unhealthy') return 0.19;
  if (key === 'severe') return 0.22;
  if (key === 'hazardous') return 0.24;
  return 0.15;
}

function hexToRgbValues(hex) {
  const clean = String(hex || '').replace('#', '').trim();
  if (clean.length !== 6) return null;
  const n = Number.parseInt(clean, 16);
  if (Number.isNaN(n)) return null;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `${r},${g},${b}`;
}

function updateHeroTint(cat) {
  const overlay = $('heroTintOverlay');
  if (!overlay) return;
  const rgb = hexToRgbValues(cat?.color) || '75,169,255';
  const alpha = getAqiTintAlpha(cat?.level);
  overlay.style.background = `linear-gradient(120deg, rgba(${rgb},${alpha}) 0%, rgba(8,15,32,.16) 58%, rgba(8,15,32,.28) 100%)`;
}

function getHourFromCityIso(isoText) {
  const txt = String(isoText || '').trim();
  if (!txt) return null;

  // WAQI ISO-like timestamps already carry city-local time in the text itself.
  const m = txt.match(/[T\s](\d{1,2})(?::(\d{2}))?/);
  if (m) {
    const h = Number.parseInt(m[1], 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return h;
  }

  // Fallback parser for unexpected timestamp shapes.
  const parsed = new Date(txt);
  if (!Number.isNaN(parsed.getTime())) return parsed.getHours();
  return null;
}

function getTimePhaseFromIso(isoText) {
  const parsedHour = getHourFromCityIso(isoText);
  const h = Number.isFinite(parsedHour) ? parsedHour : new Date().getHours();
  if (h >= 6 && h <= 16) return 'day';
  if (h >= 17 && h <= 19) return 'evening';
  return 'night';
}

function applyScenePhase(phase) {
  const hero = $('cinematicHero');
  const p = ['day', 'evening', 'night'].includes(phase) ? phase : 'day';
  const classes = ['scene-day', 'scene-evening', 'scene-night'];

  document.body.classList.remove(...classes);
  document.body.classList.add(`scene-${p}`);

  if (hero) {
    hero.classList.remove(...classes);
    hero.classList.add(`scene-${p}`);
  }
}

function crossfadeHeroImage(imageUrl, focalPoint = 'center') {
  const primary = $('heroBgPrimary');
  const secondary = $('heroBgSecondary');
  if (!primary || !secondary || !imageUrl) return;

  const incoming = heroActiveLayer === 'primary' ? secondary : primary;
  const outgoing = heroActiveLayer === 'primary' ? primary : secondary;

  setHeroLayerImage(incoming, imageUrl, focalPoint);
  incoming.classList.add('is-visible');

  requestAnimationFrame(() => {
    outgoing.classList.remove('is-visible');
    heroActiveLayer = heroActiveLayer === 'primary' ? 'secondary' : 'primary';
  });
}

function initCinematicHero() {
  const hero = $('cinematicHero');
  if (!hero) return;

  const primaryLayer = $('heroBgPrimary');
  if (primaryLayer && !heroLoadedImage) {
    setHeroLayerImage(primaryLayer, FALLBACK_BG.imageUrl, FALLBACK_BG.focalPoint);
    heroLoadedImage = FALLBACK_BG.imageUrl;
  }
  applyPageBackgroundImage(FALLBACK_BG.imageUrl, FALLBACK_BG.focalPoint);
  applyScenePhase(getTimePhaseFromIso(''));

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canParallax = !reduceMotion &&
    window.matchMedia &&
    window.matchMedia('(hover:hover) and (pointer:fine)').matches;

  if (!canParallax || hero.dataset.parallaxReady === '1') return;

  hero.addEventListener('pointermove', e => {
    const r = hero.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = ((e.clientX - r.left) / r.width - 0.5) * 16;
    const y = ((e.clientY - r.top) / r.height - 0.5) * 12;
    hero.style.setProperty('--mx', `${x.toFixed(2)}px`);
    hero.style.setProperty('--my', `${y.toFixed(2)}px`);
  });

  hero.addEventListener('pointerleave', () => {
    hero.style.setProperty('--mx', '0px');
    hero.style.setProperty('--my', '0px');
  });

  hero.dataset.parallaxReady = '1';
}

async function updateCinematicHero({ cityName, country, aqi, level, updatedAt, timeIso }, reqSeq = null) {
  if (isStaleReq(reqSeq)) return;
  const hero = $('cinematicHero');
  if (!hero) return;

  const parsedAqi = Number.isFinite(aqi) ? aqi : Number.parseInt(aqi, 10);
  const safeAqi = Number.isFinite(parsedAqi) ? parsedAqi : 80;
  const cat = getCat(safeAqi);
  const parsedCity = parseCityCountry(cityName, curCity);
  const displayCity = parsedCity.city;
  const rawCountry = String(country || '').trim();
  const parsedCountry = String(parsedCity.country || '').trim();
  const displayCountry = (rawCountry && rawCountry !== '—')
    ? rawCountry
    : ((parsedCountry && parsedCountry !== '—') ? parsedCountry : displayCity);

  const cityLabel = $('heroCityLabel');
  const countryLabel = $('heroCountryLabel');
  const badge = $('heroAqiBadge');
  const levelLabel = $('heroLevelLabel');
  const updatedLabel = $('heroUpdatedTime');

  if (cityLabel) cityLabel.textContent = displayCity;
  if (countryLabel) countryLabel.textContent = displayCountry || displayCity;
  if (badge) {
    badge.textContent = Number.isFinite(parsedAqi) ? `AQI ${fmtAqi(parsedAqi)}` : 'AQI —';
    badge.style.background = cat.color + 'dc';
    badge.style.color = cat.textClr || '#fff';
  }
  if (levelLabel) {
    levelLabel.textContent = level || cat.level;
    levelLabel.style.color = '#fff';
    levelLabel.style.background = cat.color + '88';
  }
  if (updatedLabel) updatedLabel.textContent = updatedAt || $('aqiUpdated')?.textContent || 'Updated: --';

  applyScenePhase(getTimePhaseFromIso(timeIso));
  updateHeroTint(cat);

  const mySeq = ++heroUpdateSeq;
  const bgCfg = await resolveHeroBg(displayCity, displayCountry, curHeroQueryHint || curCityDisplay || curCity);
  if (isStaleReq(reqSeq)) return;
  let imageUrl = await preloadBackgroundImage(bgCfg.imageUrl);
  let focalPoint = bgCfg.focalPoint || 'center';
  if (!imageUrl && bgCfg.imageUrl !== FALLBACK_BG.imageUrl) {
    imageUrl = await preloadBackgroundImage(FALLBACK_BG.imageUrl);
    focalPoint = FALLBACK_BG.focalPoint || 'center';
  }

  if (isStaleReq(reqSeq)) return;
  if (!imageUrl || mySeq !== heroUpdateSeq) return;
  applyPageBackgroundImage(imageUrl, focalPoint);
  if (imageUrl === heroLoadedImage) return;

  crossfadeHeroImage(imageUrl, focalPoint);
  heroLoadedImage = imageUrl;
}

function getDisplayedAqiFallback() {
  const raw = $('gaugeValue')?.textContent || '';
  const parsed = Number.parseInt(String(raw).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 90;
}

function applySelectedCityVisual(city, reqSeq) {
  const loc = parseCityCountry(city, city);
  const heroHint = normalizeDisplayName(city || loc.city || curCityDisplay || curCity);
  if (heroHint) curHeroQueryHint = heroHint;
  const aqi = getDisplayedAqiFallback();
  const level = $('gaugeLevel')?.textContent || getCat(aqi).level;
  updateCinematicHero({
    cityName: loc.city,
    country: loc.country === '—' ? '' : loc.country,
    aqi,
    level,
    updatedAt: $('aqiUpdated')?.textContent || 'Updated: --',
    timeIso: curTimeIso || '',
  }, reqSeq).catch(() => { });
}

/* ── Refresh button ─────────────────────────────────────── */
const btnRefresh = $('btnRefresh');
if (btnRefresh) {
  btnRefresh.addEventListener('click', () => {
    btnRefresh.classList.add('spinning');
    loadCity(curCity).finally(() => {
      setTimeout(() => btnRefresh.classList.remove('spinning'), 800);
    });
  });
}

async function getApproxCoordsFromIP() {
  const providers = [
    'https://ipapi.co/json/',
    'https://ipwho.is/',
  ];
  for (const url of providers) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      const lat = Number(j?.latitude ?? j?.lat);
      const lng = Number(j?.longitude ?? j?.lon ?? j?.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng, provider: url };
      }
    } catch { }
  }
  return null;
}

async function loadLiveFromCoords(lat, lng, modeLabel = 'your location') {
  const latStr = Number(lat).toFixed(6);
  const lngStr = Number(lng).toFixed(6);

  try {
    const nearby = await fetchJsonNoCache(`/api/live/nearby?lat=${latStr}&lng=${lngStr}`);
    if (nearby?.status === 'ok' && nearby?.data) {
      const uid = String(nearby?.nearest?.uid ?? '').replace(/[^\d]/g, '');
      const stationName = nearby?.nearest?.station_name || nearby?.data?.city?.name || '';
      await loadCity({
        query: uid ? `@${uid}` : (stationName || `geo:${latStr};${lngStr}`),
        displayName: normalizeDisplayName(stationName),
        bgHint: normalizeDisplayName(stationName),
      });
      const stationLat = Number(nearby?.nearest?.lat ?? nearby?.data?.city?.geo?.[0]);
      const stationLng = Number(nearby?.nearest?.lng ?? nearby?.data?.city?.geo?.[1]);
      if (aqiMap && Number.isFinite(stationLat) && Number.isFinite(stationLng)) {
        aqiMap.setView([stationLat, stationLng], Math.max(aqiMap.getZoom(), 11));
      }
      const d = Number(nearby?.nearest?.distance_km);
      if (Number.isFinite(d)) toast(`Nearest station is ${d.toFixed(1)} km from ${modeLabel}`, 'success');
      else toast(`Loaded live AQI for ${modeLabel}`, 'success');
      showLocationAqiPopup(lat, lng, nearby.data);
      return true;
    }
  } catch { }

  try {
    const geo = await fetchJsonNoCache(`/api/live/geo/${latStr}/${lngStr}`);
    if (geo?.status === 'ok' && geo?.data) {
      const stationName = geo?.data?.city?.name || `geo:${latStr};${lngStr}`;
      await loadCity({
        query: stationName,
        displayName: normalizeDisplayName(stationName),
        bgHint: normalizeDisplayName(stationName),
      });
      const stationLat = Number(geo?.data?.city?.geo?.[0]);
      const stationLng = Number(geo?.data?.city?.geo?.[1]);
      if (aqiMap && Number.isFinite(stationLat) && Number.isFinite(stationLng)) {
        aqiMap.setView([stationLat, stationLng], Math.max(aqiMap.getZoom(), 11));
      }
      toast(`Loaded live AQI for ${modeLabel}`, 'success');
      showLocationAqiPopup(lat, lng, geo.data);
      return true;
    }
  } catch { }

  const nearest = await getNearestCityFromCsv(lat, lng);
  if (nearest?.city) {
    if (aqiMap) aqiMap.setView([Number(nearest.lat), Number(nearest.lng)], 10);
    await loadCity(nearest.city);
    toast(`Live geo unavailable. Showing nearest city: ${nearest.city}`, 'info');
    return true;
  }
  return false;
}

// Locate button: find user and show AQI at their coordinates
const btnLocate = $('btnLocate');
if (btnLocate) {
  btnLocate.addEventListener('click', async () => {
    btnLocate.classList.add('spinning');
    const release = () => setTimeout(() => btnLocate.classList.remove('spinning'), 500);

    const tryApproximate = async () => {
      const approx = await getApproxCoordsFromIP();
      if (!approx) return false;
      const ok = await loadLiveFromCoords(approx.lat, approx.lng, 'approximate location');
      if (ok) toast('Using approximate location (IP-based)', 'info');
      return ok;
    };

    if (!navigator.geolocation) {
      if (!(await tryApproximate())) {
        toast('Geolocation not available in this browser', 'error');
      }
      release();
      return;
    }

    navigator.geolocation.getCurrentPosition(async pos => {
      const lat = Number(pos.coords.latitude);
      const lng = Number(pos.coords.longitude);
      const ok = await loadLiveFromCoords(lat, lng, 'your location');
      if (!ok && !(await tryApproximate())) {
        toast('Unable to fetch AQI for your location', 'error');
      }
      release();
    }, async err => {
      const msg = err?.code === 1 ? 'Location permission denied. Enable location and try again.' : 'Unable to get your location';
      if (!(await tryApproximate())) {
        toast(msg, 'error');
      }
      release();
    }, {
      enableHighAccuracy: true,
      timeout: 14000,
      maximumAge: 0
    });
  });
}

function showLocationAqiPopup(lat, lng, data) {
  try {
    if (!aqiMap) return;
    const aqi = resolveLiveAqi(data, getDisplayedAqiFallback()) ?? getDisplayedAqiFallback();
    const cat = getCat(aqi);
    const stationLat = Number(data.city?.geo?.[0]);
    const stationLng = Number(data.city?.geo?.[1]);
    const markerLat = Number.isFinite(stationLat) ? stationLat : Number(lat);
    const markerLng = Number.isFinite(stationLng) ? stationLng : Number(lng);
    const dist = Number.isFinite(stationLat) && Number.isFinite(stationLng)
      ? haversineKm(Number(lat), Number(lng), stationLat, stationLng)
      : null;
    const proximity = Number.isFinite(dist) ? `${dist.toFixed(1)} km from your device` : 'Nearest station to your location';

    const html = `<div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:200px">
      <div style="font-size:1rem;font-weight:800;color:#1a1d2e">${data.city?.name || 'Nearby station'}</div>
      <div style="font-size:.9rem;color:#9ca3af;margin-bottom:6px">AQI: <strong style='color:${cat.color}'>${aqi}</strong> — ${cat.level}</div>
      <div style="font-size:.75rem;color:#6b7280;margin-bottom:6px">${proximity}</div>
      <div style="font-size:.85rem;color:#4a5568">${cat.text || ''}</div>
    </div>`;

    const m = L.circleMarker([markerLat, markerLng], { radius: 10, color: cat.color, fillColor: cat.color, fillOpacity: .9 }).addTo(aqiMap);
    const user = L.circleMarker([Number(lat), Number(lng)], {
      radius: 6, color: '#1d4ed8', fillColor: '#3b82f6', fillOpacity: .85, weight: 2
    }).addTo(aqiMap);
    m.bindPopup(html).openPopup();
    // remove temporary markers
    setTimeout(() => {
      if (aqiMap.hasLayer(m)) aqiMap.removeLayer(m);
      if (aqiMap.hasLayer(user)) aqiMap.removeLayer(user);
    }, 20000);
  } catch (e) { }
}

/* ── City chips ─────────────────────────────────────────── */
function setActiveCityChip(cityName) {
  const target = normalizeCityKey(parseCityCountry(cityName, cityName).city);
  let matched = false;
  document.querySelectorAll('.city-chip').forEach(btn => {
    const key = normalizeCityKey(btn.dataset.city);
    const isMatch = key === target || target.includes(key) || key.includes(target);
    btn.classList.toggle('active', isMatch);
    if (isMatch) matched = true;
  });
  if (!matched) {
    document.querySelectorAll('.city-chip').forEach(btn => btn.classList.remove('active'));
  }
}

document.querySelectorAll('.city-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.city-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadCity(btn.dataset.city);
  });
});

/* ── Global search ──────────────────────────────────────── */
const searchInput = $('globalSearch');
const searchDropdown = $('searchDropdown');
let searchTimer = null;
let searchReqSeq = 0;

function renderSearchState(message, stateClass = '') {
  if (!searchDropdown) return;
  const cls = stateClass ? ` ${stateClass}` : '';
  searchDropdown.innerHTML = `<div class="sd-state${cls}">${escapeHtml(message)}</div>`;
  searchDropdown.classList.add('show');
}

function normalizeSearchSuggestion(item, fallbackQuery = '') {
  const uid = String(item?.uid ?? '').replace(/[^\d]/g, '');
  const stationNameRaw = String(item?.station?.name || '').trim();
  if (!stationNameRaw || /^@?\d+$/.test(stationNameRaw)) return null;

  const stationName = cleanPlaceToken(stationNameRaw);
  if (!stationName) return null;

  const parsed = parseMapStationLocation(stationName, fallbackQuery);
  const area = titleCaseWords(parsed.area || '');
  const city = titleCaseWords(parsed.city || '');
  const country = titleCaseWords(parsed.country || '');
  const primary = area || city || titleCaseWords(fallbackQuery || curCity);

  const secondaryParts = [];
  if (city && normalizeCityKey(city) !== normalizeCityKey(primary)) secondaryParts.push(city);
  if (country && country !== '—') secondaryParts.push(country);
  const secondary = secondaryParts.join(', ') || stationName;

  const aqi = parseAqiNumber(item?.aqi);
  return {
    uid,
    stationName,
    primary,
    secondary,
    aqi,
    cat: Number.isFinite(aqi) ? getCat(aqi) : { color: '#9ca3af', textClr: '#fff' },
  };
}

if (searchInput) {
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const val = searchInput.value.trim();
    if (!val) {
      searchReqSeq++;
      if (searchDropdown) searchDropdown.classList.remove('show');
      return;
    }
    searchTimer = setTimeout(() => doSearch(val), 400);
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = searchInput.value.trim();
      if (!val) return;
      const first = searchDropdown?.querySelector('.sd-item');
      if (first) {
        first.click();
      } else {
        loadCity(val);
        if (searchDropdown) searchDropdown.classList.remove('show');
        searchInput.value = '';
      }
    }
  });

  document.addEventListener('click', e => {
    if (!searchDropdown) return;
    if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
      searchDropdown.classList.remove('show');
    }
  });
}

async function doSearch(q) {
  if (!searchDropdown) return;
  const query = String(q || '').trim();
  if (!query) {
    searchDropdown.classList.remove('show');
    return;
  }
  const reqSeq = ++searchReqSeq;
  renderSearchState('Searching live stations…', 'is-loading');

  try {
    const j = await fetchJsonNoCache(`/api/live/search/${encodeURIComponent(query)}`);
    if (reqSeq !== searchReqSeq) return;
    if (j?.status !== 'ok' || !Array.isArray(j?.data)) {
      renderSearchState('Search is temporarily unavailable.', 'is-error');
      return;
    }

    const rows = j.data
      .map(item => normalizeSearchSuggestion(item, query))
      .filter(Boolean)
      .slice(0, 8);

    if (!rows.length) {
      renderSearchState('No matching live stations found.', 'is-empty');
      return;
    }

    searchDropdown.innerHTML = rows.map(item => {
      const badge = Number.isFinite(item.aqi) ? fmtAqi(item.aqi) : '—';
      return `<div class="sd-item" data-uid="${escapeHtml(item.uid)}" data-name="${escapeHtml(item.stationName)}">
        <span class="sd-aqi" style="background:${item.cat.color};color:${item.cat.textClr}">${badge}</span>
        <span class="sd-text">
          <span class="sd-primary">${escapeHtml(item.primary)}</span>
          <span class="sd-secondary">${escapeHtml(item.secondary)}</span>
        </span>
      </div>`;
    }).join('');

    searchDropdown.querySelectorAll('.sd-item').forEach(item => {
      item.addEventListener('click', () => {
        const uid = String(item.dataset.uid || '').trim();
        const stationName = String(item.dataset.name || '').trim();
        loadCity({
          query: uid ? `@${uid}` : stationName,
          displayName: normalizeDisplayName(stationName),
          bgHint: normalizeDisplayName(stationName),
        });
        searchDropdown.classList.remove('show');
        if (searchInput) searchInput.value = '';
      });
    });
    searchDropdown.classList.add('show');
  } catch {
    if (reqSeq !== searchReqSeq) return;
    renderSearchState('Search is temporarily unavailable.', 'is-error');
  }
}

function applyCachedLiveSnapshot(snapshot, reqSeq, displayNameHint = '') {
  if (!snapshot || isStaleReq(reqSeq)) return false;
  curLiveData = snapshot;
  const aqi = resolveLiveAqi(curLiveData, getDisplayedAqiFallback());
  if (Number.isFinite(aqi)) curLiveData.aqi = aqi;
  curTimeIso = curLiveData?.time?.iso || curTimeIso || '';
  if ($('aqiUpdated')) $('aqiUpdated').textContent = `Updated: ${new Date().toLocaleTimeString()} (cached live)`;

  const liveLat = Number(curLiveData?.city?.geo?.[0]);
  const liveLng = Number(curLiveData?.city?.geo?.[1]);
  if (aqiMap && Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
    aqiMap.setView([liveLat, liveLng], Math.max(aqiMap.getZoom(), 10));
  }

  renderHero(curLiveData, reqSeq, displayNameHint || curCityDisplay || '');
  renderForecast(curLiveData?.forecast, Number.isFinite(aqi) ? aqi : 0);
  loadDonut();
  loadNlpAdvice(curLiveData, reqSeq);
  return true;
}

/* ── Load city ──────────────────────────────────────────── */
async function loadCity(cityInput) {
  const { query: city, displayName, bgHint } = normalizeLoadCityInput(cityInput);
  if (!city) return;
  console.log('loadCity()', city, displayName || '');
  const reqSeq = ++cityLoadSeq;
  const previewName = displayName || normalizeDisplayName(isUidQuery(city) ? curCityDisplay : city) || city;
  const resolvedBgHint = normalizeDisplayName(bgHint || displayName || previewName || city);
  curCity = city;
  curCityDisplay = normalizeDisplayName(previewName) || curCityDisplay || city;
  if (resolvedBgHint) curHeroQueryHint = resolvedBgHint;
  setActiveCityChip(previewName);
  // Avoid optimistic hero repaint for station/UID loads to prevent flicker.
  const shouldOptimisticVisual = !displayName && !isUidQuery(city);
  if (shouldOptimisticVisual) {
    applySelectedCityVisual(previewName, reqSeq);
  }
  const cachedSnapshot = getLiveSnapshot([city, displayName, bgHint, previewName, curCityDisplay]);
  loadAreaAqiList(city, reqSeq);
  try {
    const j = await fetchJsonNoCache(`/api/live/${encodeURIComponent(city)}?fresh=1`);
    console.log('loadCity() response', j);
    if (isStaleReq(reqSeq)) return;
    if (j.status !== 'ok') {
      console.warn('live API unavailable for', city, j);
      if (applyCachedLiveSnapshot(cachedSnapshot, reqSeq, displayName || previewName)) {
        toast(`Live update failed for "${city}". Showing latest real-time snapshot.`, 'info');
        return;
      }
      toast(`Live AQI unavailable for "${city}". Showing latest live snapshot fallback.`, 'info');
      await loadLocalAqi(city, reqSeq);
      return;
    }
    curLiveData = j.data;
    const resolvedAqi = resolveLiveAqi(j.data, getDisplayedAqiFallback());
    if (!Number.isFinite(Number(j?.data?.aqi)) && Number.isFinite(resolvedAqi)) {
      curLiveData.aqi = resolvedAqi;
    }
    curTimeIso = j.data?.time?.iso || '';
    if ($('aqiUpdated')) $('aqiUpdated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
    if (!displayName && !isDirectCityQuery(city)) {
      const liveLabel = normalizeDisplayName(j?.data?.city?.name || '');
      if (liveLabel) curCityDisplay = liveLabel;
    }
    if (!bgHint && !isDirectCityQuery(city)) {
      const liveHint = normalizeDisplayName(j?.data?.city?.name || curCityDisplay || previewName);
      if (liveHint) curHeroQueryHint = liveHint;
    }
    rememberLiveSnapshot(
      [city, displayName, bgHint, previewName, curCityDisplay, j?.data?.city?.name],
      curLiveData
    );
    renderHero(j.data, reqSeq, displayName || curCityDisplay || previewName);
    const liveLat = Number(j.data?.city?.geo?.[0]);
    const liveLng = Number(j.data?.city?.geo?.[1]);
    if (aqiMap && Number.isFinite(liveLat) && Number.isFinite(liveLng)) {
      aqiMap.setView([liveLat, liveLng], Math.max(aqiMap.getZoom(), 10));
    }
    renderForecast(j.data.forecast, Number.isFinite(resolvedAqi) ? resolvedAqi : 0);
    loadDonut();
    loadNlpAdvice(j.data, reqSeq);
    const analyticsCity = normalizeDisplayName(
      parseMapStationLocation(j?.data?.city?.name || curCityDisplay || city, curCityDisplay || city).city
    ) || curCityDisplay || city;
    currentUserCity = analyticsCity;
    loadTrend(analyticsCity).catch(() => { });
    loadHeatmap(analyticsCity).catch(() => { });
    loadStats();
    loadRanking();
  } catch (e) {
    console.error('loadCity() error', e);
    if (isStaleReq(reqSeq)) return;
    if (applyCachedLiveSnapshot(cachedSnapshot, reqSeq, displayName || previewName)) {
      toast(`Live update failed for "${city}". Showing latest real-time snapshot.`, 'info');
      return;
    }
    // Live API unavailable — use normalized live snapshot endpoint
    await loadLocalAqi(city, reqSeq);
  }
}

/* ── Fallback: normalized live snapshot endpoint ───────── */
async function loadLocalAqi(cityOverride = null, reqSeq = null) {
  try {
    const cityToLoad = cityOverride || curCity;
    const qCity = cityToLoad ? `?city=${encodeURIComponent(cityToLoad)}` : '';
    let d = await fetchJsonNoCache(`/api/current-aqi${qCity}`);
    let usedLatestFallback = false;
    if (isStaleReq(reqSeq)) return;
    if (d.error && cityToLoad) {
      const latest = await fetchJsonNoCache('/api/current-aqi');
      if (!latest.error) {
        d = latest;
        usedLatestFallback = true;
        toast(`Live AQI unavailable for "${cityToLoad}". Showing latest available station data.`, 'info');
      }
    }
    if (d.error) {
      stabilityLog('Local AQI fallback unavailable', { cityToLoad, error: d.error });
      toast('Live data unavailable. Showing selected city visual only.', 'info');
      applySelectedCityVisual(curCityDisplay || cityToLoad, reqSeq);
      return;
    }
    // Ignore fallback payloads that do not match the requested city.
    if (cityToLoad && !usedLatestFallback) {
      if (!isRequestedCityMatch(cityToLoad, d.city)) {
        console.warn('Ignoring mismatched /api/current-aqi payload', { cityToLoad, returnedCity: d.city });
        stabilityLog('Rejected mismatched fallback payload', { requested: cityToLoad, returned: d.city });
        applySelectedCityVisual(curCityDisplay || cityToLoad, reqSeq);
        return;
      }
    }

    const aqi = Math.round(d.aqi);
    const cat = getCat(aqi);
    const dominant = getDominantPollutantFromList(d.pollutants);
    curTimeIso = '';
    curLiveData = {
      city: { name: `${d.city}, ${d.country || ''}`.trim() },
      aqi: d.aqi,
      dominentpol: dominant,
      forecast: null,
      iaqi: {
        pm25: { v: d.pollutants?.pm25 },
        pm10: { v: d.pollutants?.pm10 },
        no2: { v: d.pollutants?.no2 },
        so2: { v: d.pollutants?.so2 },
        o3: { v: d.pollutants?.o3 },
        co: { v: d.pollutants?.co },
        t: { v: d.weather?.temperature },
        h: { v: d.weather?.humidity },
        w: { v: d.weather?.wind_speed },
      },
      time: { iso: '' }
    };
    const fbLat = Number(d.latitude);
    const fbLng = Number(d.longitude);
    if (aqiMap && Number.isFinite(fbLat) && Number.isFinite(fbLng)) {
      aqiMap.setView([fbLat, fbLng], Math.max(aqiMap.getZoom(), 9));
    }
    if ($('aqiUpdated')) $('aqiUpdated').textContent = 'Updated: ' + new Date().toLocaleTimeString();
    const fallbackLabel = normalizeDisplayName(d.city || cityToLoad);
    if (fallbackLabel) {
      curCityDisplay = fallbackLabel;
      curHeroQueryHint = fallbackLabel;
    }
    updateHeroUI(d.city, d.country, aqi, cat, d.description, reqSeq);
    updatePollutants(d.pollutants, d.city);
    updateWeather(d.weather);
    renderForecast(null, aqi);
    loadDonut();
    loadNlpAdvice(curLiveData, reqSeq);
    loadAreaAqiList(`${d.city || cityToLoad}`, reqSeq);
    const analyticsCity = normalizeDisplayName(d.city || cityToLoad || curCityDisplay || curCity) || (d.city || cityToLoad || curCity);
    currentUserCity = analyticsCity;
    loadTrend(analyticsCity).catch(() => { });
    loadHeatmap(analyticsCity).catch(() => { });
    loadStats();
    loadRanking();
  } catch (e) {
    console.warn('loadLocalAqi() error', e);
  }
}

/* ── Render hero ────────────────────────────────────────── */
function renderHero(data, reqSeq = null, displayNameHint = '') {
  const aqi = resolveLiveAqi(data, getDisplayedAqiFallback()) ?? getDisplayedAqiFallback();
  const cat = getCat(aqi);
  const loc = parseMapStationLocation(data.city?.name || curCity, curCity);
  const hintedCity = normalizeDisplayName(displayNameHint);
  if (hintedCity) curHeroQueryHint = hintedCity;
  curTimeIso = data?.time?.iso || curTimeIso || '';

  let displayTitle = loc.city;
  if (loc.area && normalizeCityKey(loc.area) !== normalizeCityKey(loc.city)) {
    displayTitle = `${loc.area}, ${loc.city}`;
  } else if (hintedCity && normalizeCityKey(hintedCity) !== normalizeCityKey(loc.city)) {
    if (looksLikeStationArea(hintedCity)) {
      displayTitle = `${hintedCity}, ${loc.city}`;
    } else {
      displayTitle = hintedCity;
    }
  }

  updateHeroUI(displayTitle, loc.country, aqi, cat, cat.text || '', reqSeq);

  // Update Guidance Bot with fresh city/AQI state
  if (typeof GuidanceBot !== 'undefined') {
    GuidanceBot.setState({
      aqi,
      city: loc.city || curCity,
      country: loc.country || '',
      dominant: data.dominentpol || data.dominant || 'pm25',
      timestamp_iso: data?.time?.iso || '',
    });
  }

  const iaqi = data.iaqi || {};
  updatePollutantsFromIaqi(iaqi, data.dominentpol);
  updateWeatherFromIaqi(iaqi);
}

function updateHeroUI(cityName, country, aqi, cat, desc, reqSeq = null) {
  css('--aqi-color', cat.color);
  css('--aqi-color-light', lightenColor(cat.color));
  css('--aqi-bg', cat.bg);
  // set page background to match AQI
  if (typeof setAqiBackground === 'function') setAqiBackground(cat);

  // Header card
  const heroCard = $('aqiHeroCard');
  const cityNameEl = $('aqiCityName');
  const cityCountryEl = $('aqiCityCountry');
  if (heroCard) heroCard.style.borderTopColor = cat.color;
  if (cityNameEl) cityNameEl.textContent = cityName;
  const countryText = String(country || '').trim();
  if (cityCountryEl) cityCountryEl.textContent = (countryText && countryText !== '—') ? countryText : cityName;

  // Gauge
  const gaugeValueEl = $('gaugeValue');
  const gaugeLevelEl = $('gaugeLevel');
  if (gaugeValueEl) {
    gaugeValueEl.textContent = aqi;
    gaugeValueEl.style.color = cat.color;
  }
  if (gaugeLevelEl) {
    gaugeLevelEl.textContent = cat.level;
    gaugeLevelEl.style.color = cat.color;
  }

  // Gauge arc — circumference = 2π×85 ≈ 534
  const circ = 534;
  const pct = Math.min(aqi / 500, 1);
  const offset = circ - circ * pct;
  const arc = $('gaugeProgress');
  if (arc) {
    arc.style.strokeDashoffset = offset;
    arc.setAttribute('stroke', cat.color);
  }

  // Scale needle
  const needle = $('scaleNeedle');
  if (needle) needle.style.left = Math.min(pct * 100, 97) + '%';

  // Description
  const descTextEl = $('aqiDescText');
  if (descTextEl) descTextEl.textContent = desc || cat.text || '';

  // AQI description bg
  const descEl = document.querySelector('.aqi-description');
  if (descEl) descEl.style.background = cat.bg;

  updateCinematicHero({
    cityName,
    country,
    aqi,
    level: cat.level,
    updatedAt: $('aqiUpdated')?.textContent || '',
    timeIso: curTimeIso,
  }, reqSeq);
}

// Apply background class based on AQI category
function setAqiBackground(cat) {
  try {
    document.body.classList.remove('bg-good', 'bg-moderate', 'bg-poor', 'bg-unhealthy', 'bg-severe', 'bg-hazardous');
    const cls = 'bg-' + (cat.level || '').toLowerCase();
    document.body.classList.add(cls);
  } catch (e) { }
}

function updatePollutantsFromIaqi(iaqi, dominant) {
  const pollutants = {};
  Object.entries(POLL_CFG).forEach(([k]) => {
    pollutants[k] = iaqi[k]?.v ?? null;
  });
  updatePollutants(pollutants, null, dominant);
  updateWeatherFromIaqi(iaqi);
}

function updatePollutants(data, city, dominant) {
  const grid = $('pollutantsGrid');
  if (!grid) return;

  grid.innerHTML = Object.entries(POLL_CFG).map(([key, cfg]) => {
    const val = data[key];
    const pct = val != null ? Math.min(val / cfg.max * 100, 100).toFixed(1) : 0;
    const numVal = val != null ? (key === 'co' ? val.toFixed(2) : Math.round(val)) : '—';

    // Color-code the value
    const aqi = estimateAqiFromPoll(key, val);
    const c = val != null ? getCat(aqi) : { color: '#9ca3af', bg: '#f5f6fa', level: '' };

    return `<div class="p-card fade-in">
      <div class="pc-name">${cfg.lbl}</div>
      <div class="pc-value" style="color:${cfg.color}">${numVal}</div>
      <div class="pc-unit">${cfg.unit}</div>
      <div class="pc-bar-track">
        <div class="pc-bar-fill" style="width:${pct}%;background:${cfg.color}"></div>
      </div>
      ${val != null ? `<div class="pc-status" style="background:${c.bg};color:${c.color}">${c.level}</div>` : ''}
    </div>`;
  }).join('');

  // Dominant tag
  if (dominant) {
    const cfg = POLL_CFG[dominant] || {};
    $('dominantValue').textContent = (cfg.lbl || dominant).toUpperCase();
    $('dominantValue').style.background = cfg.color + '20';
    $('dominantValue').style.color = cfg.color;
  }
}

function getDominantPollutantFromList(polls) {
  if (!polls || typeof polls !== 'object') return 'pm25';
  let bestKey = 'pm25';
  let bestVal = -Infinity;
  Object.keys(POLL_CFG).forEach(k => {
    const v = Number(polls[k]);
    if (Number.isFinite(v) && v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  });
  return bestKey;
}

function getDominantPollutantFromIaqi(iaqi) {
  if (!iaqi || typeof iaqi !== 'object') return 'pm25';
  const src = {};
  Object.keys(POLL_CFG).forEach(k => {
    src[k] = Number(iaqi?.[k]?.v);
  });
  return getDominantPollutantFromList(src);
}

function renderNlpAdvice(payload) {
  const summaryEl = $('nlpSummary');
  const maskEl = $('nlpMask');
  if (!summaryEl || !maskEl) return;
  const summary = String(payload?.summary || 'AQI guidance unavailable.').replace(/\s+/g, ' ').trim();
  summaryEl.textContent = summary.length > 150 ? `${summary.slice(0, 149)}…` : summary;
  maskEl.textContent = `Mask: ${payload?.mask_recommendation || '--'}`;
}

async function loadNlpAdvice(sourceData, reqSeq = null) {
  try {
    if (isStaleReq(reqSeq)) return;
    const loc = parseCityCountry(sourceData?.city?.name || curCity, curCity);
    const iaqi = sourceData?.iaqi || {};
    const aqi = resolveLiveAqi(sourceData, getDisplayedAqiFallback());
    const dominant = String(sourceData?.dominentpol || getDominantPollutantFromIaqi(iaqi) || 'pm25').toLowerCase();

    const params = new URLSearchParams({
      city: loc.city || curCity,
      country: loc.country || '',
      aqi: Number.isFinite(aqi) ? String(aqi) : '0',
      dominant,
      temp: Number.isFinite(Number(iaqi?.t?.v)) ? String(Number(iaqi?.t?.v)) : '',
      humidity: Number.isFinite(Number(iaqi?.h?.v)) ? String(Number(iaqi?.h?.v)) : '',
      wind: Number.isFinite(Number(iaqi?.w?.v)) ? String(Number(iaqi?.w?.v)) : '',
      time_iso: sourceData?.time?.iso || curTimeIso || '',
    });

    const advice = await fetchJsonNoCache(`/api/nlp/advice?${params.toString()}`);
    if (isStaleReq(reqSeq)) return;
    if (advice?.error) return;
    renderNlpAdvice(advice);
  } catch (e) {
    console.warn('NLP advice load failed:', e);
  }
}

function estimateAqiFromPoll(key, val) {
  if (val == null) return 0;
  // Simplified estimates — use for coloring only
  const scales = { pm25: 300, pm10: 420, no2: 200, so2: 100, o3: 200, co: 15 };
  return Math.round((val / (scales[key] || 200)) * 300);
}

function formatForecastLabel(dayText, idx) {
  const txt = String(dayText || '').trim();
  if (txt) {
    const parsed = new Date(`${txt}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en', { weekday: 'short' });
    }
    if (txt.length >= 5) return txt.slice(5);
    return txt;
  }
  const d = new Date();
  d.setDate(d.getDate() + idx);
  return d.toLocaleDateString('en', { weekday: 'short' });
}

function extractForecastSeries(forecast, poll) {
  const direct = Array.isArray(forecast?.[poll]) ? forecast[poll] : [];
  const daily = Array.isArray(forecast?.daily?.[poll]) ? forecast.daily[poll] : [];
  const source = direct.length ? direct : daily;
  const series = source
    .map(item => {
      const avg = Number(item?.avg ?? item?.v ?? item?.value);
      if (!Number.isFinite(avg)) return null;
      const dayRaw = String(item?.day || item?.date || '').trim();
      const parsedDay = dayRaw ? new Date(`${dayRaw}T00:00:00`) : null;
      return {
        day: String(item?.day || item?.date || '').trim(),
        ts: parsedDay && !Number.isNaN(parsedDay.getTime()) ? parsedDay.getTime() : null,
        avg: Number(avg.toFixed(1)),
      };
    })
    .filter(Boolean);
  if (!series.length) return [];
  const dated = series.filter(s => Number.isFinite(s.ts)).sort((a, b) => a.ts - b.ts);
  if (dated.length) {
    const now = new Date();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let startIdx = dated.findIndex(s => s.ts >= todayMidnight);
    if (startIdx < 0) startIdx = Math.max(0, dated.length - 7);
    return dated.slice(startIdx, startIdx + 7);
  }
  return series.slice(0, 7);
}

function buildDeterministicForecast(baseValue) {
  const base = Number.isFinite(baseValue) ? baseValue : 80;
  const deltas = [-8, -4, -1, 2, 4, 6, 3];
  return deltas.map((d, i) => ({
    day: '',
    avg: Math.max(5, Math.round((base + d + i * 0.5) * 10) / 10),
  }));
}



function updateWeather(w) {
  $('qsTemp').textContent = w.temperature ? w.temperature.toFixed(1) + ' °C' : '—';
  $('qsHum').textContent = w.humidity ? w.humidity.toFixed(1) + ' %' : '—';
  $('qsWind').textContent = w.wind_speed ? w.wind_speed.toFixed(1) + ' m/s' : '—';
}

// Alias: renderHero uses updateWeatherFromIaqi which maps iaqi keys to weather fields
function updateWeatherFromIaqi(iaqi) {
  const w = {
    temperature: iaqi?.t?.v ?? null,
    humidity: iaqi?.h?.v ?? null,
    wind_speed: iaqi?.w?.v ?? null,
  };
  updateWeather(w);
}

function lightenColor(hex) {
  // Returns a slightly lighter version for gradient
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + 40);
  const g = Math.min(255, ((n >> 8) & 0xff) + 40);
  const b = Math.min(255, (n & 0xff) + 40);
  return `rgb(${r},${g},${b})`;
}




/* ── Forecast chart ─────────────────────────────────────── */
let activePoll = 'pm25';

document.querySelectorAll('.ftoggle').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ftoggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activePoll = btn.dataset.poll;
    renderForecast(curLiveData?.forecast, parseInt(curLiveData?.aqi) || 100);
  });
});

function renderForecast(forecast, curAqi) {
  if (forecastChartInst) { forecastChartInst.destroy(); forecastChartInst = null; }
  const cvs = $('forecastChart');
  if (!cvs) return;

  const fc = extractForecastSeries(forecast, activePoll);
  const labels = [], vals = [];

  if (fc.length) {
    fc.slice(0, 7).forEach(d => {
      labels.push(formatForecastLabel(d.day, labels.length));
      vals.push(d.avg ?? null);
    });
  } else {
    buildDeterministicForecast(curAqi).forEach((d, i) => {
      labels.push(formatForecastLabel('', i));
      vals.push(d.avg);
    });
  }

  const cfg = POLL_CFG[activePoll] || POLL_CFG.pm25;
  const numericVals = vals.filter(v => Number.isFinite(Number(v))).map(Number);
  const highest = numericVals.length ? Math.max(...numericVals) : Math.max(50, Number(curAqi) || 100);
  const suggestedMax = Math.max(50, Math.ceil((highest * 1.25) / 10) * 10);

  forecastChartInst = new Chart(cvs, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: cfg.lbl,
        data: vals,
        borderColor: cfg.color,
        backgroundColor: cfg.color + '18',
        fill: true, tension: .4,
        pointBackgroundColor: cfg.color, pointRadius: 4, borderWidth: 2,
        pointHoverRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,.96)', titleColor: '#1a1d2e', bodyColor: '#4a5568',
          borderColor: '#e8eaed', borderWidth: 1, padding: 10,
          callbacks: { label: ctx => ` ${ctx.parsed.y} ${cfg.unit}` }
        }
      },
      scales: {
        x: { ticks: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 10 } }, grid: { color: 'rgba(0,0,0,.04)' } },
        y: {
          beginAtZero: true,
          suggestedMax,
          ticks: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 10 } },
          grid: { color: 'rgba(0,0,0,.04)' }
        }
      }
    }
  });
}

/* ── Trend Chart ────────────────────────────────────────── */
function getRequestedTrendCity(explicitCity = undefined) {
  if (typeof explicitCity === 'string') {
    const normalized = explicitCity.trim();
    if (normalized) return normalized;
    return '';
  }
  const sel = $('trendCitySelect');
  const picked = String(sel?.value || '').trim();
  if (picked) return picked;
  return currentUserCity;
}

async function loadTrend(city = undefined) {
  try {
    const requestedCity = getRequestedTrendCity(city);
    const url = requestedCity
      ? `/api/historical?city=${encodeURIComponent(requestedCity)}&hours=24&fresh=1`
      : '/api/historical?hours=24&fresh=1';
    const d = await fetchJsonNoCache(url);
    if (d.error || !d.timestamps) {
      if (trendChartInst) { trendChartInst.destroy(); trendChartInst = null; }
      return;
    }

    if (trendChartInst) { trendChartInst.destroy(); trendChartInst = null; }
    const cvs = $('trendChart');
    if (!cvs) return;

    trendChartInst = new Chart(cvs, {
      type: 'line',
      data: {
        labels: d.timestamps,
        datasets: [{
          label: 'AQI',
          data: d.aqi,
          borderColor: getComputedStyle(document.documentElement).getPropertyValue('--aqi-color').trim() || '#4ba9ff',
          backgroundColor: 'rgba(75,169,255,.07)',
          fill: true, tension: .4,
          pointBackgroundColor: d.aqi.map(v => getCat(v).color),
          pointRadius: 3, borderWidth: 2.5,
          segment: {
            borderColor: ctx => getCat(ctx.p1.parsed.y).color,
          }
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(255,255,255,.96)', titleColor: '#1a1d2e', bodyColor: '#4a5568',
            borderColor: '#e8eaed', borderWidth: 1, padding: 10,
            callbacks: { label: ctx => ` AQI: ${Math.round(ctx.parsed.y)} — ${getCat(ctx.parsed.y).level}` }
          }
        },
        scales: {
          x: { ticks: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 10 } }, grid: { display: false } },
          y: {
            ticks: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 10 } },
            grid: { color: 'rgba(0,0,0,.04)' },
            min: 0,
          }
        }
      }
    });

    // Populate city dropdown
    populateCitySelect(requestedCity);
  } catch { }
}

async function populateCitySelect(selectedCity = '') {
  try {
    const d = await fetchJsonNoCache('/api/city-ranking?fresh=1');
    const sel = $('trendCitySelect');
    if (!sel || !d.cities) return;
    sel.innerHTML = '<option value="">Current Selection</option>' +
      d.cities.map(c => `<option value="${c.city}">${titleCaseWords(c.city || '')}</option>`).join('');
    const fallbackPicked = isUidQuery(curCity) ? (curCityDisplay || '') : (curCity || '');
    const picked = String(selectedCity || fallbackPicked || '').trim();
    if (picked) sel.value = picked;
    if (!sel.dataset.bound) {
      sel.addEventListener('change', () => {
        const selected = String(sel.value || '').trim();
        const fallbackCity = isUidQuery(curCity) ? String(curCityDisplay || '').trim() : String(curCity || '').trim();
        const targetCity = selected || fallbackCity;
        loadTrend(targetCity);
        loadHeatmap(targetCity);
      });
      sel.dataset.bound = '1';
    }
  } catch { }
}

/* ── Donut chart ────────────────────────────────────────── */
async function loadDonut() {
  try {
    if (donutChartInst) { donutChartInst.destroy(); donutChartInst = null; }
    const cvs = $('donutChart');
    if (!cvs) return;

    let polls = null;
    if (curLiveData && typeof curLiveData === 'object') {
      const livePolls = extractLivePollutants(curLiveData);
      const hasLive = Object.values(livePolls).some(v => Number.isFinite(v));
      if (hasLive) {
        polls = livePolls;
      }
    }

    if (!polls) {
      const qCity = curCity ? `?city=${encodeURIComponent(curCity)}` : '';
      const d = await fetchJsonNoCache(`/api/current-aqi${qCity}`);
      if (d.error) return;
      polls = d.pollutants || {};
    }

    const keys = Object.keys(POLL_CFG);

    donutChartInst = new Chart(cvs, {
      type: 'doughnut',
      data: {
        labels: keys.map(k => POLL_CFG[k].lbl),
        datasets: [{
          data: keys.map(k => Number.isFinite(Number(polls[k])) ? Number(polls[k]) : 0),
          backgroundColor: keys.map(k => POLL_CFG[k].color),
          borderWidth: 2, borderColor: '#fff', hoverOffset: 10,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { color: '#4a5568', font: { family: 'Plus Jakarta Sans', size: 11 }, boxWidth: 10, padding: 10 } },
          tooltip: {
            backgroundColor: 'rgba(255,255,255,.96)', titleColor: '#1a1d2e', bodyColor: '#4a5568',
            borderColor: '#e8eaed', borderWidth: 1, padding: 10,
          }
        }
      }
    });
  } catch { }
}

/* ── Map ────────────────────────────────────────────────── */
function initMap() {
  const mapEl = $('aqiMap');
  if (!mapEl || aqiMap) return;

  try {
    aqiMap = L.map('aqiMap', { zoomControl: true, scrollWheelZoom: true }).setView([20, 78], 4);

    // create marker cluster group
    markerCluster = L.markerClusterGroup();

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap © CARTO',
      subdomains: 'abcd', maxZoom: 19
    }).addTo(aqiMap);

    // add cluster layer to map
    aqiMap.addLayer(markerCluster);

    loadMapData();
    aqiMap.on('moveend zoomend', () => {
      clearTimeout(mapMoveTimer);
      mapMoveTimer = setTimeout(() => loadMapData(), 300);
    });
  } catch (e) {
    console.error('Map init error:', e);
  }
}

async function loadMapData() {
  try {
    if (!aqiMap) return;
    const bounds = aqiMap.getBounds();
    if (!bounds || !bounds.isValid()) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const reqSeq = ++mapLoadSeq;
    const d = await fetchJsonNoCache(
      `/api/live-map-bounds?lat1=${encodeURIComponent(sw.lat.toFixed(6))}&lng1=${encodeURIComponent(sw.lng.toFixed(6))}&lat2=${encodeURIComponent(ne.lat.toFixed(6))}&lng2=${encodeURIComponent(ne.lng.toFixed(6))}`
    );
    if (reqSeq !== mapLoadSeq) return;

    const liveStations = Array.isArray(d?.data) ? d.data : [];
    let source = [];
    if (d?.status === 'ok' && liveStations.length) {
      source = liveStations.map(item => ({
        lat: Number(item?.lat),
        lng: Number(item?.lon),
        aqi: Number(item?.aqi),
        stationName: item?.station?.name || '',
      }));
    } else {
      // Fallback to local map points when live stations are unavailable.
      const local = await fetchJsonNoCache('/api/city-locations');
      source = Array.isArray(local?.locations) ? local.locations.map(item => ({
        lat: Number(item?.lat),
        lng: Number(item?.lng),
        aqi: Number(item?.aqi),
        stationName: `${item?.city || ''}, ${item?.country || ''}`,
      })) : [];
    }
    if (!source.length) return;

    if (markerCluster) { markerCluster.clearLayers(); }
    mapMarkers = [];

    source.forEach(loc => {
      try {
        const lat = Number(loc.lat);
        const lng = Number(loc.lng);
        const aqiNum = Number(loc.aqi);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(aqiNum)) return;

        const place = parseMapStationLocation(loc.stationName || '', curCity);
        const cat = getCat(aqiNum);
        const icon = L.divIcon({
          className: 'aqi-marker-label',
          html: `<div class="aql-inner" style="border-color:${cat.color};color:${cat.color}">
            <div>${Math.round(aqiNum)}</div>
            <div style="font-size:.56rem;font-weight:600;color:#9ca3af">${place.city}</div>
          </div>`,
          iconAnchor: [30, 20]
        });

        const m = L.marker([lat, lng], { icon });
        const locationLine = place.area
          ? `<div style="font-size:.7rem;color:#9ca3af;margin-bottom:8px">${place.area} · ${place.city}, ${place.country}</div>`
          : `<div style="font-size:.7rem;color:#9ca3af;margin-bottom:8px">${place.city}, ${place.country}</div>`;
        const popupHtml = `
          <div style="font-family:'Plus Jakarta Sans',sans-serif;min-width:160px">
            <div style="font-size:.95rem;font-weight:800;color:#1a1d2e">${place.city}</div>
            ${locationLine}
            <div style="font-size:1.8rem;font-weight:900;color:${cat.color};line-height:1">${Math.round(aqiNum)}</div>
            <div style="font-size:.75rem;font-weight:700;color:${cat.color}">${cat.level}</div>
          </div>`;
        m.bindPopup(popupHtml);

        m.on('click', () => {
          // Marker click is preview-only: never mutate selected city state here.
          stabilityLog('Map marker preview click (non-mutating)', { selectedCity: curCity, markerCity: place.city });
        });

        if (markerCluster) markerCluster.addLayer(m);
        else if (aqiMap) m.addTo(aqiMap);
        mapMarkers.push(m);
      } catch (e) {
        console.warn('Map marker error:', e);
      }
    });
  } catch (e) {
    console.error('loadMapData error:', e);
  }
}
function heatColor(val) {
  if (val === 0) return '#f0f0f0';
  if (val <= 50) return '#009966';
  if (val <= 100) return '#ffde33';
  if (val <= 150) return '#ff9933';
  if (val <= 200) return '#cc0033';
  if (val <= 300) return '#660099';
  return '#7e0023';
}

async function loadHeatmap(city = undefined) {
  try {
    const requestedCity = getRequestedTrendCity(city);
    const url = requestedCity
      ? `/api/heatmap?city=${encodeURIComponent(requestedCity)}&hours=24&fresh=1`
      : '/api/heatmap?hours=24&fresh=1';
    const d = await fetchJsonNoCache(url);

    const cont = $('heatmapContainer');
    if (!cont) return;

    if (d.error || !d.data) {
      cont.innerHTML = `<div style="padding:24px;text-align:center;color:#9ca3af;font-size:.85rem">No heatmap data yet for ${escapeHtml(requestedCity || 'selected city')}. Data accumulates over time.</div>`;
      return;
    }

    const hourLabels = Array.from({ length: 24 }, (_, i) => i % 3 === 0 ? String(i) + 'h' : '');

    let html = `<table class="heatmap-table"><thead><tr><th></th>`;
    hourLabels.forEach(l => html += `<th>${escapeHtml(l)}</th>`);
    html += '</tr></thead><tbody>';

    d.days.forEach((day, di) => {
      html += `<tr><th style="text-align:right;padding-right:8px;font-size:.6rem;color:#9ca3af;white-space:nowrap">${escapeHtml(day.slice(0, 3))}</th>`;
      (d.hours || []).forEach((h, hi) => {
        const v = Number(d.data[di]?.[hi]) || 0;
        const bg = heatColor(v);
        const label = v > 0 ? Math.round(v) : '';
        html += `<td style="background:${bg}" title="${escapeHtml(day)} ${h}:00 — AQI: ${v}">${label}</td>`;
      });
      html += '</tr>';
    });

    html += '</tbody></table>';
    cont.innerHTML = html;
  } catch (e) {
    console.warn('loadHeatmap error:', e);
  }
}

/* ── City Ranking Table ─────────────────────────────────── */
async function loadRanking() {
  try {
    const d = await fetchJsonNoCache('/api/city-ranking?fresh=1');
    if (!d.cities) return;

    $('rankingBody').innerHTML = d.cities.map((c, i) => {
      const cat = getCat(c.aqi);
      const txtClr = c.aqi <= 100 ? '#000' : '#fff';
      const cityLabel = titleCaseWords(c.city || '');
      const countryLabel = titleCaseWords(c.country || '');
      return `<tr class="fade-in stagger-${Math.min(i + 1, 5)}">
        <td style="font-size:.72rem;font-weight:600;color:#9ca3af">${i + 1}</td>
        <td style="font-weight:700">${cityLabel}</td>
        <td style="color:#9ca3af;font-size:.78rem">${countryLabel || '—'}</td>
        <td><span class="aqi-badge-cell" style="background:${cat.color};color:${txtClr}">${Math.round(c.aqi)}</span></td>
        <td style="font-weight:700;font-size:.78rem;color:${cat.color}">${cat.level}</td>
        <td style="font-size:.78rem;color:#4a5568">${c.pm25}</td>
        <td style="font-size:.7rem;color:#9ca3af">${c.timestamp}</td>
      </tr>`;
    }).join('');
  } catch { }
}

/* ── Stats Cards ────────────────────────────────────────── */
async function loadStats() {
  try {
    const d = await fetchJsonNoCache('/api/statistics?fresh=1');
    if (d.error) return;

    animateCount($('statReadings'), d.total_readings);
    animateCount($('statAvgAqi'), d.avg_aqi, 1);
    animateCount($('statMaxAqi'), d.max_aqi);
    animateCount($('statCities'), d.cities_monitored);
  } catch { }
}

function animateCount(el, target, decimals = 0) {
  if (!el) return;
  const numericTarget = Number(target);
  const safeTarget = Number.isFinite(numericTarget) ? numericTarget : 0;
  const start = 0, dur = 1200;
  const startTime = performance.now();
  const update = now => {
    const t = Math.min((now - startTime) / dur, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (start + (safeTarget - start) * eased).toFixed(decimals);
    if (t < 1) requestAnimationFrame(update);
    else el.textContent = safeTarget.toFixed(decimals);
  };
  requestAnimationFrame(update);
}

async function refreshLiveAqiOnly() {
  const activeCity = String(curCity || '').trim();
  if (!activeCity) return;
  const reqSeq = ++cityLoadSeq;
  const displayHint = curCityDisplay || normalizeDisplayName(activeCity) || activeCity;
  const cachedSnapshot = getLiveSnapshot([activeCity, displayHint, curHeroQueryHint]);

  try {
    const j = await fetchJsonNoCache(`/api/live/${encodeURIComponent(activeCity)}?fresh=1`);
    if (isStaleReq(reqSeq)) return;
    if (j?.status !== 'ok' || !j?.data) {
      applyCachedLiveSnapshot(cachedSnapshot, reqSeq, displayHint);
      return;
    }

    curLiveData = j.data;
    const resolvedAqi = resolveLiveAqi(j.data, getDisplayedAqiFallback());
    if (!Number.isFinite(Number(j?.data?.aqi)) && Number.isFinite(resolvedAqi)) {
      curLiveData.aqi = resolvedAqi;
    }
    curTimeIso = j.data?.time?.iso || curTimeIso || '';
    if ($('aqiUpdated')) $('aqiUpdated').textContent = 'Updated: ' + new Date().toLocaleTimeString();

    rememberLiveSnapshot([activeCity, displayHint, curHeroQueryHint, j?.data?.city?.name], curLiveData);
    renderHero(curLiveData, reqSeq, displayHint);
    renderForecast(curLiveData?.forecast, Number.isFinite(resolvedAqi) ? resolvedAqi : getDisplayedAqiFallback());
    loadDonut();
    loadNlpAdvice(curLiveData, reqSeq);
  } catch {
    if (isStaleReq(reqSeq)) return;
    applyCachedLiveSnapshot(cachedSnapshot, reqSeq, displayHint);
  }
}

/* ── Auto refresh (live + overview) ─────────────────────── */
setInterval(() => {
  refreshLiveAqiOnly();
}, LIVE_UI_REFRESH_MS);

setInterval(() => {
  const selected = getRequestedTrendCity();
  loadTrend(selected);
  loadMapData();
  loadStats();
  loadRanking();
  loadHeatmap(selected);
}, OVERVIEW_REFRESH_MS);

/* ── Boot ───────────────────────────────────────────────── */
(async function init() {
  // Show loading bar progress
  const bar = $('loadingBar');

  try {
    initCinematicHero();
    bindAreaSliderControls();
    await withTimeout(loadHeroManifest(), 2500);

    // attempt to load critical pieces but don't hang indefinitely
    await withTimeout(loadCity('delhi'), 5000);

    await Promise.all([
      withTimeout(loadTrend(curCity), 5000),
      withTimeout(loadDonut(), 5000),
      withTimeout(loadStats(), 5000),
      withTimeout(loadRanking(), 5000),
      withTimeout(loadHeatmap(curCity), 5000),
    ]);

    // initialize map
    try { initMap(); } catch (e) { console.error('initMap error', e); }
  } catch (e) {
    console.error('init() boot error', e);
  } finally {
    // always hide loader after a short delay
    setTimeout(hideLoading, 300);
  }
})();

/* ── Guidance Bot ───────────────────────────────────────── */
const GuidanceBot = (() => {
  // Track current live data for the advice API call
  let _state = { aqi: 0, city: 'delhi', country: '', dominant: 'pm25', timestamp_iso: '' };

  function setState(data) {
    if (!data) return;
    _state.aqi = Number(data.aqi || _state.aqi) || 0;
    _state.city = String(data.city || _state.city || 'delhi');
    _state.country = String(data.country || _state.country || '');
    _state.dominant = String(data.dominant || data.dominentpol || _state.dominant || 'pm25');
    _state.timestamp_iso = String(data.timestamp_iso || data.timestamp || _state.timestamp_iso || '');
  }

  function _show(id) { const el = $(id); if (el) el.style.display = ''; }
  function _hide(id) { const el = $(id); if (el) el.style.display = 'none'; }

  function openModal() {
    const overlay = $('guidanceModalOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    _show('guidanceLoading');
    _hide('guidanceResult');
    _hide('guidanceError');
    const cityLbl = $('guidanceBotCityLabel');
    if (cityLbl) cityLbl.textContent = _state.city ? _state.city.charAt(0).toUpperCase() + _state.city.slice(1) : '—';
    fetchAdvice();
  }

  function closeModal() {
    const overlay = $('guidanceModalOverlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  async function fetchAdvice() {
    _show('guidanceLoading');
    _hide('guidanceResult');
    _hide('guidanceError');
    try {
      const params = new URLSearchParams({
        city: _state.city,
        country: _state.country,
        aqi: _state.aqi,
        dominant: _state.dominant,
        timestamp_iso: _state.timestamp_iso,
      });
      const resp = await fetchJsonNoCache(`/api/nlp/advice?${params}`);
      const advice = (resp.data || resp.advice || resp);
      if (!advice || advice.error) throw new Error(advice?.error || 'Empty advice');
      renderAdvice(advice);
    } catch (e) {
      console.warn('GuidanceBot: advice fetch failed', e);
      _hide('guidanceLoading');
      _show('guidanceError');
    }
  }

  function renderAdvice(adv) {
    _hide('guidanceLoading');
    _show('guidanceResult');

    const pill = $('guidanceAqiPill');
    if (pill) {
      pill.textContent = `AQI ${Math.round(_state.aqi)}`;
      pill.style.background = adv.color || '#888';
    }
    const levelTag = $('guidanceLevelTag');
    if (levelTag) levelTag.textContent = adv.risk_level || adv.category || '—';

    const summary = $('guidanceSummary');
    if (summary) summary.textContent = adv.summary || '';

    // Support both new (action_steps/primary_action) and legacy (precautions/mask_recommendation) response shapes
    const primaryText = $('guidancePrimaryText');
    if (primaryText) {
      primaryText.textContent =
        adv.primary_action ||
        adv.mask_recommendation ||
        adv.best_time_outdoor ||
        '';
    }

    const steps = $('guidanceSteps');
    if (steps) {
      // Merge precautions + measures from legacy shape into a flat list
      let items = adv.action_steps || adv.steps || [];
      if (!items.length) {
        const precautions = Array.isArray(adv.precautions) ? adv.precautions : [];
        const measures = Array.isArray(adv.measures) ? adv.measures : [];
        items = [...precautions, ...measures];
        // Include best_time_outdoor as a final tip if present
        if (adv.best_time_outdoor) items.push(`🕐 Best time outdoors: ${adv.best_time_outdoor}`);
        if (adv.sensitive_groups_note) items.push(`⚠ ${adv.sensitive_groups_note}`);
      }
      steps.innerHTML = items.length
        ? items.map(s => `<li>${escapeHtml(String(s))}</li>`).join('')
        : '<li>No specific steps available at this time.</li>';
    }
  }

  // Bind events
  document.addEventListener('DOMContentLoaded', () => {
    const btn = $('guidanceBotBtn');
    if (btn) btn.addEventListener('click', openModal);
    const closeBtn = $('guidanceModalClose');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    const retryBtn = $('guidanceRetryBtn');
    if (retryBtn) retryBtn.addEventListener('click', fetchAdvice);
    const overlay = $('guidanceModalOverlay');
    if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  });

  // Public setState is wired after a successful loadCity / refreshLiveAqiOnly call
  return { setState };
})();
