// ─────────────────────────────────────────────────────────────────
// Provider Registry
//
// Wraps a priority-ordered list of LightningProviders with:
//   - Per-provider error counting and last-error tracking
//   - Automatic failover: if the primary exceeds error threshold,
//     fall through to the next provider in the chain
//   - Reset: a provider recovers after RECOVERY_WINDOW_MS with no errors
//   - Health snapshot: real-time status for all providers
// ─────────────────────────────────────────────────────────────────

import type {
  LightningProvider,
  LightningQuery,
  LightningResponse,
} from '../types/lightning.js';

const ERROR_THRESHOLD = 3;           // consecutive failures before skipping
const PROVIDER_TIMEOUT_MS = 8_000;   // abort a provider call after this long
const RECOVERY_WINDOW_MS = 2 * 60 * 1000; // reset error count after 2 min clean run

export interface ProviderHealth {
  name: string;
  active: boolean;
  errorCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
  totalRequests: number;
  totalErrors: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
}

export interface RegistryDiagnostics {
  startedAt: number;
  uptimeSec: number;
  totalRequests: number;
  totalFailures: number;
  totalFailovers: number;
  lastFailoverAt: number | null;
  lastFailoverFrom: string | null;
  lastFailoverTo: string | null;
  lastFailoverReason: string | null;
}

interface ProviderEntry {
  name: string;
  provider: LightningProvider;
  errorCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
  totalRequests: number;
  totalErrors: number;
  lastLatencyMs: number | null;
  totalLatencyMs: number;
}

function shouldFailoverFromResult(result: LightningResponse): string | null {
  const providerStatus = result.meta.providerStatus;
  if (providerStatus !== 'degraded') {
    return null;
  }

  // If a provider is degraded and returns no strikes, treat it as unavailable so
  // the registry can fail over instead of silently reporting a false all-clear.
  if (result.strikes.length === 0) {
    return 'Provider reported degraded status with empty strike payload';
  }

  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Provider '${name}' timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class ProviderRegistry {
  private readonly entries: ProviderEntry[];
  private activeIndex = 0;
  private readonly startedAt = Date.now();
  private totalRequests = 0;
  private totalFailures = 0;
  private totalFailovers = 0;
  private lastFailoverAt: number | null = null;
  private lastFailoverFrom: string | null = null;
  private lastFailoverTo: string | null = null;
  private lastFailoverReason: string | null = null;

  constructor(providers: { name: string; provider: LightningProvider }[]) {
    this.entries = providers.map((p) => ({
      ...p,
      errorCount: 0,
      lastError: null,
      lastErrorAt: null,
      lastSuccessAt: null,
      totalRequests: 0,
      totalErrors: 0,
      lastLatencyMs: null,
      totalLatencyMs: 0,
    }));
  }

  async getRecentStrikes(query: LightningQuery): Promise<LightningResponse> {
    this.totalRequests++;
    const attemptErrors: string[] = [];

    // Try each provider in order, starting from the current active one
    for (let attempt = 0; attempt < this.entries.length; attempt++) {
      const idx = (this.activeIndex + attempt) % this.entries.length;
      const entry = this.entries[idx];

      // Skip degraded providers unless all are degraded
      if (this._isDegraded(entry) && attempt < this.entries.length - 1) {
        continue;
      }

      entry.totalRequests++;
      const attemptStartedAt = Date.now();
      try {
        const result = await withTimeout(
          entry.provider.getRecentStrikes(query),
          PROVIDER_TIMEOUT_MS,
          entry.name,
        );

        const latencyMs = Date.now() - attemptStartedAt;
        entry.lastLatencyMs = latencyMs;
        entry.totalLatencyMs += latencyMs;

        const failoverReason = shouldFailoverFromResult(result);
        if (failoverReason && attempt < this.entries.length - 1) {
          throw new Error(failoverReason);
        }

        if (attempt > 0) {
          this.totalFailovers++;
          this.lastFailoverAt = Date.now();
          this.lastFailoverFrom = this.entries[this.activeIndex]?.name ?? null;
          this.lastFailoverTo = entry.name;
          this.lastFailoverReason = attemptErrors.join(' | ') || 'Primary unavailable';
        }

        // Success: reset consecutive error count, promote to active
        entry.errorCount = 0;
        entry.lastSuccessAt = Date.now();
        this.activeIndex = idx;

        return {
          ...result,
          meta: {
            ...result.meta,
            notes: [
              ...(attempt > 0 ? [`Failover: using ${entry.name} (primary unavailable)`] : []),
              ...(result.meta.notes ?? []),
            ],
          },
        };
      } catch (err) {
        entry.errorCount++;
        entry.totalErrors++;
        this.totalFailures++;
        const latencyMs = Date.now() - attemptStartedAt;
        entry.lastLatencyMs = latencyMs;
        entry.totalLatencyMs += latencyMs;
        entry.lastError = err instanceof Error ? err.message : 'Unknown error';
        entry.lastErrorAt = Date.now();
        attemptErrors.push(`${entry.name}: ${entry.lastError}`);
      }
    }

    // All providers failed — return degraded error payload
    const names = this.entries.map((e) => e.name).join(', ');
    return {
      provider: 'error',
      generatedAt: Date.now(),
      strikes: [],
      meta: {
        simulated: false,
        source: 'all-providers-failed',
        providerStatus: 'degraded',
        notes: [`All providers failed (${names}). Check credentials and network.`],
      },
    };
  }

  getHealth(): ProviderHealth[] {
    return this.entries.map((entry, idx) => ({
      name: entry.name,
      active: idx === this.activeIndex && !this._isDegraded(entry),
      errorCount: entry.errorCount,
      lastError: entry.lastError,
      lastErrorAt: entry.lastErrorAt,
      lastSuccessAt: entry.lastSuccessAt,
      totalRequests: entry.totalRequests,
      totalErrors: entry.totalErrors,
      lastLatencyMs: entry.lastLatencyMs,
      avgLatencyMs: entry.totalRequests > 0
        ? Math.round((entry.totalLatencyMs / entry.totalRequests) * 10) / 10
        : null,
    }));
  }

  getDiagnostics(): RegistryDiagnostics {
    return {
      startedAt: this.startedAt,
      uptimeSec: Math.max(0, Math.round((Date.now() - this.startedAt) / 1000)),
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
      totalFailovers: this.totalFailovers,
      lastFailoverAt: this.lastFailoverAt,
      lastFailoverFrom: this.lastFailoverFrom,
      lastFailoverTo: this.lastFailoverTo,
      lastFailoverReason: this.lastFailoverReason,
    };
  }

  getActiveName(): string {
    return this.entries[this.activeIndex]?.name ?? 'unknown';
  }

  private _isDegraded(entry: ProviderEntry): boolean {
    if (entry.errorCount < ERROR_THRESHOLD) return false;

    // Automatically recover if enough time has passed with no new failures
    if (entry.lastErrorAt !== null && Date.now() - entry.lastErrorAt > RECOVERY_WINDOW_MS) {
      entry.errorCount = 0;
      return false;
    }

    return true;
  }
}
