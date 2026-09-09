// ==Plugin==
// @id: dawn-weather-moon
// @name: Weather & Moon
// @description: Status chip + popover + journal title cluster — cache paint; fetch idle/onDemand
// @icon: ti-cloud
// ==/Plugin==

/**
 * Dawn Weather & Moon — standalone (not Tier2 blob).
 *
 * Deploy: cat plugin.js weather-engine.js
 * Hydrates prod Path B `weather-moon` + LS `weather_moon_*`. Old Weather & Moon stays Off.
 */

class Plugin extends AppPlugin {
  onLoad() {
    this._unreg = null;
    this._weather = null;
    try {
      this._weather = new DawnWeather(this);
      this._weather.attach();
    } catch (e) {
      console.error('[Dawn/Weather] engine missing — deploy concatenated bundle', e);
      return;
    }
    this._waitForBoot((boot) => {
      this._unreg = boot.register({
        id: 'dawn-weather-moon',
        tier: 'idle',
        idleDelayMs: (isMobile) => (isMobile ? 8000 : 600),
      });
    });
  }

  onUnload() {
    try { this._weather?.detach?.(); } catch (_) {}
    try { this._unreg?.(); } catch (_) {}
  }

  _waitForBoot(cb) {
    let n = 0;
    const tick = () => {
      const boot = globalThis.BootKernel || globalThis.__dawnBoot;
      if (boot?.register) { cb(boot); return; }
      n += 1;
      if (n > 240) return;
      setTimeout(tick, 25);
    };
    tick();
  }
}
/**
 * Dawn Weather & Moon — prod status chip + popover.
 * Instantiated by Dawn Weather plugin (or lab Tier2). Title cluster: cache paint on nav; fetch idle/onDemand; no MutationObserver.
 * Path B pluginId is prod `weather-moon` so darienx vault/LS hydrate.
 */

const WM_PLUGIN_ID = 'weather-moon';
const WM_SETTINGS_KEY = 'dawn:weather_moon_settings_v1';
const WM_SETTINGS_KEY_PROD = 'weather_moon_settings_v1';
const WM_DAY_PINS_KEY = 'dawn:weather_moon_day_pins_v1';
const WM_DAY_PINS_KEY_PROD = 'weather_moon_day_pins_v1';

function wmCopyProdLsIfEmpty() {
  for (const [dawnKey, prodKey] of [
    [WM_SETTINGS_KEY, WM_SETTINGS_KEY_PROD],
    [WM_DAY_PINS_KEY, WM_DAY_PINS_KEY_PROD],
  ]) {
    try {
      if (String(localStorage.getItem(dawnKey) || '').trim()) continue;
      const v = localStorage.getItem(prodKey);
      if (v == null || v === '') continue;
      localStorage.setItem(dawnKey, v);
    } catch (_) {}
  }
}

function wmLsGet(dawnKey, prodKey) {
  try {
    const a = localStorage.getItem(dawnKey);
    if (a != null && String(a).trim()) return a;
  } catch (_) {}
  try {
    return localStorage.getItem(prodKey);
  } catch (_) {
    return null;
  }
}

function wmLsSet(dawnKey, prodKey, raw) {
  try { localStorage.setItem(dawnKey, raw); } catch (_) {}
  try { localStorage.setItem(prodKey, raw); } catch (_) {}
}

function wmMirrorKeys() {
  return [WM_SETTINGS_KEY, WM_SETTINGS_KEY_PROD, WM_DAY_PINS_KEY, WM_DAY_PINS_KEY_PROD];
}
const WM_DAY_PIN_MAX = 400;
const WM_RECENT_CITIES_MAX = 8;
const WM_PINNED_CITIES_MAX = 12;
const WM_CACHE_PREFIX = 'dawn:wm_wx_v3:';
const WM_MOON_SYNODIC = 29.530588853;
const WM_JD_EPOCH = 2451549.5;

// ─── Moon (client-side only) ─────────────────────────────────────────────────

function wmToJulian(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getTime() / 86400000 + 2440587.5;
}

function wmMoonPhaseForDate(d) {
  const jd = wmToJulian(d);
  let days = (jd - WM_JD_EPOCH) % WM_MOON_SYNODIC;
  if (days < 0) days += WM_MOON_SYNODIC;
  const phase = days / WM_MOON_SYNODIC;
  const waxing = phase < 0.5;
  const illum = Math.round((1 - Math.cos(phase * 2 * Math.PI)) * 50);
  let name;
  if (phase < 0.03 || phase > 0.97) name = 'New moon';
  else if (phase < 0.22) name = waxing ? 'Waxing crescent' : 'Waning crescent';
  else if (phase < 0.28) name = 'First quarter';
  else if (phase < 0.47) name = waxing ? 'Waxing gibbous' : 'Waning gibbous';
  else if (phase < 0.53) name = 'Full moon';
  else if (phase < 0.72) name = 'Waning gibbous';
  else if (phase < 0.78) name = 'Last quarter';
  else name = 'Waning crescent';

  let daysToEvent;
  let eventLabel;
  if (waxing) {
    daysToEvent = Math.max(0, Math.round((0.5 - phase) * WM_MOON_SYNODIC));
    eventLabel = 'full';
  } else {
    daysToEvent = Math.max(0, Math.round((1 - phase) * WM_MOON_SYNODIC));
    eventLabel = 'new';
  }
  if (daysToEvent === 0) daysToEvent = 1;

  return { phase, illum, waxing, name, daysToEvent, eventLabel };
}

function wmMoonSvg(phase, size = 16) {
  const r = 8.5;
  const cx = 12;
  const cy = 12;
  const p = ((phase % 1) + 1) % 1;
  const illum = (1 - Math.cos(p * 2 * Math.PI)) / 2;
  const ring =
    `<circle cx="${cx}" cy="${cy}" r="${r + 0.55}" fill="none" stroke="#8E8E93" stroke-width="1.1" opacity="0.35"/>`;
  const lit = '#D1D1D6';

  if (illum >= 0.97) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
      `aria-hidden="true" class="wm-moon-svg" overflow="visible" shape-rendering="geometricPrecision">` +
      ring +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${lit}" opacity="0.98"/>` +
      `</svg>`
    );
  }
  if (illum <= 0.03) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
      `aria-hidden="true" class="wm-moon-svg" overflow="visible" shape-rendering="geometricPrecision">` +
      ring +
      `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#8E8E93" stroke-width="1.15" opacity="0.65"/>` +
      `</svg>`
    );
  }

  const dx = -Math.cos(p * 2 * Math.PI) * r;
  const maskId = `wm-moon-${Math.round(p * 10000)}-${Math.random().toString(36).slice(2, 8)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `aria-hidden="true" class="wm-moon-svg" overflow="visible" shape-rendering="geometricPrecision">` +
    `<defs><mask id="${maskId}"><rect width="24" height="24" fill="white"/>` +
    `<circle cx="${(cx + dx).toFixed(2)}" cy="${cy}" r="${r + 0.35}" fill="black"/></mask></defs>` +
    ring +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${lit}" opacity="0.98" mask="url(#${maskId})"/>` +
    `</svg>`
  );
}

function wmMoonEventEmoji(eventLabel) {
  return eventLabel === 'full' ? '🌕' : '🌑';
}

function wmMoonEmoji(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.03 || p > 0.97) return '🌑';
  if (p < 0.22) return p < 0.5 ? '🌒' : '🌘';
  if (p < 0.28) return p < 0.5 ? '🌓' : '🌗';
  if (p < 0.47) return p < 0.5 ? '🌔' : '🌖';
  if (p < 0.53) return '🌕';
  if (p < 0.72) return '🌖';
  if (p < 0.78) return '🌗';
  return '🌘';
}

function wmMoonEmojiHtml(phase, size = 18) {
  const px = Math.max(14, Math.round(Number(size) || 18));
  return (
    `<span class="wm-moon-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">` +
    `${wmMoonEmoji(phase)}</span>`
  );
}

function wmFormatDisplayDate(dateKey) {
  return String(dateKey || '').replace(/-/g, '.');
}

const WM_WEATHER_EMOJI = {
  clear: '☀️',
  partly: '🌤️',
  cloud: '☁️',
  fog: '🌫️',
  drizzle: '🌦️',
  rain: '🌧️',
  showers: '🌦️',
  snow: '🌨️',
  storm: '⛈️',
};

function wmWeatherEmoji(kind) {
  return WM_WEATHER_EMOJI[kind] || '☁️';
}

function wmWeatherEmojiFromCode(code) {
  return wmWeatherEmoji(wmWeatherKind(code));
}

function wmWeatherIconHtml(kind, size = 18) {
  const px = Math.max(14, Math.round(Number(size) || 18));
  return (
    `<span class="wm-weather-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">` +
    `${wmWeatherEmoji(kind)}</span>`
  );
}

function wmWeatherIconFromCode(code, size = 18) {
  return wmWeatherIconHtml(wmWeatherKind(code), size);
}

function wmFormatSunTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (_) {
    return '—';
  }
}

function wmFormatPrecipPct(n, withDrop = false) {
  if (n == null || Number.isNaN(Number(n))) return '';
  const pct = `${Math.round(Number(n))}%`;
  return withDrop ? `💧 ${pct}` : pct;
}

const WM_SUN_ICON = {
  base:
    '<path d="M4 17h16"/>' +
    '<path d="M8 17a4 4 0 0 1 8 0"/>' +
    '<path d="M6.2 14.2 5 13" stroke-dasharray="1.6 1.8"/>' +
    '<path d="M12 13.5V11.2" stroke-dasharray="1.6 1.8"/>' +
    '<path d="M17.8 14.2 19 13" stroke-dasharray="1.6 1.8"/>',
  rise: '<path d="M12 5.5v2.2"/><path d="m10.1 8.2 1.9-1.4 1.9 1.4"/>',
  set: '<path d="M12 8.3v2.2"/><path d="m10.1 8.2 1.9 1.4 1.9-1.4"/>',
};

function wmSunIcon(kind, size = 14) {
  const body = WM_SUN_ICON.base + (kind === 'sunset' ? WM_SUN_ICON.set : WM_SUN_ICON.rise);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" ` +
    `aria-hidden="true" class="wm-sun-ico" fill="none" stroke="currentColor" ` +
    `stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" shape-rendering="geometricPrecision">${body}</svg>`
  );
}

function wmSunLine(sunrise, sunset) {
  if (!sunrise && !sunset) return '';
  const up = wmFormatSunTime(sunrise);
  const down = wmFormatSunTime(sunset);
  if (up === '—' && down === '—') return '';
  return `↑ ${up}  ↓ ${down}`;
}

function wmSunTimesHtml(sunrise, sunset) {
  if (!sunrise && !sunset) return '';
  const up = wmFormatSunTime(sunrise);
  const down = wmFormatSunTime(sunset);
  if (up === '—' && down === '—') return '';
  let html = '<span class="wm-sun-times">';
  if (up !== '—') {
    html += `<span class="wm-sun-slot">${wmSunIcon('sunrise', 14)}<span>${up}</span></span>`;
  }
  if (down !== '—') {
    html += `<span class="wm-sun-slot">${wmSunIcon('sunset', 14)}<span>${down}</span></span>`;
  }
  return html + '</span>';
}

// ─── Weather codes (WMO) ─────────────────────────────────────────────────────

function wmWeatherLabel(code) {
  const c = Number(code);
  if (c === 0) return 'Clear';
  if (c <= 3) return 'Partly cloudy';
  if (c <= 48) return 'Fog';
  if (c <= 55) return 'Drizzle';
  if (c <= 57) return 'Freezing drizzle';
  if (c <= 65) return 'Rain';
  if (c <= 67) return 'Freezing rain';
  if (c <= 77) return 'Snow';
  if (c <= 82) return 'Showers';
  if (c <= 86) return 'Snow showers';
  if (c >= 95) return 'Thunderstorm';
  return 'Cloudy';
}

function wmWeatherKind(code) {
  const c = Number(code);
  if (c === 0) return 'clear';
  if (c <= 3) return 'partly';
  if (c <= 48) return 'fog';
  if (c <= 57) return 'drizzle';
  if (c <= 67) return 'rain';
  if (c <= 77) return 'snow';
  if (c <= 82) return 'showers';
  if (c >= 95) return 'storm';
  return 'cloud';
}

function wmWeatherIconFromCode(code, size = 18) {
  return wmWeatherIconHtml(wmWeatherKind(code), size);
}

