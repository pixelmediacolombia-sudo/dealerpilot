import express, { type Express } from "express";
import cors from "cors";
import router from "../routes";
import { createHttpLogger } from "./middleware/httpLogger";
import { registerBodyParsers } from "./middleware/bodyParsers";
import { registerAiPhotoStaticFiles } from "./static/aiPhotos";
import { registerFeedAuditRoutes } from "./static/feedAuditRoutes";
import { registerPublicFeeds } from "./static/publicFeeds";
import { registerSpaFallback } from "./spaFallback";

export function createApp(): Express {
  const app = express();

  app.use(createHttpLogger());
  app.use(cors());
  registerBodyParsers(app);
  registerPublicFeeds(app);
  registerFeedAuditRoutes(app);
  registerAiPhotoStaticFiles(app);
  app.use("/api", router);
  registerSpaFallback(app);

  return app;
}
