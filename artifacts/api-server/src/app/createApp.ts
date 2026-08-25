import express, { type Express } from "express";
import cors from "cors";
import router from "../routes";
import { createHttpLogger } from "./middleware/httpLogger";
import { registerBodyParsers } from "./middleware/bodyParsers";
import { registerAiPhotoStaticFiles } from "./static/aiPhotos";
import { registerFeedAuditRoutes } from "./static/feedAuditRoutes";
import { registerPublicFeeds } from "./static/publicFeeds";
import { registerSpaFallback } from "./spaFallback";
import dealerThemeRouter from "../routes/dealerTheme";
import sofiaMarketplaceRouter from "../routes/sofiaMarketplace";

export function createApp(): Express {
  const app = express();

  app.use(createHttpLogger());
  app.use(cors());
  registerBodyParsers(app);
  app.use(sofiaMarketplaceRouter);
  registerPublicFeeds(app);
  registerFeedAuditRoutes(app);
  registerAiPhotoStaticFiles(app);
  // Dealer colors are non-secret public brand data. Mount this router outside
  // the authenticated API router so extensions can refresh the palette too.
  app.use("/api", dealerThemeRouter);
  app.use("/api", router);
  registerSpaFallback(app);

  return app;
}