function wmDateKey(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function wmTodayKey() {
  return wmDateKey(new Date());
}

/** Open-Meteo geocoding rejects many "City, ST" strings — try simpler queries too. */
function wmGeocodeQueries(raw) {
  const q = String(raw || '').trim();
  if (!q) return [];
  const out = [];
  const add = (s) => {
    const t = String(s || '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(q);
  add(q.split(',')[0]);
  add(q.replace(/,.*$/, '').trim());
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 2) add(words.slice(0, 2).join(' '));
  return out;
}

async function wmGeocodeSearch(raw) {
  const queries = wmGeocodeQueries(raw);
  let lastErr = null;
  for (const name of queries) {
    try {
      const url =
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}` +
        `&count=8&language=en&format=json`;
      const r = await fetch(url);
      if (!r.ok) {
        lastErr = new Error(`Geocode HTTP ${r.status}`);
        continue;
      }
      const j = await r.json();
      if (Array.isArray(j.results) && j.results.length) {
        return { results: j.results, queryUsed: name };
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return { results: [], queryUsed: queries[0] || String(raw || '').trim() };
}

function wmLocationFromGeocodeResult(it) {
  if (!it) return null;
  const admin = [it.admin1, it.country].filter(Boolean).join(', ');
  return {
    name: `${it.name}${admin ? `, ${admin}` : ''}`,
    latitude: it.latitude,
    longitude: it.longitude,
    timezone: it.timezone || 'auto',
  };
}

function wmFormatTemp(n, units) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Math.round(Number(n));
  return units === 'celsius' ? `${v}°C` : `${v}°F`;
}
function wmWindSpeedUnit(units) {
  return units === 'celsius' ? 'kmh' : 'mph';
}

function wmFormatWind(speed, units) {
  if (speed == null || Number.isNaN(Number(speed))) return '—';
  const v = Math.round(Number(speed));
  return units === 'celsius' ? `${v} km/h` : `${v} mph`;
}

function wmFormatWindShort(speed) {
  if (speed == null || Number.isNaN(Number(speed))) return '';
  return String(Math.round(Number(speed)));
}

function wmExpandChevronHtml(pointUp = false) {
  const d = pointUp ? 'M3 8 L12 4 L21 8' : 'M3 4 L12 8 L21 4';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="28" height="12" ` +
    `class="wm-expand-chevron-svg" aria-hidden="true">` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" ` +
    `stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
}

function wmFormatHumidity(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return `${Math.round(Number(n))}%`;
}

function wmIsNightAt(isoTime, sunrise, sunset) {
  if (!isoTime) return false;
  try {
    const t = new Date(isoTime).getTime();
    const sr = sunrise ? new Date(sunrise).getTime() : NaN;
    const ss = sunset ? new Date(sunset).getTime() : NaN;
    if (!Number.isNaN(sr) && !Number.isNaN(ss)) return t < sr || t >= ss;
    const h = new Date(isoTime).getHours();
    return h < 6 || h >= 20;
  } catch (_) {
    return false;
  }
}

function wmHourWeatherIcon(code, timeIso, sunrise, sunset, size = 18) {
  const kind = wmWeatherKind(code);
  if (wmIsNightAt(timeIso, sunrise, sunset)) {
    if (kind === 'clear') {
      const px = Math.max(14, Math.round(Number(size) || 18));
      return `<span class="wm-weather-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">🌙</span>`;
    }
    if (kind === 'partly') {
      const px = Math.max(14, Math.round(Number(size) || 18));
      return `<span class="wm-weather-emoji" style="font-size:${px}px;line-height:1" aria-hidden="true">☁️</span>`;
    }
  }
  return wmWeatherIconFromCode(code, size);
}

function wmSliceHourlyFromNow(hourly, count = 24) {
  const times = hourly?.time || [];
  if (!times.length) return [];
  const now = Date.now() - 30 * 60 * 1000;
  let start = 0;
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]).getTime() >= now) {
      start = i;
      break;
    }
  }
  const out = [];
  for (let i = start; i < Math.min(start + count, times.length); i++) {
    out.push({
      time: times[i],
      temp: hourly.temperature_2m?.[i],
      code: hourly.weather_code?.[i],
      precip: hourly.precipitation_probability?.[i],
      precipMm: hourly.precipitation?.[i],
      humidity: hourly.relative_humidity_2m?.[i],
      wind: hourly.wind_speed_10m?.[i],
      feels: hourly.apparent_temperature?.[i],
    });
  }
  return out;
}

function wmFeelsLikeNote(temp, apparent, wind, units) {
  if (apparent == null || temp == null) return '';
  const diff = Math.round(Number(apparent) - Number(temp));
  if (Math.abs(diff) >= 3) {
    if (diff < 0) {
      return wind != null && Number(wind) >= 8
        ? 'Wind is making it feel cooler.'
        : 'Feels cooler than the actual temperature.';
    }
    return 'Feels warmer than the actual temperature.';
  }
  if (wind != null && Number(wind) >= 12) {
    return `Wind gusts up to ${Math.round(Number(wind))} ${units === 'celsius' ? 'km/h' : 'mph'}.`;
  }
  return '';
}

function wmConditionBlurb(bundle, units) {
  return wmWeatherInsights(bundle, units, { compact: true }).join(' ');
}

function wmPrecipInsight(bundle, hourly, daily, todayKey) {
  const rainCode = (c) => {
    const n = Number(c);
    return (n >= 51 && n <= 67) || n >= 80;
  };
  const now = Date.now();
  for (const h of hourly || []) {
    const t = new Date(h.time).getTime();
    if (t < now - 60000) continue;
    const p = Number(h.precip);
    const code = Number(h.code);
    const mm = Number(h.precipMm);
    if (!(p >= 20 || (rainCode(code) && p >= 10) || (!Number.isNaN(mm) && mm >= 0.05))) continue;
    const when = new Date(h.time);
    const isToday = wmDateKey(when) === todayKey;
    const name = wmWeatherLabel(code).toLowerCase();
    const timeStr = when.toLocaleTimeString([], { hour: 'numeric' });
    const pct = p >= 10 ? ` (${Math.round(p)}%)` : '';
    if (isToday) return `${name.charAt(0).toUpperCase() + name.slice(1)} likely around ${timeStr}${pct}.`;
    return `Next ${name} likely ${when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}${pct}.`;
  }
  for (let i = 1; i < (daily || []).length; i++) {
    const d = daily[i];
    if (Number(d.precip) >= 25) {
      const when = new Date(String(d.date) + 'T12:00:00');
      return `Next rain likely ${when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} (${Math.round(Number(d.precip))}%).`;
    }
  }
  const sum = Number(bundle?.precipSum);
  if (!Number.isNaN(sum) && sum >= 0.05) {
    return `About ${sum.toFixed(2)} in expected today.`;
  }
  return 'No significant precipitation expected in the next 10 days.';
}

function wmNextPrecipText(hourly, daily, todayKey) {
  return wmPrecipInsight({ precipSum: null }, hourly, daily, todayKey);
}

function wmWeatherInsights(bundle, units, opts = {}) {
  const { compact = false, hourly, daily, todayKey } = opts;
  const lines = [];
  const labelLower = String(bundle?.label || '').toLowerCase();
  const feel = wmFeelsLikeNote(bundle?.temp, bundle?.feelsLike, bundle?.wind, units);

  if (bundle?.isHistorical) {
    if (bundle.hi != null && bundle.lo != null) {
      const spread = Number(bundle.hi) - Number(bundle.lo);
      if (spread >= 12) {
        lines.push(`Temperatures ranged ${wmFormatTemp(bundle.lo, units)} to ${wmFormatTemp(bundle.hi, units)}.`);
      }
    }
    if (feel) lines.push(feel);
    return lines.slice(0, compact ? 1 : 2);
  }

  if (compact) {
    if (bundle?.timing) {
      lines.push(`${bundle.timing.charAt(0).toUpperCase()}${bundle.timing.slice(1)}.`);
    } else {
      const night = wmIsNightAt(new Date().toISOString(), bundle?.sunrise, bundle?.sunset);
      if (night && labelLower.includes('clear')) lines.push('Stays clear through the morning.');
      else if (night && labelLower.includes('partly')) lines.push('Clouds break up toward morning.');
    }
    if (feel && lines.length < 2) lines.push(feel);
    return lines.slice(0, 2);
  }

  const precipLine = wmPrecipInsight(bundle, hourly, daily, todayKey);
  if (precipLine) lines.push(precipLine);

  const night = wmIsNightAt(new Date().toISOString(), bundle?.sunrise, bundle?.sunset);
  if (night && (labelLower.includes('clear') || labelLower.includes('partly'))) {
    const sky = labelLower.includes('clear') ? 'Stays clear through the morning.' : 'Clouds break up toward morning.';
    if (!lines.some((l) => /morning/i.test(l))) lines.unshift(sky);
  }

  if (feel && lines.length < 2 && !lines.some((l) => /feel|wind/i.test(l))) lines.push(feel);

  if (!compact && bundle?.timing) {
    const t = `${bundle.timing.charAt(0).toUpperCase()}${bundle.timing.slice(1)}.`;
    if (!lines.some((l) => l.toLowerCase().includes(bundle.timing.toLowerCase().slice(0, 8)))) {
      lines.unshift(t);
    }
  }

  return lines.slice(0, 2);
}

function wmChartSamplePoints(hourly, count = 8) {
  const pts = (hourly || []).slice(0, 24);
  if (pts.length < 2) return pts;
  if (pts.length <= count) return pts;
  const out = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * (pts.length - 1));
    if (!out.length || out[out.length - 1].time !== pts[idx].time) out.push(pts[idx]);
  }
  return out;
}

function wmChartValueLabel(metric, value, units) {
  const v = Number(value);
  if (Number.isNaN(v)) return '—';
  if (metric === 'temp') return `${Math.round(v)}°`;
  if (metric === 'wind') return units === 'celsius' ? `${Math.round(v)}` : `${Math.round(v)}`;
  return `${Math.round(v)}%`;
}

function wmSparkChartSvg(hourly, metric, units) {
  const pts = wmChartSamplePoints(hourly, 8);
  if (pts.length < 2) return '';
  const W = 320;
  const H = 96;
  const pad = { t: 20, r: 8, b: 20, l: 8 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const values = pts.map((h) => {
    if (metric === 'temp') return Number(h.temp);
    if (metric === 'precip') return Number(h.precip) || 0;
    if (metric === 'wind') return Number(h.wind) || 0;
    return 0;
  });
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = maxV - minV || 1;
  const coords = values.map((v, i) => {
    const x = pad.l + (i / (values.length - 1)) * innerW;
    const y = pad.t + innerH - ((v - minV) / span) * innerH;
    return [x, y, v];
  });
  const line = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} L${coords[0][0].toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`;
  const colors = { temp: '#f5a623', precip: '#5ac8fa', wind: '#a78bfa' };
  const stroke = colors[metric] || '#888';
  const valueLabels = coords
    .map((c) => {
      const text = wmChartValueLabel(metric, c[2], units);
      return `<text x="${c[0].toFixed(1)}" y="${Math.max(11, c[1] - 6).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="currentColor" opacity="0.92">${text}</text>`;
    })
    .join('');
  const timeLabels = coords
    .map((c, i) => {
      const h = new Date(pts[i].time);
      const txt = i === 0 ? 'Now' : h.toLocaleTimeString([], { hour: 'numeric' });
      return `<text x="${c[0].toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="8" fill="currentColor" opacity="0.5">${txt}</text>`;
    })
    .join('');
  return (
    `<svg class="wm-chart-svg" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" aria-hidden="true">` +
    `<path d="${area}" fill="${stroke}" opacity="0.2"/>` +
    `<path d="${line}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    valueLabels +
    timeLabels +
    `</svg>`
  );
}


function wmNormalizeLoc(loc) {
  if (!loc) return null;
  const lat = Number(loc.latitude);
  const lon = Number(loc.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    name: String(loc.name || 'Location').trim() || 'Location',
    latitude: lat,
    longitude: lon,
    timezone: loc.timezone || 'auto',
  };
}

function wmLocKey(loc) {
  const n = wmNormalizeLoc(loc);
  if (!n) return '';
  return `${n.latitude.toFixed(4)},${n.longitude.toFixed(4)}`;
}

function wmDefaultPinStore() {
  return { v: 1, pins: {}, skipAutoPin: [] };
}

function wmJournalDateFromRecord(record) {
  if (!record) return null;
  try {
    const g = String(record.guid || '');
    const m = g.match(/(?:^|[-_:])(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      const y = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const d = parseInt(m[3], 10);
      if (y >= 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        return new Date(y, mo - 1, d);
      }
    }
  } catch (_) {}
  try {
    const jd = record.getJournalDetails?.()?.date;
    if (jd instanceof Date && !isNaN(jd.getTime())) {
      return new Date(jd.getFullYear(), jd.getMonth(), jd.getDate());
    }
  } catch (_) {}
  return null;
}

class DawnWeather {
  constructor(app) {
    this.ui = app.ui;
    this.data = app.data;
    this.events = app.events;
    this._host = app;
  }

  getConfiguration() {
    try {
      return this._host.getConfiguration?.() || {};
    } catch (_) {
      return {};
    }
  }

  attach() {
    this._panelStates = new Map();
    this._eventIds = [];
    this._wxCache = new Map();
    this._fetchInflight = new Map();
    this._statusItem = null;
    this._popoverEl = null;
    this._popoverSource = null;
    this._popoverContextDate = null;
    this._boundDocMouse = null;
    this._boundDocClick = null;
    this._boundDocKey = null;
    this._boundWinResize = null;
    this._boundWinScroll = null;
    this._lockObserver = null;
    this._cssInjected = false;
    wmCopyProdLsIfEmpty();
    this._settings = this._loadSettingsLocal();
    this._todayRefreshTimer = null;
    this._titleObserver = null;
    this._cmds = [];

    this._injectCss();
    this._registerCommands();
    this._mountStatusBar();

    const boot = globalThis.BootKernel || globalThis.__dawnBoot;
    const hydrate = async () => {
      try {
        const api = globalThis.ThymerPluginSettings;
        if (api?.init && (!api.__pathBStub || api.__dawnPathBHost)) {
          await api.init({
            plugin: this._host || this,
            pluginId: WM_PLUGIN_ID,
            label: 'Weather & Moon',
            data: this.data,
            ui: this.ui,
            mirrorKeys: wmMirrorKeys,
            awaitHydrate: false,
            onHydrated: () => {
              wmCopyProdLsIfEmpty();
              this._settings = this._loadSettingsLocal();
              void this._refreshTodayStatusBar();
            },
          });
          this._pluginSettingsPluginId = WM_PLUGIN_ID;
          this._pluginSettingsSyncMode = 'synced';
          if (this._host) {
            this._host._pluginSettingsPluginId = WM_PLUGIN_ID;
            this._host._pluginSettingsSyncMode = 'synced';
          }
          wmCopyProdLsIfEmpty();
          this._settings = this._loadSettingsLocal();
        }
      } catch (e) {
        console.warn('[Weather & Moon] Path B init', e);
      }
      await this._refreshTodayStatusBar();
      try {
        const p = this.ui.getActivePanel?.();
        if (p) this._handlePanel(p);
      } catch (_) {}
    };
    if (boot?.enqueue) boot.enqueue(hydrate, { id: 'wm:hydrate', tier: 'idle', delayMs: 4000 });
    else setTimeout(() => void hydrate(), 4000);
    this._subscribeEvents();
  }

  _wmOnDemand(id, fn) {
    const boot = globalThis.BootKernel || globalThis.__dawnBoot;
    if (boot?.enqueue) boot.enqueue(fn, { id, tier: 'onDemand' });
    else void fn();
  }

  _registerCommands() {
    try {
      this._cmds.push(this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Configure',
        icon: 'ti-cloud',
        onSelected: () => this._wmOnDemand('wm:cfg', () => this._openConfigureDialog()),
      }));
      this._cmds.push(this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Choose location for this journal day…',
        icon: 'ti-map-pin',
        onSelected: () => this._wmOnDemand('wm:pin', () => this._cmdChooseJournalDayLocation()),
      }));
      this._cmds.push(this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Apply current location to this journal day',
        icon: 'ti-location',
        onSelected: () => this._wmOnDemand('wm:apply', () => this._cmdApplyCurrentToJournalDay()),
      }));
      this._cmds.push(this.ui.addCommandPaletteCommand({
        label: 'Weather & Moon: Clear location override for this journal day',
        icon: 'ti-map-pin-off',
        onSelected: () => this._wmOnDemand('wm:clear', () => this._cmdClearJournalDayLocation()),
      }));
    } catch (e) {
      console.warn('[Weather & Moon] commands', e);
    }
  }

  detach() {
    for (const id of this._eventIds || []) {
      try {
        this.events.off(id);
      } catch (_) {}
    }
    this._eventIds = [];
    if (this._todayRefreshTimer) {
      clearInterval(this._todayRefreshTimer);
      this._todayRefreshTimer = null;
    }
    try {
      this._closePopover();
    } catch (_) {}
    try {
      this._removeDocListeners();
    } catch (_) {}
    if (this._panelStates) {
      for (const [, st] of this._panelStates) {
        try {
          st.titleObserver?.disconnect?.();
        } catch (_) {}
        try {
          st.titleCluster?.remove?.();
        } catch (_) {}
      }
      try {
        this._panelStates.clear();
      } catch (_) {}
    }
    try {
      this._statusItem?.remove?.();
    } catch (_) {}
    this._statusItem = null;
    try {
      this._wxCache?.clear?.();
    } catch (_) {}
    try {
      this._fetchInflight?.clear?.();
    } catch (_) {}
    for (const c of this._cmds || []) {
      try { c?.remove?.(); } catch (_) {}
    }
    this._cmds = [];
  }

  _loadSettingsLocal() {
    wmCopyProdLsIfEmpty();
    try {
      const raw = wmLsGet(WM_SETTINGS_KEY, WM_SETTINGS_KEY_PROD);
      if (raw) return { ...this._defaultSettings(), ...JSON.parse(raw) };
    } catch (_) {}
    return this._defaultSettings();
  }

  _defaultSettings() {
    return {
      locationName: '',
      latitude: null,
      longitude: null,
      units: 'fahrenheit',
      timezone: 'auto',
      recentCities: [],
      pinnedCities: [],
    };
  }

  async _saveSettings(next) {
    this._settings = { ...this._defaultSettings(), ...next };
    if (next.locationName != null || next.latitude != null) {
      const loc = this._globalLocation();
      if (loc) this._touchRecentCity(loc);
    }
    try {
      wmLsSet(WM_SETTINGS_KEY, WM_SETTINGS_KEY_PROD, JSON.stringify(this._settings));
    } catch (_) {}
    try {
      globalThis.ThymerPluginSettings?.scheduleFlush?.(this._host || this, wmMirrorKeys);
      if (this._pluginSettingsSyncMode === 'synced') {
        await globalThis.ThymerPluginSettings?.flushNow?.(this.data, WM_PLUGIN_ID, wmMirrorKeys());
      }
    } catch (e) {
      console.warn('[Weather & Moon] settings flush', e);
    }
    this._clearWeatherCache();
    this._refreshTodayStatusBar();
    if (this._panelStates) {
      for (const [, st] of this._panelStates) this._refreshPanelTitle(st);
    }
  }

  _hasLocation() {
    const lat = Number(this._settings?.latitude);
    const lon = Number(this._settings?.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon);
  }

  _unitsParam() {
    return this._settings?.units === 'celsius' ? 'celsius' : 'fahrenheit';
  }

  _loadPinStore() {
    try {
      const raw = wmLsGet(WM_DAY_PINS_KEY, WM_DAY_PINS_KEY_PROD);
      if (!raw) return wmDefaultPinStore();
      const parsed = JSON.parse(raw);
      return {
        v: 1,
        pins: parsed?.pins && typeof parsed.pins === 'object' ? parsed.pins : {},
        skipAutoPin: Array.isArray(parsed?.skipAutoPin) ? parsed.skipAutoPin : [],
      };
    } catch (_) {
      return wmDefaultPinStore();
    }
  }

  _savePinStore(store) {
    try {
      wmLsSet(WM_DAY_PINS_KEY, WM_DAY_PINS_KEY_PROD, JSON.stringify(store));
    } catch (_) {}
    try {
      globalThis.ThymerPluginSettings?.scheduleFlush?.(this._host || this, wmMirrorKeys);
    } catch (_) {}
  }

  _trimPinStore(store) {
    const keys = Object.keys(store.pins || {});
    if (keys.length <= WM_DAY_PIN_MAX) return store;
    keys.sort((a, b) => {
      const ta = Date.parse(store.pins[a]?.pinnedAt || 0) || 0;
      const tb = Date.parse(store.pins[b]?.pinnedAt || 0) || 0;
      return ta - tb;
    });
    const drop = keys.length - WM_DAY_PIN_MAX;
    for (let i = 0; i < drop; i++) delete store.pins[keys[i]];
    return store;
  }

  _getDayPin(dateKey) {
    if (!dateKey) return null;
    const pin = this._loadPinStore().pins?.[dateKey];
    return wmNormalizeLoc(pin);
  }

  _isDayPinSkipped(dateKey) {
    if (!dateKey) return false;
    return this._loadPinStore().skipAutoPin.includes(dateKey);
  }

  _setDayPin(dateKey, loc) {
    const normalized = wmNormalizeLoc(loc);
    if (!dateKey || !normalized) return false;
    const store = this._loadPinStore();
    store.pins[dateKey] = { ...normalized, pinnedAt: new Date().toISOString() };
    store.skipAutoPin = (store.skipAutoPin || []).filter((k) => k !== dateKey);
    this._savePinStore(this._trimPinStore(store));
    this._clearWeatherCache();
    return true;
  }

  _clearDayPin(dateKey) {
    if (!dateKey) return false;
    const store = this._loadPinStore();
    if (!store.pins?.[dateKey] && !store.skipAutoPin?.includes(dateKey)) return false;
    delete store.pins[dateKey];
    if (!store.skipAutoPin.includes(dateKey)) store.skipAutoPin.push(dateKey);
    this._savePinStore(store);
    this._clearWeatherCache();
    return true;
  }

  _maybeAutoPinDay(dateKey) {
    if (!dateKey || this._getDayPin(dateKey) || this._isDayPinSkipped(dateKey)) return;
    const global = this._globalLocation();
    if (!global) return;
    const store = this._loadPinStore();
    store.pins[dateKey] = { ...global, pinnedAt: new Date().toISOString() };
    this._savePinStore(this._trimPinStore(store));
  }

  _globalLocation() {
    return wmNormalizeLoc({
      name: this._settings?.locationName,
      latitude: this._settings?.latitude,
      longitude: this._settings?.longitude,
      timezone: this._settings?.timezone,
    });
  }

  _resolveLocationForDate(dateKey) {
    return this._getDayPin(dateKey) || this._globalLocation();
  }

  _hasLocationForDate(dateKey) {
    return !!this._resolveLocationForDate(dateKey);
  }

  _clearWeatherCache() {
    try {
      this._wxCache?.clear?.();
    } catch (_) {}
    try {
      const prefix = WM_CACHE_PREFIX;
      const drop = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith(prefix)) drop.push(k);
      }
      for (const k of drop) sessionStorage.removeItem(k);
    } catch (_) {}
  }

  _touchRecentCity(loc) {
    const normalized = wmNormalizeLoc(loc);
    if (!normalized) return;
    const key = wmLocKey(normalized);
    let recent = Array.isArray(this._settings.recentCities) ? [...this._settings.recentCities] : [];
    recent = recent.filter((c) => wmLocKey(c) !== key);
    recent.unshift(normalized);
    recent = recent.slice(0, WM_RECENT_CITIES_MAX);
    this._settings = { ...this._settings, recentCities: recent };
    try {
      wmLsSet(WM_SETTINGS_KEY, WM_SETTINGS_KEY_PROD, JSON.stringify(this._settings));
    } catch (_) {}
    try {
      globalThis.ThymerPluginSettings?.scheduleFlush?.(this._host || this, wmMirrorKeys);
    } catch (_) {}
  }

  _togglePinnedCity(loc) {
    const normalized = wmNormalizeLoc(loc);
    if (!normalized) return false;
    const key = wmLocKey(normalized);
    let pinned = Array.isArray(this._settings.pinnedCities) ? [...this._settings.pinnedCities] : [];
    const idx = pinned.findIndex((c) => wmLocKey(c) === key);
    if (idx >= 0) pinned.splice(idx, 1);
    else {
      pinned.unshift(normalized);
      pinned = pinned.slice(0, WM_PINNED_CITIES_MAX);
    }
    this._settings = { ...this._settings, pinnedCities: pinned };
    try {
      wmLsSet(WM_SETTINGS_KEY, WM_SETTINGS_KEY_PROD, JSON.stringify(this._settings));
    } catch (_) {}
    try {
      globalThis.ThymerPluginSettings?.scheduleFlush?.(this._host || this, wmMirrorKeys);
    } catch (_) {}
    return idx < 0;
  }

  _isPinnedCity(loc) {
    const key = wmLocKey(loc);
    if (!key) return false;
    return (this._settings.pinnedCities || []).some((c) => wmLocKey(c) === key);
  }

  _getActiveJournalState() {
    try {
      const panel = this.ui?.getActivePanel?.();
      const panelId = panel?.getId?.();
      if (!panelId) return null;
      const panelEl = panel?.getElement?.();
      const record = panel?.getActiveRecord?.();
      if (!this._isJournalRecord(record, panelEl)) return null;
      let state = this._panelStates?.get(panelId);
      if (state?.journalDateKey) return state;
      const journalDate = wmJournalDateFromRecord(record) || new Date();
      return {
        panelId,
        panel,
        journalDate,
        journalDateKey: wmDateKey(journalDate),
      };
    } catch (_) {
      return null;
    }
  }

  _refreshJournalPanel(dateKey) {
    if (!dateKey || !this._panelStates) return;
    for (const [, st] of this._panelStates) {
      if (st.journalDateKey === dateKey) this._refreshPanelTitle(st);
    }
  }

  _cachedBundleForDate(dateKey) {
    const loc = this._resolveLocationForDate(dateKey);
    if (!loc || !dateKey) return null;
    return this._cacheGet(`${loc.latitude},${loc.longitude},${this._unitsParam()},${dateKey}`);
  }

  _cacheGet(key) {
    if (this._wxCache.has(key)) return this._wxCache.get(key);
    try {
      const raw = sessionStorage.getItem(WM_CACHE_PREFIX + key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed.exp && Date.now() > parsed.exp) return null;
      this._wxCache.set(key, parsed.data);
      return parsed.data;
    } catch (_) {
      return null;
    }
  }

  _cacheSet(key, data, ttlMs) {
    this._wxCache.set(key, data);
    try {
      sessionStorage.setItem(
        WM_CACHE_PREFIX + key,
        JSON.stringify({ exp: Date.now() + ttlMs, data })
      );
    } catch (_) {}
  }

  async _fetchWeatherBundle(dateKey, opts = {}) {
    const useGlobal = opts.useGlobal === true;
    const loc = useGlobal ? this._globalLocation() : this._resolveLocationForDate(dateKey);
    if (!loc) return null;
    const lat = loc.latitude;
    const lon = loc.longitude;
    const units = this._unitsParam();
    const tz = encodeURIComponent(loc.timezone || 'auto');
    const cacheKey = `${lat},${lon},${units},${dateKey}`;
    const cached = this._cacheGet(cacheKey);
    if (cached) return cached;

    if (this._fetchInflight.has(cacheKey)) return this._fetchInflight.get(cacheKey);

    const today = wmTodayKey();
    const p = (async () => {
      try {
        let bundle;
        if (dateKey === today) {
          bundle = await this._fetchForecastToday(lat, lon, units, tz);
        } else if (dateKey < today) {
          bundle = await this._fetchArchiveDay(lat, lon, units, tz, dateKey);
        } else {
          bundle = await this._fetchForecastDay(lat, lon, units, tz, dateKey);
        }
        if (bundle) {
          const ttl = dateKey === today ? 15 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
          this._cacheSet(cacheKey, bundle, ttl);
        }
        return bundle;
      } finally {
        this._fetchInflight.delete(cacheKey);
      }
    })();
    this._fetchInflight.set(cacheKey, p);
    return p;
  }

  async _fetchForecastToday(lat, lon, units, tz) {
    const wu = wmWindSpeedUnit(units);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m,apparent_temperature` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset` +
      `&hourly=weather_code,temperature_2m,precipitation_probability,precipitation,relative_humidity_2m,wind_speed_10m,apparent_temperature&timezone=${tz}` +
      `&forecast_days=10&past_days=0&temperature_unit=${units}&precipitation_unit=inch&wind_speed_unit=${wu}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const j = await r.json();
    const cur = j.current || {};
    const daily = j.daily || {};
    const hourly = j.hourly || {};
    const hi = daily.temperature_2m_max?.[0];
    const lo = daily.temperature_2m_min?.[0];
    const code = cur.weather_code ?? daily.weather_code?.[0];
    const precip = daily.precipitation_probability_max?.[0];
    const timing = this._precipTimingLine(hourly.time, hourly.precipitation_probability, hourly.weather_code);
    const days = (daily.time || []).slice(0, 10).map((t, i) => ({
      date: t,
      hi: daily.temperature_2m_max?.[i],
      lo: daily.temperature_2m_min?.[i],
      code: daily.weather_code?.[i],
      precip: daily.precipitation_probability_max?.[i],
    }));
    const hourlyFromNow = wmSliceHourlyFromNow(hourly, 48);
    return {
      dateKey: wmTodayKey(),
      temp: cur.temperature_2m,
      hi,
      lo,
      code,
      precip,
      precipSum: daily.precipitation_sum?.[0],
      humidity: cur.relative_humidity_2m,
      wind: cur.wind_speed_10m,
      feelsLike: cur.apparent_temperature,
      label: wmWeatherLabel(code),
      kind: wmWeatherKind(code),
      timing,
      sunrise: daily.sunrise?.[0] || null,
      sunset: daily.sunset?.[0] || null,
      hourly: hourlyFromNow.length ? hourlyFromNow : this._sliceHourly(hourly, 0, 24),
      hourlyChart: hourlyFromNow.length ? hourlyFromNow : this._sliceHourly(hourly, 0, 48),
      daily: days,
      isHistorical: false,
    };
  }

  async _fetchForecastDay(lat, lon, units, tz, dateKey) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset` +
      `&hourly=weather_code,temperature_2m,precipitation_probability&timezone=${tz}` +
      `&start_date=${dateKey}&end_date=${dateKey}&temperature_unit=${units}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Open-Meteo ${r.status}`);
    const j = await r.json();
    const daily = j.daily || {};
    const hourly = j.hourly || {};
    const code = daily.weather_code?.[0];
    return {
      dateKey,
      temp: daily.temperature_2m_max?.[0],
      hi: daily.temperature_2m_max?.[0],
      lo: daily.temperature_2m_min?.[0],
      code,
      precip: daily.precipitation_probability_max?.[0],
      label: wmWeatherLabel(code),
      kind: wmWeatherKind(code),
      timing: this._precipTimingLine(hourly.time, hourly.precipitation_probability, hourly.weather_code),
      sunrise: daily.sunrise?.[0] || null,
      sunset: daily.sunset?.[0] || null,
      hourly: this._sliceHourly(hourly, 0, 24),
      daily: [],
      isHistorical: false,
    };
  }

  async _fetchArchiveDay(lat, lon, units, tz, dateKey) {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
      `&start_date=${dateKey}&end_date=${dateKey}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset` +
      `&timezone=${tz}&temperature_unit=${units}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Archive ${r.status}`);
    const j = await r.json();
    const daily = j.daily || {};
    const code = daily.weather_code?.[0];
    const hi = daily.temperature_2m_max?.[0];
    const lo = daily.temperature_2m_min?.[0];
    return {
      dateKey,
      temp: hi,
      hi,
      lo,
      code,
      precip: null,
      label: wmWeatherLabel(code),
      kind: wmWeatherKind(code),
      timing: null,
      sunrise: daily.sunrise?.[0] || null,
      sunset: daily.sunset?.[0] || null,
      hourly: [],
      daily: [],
      isHistorical: true,
    };
  }

  _sliceHourly(hourly, start, count) {
    const out = [];
    const times = hourly?.time || [];
    for (let i = start; i < Math.min(start + count, times.length); i++) {
      out.push({
        time: times[i],
        temp: hourly.temperature_2m?.[i],
        code: hourly.weather_code?.[i],
        precip: hourly.precipitation_probability?.[i],
        precipMm: hourly.precipitation?.[i],
        humidity: hourly.relative_humidity_2m?.[i],
        wind: hourly.wind_speed_10m?.[i],
        feels: hourly.apparent_temperature?.[i],
      });
    }
    return out;
  }

  _isFullForecastSource(source) {
    return source === 'status';
  }

  _popoverHeadConditionHtml(bundle, isToday, units) {
    const daily0 = bundle.daily?.[0];
    const dayLabel = daily0 ? wmWeatherLabel(daily0.code) : bundle.label;
    let cond = this._escapeHtml(dayLabel || bundle.label || '—');
    if (isToday && !bundle.isHistorical && bundle.label && dayLabel && dayLabel !== bundle.label) {
      cond += `<span class="wm-head-now"> · now ${this._escapeHtml(String(bundle.label).toLowerCase())}</span>`;
    }
    return cond;
  }

  _popoverHeadIconKind(bundle, isToday) {
    const daily0 = bundle.daily?.[0];
    if (isToday && daily0?.code != null) return wmWeatherKind(daily0.code);
    return bundle.kind;
  }

  _appendPopoverMoon(card, moon) {
    const mRow = document.createElement('div');
    mRow.className = 'wm-moon-row wm-detail-line';
    mRow.innerHTML =
      `${wmMoonEmojiHtml(moon.phase, 16)}` +
      `<span>${this._escapeHtml(moon.name)} · ${moon.illum}% · ${moon.daysToEvent}d → ${wmMoonEventEmoji(moon.eventLabel)}</span>`;
    card.appendChild(mRow);
  }

  _appendPopoverHourly(card, bundle, units) {
    if (!bundle.hourly?.length || bundle.isHistorical) return;
    const lab = document.createElement('div');
    lab.className = 'wm-section-label';
    lab.textContent = 'Hourly';
    card.appendChild(lab);
    const row = document.createElement('div');
    row.className = 'wm-hourly';
    for (const h of bundle.hourly.slice(0, 18)) {
      const cell = document.createElement('div');
      cell.className = 'wm-hour';
      const hr = new Date(h.time);
      const label = hr.toLocaleTimeString([], { hour: 'numeric' });
      const pPct = wmFormatPrecipPct(h.precip, true) || '💧 0%';
      const windVal = wmFormatWindShort(h.wind);
      const windBit = windVal ? `💨 ${windVal}` : '';
      cell.innerHTML =
        `<div>${wmHourWeatherIcon(h.code, h.time, bundle.sunrise, bundle.sunset, 18)}</div>` +
        `<div class="wm-hour-t">${this._escapeHtml(label)}</div>` +
        `<div class="wm-hour-t wm-hour-temp">${wmFormatTemp(h.temp, units)}</div>` +
        `<div class="wm-hour-meta">${pPct}</div>` +
        (windBit ? `<div class="wm-hour-meta">${windBit}</div>` : '');
      row.appendChild(cell);
    }
    card.appendChild(row);
  }

  _fillExpandSection(host, bundle, units, useGlobalWx) {
    if (!host || host.dataset.wmBuilt === '1') return;
    host.innerHTML = '';
    let chartCtrl = null;
    if (!bundle.isHistorical) {
      chartCtrl = this._appendWeatherCharts(host, bundle, units);
    }
    if (bundle.daily?.length) {
      this._appendDailyTiles(host, bundle, units, useGlobalWx, chartCtrl);
    }
    host.dataset.wmBuilt = '1';
  }

  _appendExpandToggle(shell, card, expandHost, bundle, units, useGlobalWx, positionFn) {
    if (!shell || !card || !expandHost) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wm-expand-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Show charts and 10-day forecast');
    const chevron = document.createElement('span');
    chevron.className = 'wm-expand-chevron';
    chevron.innerHTML = wmExpandChevronHtml(false);
    btn.appendChild(chevron);
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const open = !shell.classList.contains('wm-shell--popover-expanded');
      shell.classList.toggle('wm-shell--popover-expanded', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.setAttribute(
        'aria-label',
        open ? 'Hide charts and 10-day forecast' : 'Show charts and 10-day forecast'
      );
      chevron.innerHTML = wmExpandChevronHtml(open);
      if (open) this._fillExpandSection(expandHost, bundle, units, useGlobalWx);
      try {
        positionFn?.();
      } catch (_) {}
    });
    shell.appendChild(btn);
  }

  async _mergeTodayDashboard(bundle, targetKey, useGlobalWx) {
    if (!bundle || targetKey !== wmTodayKey()) return bundle;
    let next = await this._ensureTodayDashboard(bundle, targetKey, { useGlobal: useGlobalWx });
    try {
      const todayFull = await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: useGlobalWx });
      if (todayFull) {
        if (todayFull.daily?.length) next.daily = todayFull.daily;
        if (todayFull.hourly?.length) next.hourly = todayFull.hourly;
        if (todayFull.hourlyChart?.length) next.hourlyChart = todayFull.hourlyChart;
        if (todayFull.timing) next.timing = todayFull.timing;
        if (todayFull.humidity != null) next.humidity = todayFull.humidity;
        if (todayFull.wind != null) next.wind = todayFull.wind;
        if (todayFull.feelsLike != null) next.feelsLike = todayFull.feelsLike;
        if (todayFull.precipSum != null) next.precipSum = todayFull.precipSum;
      }
    } catch (_) {}
    return next;
  }

  _statusBarVisible() {
    try {
      const el = this._statusItem?.getElement?.();
      return !!(el && el.isConnected && el.offsetParent !== null);
    } catch (_) {
      return false;
    }
  }

  async _ensureTodayDashboard(bundle, targetKey, opts = {}) {
    if (!bundle || targetKey !== wmTodayKey()) return bundle;
    if (Array.isArray(bundle.daily) && bundle.daily.length >= 7) return bundle;
    const loc = opts.useGlobal ? this._globalLocation() : this._resolveLocationForDate(targetKey);
    if (!loc) return bundle;
    const lat = loc.latitude;
    const lon = loc.longitude;
    const units = this._unitsParam();
    const cacheKey = `${lat},${lon},${units},${targetKey}`;
    try {
      this._wxCache.delete(cacheKey);
      sessionStorage.removeItem(WM_CACHE_PREFIX + cacheKey);
    } catch (_) {}
    return (await this._fetchWeatherBundle(targetKey, opts)) || bundle;
  }

  _appendMetricsRow(card, bundle, units) {
    if (bundle.humidity == null && bundle.wind == null && bundle.feelsLike == null) return;
    const row = document.createElement('div');
    row.className = 'wm-metrics wm-detail-line';
    const bits = [];
    if (bundle.feelsLike != null) bits.push(`Feels ${wmFormatTemp(bundle.feelsLike, units)}`);
    if (bundle.humidity != null) bits.push(`Humidity ${wmFormatHumidity(bundle.humidity)}`);
    if (bundle.wind != null) bits.push(`Wind ${wmFormatWind(bundle.wind, units)}`);
    row.textContent = bits.join(' · ');
    card.appendChild(row);
  }

  _appendBlurb(card, text, className = 'wm-blurb wm-detail-line') {
    const t = String(text || '').trim();
    if (!t) return;
    const el = document.createElement('div');
    el.className = className;
    el.textContent = t;
    card.appendChild(el);
  }

  _appendInsights(card, bundle, units, opts = {}) {
    const lines = wmWeatherInsights(bundle, units, opts);
    const cls = opts.compact ? 'wm-blurb wm-blurb--compact wm-detail-line' : 'wm-blurb wm-detail-line';
    for (const line of lines) this._appendBlurb(card, line, cls);
  }

  _appendWeatherCharts(host, bundle, units) {
    const chartData = bundle.hourlyChart || bundle.hourly;
    if (!chartData?.length || bundle.isHistorical) return null;
    const wrap = document.createElement('div');
    wrap.className = 'wm-charts';
    const tabs = document.createElement('div');
    tabs.className = 'wm-chart-tabs';
    const pane = document.createElement('div');
    pane.className = 'wm-chart-pane';
    const defs = [
      ['temp', 'Temperature'],
      ['precip', 'Precipitation'],
      ['wind', 'Wind'],
    ];
    let active = 'temp';
    let series = chartData;
    const render = () => {
      pane.innerHTML = wmSparkChartSvg(series, active, units);
    };
    for (const [id, label] of defs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wm-chart-tab' + (id === active ? ' is-active' : '');
      btn.textContent = label;
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        active = id;
        tabs.querySelectorAll('.wm-chart-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
        render();
      });
      tabs.appendChild(btn);
    }
    render();
    wrap.appendChild(tabs);
    wrap.appendChild(pane);
    host.appendChild(wrap);
    return {
      setChartData(data) {
        series = data?.length ? data : chartData;
        render();
      },
    };
  }

  _appendDailyTiles(host, bundle, units, useGlobalWx, chartCtrl) {
    if (!bundle.daily?.length) return;
    const lab = document.createElement('div');
    lab.className = 'wm-section-label';
    lab.textContent = '10-day';
    host.appendChild(lab);

    const strip = document.createElement('div');
    strip.className = 'wm-daily-strip';

    const detail = document.createElement('div');
    detail.className = 'wm-daily-detail wm-detail-line';
    detail.style.setProperty('--wm-text-indent', '0px');

    const formatDetail = (d, idx) => {
      const label = wmWeatherLabel(d.code);
      const precip = wmFormatPrecipPct(d.precip, true);
      const dayNote = idx === 0 && d.date === wmTodayKey() ? ' · day overall' : '';
      return `${label}${dayNote}${precip ? ` · ${precip}` : ''} · ${wmFormatTemp(d.hi, units)} / ${wmFormatTemp(d.lo, units)}`;
    };

    let activeIdx = 0;
    const selectTile = async (idx) => {
      activeIdx = idx;
      strip.querySelectorAll('.wm-daily-tile').forEach((el, i) => {
        el.classList.toggle('is-active', i === idx);
      });
      const d = bundle.daily[idx];
      detail.textContent = formatDetail(d, idx);
      if (!chartCtrl) return;
      const today = wmTodayKey();
      if (d.date === today || idx === 0) {
        chartCtrl.setChartData(bundle.hourlyChart || bundle.hourly);
        return;
      }
      detail.textContent = `${formatDetail(d, idx)} · loading chart…`;
      try {
        const dayBundle = await this._fetchWeatherBundle(d.date, { useGlobal: useGlobalWx });
        chartCtrl.setChartData(dayBundle?.hourly?.length ? dayBundle.hourly : []);
        detail.textContent = formatDetail(d, idx);
      } catch (_) {
        detail.textContent = formatDetail(d, idx);
      }
    };

    bundle.daily.forEach((d, i) => {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'wm-daily-tile' + (i === 0 ? ' is-active' : '');
      const dow = new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
      tile.innerHTML =
        `<span class="wm-daily-tile-dow">${this._escapeHtml(dow)}</span>` +
        `<span class="wm-daily-tile-ico">${wmWeatherIconFromCode(d.code, 20)}</span>` +
        `<span class="wm-daily-tile-hi">${wmFormatTemp(d.hi, units)}</span>` +
        `<span class="wm-daily-tile-lo">${wmFormatTemp(d.lo, units)}</span>`;
      tile.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void selectTile(i);
      });
      strip.appendChild(tile);
    });

    detail.textContent = formatDetail(bundle.daily[0], 0);
    host.appendChild(strip);
    host.appendChild(detail);
  }

  _precipTimingLine(times, precipArr, codeArr) {
    if (!Array.isArray(times) || !times.length) return null;
    const now = Date.now();
    const todayKey = wmTodayKey();
    const rainCode = (code) => {
      const c = Number(code);
      return (c >= 51 && c <= 67) || c >= 80;
    };
    for (let i = 0; i < times.length; i++) {
      const t = new Date(times[i]).getTime();
      if (t < now - 3600000) continue;
      if (wmDateKey(new Date(times[i])) !== todayKey) continue;
      const p = Number(precipArr?.[i]);
      const code = Number(codeArr?.[i]);
      // Open-Meteo often assigns drizzle/rain codes while precip % stays low — trust probability.
      if (!(p >= 30 || (rainCode(code) && p >= 20))) continue;
      const mins = Math.max(0, Math.round((t - now) / 60000));
      const label = wmWeatherLabel(code).toLowerCase();
      if (mins <= 5) return `${label} now`;
      if (mins < 90) return `${label} in ~${mins} min`;
      const when = new Date(times[i]).toLocaleTimeString([], { hour: 'numeric' });
      return `${label} around ${when}`;
    }
    return null;
  }

  _moonSummaryLine(date) {
    const m = wmMoonPhaseForDate(date);
    const d = m.daysToEvent;
    const unit = d === 1 ? 'day' : 'days';
    return `${d}${unit[0]} to ${m.eventLabel}`;
  }

  _statusReadoutHtml(bundle, date = new Date()) {
    if (!this._hasLocation()) {
      return '<span class="wm-status-readout wm-status-readout--muted">Weather — configure</span>';
    }
    if (!bundle) {
      return '<span class="wm-status-readout wm-status-readout--muted">Weather…</span>';
    }
    const moon = wmMoonPhaseForDate(date);
    const hi = wmFormatTemp(bundle.hi, this._settings.units);
    const lo = wmFormatTemp(bundle.lo, this._settings.units);
    const cond = (bundle.label || '—').toLowerCase();
    const moonBit = `${moon.daysToEvent}d → ${wmMoonEventEmoji(moon.eventLabel)}`;
    const precipBit =
      bundle.precip != null && !Number.isNaN(Number(bundle.precip))
        ? `💧 ${Math.round(Number(bundle.precip))}%`
        : '';
    const windBit =
      bundle.wind != null && !Number.isNaN(Number(bundle.wind))
        ? `💨 ${wmFormatWindShort(bundle.wind)}`
        : '';
    let html =
      `<span class="wm-status-readout">` +
      `<span class="wm-status-temps">${hi}<span class="wm-status-sep"> / </span>${lo}</span>` +
      `<span class="wm-status-dot">·</span>` +
      `<span class="wm-status-cond">${this._escapeHtml(cond)}</span>`;
    if (precipBit) {
      html += `<span class="wm-status-dot">·</span><span class="wm-status-meta">${precipBit}</span>`;
    }
    if (windBit) {
      html += `<span class="wm-status-dot">·</span><span class="wm-status-meta">${windBit}</span>`;
    }
    html +=
      `<span class="wm-status-dot">·</span>` +
      `<span class="wm-status-moon">${this._escapeHtml(moonBit)}</span>` +
      `</span>`;
    return html;
  }

  _escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async _refreshTodayStatusBar() {
    if (!this._statusItem) return;
    let bundle = null;
    if (this._hasLocation()) {
      try {
        bundle = await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: true });
      } catch (e) {
        console.warn('[Weather & Moon] today fetch', e);
      }
    }
    try {
      const sunTip = bundle ? wmSunLine(bundle.sunrise, bundle.sunset) : '';
      this._statusItem.setHtmlLabel?.(this._statusReadoutHtml(bundle));
      const precipTip =
        bundle?.precip != null ? ` · 💧 ${Math.round(Number(bundle.precip))}%` : '';
      const windTip =
        bundle?.wind != null ? ` · 💨 ${wmFormatWind(bundle.wind, this._settings.units)}` : '';
      this._statusItem.setTooltip?.(
        bundle
          ? `Weather — ${bundle.label}${precipTip}${windTip}${sunTip ? ` · ${sunTip}` : ''}; click for forecast`
          : 'Weather & Moon — click to configure'
      );
    } catch (_) {}
  }

  _scheduleTodayRefresh() {
    if (this._todayRefreshTimer) clearInterval(this._todayRefreshTimer);
    this._todayRefreshTimer = setInterval(() => this._refreshTodayStatusBar(), 30 * 60 * 1000);
  }

  _mountStatusBar() {
    if (typeof this.ui?.addStatusBarItem !== 'function') return;
    try {
      this._statusItem = this.ui.addStatusBarItem({
        htmlLabel: this._statusReadoutHtml(null),
        tooltip: 'Weather & Moon',
        onClick: () =>
          this._wmOnDemand('wm:pop', () =>
            this._togglePopover('status', this._statusItem?.getElement?.(), wmTodayKey())
          ),
      });
    } catch (e) {
      console.warn('[Weather & Moon] status bar', e);
      return;
    }
    setTimeout(() => this._moveStatusToEnd(), 800);
  }

  _moveStatusToEnd() {
    try {
      const el = this._statusItem?.getElement?.();
      const p = el?.parentNode;
      if (el && p && p.lastElementChild !== el) p.appendChild(el);
    } catch (_) {}
  }

  _subscribeEvents() {
    const onPanel = (ev) => {
      const delay = ev?.type === 'panel.navigated' ? 80 : 40;
      setTimeout(() => {
        // Property edits re-fire navigated; remounting the title cluster steals focus.
        if (globalThis.__dawnIsUiTyping?.()) return;
        this._handlePanel(ev?.panel);
      }, delay);
    };
    try {
      this._eventIds.push(this.events.on('panel.navigated', onPanel));
      this._eventIds.push(this.events.on('panel.focused', onPanel));
      this._eventIds.push(this.events.on('panel.closed', (ev) => this._disposePanel(ev?.panel?.getId?.())));
    } catch (_) {}
  }

  _isJournalRecord(record, panelEl) {
    if (!record && !panelEl) return false;
    try {
      const d = record?.getJournalDetails?.()?.date;
      if (d instanceof Date && !isNaN(d.getTime())) return true;
    } catch (_) {}
    try {
      const collName = String(record?.getCollection?.()?.getName?.() || '').trim();
      const title = String(record?.getName?.() || '').trim();
      const g = String(record?.guid || '');
      if (/journal/i.test(g) && /(?:^|[-_:])\d{8}$/.test(g)) return true;
      const looksLikeJournalCollection = /^(journal|journal pages?|daily|to\.?day)$/i.test(collName);
      const looksLikeDateTitle =
        /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Z][a-z]{2}\s+\d{1,2}$/.test(title) ||
        /^\d{4}-\d{2}-\d{2}$/.test(title);
      const guidHasDateSuffix = /(?:^|[-_:])\d{8}$/.test(g);
      if (looksLikeJournalCollection && (looksLikeDateTitle || guidHasDateSuffix)) return true;
      if (/^daily$/i.test(collName)) return true;
      if (looksLikeDateTitle && panelEl) {
        const scope = panelEl.closest?.('.panel') || panelEl;
        if (scope?.querySelector?.('h1.id--h1, input#h1-edit')) return true;
      }
    } catch (_) {}
    return false;
  }

  _getPanelTitleScopes(panelEl, container) {
    const scopes = [];
    const add = (el) => {
      if (el && !scopes.includes(el)) scopes.push(el);
    };
    add(panelEl?.closest?.('.panel.has-focus'));
    add(panelEl?.closest?.('.panel'));
    add(panelEl?.closest?.('.panel-bar'));
    add(panelEl);
    add(container);
    try {
      const focused = document.querySelector('.panel.has-focus');
      add(focused);
    } catch (_) {}
    let node = panelEl;
    for (let i = 0; i < 8 && node; i++) {
      add(node);
      node = node.parentElement;
    }
    return scopes;
  }

  _isVisibleTitleEl(el) {
    try {
      if (!el?.isConnected) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (_) {
      return true;
    }
  }

  _pickBestTitleCandidate(nodes, expected) {
    const list = Array.isArray(nodes) ? nodes : [];
    const visible = list.filter((el) => !this._shouldSkipTitleNode(el) && this._isVisibleTitleEl(el));
    if (!visible.length) return null;
    for (let i = visible.length - 1; i >= 0; i--) {
      if (this._titleMatchesRecord(visible[i], expected)) return visible[i];
    }
    return visible[visible.length - 1];
  }

  /** Prefer the last match — Thymer may leave stale layers after journal navigation. */
  _findContainer(panelEl) {
    if (!panelEl) return null;
    for (const sel of [
      '.panel-body',
      '.panel-heading',
      '.panel-bar',
      '.page-content',
      '.editor-wrapper',
      '.editor-panel',
      '#editor',
    ]) {
      if (panelEl.matches?.(sel)) return panelEl;
      const all = panelEl.querySelectorAll?.(sel);
      if (all && all.length) return all[all.length - 1];
    }
    try {
      if (panelEl.matches?.('.panel, .panel-normal, [class*="panel-"]')) return panelEl;
    } catch (_) {}
    return panelEl;
  }

  _titleText(el) {
    if (!el) return '';
    try {
      if ('value' in el && el.value != null && String(el.value).trim()) return String(el.value).trim();
    } catch (_) {}
    return String(el.textContent || '').trim();
  }

  _shouldSkipTitleNode(el) {
    return (
      !el ||
      el.closest?.('.wm-title-cluster, .jhs-shell, .tn-footer, .ht-sidebar, .wm-shell, .banner-container') ||
      el.classList?.contains?.('wm-title-cluster')
    );
  }

  _titleMatchesRecord(el, expected) {
    const text = this._titleText(el);
    if (!text) return false;
    if (!expected) return true;
    if (text === expected) return true;
    return text.length < 80 && (text.includes(expected) || expected.includes(text));
  }

  /**
   * Thymer journal titles: h1.title.id--h1 (view) or input#h1-edit.heading-title (edit).
   * Parent row is usually a flex container inside .id--h1-area / .panel-body.
   */
  _findJournalTitleEl(container, record, panelEl) {
    const expected = String(record?.getName?.() || '').trim();
    const scopes = this._getPanelTitleScopes(panelEl, container);
    if (!scopes.length) return null;

    const thymerSelectors = [
      'h1.title.id--h1',
      'h1.id--h1',
      '.id--h1-area h1.title',
      'input#h1-edit.heading-title',
      'input.heading-title',
      'h1.title',
      'h1',
    ];

    for (const sel of thymerSelectors) {
      const found = [];
      for (const scope of scopes) {
        try {
          found.push(...scope.querySelectorAll(sel));
        } catch (_) {}
      }
      const pick = this._pickBestTitleCandidate(found, expected);
      if (pick) return pick;
    }
    return null;
  }

  _findTitleMountParent(titleEl) {
    if (!titleEl?.parentElement) return null;
    const parent = titleEl.parentElement;
    try {
      if (parent.closest?.('.id--h1-area') || parent.querySelector?.('h1.id--h1, input#h1-edit')) {
        return parent;
      }
    } catch (_) {}
    return parent;
  }

  _handlePanel(panel) {
    const panelId = panel?.getId?.();
    if (!panelId) return;
    const panelEl = panel?.getElement?.();
    const record = panel?.getActiveRecord?.();
    if (!this._isJournalRecord(record, panelEl)) {
      this._disposePanel(panelId);
      return;
    }
    const container = this._findContainer(panelEl);
    if (!panelEl) return;

    let state = this._panelStates.get(panelId);
    if (!state) {
      state = {
        panelId,
        panel,
        container,
        titleEl: null,
        titleCluster: null,
        titleObserver: null,
        titleAnchorObserver: null,
        journalDate: null,
        journalDateKey: null,
      };
      this._panelStates.set(panelId, state);
    }
    state.panel = panel;
    state.container = container || panelEl;
    const nextKey = wmDateKey(wmJournalDateFromRecord(record) || new Date());
    if (state.journalDateKey !== nextKey) state._titleTries = 0;
    state.journalDate = wmJournalDateFromRecord(record) || new Date();
    // Same journal day + healthy title cluster → no remount/repaint.
    // Prior "fix" gated this on __dawnIsUiTyping; property first-save blurs
    // the field so that guard misses and remounts still steal focus. Do not
    // require typing detection for the common same-day path.
    if (state.journalDateKey === nextKey && state.titleCluster?.isConnected) {
      const titleOk =
        state.titleEl?.isConnected &&
        state.titleCluster.nextElementSibling === state.titleEl;
      if (titleOk) {
        this._ensureTitleAnchorObserver(state, panelEl, record);
        return;
      }
    }
    state.journalDateKey = nextKey;

    this._mountTitleCluster(state, record, panelEl);
    if (!state.titleCluster) this._scheduleTitleRetry(state);
  }

  _scheduleTitleRetry(state) {
    if (!state || (state._titleTries || 0) >= 4) return;
    state._titleTries = (state._titleTries || 0) + 1;
    const wait = 140 * state._titleTries;
    setTimeout(() => {
      if (!this._panelStates.has(state.panelId)) return;
      const panel = state.panel;
      const rec = panel?.getActiveRecord?.();
      const el = panel?.getElement?.();
      if (!this._isJournalRecord(rec, el)) return;
      this._mountTitleCluster(state, rec, el);
      if (!state.titleCluster) this._scheduleTitleRetry(state);
    }, wait);
  }

  _ensureTitleAnchorObserver(state, panelEl, record) {
    if (!state || state.titleAnchorObserver) return;
    const panelRoot = panelEl?.closest?.('.panel') || panelEl;
    if (!panelRoot) return;

    let syncTimer = null;
    const sync = () => {
      if (!this._panelStates.has(state.panelId)) return;
      if (globalThis.__dawnIsUiTyping?.()) return;
      const activeRecord = state.panel?.getActiveRecord?.();
      if (!this._isJournalRecord(activeRecord, panelRoot)) return;

      let titleEl = state.titleEl;
      if (!titleEl?.isConnected) {
        titleEl = this._findJournalTitleEl(state.container, activeRecord, panelRoot);
        state.titleEl = titleEl;
      }
      if (!titleEl) return;

      const clusterOk =
        state.titleCluster?.isConnected && state.titleCluster.nextElementSibling === titleEl;
      if (clusterOk) return;
      this._mountTitleCluster(state, activeRecord, panelRoot);
    };

    const scheduleSync = () => {
      if (syncTimer) clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        syncTimer = null;
        sync();
      }, 160);
    };

    state.titleAnchorObserver = new MutationObserver(() => {
      scheduleSync();
    });
    // Never fall back to panelRoot — property edits mutate the panel body and
    // would retrigger title remounts (focus steal). Title chrome only.
    const observeRoot =
      panelRoot.querySelector?.('.id--h1-area') ||
      panelRoot.querySelector?.('.panel-heading') ||
      panelRoot.querySelector?.('.panel-bar') ||
      state.titleEl?.parentElement ||
      null;
    if (!observeRoot) return;
    try {
      state.titleAnchorObserver.observe(observeRoot, { childList: true, subtree: true });
    } catch (_) {
      try {
        state.titleAnchorObserver.disconnect();
      } catch (_) {}
      state.titleAnchorObserver = null;
      return;
    }
    sync();
  }

  _mountTitleCluster(state, record, panelEl) {
    const container = state.container;
    const titleEl = this._findJournalTitleEl(container, record, panelEl || state.panel?.getElement?.());
    if (!titleEl) {
      return;
    }
    state.titleEl = titleEl;

    let cluster = state.titleCluster;
    if (!cluster || !cluster.isConnected || cluster.nextElementSibling !== titleEl) {
      if (cluster && cluster.isConnected) {
        try {
          cluster.remove();
        } catch (_) {}
      }
      cluster = document.createElement('button');
      cluster.type = 'button';
      cluster.className = 'wm-title-cluster button-none';
      cluster.setAttribute('aria-label', 'Weather and moon for this journal day');
      cluster.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        this._togglePopover('title', cluster, state.journalDateKey);
      });
      state.titleCluster = cluster;

      const parent = this._findTitleMountParent(titleEl);
      if (parent) {
        parent.classList.add('wm-title-row');
        parent.insertBefore(cluster, titleEl);
      } else {
        titleEl.insertAdjacentElement('beforebegin', cluster);
      }
    }

    const cached = this._cachedBundleForDate(state.journalDateKey);
    this._renderTitleCluster(state, cached || null);
    if (!cached && this._hasLocationForDate(state.journalDateKey)) {
      this._wmOnDemand('wm:title-' + state.journalDateKey, () => this._refreshPanelTitle(state));
    }
  }

  _renderTitleCluster(state, bundle) {
    const cluster = state.titleCluster;
    if (!cluster) return;
    const date = state.journalDate || new Date();
    const moon = wmMoonPhaseForDate(date);
    const moonHtml = wmMoonEmojiHtml(moon.phase, 22);
    let weatherHtml;
    if (!this._hasLocationForDate(state.journalDateKey)) {
      weatherHtml = wmWeatherIconHtml('cloud', 26);
      cluster.classList.add('wm-title-cluster--muted');
    } else if (!bundle) {
      weatherHtml = wmWeatherIconHtml('partly', 26);
      cluster.classList.add('wm-title-cluster--loading');
    } else {
      weatherHtml = wmWeatherIconHtml(bundle.kind, 26);
      cluster.classList.remove('wm-title-cluster--muted', 'wm-title-cluster--loading');
    }
    cluster.innerHTML =
      `<span class="wm-title-diagonal">` +
      `<span class="wm-title-weather">${weatherHtml}</span>` +
      `<span class="wm-title-slash" aria-hidden="true"></span>` +
      `<span class="wm-title-moon">${moonHtml}</span>` +
      `</span>`;
    const sunTip = bundle ? wmSunLine(bundle.sunrise, bundle.sunset) : '';
    const precipTip = bundle ? wmFormatPrecipPct(bundle.precip) : '';
    const timingTip =
      bundle?.timing && state.journalDateKey === wmTodayKey()
        ? bundle.timing.charAt(0).toUpperCase() + bundle.timing.slice(1)
        : '';
    const locName = this._resolveLocationForDate(state.journalDateKey)?.name;
    const locTip = locName ? ` · ${locName}` : '';
    const tip = bundle
      ? `${bundle.label} · ${wmFormatTemp(bundle.hi, this._settings.units)} / ${wmFormatTemp(bundle.lo, this._settings.units)}${precipTip ? ` · ${precipTip}` : ''}${sunTip ? ` · ${sunTip}` : ''}${timingTip ? ` · ${timingTip}` : ''}${locTip} · ${moon.name}`
      : 'Weather & Moon — configure in command palette';
    cluster.title = tip;
  }

  async _refreshPanelTitle(state) {
    if (!state?.journalDateKey || !state.titleCluster) return;
    if (!this._hasLocationForDate(state.journalDateKey)) {
      this._renderTitleCluster(state, null);
      return;
    }
    if (state._titleFetchKey === state.journalDateKey && state._titleFetchInflight) {
      return state._titleFetchInflight;
    }
    try {
      if (typeof globalThis.thymerExtInMobileLoadGrace === 'function' && globalThis.thymerExtInMobileLoadGrace()) {
        setTimeout(() => this._refreshPanelTitle(state), 3000);
        return;
      }
    } catch (_) {}
    this._maybeAutoPinDay(state.journalDateKey);
    state._titleFetchKey = state.journalDateKey;
    const p = (async () => {
      let bundle = null;
      try {
        bundle = await this._fetchWeatherBundle(state.journalDateKey);
      } catch (e) {
        console.warn('[Weather & Moon] journal date fetch', e);
      }
      if (!this._panelStates.has(state.panelId)) return;
      if (state.journalDateKey !== state._titleFetchKey) return;
      this._renderTitleCluster(state, bundle);
    })();
    state._titleFetchInflight = p;
    try {
      await p;
    } finally {
      if (state._titleFetchInflight === p) state._titleFetchInflight = null;
    }
    return p;
  }

  _disposePanel(panelId) {
    if (!panelId) return;
    const state = this._panelStates.get(panelId);
    if (!state) return;
    try {
      state.titleObserver?.disconnect();
    } catch (_) {}
    try {
      state.titleAnchorObserver?.disconnect();
    } catch (_) {}
    try {
      state.titleCluster?.remove();
    } catch (_) {}
    try {
      state.titleEl?.parentElement?.classList?.remove?.('wm-title-row');
    } catch (_) {}
    this._panelStates.delete(panelId);
  }

  // ─── Popover (DSS-style) ───────────────────────────────────────────────────

  _injectCss() {
    if (this._cssInjected) return;
    this._cssInjected = true;
    try {
      this.ui.injectCSS(`
        .wm-title-row .wm-title-cluster {
          margin-right: 4px;
        }
        .wm-title-cluster {
          display: inline-flex !important;
          flex-shrink: 0;
          cursor: pointer;
          color: var(--text-secondary, color-mix(in srgb, CanvasText 78%, Canvas));
          opacity: 0.92;
          padding: 1px 2px;
          border-radius: 6px;
          line-height: 0;
          vertical-align: middle;
          transition: opacity 0.12s ease, color 0.12s ease;
          position: relative;
          z-index: 2;
        }
        .id--h1-area .wm-title-cluster,
        .panel-body .wm-title-cluster,
        .panel-bar .wm-title-cluster {
          align-self: center;
        }
        .wm-title-cluster:hover {
          opacity: 1;
          color: CanvasText;
          background: color-mix(in srgb, CanvasText 6%, transparent);
        }
        .wm-title-cluster--loading { opacity: 0.55; }
        .wm-title-cluster--muted { opacity: 0.45; }
        .wm-title-diagonal {
          position: relative;
          display: block;
          width: 38px;
          height: 38px;
          flex-shrink: 0;
        }
        .wm-title-weather,
        .wm-title-moon {
          position: absolute;
          display: inline-flex;
          align-items: center;
          line-height: 0;
        }
        .wm-title-weather { top: 0; left: 0; }
        .wm-title-moon { bottom: 0; right: 0; opacity: 0.9; }
        .wm-title-weather svg,
        .wm-title-moon svg {
          display: block;
          overflow: visible;
        }
        .wm-title-slash {
          position: absolute;
          inset: 3px;
          pointer-events: none;
        }
        .wm-title-slash::after {
          content: '';
          position: absolute;
          left: 50%;
          top: 50%;
          width: 130%;
          height: 1px;
          background: currentColor;
          opacity: 0.24;
          transform: translate(-50%, -50%) rotate(-42deg);
        }

        .wm-status-readout {
          display: inline-flex;
          align-items: baseline;
          gap: 0;
          font-size: 11px;
          letter-spacing: 0.01em;
          font-variant-numeric: tabular-nums;
          cursor: pointer;
          white-space: nowrap;
          max-width: min(52vw, 420px);
          overflow: hidden;
          text-overflow: ellipsis;
          color: var(--text-secondary, color-mix(in srgb, CanvasText 82%, Canvas));
        }
        .wm-status-readout--muted { opacity: 0.55; }
        .wm-status-temps { font-weight: 600; }
        .wm-status-sep { opacity: 0.5; font-weight: 400; }
        .wm-status-dot { opacity: 0.58; margin: 0 0.4em; font-weight: 600; }
        .wm-status-cond { font-weight: 450; }
        .wm-status-moon { opacity: 0.78; }

        .wm-shell {
          position: fixed;
          z-index: 200000;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          max-width: min(420px, calc(100vw - 16px));
          pointer-events: auto;
          border-radius: 12px;
          border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
          background: color-mix(in srgb, Canvas 78%, transparent);
          color: CanvasText;
          -webkit-backdrop-filter: blur(20px) saturate(1.3);
          backdrop-filter: blur(20px) saturate(1.3);
          box-shadow:
            0 0 0 1px color-mix(in srgb, CanvasText 8%, transparent),
            0 -6px 28px color-mix(in srgb, CanvasText 18%, transparent),
            0 0 22px color-mix(in srgb, Highlight 24%, transparent);
          overflow: hidden;
          isolation: isolate;
        }
        .wm-card {
          width: 100%;
          --wm-text-indent: 32px;
          flex: 0 1 auto;
          min-height: 0;
          overflow-x: hidden;
          overflow-y: visible;
          padding: 10px 12px 8px;
          border: none;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
        }
        .wm-shell--title .wm-card {
          --wm-text-indent: 32px;
        }
        .wm-shell--title.wm-shell--popover-expanded .wm-card,
        .wm-shell--status .wm-card {
          overflow-y: auto;
          overscroll-behavior: contain;
        }
        .wm-weather-emoji,
        .wm-sun-emoji {
          display: inline-block;
          vertical-align: middle;
        }
        .wm-head-ico .wm-weather-emoji { margin-top: 1px; }
        .wm-head {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin-bottom: 4px;
          --wm-text-indent: 32px;
        }
        .wm-head-ico { line-height: 0; flex-shrink: 0; color: color-mix(in srgb, CanvasText 88%, Canvas); width: 22px; }
        .wm-head-text { min-width: 0; flex: 1; }
        .wm-head-title { font-weight: 650; font-size: 14px; line-height: 1.25; }
        .wm-head-sub { font-size: 11px; opacity: 0.72; margin-top: 2px; }
        .wm-head-now { opacity: 0.72; font-weight: 450; }
        .wm-detail-line {
          padding-left: var(--wm-text-indent, 32px);
          font-size: 11px;
          margin: 0 0 6px;
        }
        .wm-timing {
          opacity: 0.82;
          font-style: italic;
        }
        .wm-sun-line {
          opacity: 0.78;
          font-variant-numeric: tabular-nums;
          letter-spacing: 0.01em;
        }
        .wm-sun-times {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }
        .wm-sun-slot {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .wm-sun-ico { opacity: 0.82; flex-shrink: 0; line-height: 0; }
        .wm-section-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.55;
          margin: 10px 0 6px;
        }
        .wm-hourly {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          overflow-y: hidden;
          overscroll-behavior-x: contain;
          padding-bottom: 2px;
          margin-bottom: 2px;
        }
        .wm-hour {
          flex: 0 0 auto;
          text-align: center;
          font-size: 10px;
          opacity: 0.88;
          min-width: 46px;
        }
        .wm-hour-t { font-variant-numeric: tabular-nums; margin-top: 3px; }
        .wm-hour-temp { font-weight: 600; }
        .wm-hour-meta {
          font-size: 9px;
          opacity: 0.62;
          margin-top: 2px;
          font-variant-numeric: tabular-nums;
          line-height: 1.2;
        }
        .wm-status-meta { font-variant-numeric: tabular-nums; white-space: nowrap; }
        .wm-daily-row {
          display: grid;
          grid-template-columns: 2.2em 1fr auto auto auto;
          gap: 6px;
          align-items: center;
          font-size: 11px;
          padding: 3px 0;
        }
        .wm-daily-precip { opacity: 0.62; font-variant-numeric: tabular-nums; text-align: right; min-width: 2.2em; }
        .wm-daily-row + .wm-daily-row { border-top: 1px solid color-mix(in srgb, CanvasText 8%, transparent); }
        .wm-daily-strip {
          display: flex;
          gap: 6px;
          overflow-x: auto;
          overflow-y: hidden;
          overscroll-behavior-x: contain;
          padding: 2px 0 6px;
          scrollbar-width: thin;
        }
        .wm-daily-tile {
          flex: 0 0 auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 52px;
          padding: 8px 6px;
          border-radius: 10px;
          border: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
          background: color-mix(in srgb, CanvasText 4%, transparent);
          color: inherit;
          cursor: pointer;
          font: inherit;
          font-size: 10px;
          font-variant-numeric: tabular-nums;
        }
        .wm-daily-tile:hover {
          background: color-mix(in srgb, CanvasText 8%, transparent);
        }
        .wm-daily-tile.is-active {
          border-color: color-mix(in srgb, Highlight 50%, transparent);
          background: color-mix(in srgb, Highlight 14%, transparent);
        }
        .wm-daily-tile-dow {
          font-weight: 650;
          font-size: 10px;
          opacity: 0.85;
        }
        .wm-daily-tile-ico { line-height: 0; }
        .wm-daily-tile-hi { font-weight: 600; font-size: 11px; }
        .wm-daily-tile-lo { opacity: 0.55; font-size: 10px; }
        .wm-daily-detail {
          font-size: 10px;
          opacity: 0.72;
          margin-top: -2px;
          margin-bottom: 6px;
          padding-left: 0 !important;
        }
        .wm-shell--below { flex-direction: column; }
        .wm-shell--below .wm-caret {
          order: -1;
          transform: rotate(180deg);
          margin-top: 0;
          margin-bottom: -1px;
        }
        .wm-chart-pane { min-height: 96px; }
        .wm-moon-row {
          display: flex;
          align-items: center;
          gap: 6px;
          opacity: 0.88;
        }
        .wm-moon-emoji { display: inline-block; vertical-align: middle; line-height: 1; }
        .wm-metrics { opacity: 0.78; font-variant-numeric: tabular-nums; }
        .wm-blurb { opacity: 0.88; line-height: 1.35; }
        .wm-blurb--compact { font-style: italic; opacity: 0.82; }
        .wm-blurb-secondary { opacity: 0.72; font-size: 10px; }
        .wm-expand-section {
          display: none;
          flex: 0 1 auto;
          min-height: 0;
          overflow: hidden;
          padding: 2px 12px 6px;
          background: transparent;
        }
        .wm-shell--popover-expanded .wm-card {
          border-bottom: 1px solid color-mix(in srgb, CanvasText 10%, transparent);
        }
        .wm-shell--popover-expanded .wm-expand-section,
        .wm-shell--status .wm-expand-section { display: block; }
        .wm-shell--status .wm-expand-btn { display: none; }
        .wm-expand-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          margin: 0;
          padding: 0 0 2px;
          border: none;
          background: transparent;
          color: color-mix(in srgb, CanvasText 70%, Canvas);
          cursor: pointer;
          font: inherit;
          line-height: 1;
          flex-shrink: 0;
        }
        .wm-expand-btn:hover { color: CanvasText; }
        .wm-expand-chevron {
          display: flex;
          align-items: center;
          justify-content: center;
          line-height: 0;
          opacity: 0.82;
        }
        .wm-expand-chevron-svg {
          display: block;
          overflow: visible;
        }
        .wm-charts { margin: 8px 0 4px; }
        .wm-chart-tabs { display: flex; gap: 4px; margin-bottom: 6px; }
        .wm-chart-tab {
          flex: 1;
          padding: 4px 6px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font: inherit;
          font-size: 10px;
          opacity: 0.65;
          background: color-mix(in srgb, CanvasText 6%, transparent);
          color: inherit;
        }
        .wm-chart-tab.is-active {
          opacity: 1;
          font-weight: 650;
          background: color-mix(in srgb, Highlight 16%, transparent);
        }
        .wm-chart-pane {
          border-radius: 8px;
          background: color-mix(in srgb, CanvasText 4%, transparent);
          padding: 4px 2px;
        }
        .wm-chart-svg { display: block; color: CanvasText; }
        .wm-caret {
          display: block;
          margin-top: -1px;
          flex-shrink: 0;
          filter: drop-shadow(0 2px 6px color-mix(in srgb, CanvasText 22%, transparent));
        }
        .wm-caret-path {
          fill: color-mix(in srgb, Canvas 76%, transparent);
          stroke: color-mix(in srgb, CanvasText 28%, transparent);
          stroke-width: 0.6;
        }
        .wm-config-overlay {
          position: fixed; inset: 0; z-index: 300000;
          background: rgba(0,0,0,0.45);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
        }
        .wm-config-card {
          width: min(420px, 94vw);
          padding: 16px 18px;
          border-radius: 12px;
          background: color-mix(in srgb, Canvas 92%, transparent);
          color: CanvasText;
          border: 1px solid color-mix(in srgb, CanvasText 12%, transparent);
          box-shadow: 0 20px 50px rgba(0,0,0,0.35);
        }
        .wm-config-title { font-weight: 700; font-size: 15px; margin-bottom: 10px; }
        .wm-config-row { margin-bottom: 10px; }
        .wm-config-row label { display: block; font-size: 11px; opacity: 0.7; margin-bottom: 4px; }
        .wm-config-input {
          width: 100%; box-sizing: border-box;
          padding: 7px 10px; border-radius: 8px;
          border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
          background: color-mix(in srgb, Canvas 88%, transparent);
          color: inherit; font: inherit;
        }
        .wm-config-results { max-height: 140px; overflow-y: auto; margin-top: 6px; }
        .wm-config-result {
          display: block; width: 100%; text-align: left;
          padding: 6px 8px; border: none; background: transparent;
          color: inherit; cursor: pointer; border-radius: 6px; font: inherit; font-size: 12px;
        }
        .wm-config-result:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }
        .wm-config-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
        .wm-btn {
          padding: 6px 12px; border-radius: 8px; border: none; cursor: pointer; font: inherit; font-size: 12px;
        }
        .wm-btn-primary { background: color-mix(in srgb, Highlight 70%, Canvas); color: Canvas; }
        .wm-btn-ghost { background: transparent; color: inherit; opacity: 0.8; }
        .wm-config-sub {
          font-size: 11px;
          opacity: 0.72;
          margin: -4px 0 10px;
          line-height: 1.35;
        }
        .wm-config-section-label {
          font-size: 10px;
          font-weight: 650;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          opacity: 0.55;
          margin: 8px 0 6px;
        }
        .wm-config-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-bottom: 4px;
        }
        .wm-config-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          max-width: 100%;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid color-mix(in srgb, CanvasText 14%, transparent);
          background: color-mix(in srgb, CanvasText 5%, transparent);
          color: inherit;
          cursor: pointer;
          font: inherit;
          font-size: 11px;
          line-height: 1.2;
        }
        .wm-config-chip:hover {
          background: color-mix(in srgb, CanvasText 10%, transparent);
        }
        .wm-config-chip.is-selected {
          border-color: color-mix(in srgb, Highlight 45%, transparent);
          background: color-mix(in srgb, Highlight 12%, transparent);
        }
        .wm-config-chip-star {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 0 2px;
          font: inherit;
          font-size: 11px;
          line-height: 1;
          opacity: 0.55;
        }
        .wm-config-chip-star.is-pinned { opacity: 1; }
      `);
    } catch (_) {}
  }

  _togglePopover(source, anchorEl, dateKey) {
    const dk = dateKey || wmTodayKey();
    const canShow =
      source === 'status' ? this._hasLocation() : this._hasLocationForDate(dk);
    if (!canShow) {
      if (source === 'title') {
        this._openLocationDialog({ mode: 'journalDay', dateKey: dk });
      } else {
        this._openConfigureDialog();
      }
      return;
    }
    if (this._popoverEl && this._popoverSource === source) {
      this._closePopover();
      return;
    }
    this._openPopover(source, anchorEl, dateKey);
  }

  async _openPopover(source, anchorEl, dateKey) {
    this._closePopover();
    if (!anchorEl?.isConnected) return;
    try {
      if (document.querySelector('.tal-overlay')) return;
    } catch (_) {}

    const targetKey = dateKey || wmTodayKey();
    this._popoverContextDate = targetKey;

    let bundle = null;
    const statusExpanded = source === 'status';
    const useGlobalWx = source === 'status';
    try {
      bundle = await this._fetchWeatherBundle(targetKey, { useGlobal: useGlobalWx });
      if (bundle && (statusExpanded || source === 'title') && targetKey === wmTodayKey()) {
        bundle = await this._mergeTodayDashboard(bundle, targetKey, useGlobalWx);
      } else if (statusExpanded && targetKey === wmTodayKey()) {
        bundle = await this._ensureTodayDashboard(bundle, targetKey, { useGlobal: useGlobalWx });
      }
      if (bundle && statusExpanded) {
        const todayFull =
          targetKey === wmTodayKey() && useGlobalWx
            ? bundle
            : await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: true });
        if (todayFull) {
          if (todayFull.daily?.length) bundle.daily = todayFull.daily;
          if (todayFull.hourly?.length) bundle.hourly = todayFull.hourly;
          if (todayFull.hourlyChart?.length) bundle.hourlyChart = todayFull.hourlyChart;
          if (todayFull.timing) bundle.timing = todayFull.timing;
          if (todayFull.humidity != null) bundle.humidity = todayFull.humidity;
          if (todayFull.wind != null) bundle.wind = todayFull.wind;
          if (todayFull.feelsLike != null) bundle.feelsLike = todayFull.feelsLike;
          if (todayFull.precipSum != null) bundle.precipSum = todayFull.precipSum;
        }
      } else if (bundle && targetKey === wmTodayKey() && source === 'title') {
        const todayFull = await this._fetchWeatherBundle(wmTodayKey(), { useGlobal: useGlobalWx });
        if (todayFull?.timing) bundle.timing = todayFull.timing;
        if (todayFull?.humidity != null) bundle.humidity = todayFull.humidity;
        if (todayFull?.wind != null) bundle.wind = todayFull.wind;
        if (todayFull?.feelsLike != null) bundle.feelsLike = todayFull.feelsLike;
      }
    } catch (e) {
      console.warn('[Weather & Moon] popover fetch', e);
    }

    const dateForMoon = targetKey === wmTodayKey() ? new Date() : new Date(targetKey + 'T12:00:00');
    const moon = wmMoonPhaseForDate(dateForMoon);

    const shell = document.createElement('div');
    shell.className =
      source === 'title' ? 'wm-shell wm-shell--title wm-shell--below' : 'wm-shell wm-shell--status wm-shell--above';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-label', 'Weather forecast');

    const card = document.createElement('div');
    card.className = 'wm-card';
    const units = this._settings.units;

    if (!bundle) {
      card.innerHTML = `<div style="padding:8px;opacity:0.75;font-size:12px;">Could not load weather.</div>`;
    } else {
      const isToday = targetKey === wmTodayKey();
      const hi = wmFormatTemp(bundle.hi, units);
      const lo = wmFormatTemp(bundle.lo, units);
      const resolvedLoc = useGlobalWx ? this._globalLocation() : this._resolveLocationForDate(targetKey);
      const loc = this._escapeHtml(resolvedLoc?.name || 'Location');
      const sunTimesHtml = wmSunTimesHtml(bundle.sunrise, bundle.sunset);
      const precipBit = wmFormatPrecipPct(bundle.precip, true);
      const condHtml = this._popoverHeadConditionHtml(bundle, isToday, units);
      const headIcon = this._popoverHeadIconKind(bundle, isToday);
      const head = document.createElement('div');
      head.className = 'wm-head';
      head.innerHTML =
        `<span class="wm-head-ico">${wmWeatherIconHtml(headIcon, 22)}</span>` +
        `<div class="wm-head-text">` +
        `<div class="wm-head-title">${hi} / ${lo} · ${condHtml}${precipBit ? ` · ${precipBit}` : ''}</div>` +
        `<div class="wm-head-sub">${loc} · ${wmFormatDisplayDate(targetKey)}</div>` +
        `</div>`;
      card.appendChild(head);

      if (sunTimesHtml) {
        const sun = document.createElement('div');
        sun.className = 'wm-sun-line wm-detail-line';
        sun.innerHTML = sunTimesHtml;
        card.appendChild(sun);
      }

      if (isToday && !bundle.isHistorical) {
        this._appendMetricsRow(card, bundle, units);
      }

      const insightOpts = {
        compact: !statusExpanded,
        hourly: bundle.hourlyChart || bundle.hourly,
        daily: bundle.daily,
        todayKey: wmTodayKey(),
      };
      this._appendInsights(card, bundle, units, insightOpts);

      this._appendPopoverMoon(card, moon);
      this._appendPopoverHourly(card, bundle, units);
    }

    const hasExpandable =
      bundle &&
      !bundle.isHistorical &&
      ((bundle.hourlyChart || bundle.hourly)?.length || bundle.daily?.length);
    const expandHost = document.createElement('div');
    expandHost.className = 'wm-expand-section';

    shell.appendChild(card);
    if (hasExpandable) {
      shell.appendChild(expandHost);
      if (statusExpanded) {
        shell.classList.add('wm-shell--popover-expanded');
        this._fillExpandSection(expandHost, bundle, units, useGlobalWx);
      } else {
        this._appendExpandToggle(shell, card, expandHost, bundle, units, useGlobalWx, () => reposition());
      }
    }

    const NS = 'http://www.w3.org/2000/svg';
    const caret = document.createElementNS(NS, 'svg');
    caret.classList.add('wm-caret');
    caret.setAttribute('width', '20');
    caret.setAttribute('height', '9');
    caret.setAttribute('viewBox', '0 0 20 9');
    caret.setAttribute('aria-hidden', 'true');
    const caretPath = document.createElementNS(NS, 'path');
    caretPath.classList.add('wm-caret-path');
    caretPath.setAttribute('d', 'M0 1 L10 9 L20 1 Z');
    caret.appendChild(caretPath);
    shell.appendChild(caret);

    document.body.appendChild(shell);
    this._popoverEl = shell;
    this._popoverSource = source;

    let reposition = () => {};
    const position = () => {
      if (!this._popoverEl || !anchorEl.isConnected) return;
      const r = anchorEl.getBoundingClientRect();
      const gap = 6;
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      shell.style.visibility = 'hidden';
      shell.style.left = '0';
      shell.style.top = '0';
      shell.style.bottom = 'auto';
      const sw = shell.offsetWidth;
      const sh = shell.offsetHeight;
      shell.style.visibility = '';
      let left = r.left + r.width / 2 - sw / 2;
      left = Math.max(margin, Math.min(left, vw - sw - margin));

      const spaceAbove = r.top - margin;
      const spaceBelow = vh - r.bottom - margin;
      let placeBelow = source === 'title';
      if (source === 'status') placeBelow = false;
      if (placeBelow && spaceBelow < sh + gap && spaceAbove > spaceBelow) placeBelow = false;
      if (!placeBelow && spaceAbove < sh + gap && spaceBelow > spaceAbove) placeBelow = true;

      shell.classList.toggle('wm-shell--below', placeBelow);
      shell.classList.toggle('wm-shell--above', !placeBelow);

      if (placeBelow) {
        shell.style.top = `${Math.round(r.bottom + gap)}px`;
        shell.style.bottom = 'auto';
      } else {
        shell.style.top = 'auto';
        shell.style.bottom = `${Math.round(vh - r.top + gap)}px`;
      }
      shell.style.left = `${Math.round(left)}px`;

      const expanded = shell.classList.contains('wm-shell--popover-expanded');
      const avail = placeBelow ? spaceBelow : spaceAbove;
      if (expanded || source === 'status') {
        const chevronH = source === 'title' && hasExpandable ? 22 : 0;
        const maxH = Math.min(560, Math.max(140, avail - gap - chevronH - 12));
        card.style.maxHeight = `${maxH}px`;
        card.style.overflowY = 'auto';
      } else {
        card.style.maxHeight = '';
        card.style.overflowY = 'visible';
      }
      card.style.overflowX = 'hidden';

      const anchorCenter = r.left + r.width / 2;
      const caretW = 20;
      const caretLeft = Math.max(8, Math.min(anchorCenter - left - caretW / 2, sw - caretW - 8));
      caret.style.marginLeft = `${Math.round(caretLeft)}px`;
    };
    reposition = position;

    position();

    this._boundDocMouse = (ev) => {
      const t = ev.target;
      if (!this._popoverEl) return;
      if (this._popoverEl.contains(t)) return;
      if (anchorEl.contains(t)) return;
      this._closePopover();
    };
    this._boundDocClick = this._boundDocMouse;
    this._boundDocKey = (ev) => {
      if (ev.key === 'Escape') this._closePopover();
    };
    let posRaf = null;
    const positionSoon = () => {
      if (posRaf) return;
      posRaf = requestAnimationFrame(() => {
        posRaf = null;
        position();
      });
    };
    this._boundWinResize = () => positionSoon();
    this._boundWinScroll = () => positionSoon();

    setTimeout(() => {
      document.addEventListener('mousedown', this._boundDocMouse, true);
      document.addEventListener('click', this._boundDocClick, true);
      document.addEventListener('keydown', this._boundDocKey, true);
      window.addEventListener('resize', this._boundWinResize);
      window.addEventListener('scroll', this._boundWinScroll, { capture: true, passive: true });
    }, 0);

    this._startLockObserver();
  }

  _startLockObserver() {
    this._stopLockObserver();
    try {
      if (document.querySelector('.tal-overlay')) {
        this._closePopover();
        return;
      }
      this._lockObserver = new MutationObserver(() => {
        if (document.querySelector('.tal-overlay')) this._closePopover();
      });
      this._lockObserver.observe(document.body, { childList: true });
    } catch (_) {}
  }

  _stopLockObserver() {
    if (this._lockObserver) {
      try {
        this._lockObserver.disconnect();
      } catch (_) {}
      this._lockObserver = null;
    }
  }

  _removeDocListeners() {
    this._stopLockObserver();
    if (this._boundDocMouse) {
      try {
        document.removeEventListener('mousedown', this._boundDocMouse, true);
      } catch (_) {}
      this._boundDocMouse = null;
    }
    if (this._boundDocClick) {
      try {
        document.removeEventListener('click', this._boundDocClick, true);
      } catch (_) {}
      this._boundDocClick = null;
    }
    if (this._boundDocKey) {
      try {
        document.removeEventListener('keydown', this._boundDocKey, true);
      } catch (_) {}
      this._boundDocKey = null;
    }
    if (this._boundWinResize) {
      try {
        window.removeEventListener('resize', this._boundWinResize);
      } catch (_) {}
      this._boundWinResize = null;
    }
    if (this._boundWinScroll) {
      try {
        window.removeEventListener('scroll', this._boundWinScroll, true);
      } catch (_) {}
      this._boundWinScroll = null;
    }
  }

  _closePopover() {
    this._removeDocListeners();
    try {
      this._popoverEl?.remove();
    } catch (_) {}
    this._popoverEl = null;
    this._popoverSource = null;
  }

  // ─── Settings UI ───────────────────────────────────────────────────────────

  _cmdChooseJournalDayLocation() {
    const st = this._getActiveJournalState();
    if (!st?.journalDateKey) {
      this.ui.addToaster?.({
        title: 'Open a journal page',
        message: 'Open the journal day you want, then run this command again.',
        dismissible: true,
        autoDestroyTime: 4200,
      });
      return;
    }
    this._openLocationDialog({ mode: 'journalDay', dateKey: st.journalDateKey });
  }

  _cmdApplyCurrentToJournalDay() {
    const st = this._getActiveJournalState();
    if (!st?.journalDateKey) {
      this.ui.addToaster?.({
        title: 'Open a journal page',
        message: 'Open the journal day you want, then run this command again.',
        dismissible: true,
        autoDestroyTime: 4200,
      });
      return;
    }
    if (!this._hasLocation()) {
      this.ui.addToaster?.({
        title: 'Set a default location first',
        message: 'Use Weather & Moon: Configure, then apply it to this journal day.',
        dismissible: true,
        autoDestroyTime: 4500,
      });
      return;
    }
    const loc = this._globalLocation();
    this._setDayPin(st.journalDateKey, loc);
    this._touchRecentCity(loc);
    this._refreshJournalPanel(st.journalDateKey);
    this.ui.addToaster?.({
      title: 'Journal location updated',
      message: `${wmFormatDisplayDate(st.journalDateKey)} → ${loc.name}`,
      dismissible: true,
      autoDestroyTime: 3200,
    });
  }

  _cmdClearJournalDayLocation() {
    const st = this._getActiveJournalState();
    if (!st?.journalDateKey) {
      this.ui.addToaster?.({
        title: 'Open a journal page',
        message: 'Open the journal day you want, then run this command again.',
        dismissible: true,
        autoDestroyTime: 4200,
      });
      return;
    }
    const hadPin = !!this._getDayPin(st.journalDateKey);
    this._clearDayPin(st.journalDateKey);
    this._refreshJournalPanel(st.journalDateKey);
    this.ui.addToaster?.({
      title: hadPin ? 'Override cleared' : 'Using default location',
      message: hadPin
        ? `${wmFormatDisplayDate(st.journalDateKey)} now follows your default location.`
        : `${wmFormatDisplayDate(st.journalDateKey)} already uses your default location.`,
      dismissible: true,
      autoDestroyTime: 3200,
    });
  }

  _openConfigureDialog() {
    this._openLocationDialog({ mode: 'global' });
  }

  _openLocationDialog({ mode = 'global', dateKey = null } = {}) {
    const existing = document.querySelector('.wm-config-overlay');
    if (existing) existing.remove();

    this._settings = this._loadSettingsLocal();
    const isJournalDay = mode === 'journalDay' && dateKey;
    const dk = isJournalDay ? dateKey : null;

    const overlay = document.createElement('div');
    overlay.className = 'wm-config-overlay';
    const card = document.createElement('div');
    card.className = 'wm-config-card';

    const title = document.createElement('div');
    title.className = 'wm-config-title';
    title.textContent = isJournalDay
      ? `Location for ${wmFormatDisplayDate(dk)}`
      : 'Weather & Moon';

    const subtitle = document.createElement('div');
    subtitle.className = 'wm-config-sub';
    if (isJournalDay) {
      const pin = this._getDayPin(dk);
      const global = this._globalLocation();
      if (pin) {
        subtitle.textContent = `${pin.name} for this day. Status bar still uses ${global?.name || 'your default'}.`;
      } else if (global) {
        subtitle.textContent = `Using default: ${global.name}. Pick a city to set this journal day separately.`;
      } else {
        subtitle.textContent = 'Pick a city for weather on this journal day.';
      }
    } else {
      subtitle.textContent = 'Default location for today, the status bar, and new journal days.';
    }

    const cityRow = document.createElement('div');
    cityRow.className = 'wm-config-row';
    cityRow.innerHTML = '<label>City search (Open-Meteo geocoding)</label>';
    const cityInput = document.createElement('input');
    cityInput.className = 'wm-config-input';
    cityInput.type = 'text';
    cityInput.placeholder = 'e.g. Brooklyn (city name only works best)';
    const initialLoc = isJournalDay ? this._getDayPin(dk) || this._globalLocation() : this._globalLocation();
    cityInput.value = initialLoc?.name || this._settings.locationName || '';
    cityRow.appendChild(cityInput);

    const chipsHost = document.createElement('div');

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'wm-btn wm-btn-primary';
    searchBtn.textContent = 'Search';
    searchBtn.style.marginTop = '6px';

    const results = document.createElement('div');
    results.className = 'wm-config-results';

    const unitsRow = document.createElement('div');
    unitsRow.className = 'wm-config-row';
    unitsRow.innerHTML = '<label>Temperature</label>';
    const unitsSel = document.createElement('select');
    unitsSel.className = 'wm-config-input';
    unitsSel.innerHTML =
      '<option value="fahrenheit">Fahrenheit (°F)</option><option value="celsius">Celsius (°C)</option>';
    unitsSel.value = this._settings.units === 'celsius' ? 'celsius' : 'fahrenheit';
    unitsRow.appendChild(unitsSel);
    if (isJournalDay) unitsRow.style.display = 'none';

    let picked = initialLoc ? wmNormalizeLoc(initialLoc) : null;

    const showPickedHint = () => {
      if (!picked?.name) return;
      results.innerHTML = '';
      const ok = document.createElement('div');
      ok.style.cssText = 'font-size:11px;opacity:0.75;padding:4px 0;';
      ok.textContent = `Selected: ${picked.name}`;
      results.appendChild(ok);
    };

    const selectLoc = (loc) => {
      picked = wmNormalizeLoc(loc);
      if (!picked) return;
      cityInput.value = picked.name;
      showPickedHint();
      renderCityChips();
    };

    const renderChipSection = (label, cities, showStar) => {
      const list = (cities || []).map(wmNormalizeLoc).filter(Boolean);
      if (!list.length) return null;
      const wrap = document.createElement('div');
      const lab = document.createElement('div');
      lab.className = 'wm-config-section-label';
      lab.textContent = label;
      wrap.appendChild(lab);
      const row = document.createElement('div');
      row.className = 'wm-config-chips';
      for (const loc of list) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'wm-config-chip';
        if (picked && wmLocKey(picked) === wmLocKey(loc)) chip.classList.add('is-selected');
        const name = loc.name.split(',')[0];
        chip.textContent = name.length > 22 ? `${name.slice(0, 20)}…` : name;
        chip.title = loc.name;
        chip.addEventListener('click', () => selectLoc(loc));
        if (showStar) {
          const star = document.createElement('button');
          star.type = 'button';
          star.className = 'wm-config-chip-star' + (this._isPinnedCity(loc) ? ' is-pinned' : '');
          star.textContent = '★';
          star.title = this._isPinnedCity(loc) ? 'Unpin' : 'Pin';
          star.addEventListener('click', (ev) => {
            ev.stopPropagation();
            this._togglePinnedCity(loc);
            renderCityChips();
          });
          chip.appendChild(star);
        }
        row.appendChild(chip);
      }
      wrap.appendChild(row);
      return wrap;
    };

    const renderCityChips = () => {
      chipsHost.innerHTML = '';
      const pinned = renderChipSection('Pinned cities', this._settings.pinnedCities, true);
      const recent = renderChipSection('Recent cities', this._settings.recentCities, true);
      if (pinned) chipsHost.appendChild(pinned);
      if (recent) chipsHost.appendChild(recent);
    };

    const renderResults = (items, hint) => {
      results.innerHTML = '';
      if (!items?.length) {
        results.textContent =
          hint || 'No results — try the city name only (e.g. Brooklyn instead of Brooklyn, NY).';
        return;
      }
      if (hint) {
        const note = document.createElement('div');
        note.style.cssText = 'font-size:10px;opacity:0.65;padding:0 0 6px;';
        note.textContent = hint;
        results.appendChild(note);
      }
      for (const it of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wm-config-result';
        const admin = [it.admin1, it.country].filter(Boolean).join(', ');
        btn.textContent = `${it.name}${admin ? ` — ${admin}` : ''}`;
        btn.addEventListener('click', () => selectLoc(wmLocationFromGeocodeResult(it)));
        results.appendChild(btn);
      }
    };

    renderCityChips();
    if (picked?.name) showPickedHint();

    const runSearch = async () => {
      const q = cityInput.value.trim();
      if (!q) return;
      searchBtn.disabled = true;
      searchBtn.textContent = 'Searching…';
      try {
        const { results: items, queryUsed } = await wmGeocodeSearch(q);
        const hint = queryUsed && queryUsed !== q ? `Showing results for “${queryUsed}”` : '';
        renderResults(items, items.length ? hint : null);
        if (items.length === 1) selectLoc(wmLocationFromGeocodeResult(items[0]));
      } catch (e) {
        results.textContent = 'Search failed — check network or try again.';
        console.warn('[Weather & Moon] geocode', e);
      } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = 'Search';
      }
    };

    searchBtn.addEventListener('click', () => {
      void runSearch();
    });
    cityInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        void runSearch();
      }
    });

    const actions = document.createElement('div');
    actions.className = 'wm-config-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wm-btn wm-btn-ghost';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => overlay.remove());

    let clearBtn = null;
    if (isJournalDay) {
      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'wm-btn wm-btn-ghost';
      clearBtn.textContent = 'Use default';
      clearBtn.addEventListener('click', () => {
        this._clearDayPin(dk);
        this._refreshJournalPanel(dk);
        overlay.remove();
        this.ui.addToaster?.({
          title: 'Override cleared',
          message: `${wmFormatDisplayDate(dk)} now follows your default location.`,
          dismissible: true,
          autoDestroyTime: 3200,
        });
      });
    }

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'wm-btn wm-btn-primary';
    save.textContent = isJournalDay ? 'Pin for this day' : 'Save';
    save.addEventListener('click', () => {
      void (async () => {
        save.disabled = true;
        save.textContent = 'Saving…';
        try {
          let loc = picked;
          const typed = cityInput.value.trim();
          if (!loc?.latitude && typed) {
            try {
              const { results: items } = await wmGeocodeSearch(typed);
              if (items.length === 1) loc = wmLocationFromGeocodeResult(items[0]);
              else if (items.length > 1) {
                renderResults(items, 'Multiple matches — pick one, then Save again.');
                this.ui.addToaster?.({
                  title: 'Select a city',
                  message: 'Multiple matches found — choose one from the list.',
                  dismissible: true,
                  autoDestroyTime: 4000,
                });
                return;
              }
            } catch (e) {
              console.warn('[Weather & Moon] save geocode', e);
            }
          }
          loc = wmNormalizeLoc(loc);
          if (!loc?.latitude) {
            results.textContent = typed
              ? 'No matching city found. Try the city name only (e.g. Brooklyn).'
              : 'Enter a city and search, or pick a result.';
            this.ui.addToaster?.({
              title: 'Pick a location',
              message: 'Search for a city and select a result (city name only often works best).',
              dismissible: true,
              autoDestroyTime: 4500,
            });
            return;
          }

          if (isJournalDay) {
            this._setDayPin(dk, loc);
            this._touchRecentCity(loc);
            this._refreshJournalPanel(dk);
            overlay.remove();
            this.ui.addToaster?.({
              title: 'Journal location saved',
              message: `${wmFormatDisplayDate(dk)} → ${loc.name}`,
              dismissible: true,
              autoDestroyTime: 3200,
            });
            return;
          }

          if (!loc?.latitude && !this._hasLocation()) {
            results.textContent = 'Enter a city and search, or pick a result.';
            return;
          }
          const next = {
            ...this._settings,
            units: unitsSel.value === 'celsius' ? 'celsius' : 'fahrenheit',
          };
          next.locationName = loc.name;
          next.latitude = loc.latitude;
          next.longitude = loc.longitude;
          next.timezone = loc.timezone || 'auto';
          await this._saveSettings(next);
          overlay.remove();
          this.ui.addToaster?.({
            title: 'Weather & Moon',
            message: `Saved — ${loc.name}`,
            dismissible: true,
            autoDestroyTime: 2800,
          });
        } finally {
          save.disabled = false;
          save.textContent = isJournalDay ? 'Pin for this day' : 'Save';
        }
      })();
    });

    actions.appendChild(cancel);
    if (clearBtn) actions.appendChild(clearBtn);
    actions.appendChild(save);

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(chipsHost);
    card.appendChild(cityRow);
    card.appendChild(searchBtn);
    card.appendChild(results);
    if (!isJournalDay) card.appendChild(unitsRow);
    card.appendChild(actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
    cityInput.focus();
  }

  openSettings() {
    this._openConfigureDialog();
  }
}
