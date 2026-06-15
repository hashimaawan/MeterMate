/**
 * Server bootstrap: load config, start the session TTL sweep, run a Slack auth
 * health check (non-fatal warning if it fails), and listen.
 */
import { config } from './config.js';
import { createLogger } from './logger.js';
import { createApp } from './app.js';
import { startSessionSweep } from './stores/sessionStore.js';
import { slackHealthCheck } from './services/slackService.js';

const log = createLogger('index');

async function main(): Promise<void> {
  startSessionSweep();

  // Non-fatal boot check so a Slack misconfiguration is visible immediately.
  const slackOk = await slackHealthCheck();
  if (!slackOk) {
    log.warn('Slack bot token health check failed — Slack notifications may not work.');
  }

  const app = createApp();
  app.listen(config.app.port, () => {
    log.info('MeterMate server listening', {
      port: config.app.port,
      maxioSite: config.maxio.siteSubdomain,
      demoMode: config.app.demoMode,
    });
  });
}

main().catch((err) => {
  log.error('Fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
