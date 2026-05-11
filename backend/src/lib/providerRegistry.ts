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

  constructor(providers: { name: string; provider: LightningProvider }[]) {
    this.entries = providers.map((p) => ({
      ...p,
      errorCount: 0,
      lastError: null,
      lastErrorAt: null,
      lastSuccessAt: null,
      totalRequests: 0,
      totalErrors: 0,
    }));
  }

  async getRecentStrikes(query: LightningQuery): Promise<LightningResponse> {
    // Try each provider in order, starting from the current active one
    for (let attempt = 0; attempt < this.entries.length; attempt++) {
      const idx = (this.activeIndex + attempt) % this.entries.length;
      const entry = this.entries[idx];

      // Skip degraded providers unless all are degraded
      if (this._isDegraded(entry) && attempt < this.entries.length - 1) {
        continue;
      }

      entry.totalRequests++;
      try {
        const result = await withTimeout(
          entry.provider.getRecentStrikes(query),
          PROVIDER_TIMEOUT_MS,
          entry.name,
        );

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
        entry.lastError = err instanceof Error ? err.message : 'Unknown error';
        entry.lastErrorAt = Date.now();
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
    }));
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
