import app from "./app";
import { logger } from "./lib/logger";
import { seedDealerAndInventory } from "./inventory/seed";
import { seedCreative } from "./creative/seed";
import { startCreativeWorker } from "./creative/worker";
import { seedMarketplaceIntelligence } from "./intelligence/seed";
import { startStaleJobCleaner } from "./publishing/staleCleaner";
import { seedAiStudio } from "./photo/seed";
import { seedPhotoQualityProfiles } from "./photo/seedProfiles";
import { startPhotoWorker } from "./photo/worker";
import { startWorkers } from "./workers";
import { startPagesPublishingWorker } from "./pages/pagesPublishing.worker";
import { runSchemaMigrations } from "./db/migrate";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startServer(): Promise<void> {
  try {
    await runSchemaMigrations(logger);
  } catch (error) {
    logger.fatal({ err: error }, "Database schema is not ready; refusing to start workers");
    process.exit(1);
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    void seedDealerAndInventory(logger)
      .then(() => seedCreative(logger))
      .then(() => startCreativeWorker(logger))
      .then(() => seedMarketplaceIntelligence(logger))
      .then(() => startStaleJobCleaner(logger))
      .then(() => seedAiStudio(logger))
      .then(() => seedPhotoQualityProfiles(logger))
      .then(() => startPhotoWorker(logger))
      .then(() => startWorkers(logger))
      .then(() => startPagesPublishingWorker(logger))
      .catch((seedErr) => {
        logger.error({ err: seedErr }, "Failed to seed/start engines");
      });
  });
}

void startServer();
