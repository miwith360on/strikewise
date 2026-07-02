/**
 * blitzortungProvider.js
 * ------------------------------------------------------------
 * Blitzortung.org real-time lightning provider for Strikewise.
 *
 * - Connects to Blitzortung's public WebSocket firehose
 * - Decodes their LZW-compressed messages
 * - Filters strikes to a radius around the monitored point
 * - Keeps a rolling in-memory buffer (default 10 min) so the
 *   frontend history survives page refreshes
 * - Auto-reconnects and rotates across ws1 / ws7 / ws8
 *
 * License note: Blitzortung data is for NON-COMMERCIAL use.
 */

const WebSocket = require('ws');

const SERVERS = [
  'wss://ws1.blitzortung.org:443/',
  'wss://ws7.blitzortung.org:443/',
  'wss://ws8.blitzortung.org:443/',
];

const DEFAULTS = {
  radiusKm: 150,
  windowMs: 10 * 60_000,
  staleMs: 90_000,
  reconnectBaseMs: 2_000,
  reconnectMaxMs: 60_000,
};

function isFiniteLatitude(value) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isFiniteLongitude(value) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function decodeBlitzortung(data) {
  const dict = {};
  const src = data.split('');
  let currChar = src[0];
  let oldPhrase = currChar;
  const out = [currChar];
  let code = 256;

  for (let i = 1; i < src.length; i++) {
    const currCode = src[i].charCodeAt(0);
    let phrase;
    if (currCode < 256) {
      phrase = src[i];
    } else {
      phrase = dict[currCode] ? dict[currCode] : oldPhrase + currChar;
    }
    out.push(phrase);
    currChar = phrase.charAt(0);
    dict[code] = oldPhrase + currChar;
    code++;
    oldPhrase = phrase;
  }
  return out.join('');
}

const EARTH_R = 6371;
function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

class BlitzortungProvider {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };
    this.monitored = {
      lat: isFiniteLatitude(opts.lat) ? opts.lat : null,
      lon: isFiniteLongitude(opts.lon) ? opts.lon : null,
    };
    this.onStrike = opts.onStrike || null;

    this.ws = null;
    this.serverIdx = 0;
    this.reconnectMs = this.cfg.reconnectBaseMs;
    this.reconnectTimer = null;
    this.pruneTimer = null;
    this.watchdogTimer = null;
    this.stopped = true;

    this.buffer = [];
    this.lastMessageAt = 0;
    this.lastStrikeAt = 0;
    this.connectedAt = 0;
    this.totalReceived = 0;
    this.totalKept = 0;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this._connect();
    this.pruneTimer = setInterval(() => this._prune(), 15_000);
    this.watchdogTimer = setInterval(() => this._watchFeed(), 15_000);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pruneTimer);
    clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch (_) {
        // noop
      }
      this.ws = null;
    }
  }

  setMonitoredPoint(lat, lon) {
    if (!isFiniteLatitude(lat) || !isFiniteLongitude(lon)) {
      return;
    }

    this.monitored = { lat, lon };
    this.buffer = this.buffer.filter(
      (s) => distanceKm(lat, lon, s.lat, s.lon) <= this.cfg.radiusKm,
    );
    for (const s of this.buffer) {
      s.distanceKm = +distanceKm(lat, lon, s.lat, s.lon).toFixed(1);
    }
  }

  _watchFeed() {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.lastMessageAt) return;

    const silentForMs = Date.now() - this.lastMessageAt;
    if (silentForMs <= this.cfg.staleMs) return;

    try {
      this.ws.close();
    } catch (_) {
      // noop
    }
  }

  _connect() {
    if (this.stopped) return;

    const url = SERVERS[this.serverIdx % SERVERS.length];
    this.ws = new WebSocket(url, {
      headers: { Origin: 'https://www.blitzortung.org' },
    });

    this.ws.on('open', () => {
      this.connectedAt = Date.now();
      this.reconnectMs = this.cfg.reconnectBaseMs;
      this.ws.send(JSON.stringify({ a: 111 }));
      console.log(`[blitzortung] connected to ${url}`);
    });

    this.ws.on('message', (raw) => {
      this.lastMessageAt = Date.now();
      let payload;
      try {
        payload = JSON.parse(decodeBlitzortung(raw.toString()));
      } catch (_) {
        return;
      }
      this._handleStrike(payload);
    });

    const scheduleReconnect = (why) => {
      if (this.stopped) return;
      console.warn(`[blitzortung] ${why} - reconnecting in ${this.reconnectMs}ms`);
      this.serverIdx++;
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this._connect(), this.reconnectMs);
      this.reconnectMs = Math.min(this.reconnectMs * 2, this.cfg.reconnectMaxMs);
    };

    this.ws.on('close', () => scheduleReconnect('socket closed'));
    this.ws.on('error', (err) => {
      scheduleReconnect(`socket error: ${err.message}`);
      try {
        this.ws.close();
      } catch (_) {
        // noop
      }
    });
  }

  _handleStrike(p) {
    if (!p || typeof p !== 'object') return;
    if (typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
    if (!Number.isFinite(p.time) || p.time <= 0) return;
    if (!isFiniteLatitude(p.lat) || !isFiniteLongitude(p.lon)) return;
    this.totalReceived++;

    const { lat, lon } = this.monitored;
    if (lat == null || lon == null) return;

    const dKm = distanceKm(lat, lon, p.lat, p.lon);
    if (dKm > this.cfg.radiusKm) return;

    const strike = {
      id: `bo-${p.time}`,
      provider: 'blitzortung',
      timestamp: Math.round(p.time / 1e6),
      lat: p.lat,
      lon: p.lon,
      distanceKm: +dKm.toFixed(1),
      polarity: p.pol ?? null,
      peakCurrentKa: null,
      type: 'CG_OR_IC_UNKNOWN',
      stationCount: Array.isArray(p.sig) ? p.sig.length : null,
    };

    this.buffer.push(strike);
    this.lastStrikeAt = Date.now();
    this.totalKept++;

    if (this.onStrike) this.onStrike(strike);
  }

  _prune() {
    const cutoff = Date.now() - this.cfg.windowMs;
    let i = 0;
    while (i < this.buffer.length && this.buffer[i].timestamp < cutoff) i++;
    if (i > 0) this.buffer = this.buffer.slice(i);
  }

  getStrikes() {
    this._prune();
    return [...this.buffer].sort((a, b) => a.distanceKm - b.distanceKm);
  }

  getHealth() {
    const now = Date.now();
    const connected = this.ws && this.ws.readyState === WebSocket.OPEN;
    const msgAge = this.lastMessageAt ? now - this.lastMessageAt : null;
    const stale = msgAge == null || msgAge > this.cfg.staleMs;

    let state;
    if (!connected) state = 'DOWN';
    else if (stale) state = 'DEGRADED';
    else state = 'LIVE';

    return {
      provider: 'blitzortung',
      state,
      connected,
      lastMessageAgeMs: msgAge,
      lastStrikeAgeMs: this.lastStrikeAt ? now - this.lastStrikeAt : null,
      bufferedStrikes: this.buffer.length,
      totalReceived: this.totalReceived,
      totalKept: this.totalKept,
      uptimeMs: this.connectedAt ? now - this.connectedAt : 0,
      qualityHint: state === 'LIVE' ? 'high' : state === 'DEGRADED' ? 'unknown' : 'none',
    };
  }
}

module.exports = { BlitzortungProvider, decodeBlitzortung, distanceKm };
