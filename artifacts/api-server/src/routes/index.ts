import { Router, type IRouter } from "express";
import healthRouter from "../features/health/presentation/http/healthRouter";
import extensionRouter from "./extension";
import authRouter from "./auth";
import dealersRouter from "./dealers";
import vehiclesRouter from "./vehicles";
import connectionRouter from "../features/connection/presentation/http/connectionRouter";
import feedRouter from "./feed";
import listingsRouter from "./listings";
import publishingRouter from "../features/publishing/presentation/http/publishingRouter";
import autoPublishRouter from "./autoPublish";
import creativeRouter from "./creative";
import conversationsRouter from "./conversations";
import leadsRouter from "./leads";
import simulatorRouter from "./simulator";
import metaMessengerRouter from "./metaMessenger";
import marketplaceIntelligenceRouter from "./marketplaceIntelligence";
import channelsRouter from "./channels";
import photoStudioRouter from "./photoStudio";
import marketplaceListingsRouter from "./marketplaceListings";
import gmRouter from "./gm";
import workersRouter from "./workers";
import orchestratorRouter from "./orchestrator";
import pagesRouter from "./pages";
import dealerThemeRouter from "./dealerTheme";

const router: IRouter = Router();

router.use(gmRouter);
router.use(workersRouter);
router.use(orchestratorRouter);
router.use(healthRouter);
router.use(authRouter);
router.use(extensionRouter);
router.use(dealersRouter);
router.use(vehiclesRouter);
router.use(connectionRouter);
router.use(feedRouter);
router.use(listingsRouter);
router.use(publishingRouter);
router.use(autoPublishRouter);
router.use(creativeRouter);
router.use(conversationsRouter);
router.use(leadsRouter);
router.use(metaMessengerRouter);
if (process.env["NODE_ENV"] !== "production") {
  router.use(simulatorRouter);
}
router.use(marketplaceIntelligenceRouter);
router.use(channelsRouter);
router.use(photoStudioRouter);
router.use(marketplaceListingsRouter);
router.use(pagesRouter);
router.use(dealerThemeRouter);

export default router;
