import { Router, type IRouter } from "express";
import { getHealthStatus } from "../../application/getHealthStatus";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json(getHealthStatus());
});

export default router;
