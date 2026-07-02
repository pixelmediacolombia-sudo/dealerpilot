import { Router, type IRouter } from "express";
import healthRouter from "./health";
import extensionRouter from "./extension";
import dealersRouter from "./dealers";
import vehiclesRouter from "./vehicles";
import connectionRouter from "./connection";
import feedRouter from "./feed";
import listingsRouter from "./listings";
import publishingRouter from "./publishing";
import autoPublishRouter from "./autoPublish";
import creativeRouter from "./creative";
import conversationsRouter from "./conversations";
import leadsRouter from "./leads";
import simulatorRouter from "./simulator";
import marketplaceIntelligenceRouter from "./marketplaceIntelligence";
import channelsRouter from "./channels";
import photoStudioRouter from "./photoStudio";

const router: IRouter = Router();

router.use(healthRouter);
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
router.use(simulatorRouter);
router.use(marketplaceIntelligenceRouter);
router.use(channelsRouter);
router.use(photoStudioRouter);

export default router;
