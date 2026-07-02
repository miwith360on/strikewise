import { createRequire } from 'node:module';
import type {
  BlitzortungProvider as BlitzortungProviderClass,
  BlitzortungProviderOptions,
} from './blitzortungProvider.js';

type BlitzortungProviderConstructor = new (
  opts?: BlitzortungProviderOptions,
) => BlitzortungProviderClass;

const require = createRequire(import.meta.url);
const runtime = require('./blitzortungProvider.js') as {
  BlitzortungProvider: BlitzortungProviderConstructor;
};

export const BlitzortungProvider = runtime.BlitzortungProvider;
