import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { healthRouter } from './routes/health.js';
import { lightningRouter } from './routes/lightning.js';

const app = express();
const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendDistDir = resolve(currentDir, '../../dist');
const frontendIndexPath = resolve(frontendDistDir, 'index.html');
const hasFrontendBuild = existsSync(frontendIndexPath);

app.use(cors({ origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN }));
app.use(express.json());

app.use('/health', healthRouter);
app.use('/api/lightning', lightningRouter);

if (hasFrontendBuild) {
  app.use(express.static(frontendDistDir));

  app.get('*', (_request, response) => {
    response.sendFile(frontendIndexPath);
  });
} else {
  app.get('/', (_request, response) => {
    response.json({
      service: 'strikewise-backend',
      status: 'ready',
      endpoints: ['/health', '/api/lightning'],
      frontend: 'Build the root app to serve the dashboard from this service.',
    });
  });
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: 'Invalid request',
      details: error.flatten(),
    });
    return;
  }

  const message = error instanceof Error ? error.message : 'Internal server error';
  response.status(500).json({ error: message });
});

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Strikewise backend listening on port ${env.PORT}`);
  console.log(`Provider: ${env.LIGHTNING_PROVIDER}`);
});
