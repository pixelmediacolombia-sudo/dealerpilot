import { Router, type IRouter } from "express";
import healthRouter from "./health";
import extensionRouter from "./extension";
import dealersRouter from "./dealers";
import vehiclesRouter from "./vehicles";
import connectionRouter from "./connection";
import feedRouter from "./feed";
import listingsRouter from "./listings";
import publishingRouter from "./publishing";

const router: IRouter = Router();

router.use(healthRouter);
router.use(extensionRouter);
router.use(dealersRouter);
router.use(vehiclesRouter);
router.use(connectionRouter);
router.use(feedRouter);
router.use(listingsRouter);
router.use(publishingRouter);

export default router;
