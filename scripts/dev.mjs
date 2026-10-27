import { buildApp } from './build.mjs';
await buildApp();
await import('./server.mjs');
