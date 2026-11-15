import app from './app.js';
import { config } from './config.js';
import { seedDemoCareCircle } from './services/seedService.js';
import { logger } from './logger.js';

const server = app.listen(config.port, '0.0.0.0', async () => {
  logger.info(`===============================================`);
  logger.info(`CareCircle 360 is running on port ${config.port}`);
  logger.info(`Environment: ${config.nodeEnv}`);
  logger.info(`Default Timezone: ${config.defaultTimezone}`);
  logger.info(`Mode: ${config.useLocalDb ? 'Local / Offline DB' : 'Google Cloud Firestore'}`);
  logger.info(`Health check: http://localhost:${config.port}/health`);
  logger.info(`===============================================`);

  // Seed demo care circle for challenge judges & evaluators
  try {
    await seedDemoCareCircle();
    logger.info(
      `[Demo Seed] Pre-seeded demo circle ready for evaluation (ID: circle_demo_sharma_360)`
    );
  } catch (err) {
    logger.warn(`[Demo Seed Note] Could not initialize demo seed:`, err.message);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received. Closing CareCircle 360 HTTP server...');
  server.close(() => {
    logger.info('HTTP server terminated gracefully.');
  });
});
