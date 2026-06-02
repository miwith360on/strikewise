// ─────────────────────────────────────────────────────────────────
// NWS Weather Alerts Route  — /api/alerts?lat=&lng=
//
// Proxies the free National Weather Service alerts API:
//   https://api.weather.gov/alerts/active?point={lat},{lng}
//
// Returns only lightning/thunder/tornado relevant alerts so the
// frontend can surface authoritative government warnings.
// Only valid for US points; returns { active: false } elsewhere.
// ─────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { z } from 'zod';

export const alertsRouter = Router();

// Events we care about for a lightning safety app
const RELEVANT_EVENTS = new Set([
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Tornado Warning',
  'Tornado Watch',
  'Thunderstorm Warning',
  'Special Marine Warning',
  'Flash Flood Warning',          // often paired with severe convection
  'Severe Weather Statement',
]);

const SEVERITY_ORDER: Record<string, number> = {
  Extreme: 4,
  Severe: 3,
  Moderate: 2,
  Minor: 1,
  Unknown: 0,
};

interface NwsFeatureProperties {
  event?: string;
  severity?: string;
  urgency?: string;
  certainty?: string;
  headline?: string;
  description?: string;
  effective?: string;
  expires?: string;
  senderName?: string;
}

interface NwsFeature {
  id?: string;
  properties?: NwsFeatureProperties;
}

interface NwsApiResponse {
  features?: NwsFeature[];
}

const nwsApiResponseSchema = z.object({
  features: z
    .array(
      z.object({
        id: z.string().optional(),
        properties: z
          .object({
            event: z.string().optional(),
            severity: z.string().optional(),
            urgency: z.string().optional(),
            certainty: z.string().optional(),
            headline: z.string().optional(),
            description: z.string().optional(),
            effective: z.string().optional(),
            expires: z.string().optional(),
            senderName: z.string().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});

export interface NwsAlert {
  id: string;
  event: string;
  severity: string;
  urgency: string;
  headline: string;
  expires: string | null;
  effective: string | null;
  senderName: string;
}

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

alertsRouter.get('/', async (request, response, next) => {
  try {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: 'lat and lng query params are required' });
      return;
    }

    const { lat, lng } = parsed.data;
    const url = `https://api.weather.gov/alerts/active?point=${lat},${lng}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Strikewise/1.0 (lightning safety app)',
        'Accept': 'application/geo+json',
      },
      signal: AbortSignal.timeout(8_000),
    });

    // NWS returns 404 for non-US points
    if (res.status === 404) {
      response.json({ active: false, alerts: [], region: 'outside-us' });
      return;
    }

    if (!res.ok) {
      throw new Error(`NWS API responded with ${res.status}`);
    }

    const raw = await res.json();
    const parsedPayload = nwsApiResponseSchema.safeParse(raw);
    if (!parsedPayload.success) {
      throw new Error('Invalid NWS response payload');
    }
    const data: NwsApiResponse = parsedPayload.data;
    const features = data.features ?? [];

    const alerts: NwsAlert[] = features
      .filter((f) => {
        const event = f.properties?.event ?? '';
        return RELEVANT_EVENTS.has(event);
      })
      .map((f): NwsAlert => ({
        id: f.id ?? crypto.randomUUID(),
        event: f.properties?.event ?? 'Unknown',
        severity: f.properties?.severity ?? 'Unknown',
        urgency: f.properties?.urgency ?? 'Unknown',
        headline: f.properties?.headline ?? f.properties?.event ?? 'Weather Alert',
        expires: f.properties?.expires ?? null,
        effective: f.properties?.effective ?? null,
        senderName: f.properties?.senderName ?? 'NWS',
      }))
      .sort(
        (a, b) =>
          (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0),
      );

    const maxSeverity =
      alerts.length > 0
        ? alerts.reduce(
            (best, a) =>
              (SEVERITY_ORDER[a.severity] ?? 0) > (SEVERITY_ORDER[best] ?? 0)
                ? a.severity
                : best,
            alerts[0].severity,
          )
        : null;

    response.json({
      active: alerts.length > 0,
      maxSeverity,
      alerts,
      fetchedAt: Date.now(),
    });
  } catch (error) {
    next(error);
  }
});
