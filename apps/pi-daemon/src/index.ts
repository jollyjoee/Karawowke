import { startDaemon } from './daemon.js';

async function main(): Promise<void> {
  // Prevent unhandled errors from crashing the appliance daemon
  process.on('uncaughtException', (err) => {
    console.error('[pi-daemon] Uncaught exception (recovered):', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[pi-daemon] Unhandled rejection (recovered):', reason);
  });

  const running = await startDaemon();

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[pi-daemon] Received ${signal}, shutting down cleanly...`);
    try {
      await running.stop();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
