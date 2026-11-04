// Barrel for the AI module — server.js mounts `aiRouter` at /api/ai and
// nothing else needs to reach into backend/src/ai/* directly. Internal
// pieces (rag.service, tools, providers) are imported by their own relative
// paths from inside this module; re-exporting everything here would just
// create a second, redundant import surface.
export { aiRouter } from './routes/ai.routes.js';
