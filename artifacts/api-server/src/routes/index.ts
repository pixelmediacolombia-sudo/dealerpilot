import { Router, type IRouter } from "express";
import healthRouter from "./health";
import extensionRouter from "./extension";

const router: IRouter = Router();

router.use(healthRouter);
router.use(extensionRouter);

export default router;
