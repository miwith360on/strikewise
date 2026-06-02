import 'dotenv/config';
import { z } from 'zod';

const providerSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }

    const normalized = value
      .trim()
      .replace(/^=+/, '')
      .replace(/^["']|["']$/g, '')
      .toLowerCase();
    return normalized.length > 0 ? normalized : undefined;
  },
  z.enum(['auto', 'mock', 'noaa-glm', 'xweather', 'blitzortung', 'open-meteo', 'tomorrow']).default('auto'),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LIGHTNING_PROVIDER: providerSchema,
  CORS_ORIGIN: z.string().default('*'),
  NOAA_GLM_BUCKET: z.string().default('noaa-goes18'),
  NOAA_GLM_BASE_URL: z.string().url().default('https://noaa-goes18.s3.amazonaws.com'),
  NOAA_GLM_PRODUCT: z.string().default('GLM-L2-LCFA'),
  NOAA_GLM_POLL_SECONDS: z.coerce.number().default(15),
  XWEATHER_CLIENT_ID: z.string().optional(),
  XWEATHER_CLIENT_SECRET: z.string().optional(),
  TOMORROW_API_KEY: z.string().optional(),
});

const mergedEnv = {
  ...process.env,
  CORS_ORIGIN: process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? process.env.CORS_ORIGNS,
};

export const env = envSchema.parse(mergedEnv);
