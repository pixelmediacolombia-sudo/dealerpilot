import app from "./app";
import { logger } from "./lib/logger";
import { seedDealerAndInventory } from "./inventory/seed";
import { seedCreative } from "./creative/seed";
import { startCreativeWorker } from "./creative/worker";
import { seedMarketplaceIntelligence } from "./intelligence/seed";
import { startInventoryScheduler } from "./inventory/scheduler";

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
    .then(() => startInventoryScheduler(logger))
    .catch((seedErr) => {
      logger.error({ err: seedErr }, "Failed to seed/start engines");
    });
});
