import app from './app.js';
import { config } from './config.js';
import { seedDemoCareCircle } from './services/seedService.js';

const server = app.listen(config.port, '0.0.0.0', async () => {
  console.log(`===============================================`);
  console.log(`CareCircle 360 is running on port ${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Default Timezone: ${config.defaultTimezone}`);
  console.log(`Mode: ${config.useLocalDb ? 'Local / Offline DB' : 'Google Cloud Firestore'}`);
  console.log(`Health check: http://localhost:${config.port}/health`);
  console.log(`===============================================`);

  // Seed demo care circle for challenge judges & evaluators
  try {
    await seedDemoCareCircle();
    console.log(`[Demo Seed] Pre-seeded demo circle ready for evaluation (ID: circle_demo_sharma_360)`);
  } catch (err) {
    console.warn(`[Demo Seed Note] Could not initialize demo seed:`, err.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Closing CareCircle 360 HTTP server...');
  server.close(() => {
    console.log('HTTP server terminated gracefully.');
  });
});
