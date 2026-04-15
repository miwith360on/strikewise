// ─────────────────────────────────────────────────────────────────
// Blitzortung Community Lightning Network Provider
//
// Connects to the Blitzortung public WebSocket feed and streams
// individual cloud-to-ground strikes in real time (< 2 s latency).
// Strikes are buffered in memory for up to BUFFER_MINUTES.
// getRecentStrikes() reads from the buffer, filtered by time and bounds.
//
// No API key required.
// ─────────────────────────────────────────────────────────────────

import { createHash } from 'crypto';
import { WebSocket } from 'ws';

import type {
  LightningProvider,
  LightningQuery,
  LightningResponse,
  LightningStrike,
} from '../types/lightning.js';

// Blitzortung load-balances across multiple WebSocket servers.
const SERVERS = [
  'wss://ws.blitzortung.org:8001/',
  'wss://ws.blitzortung.org:8002/',
  'wss://ws.blitzortung.org:8003/',
  'wss://ws.blitzortung.org:8004/',
  'wss://ws.blitzortung.org:8005/',
];

const BUFFER_MINUTES = 60;
const RECONNECT_DELAY_MS = 5_000;
const CONNECT_TIMEOUT_MS = 12_000;

// Strike messages from Blitzortung
interface BlitzortungMessage {
  time?: number;   // nanoseconds since Unix epoch
  lat?: number;
  lon?: number;
  sig?: number;    // signal amplitude (rough kA proxy)
  sta?: number[];  // station IDs that detected the strike
}

function parseMessage(raw: string): BlitzortungMessage | null {
  try {
    return JSON.parse(raw) as BlitzortungMessage;
  } catch {
    return null;
  }
}

function toStrike(msg: BlitzortungMessage): LightningStrike | null {
  if (msg.time == null || msg.lat == null || msg.lon == null) return null;
  if (!Number.isFinite(msg.lat) || !Number.isFinite(msg.lon)) return null;

  // Blitzortung timestamps are in nanoseconds — convert to milliseconds.
  const timestampMs = Math.round(msg.time / 1_000_000);

  // Reject clearly bogus timestamps (older than 2 h or more than 60 s in future).
  const now = Date.now();
  if (timestampMs < now - 2 * 60 * 60 * 1000) return null;
  if (timestampMs > now + 60_000) return null;

  const sigKa = Math.abs(msg.sig ?? 0);
  // sig units from Blitzortung are roughly 0.1 kA steps; most CG strikes are 10–300 kA.
  const intensityKa = sigKa > 0 ? sigKa / 10 : 15;

  // Blitzortung convention: positive sig → negative polarity (most common CG flash).
  const polarity: 'negative' | 'positive' = (msg.sig ?? 0) >= 0 ? 'negative' : 'positive';

  const id = createHash('sha1')
    .update(`${msg.time}:${msg.lat}:${msg.lon}`)
    .digest('hex')
    .slice(0, 16);

  return {
    id,
    lat: msg.lat,
    lng: msg.lon,
    timestamp: timestampMs,
    intensityKa,
    polarity,
    multiplicity: 1,
  };
}

// ── Persistent WebSocket connection ──────────────────────────────

class BlitzortungConnection {
  private ws: WebSocket | null = null;
  private buffer: LightningStrike[] = [];
  private serverIdx = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _connected = false;
  private _lastError: string | null = null;

  constructor() {
    this.connect();
  }

  private connect(): void {
    const url = SERVERS[this.serverIdx % SERVERS.length];
    this.serverIdx++;

    try {
      this.ws = new WebSocket(url, { handshakeTimeout: CONNECT_TIMEOUT_MS });

      this.ws.on('open', () => {
        this._connected = true;
        this._lastError = null;
        // Subscribe to global coverage.
        this.ws?.send(JSON.stringify({ west: -180, east: 180, north: 90, south: -90 }));
      });

      this.ws.on('message', (data: Buffer | string) => {
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        const msg = parseMessage(raw);
        if (!msg) return;
        const strike = toStrike(msg);
        if (!strike) return;
        this.buffer.push(strike);
      });

      this.ws.on('error', (err: Error) => {
        this._lastError = err.message;
        this._connected = false;
      });

      this.ws.on('close', () => {
        this._connected = false;
        this.scheduleReconnect();
      });
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : 'Connection failed';
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  /** Remove strikes older than BUFFER_MINUTES from memory. */
  private pruneOld(): void {
    const cutoff = Date.now() - BUFFER_MINUTES * 60 * 1000;
    this.buffer = this.buffer.filter((s) => s.timestamp >= cutoff);
  }

  /** Return strikes within the last `minutes` minutes. */
  getStrikes(minutes: number): LightningStrike[] {
    this.pruneOld();
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.buffer.filter((s) => s.timestamp >= cutoff);
  }

  get connected(): boolean { return this._connected; }
  get bufferedCount(): number { return this.buffer.length; }
  get lastError(): string | null { return this._lastError; }
}

// Singleton — one persistent connection for the entire process lifetime.
let sharedConn: BlitzortungConnection | null = null;

function getConnection(): BlitzortungConnection {
  if (!sharedConn) sharedConn = new BlitzortungConnection();
  return sharedConn;
}

// ── Provider ─────────────────────────────────────────────────────

export class BlitzortungProvider implements LightningProvider {
  private readonly conn: BlitzortungConnection;

  constructor() {
    this.conn = getConnection();
  }

  async getRecentStrikes(query: LightningQuery): Promise<LightningResponse> {
    const { minutes, bounds } = query;

    let strikes = this.conn.getStrikes(minutes);

    if (bounds) {
      strikes = strikes.filter(
        (s) =>
          s.lat >= bounds.south &&
          s.lat <= bounds.north &&
          s.lng >= bounds.west &&
          s.lng <= bounds.east,
      );
    }

    const { connected, bufferedCount, lastError } = this.conn;
    const notes: string[] = [
      connected
        ? 'Blitzortung WebSocket connected — real-time strikes'
        : `Blitzortung disconnected: ${lastError ?? 'reconnecting…'}`,
      `Buffer: ${bufferedCount} strikes in last ${BUFFER_MINUTES} min`,
    ];

    return {
      provider: 'blitzortung',
      generatedAt: Date.now(),
      strikes,
      meta: {
        simulated: false,
        source: 'blitzortung-live-ws',
        providerStatus: connected ? 'ok' : 'degraded',
        notes,
      },
    };
  }
}
