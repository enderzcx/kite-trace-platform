import 'dotenv/config';
import { infraBootstrap } from './infraBootstrap.js';
import { servicesBootstrap } from './servicesBootstrap.js';
import { loopsBootstrap } from './loopsBootstrap.js';
import { routesBootstrap } from './routesBootstrap.js';

const ctx = {};
await infraBootstrap(ctx);
await servicesBootstrap(ctx);
loopsBootstrap(ctx);
export const { startServer, shutdownServer } = routesBootstrap(ctx);
