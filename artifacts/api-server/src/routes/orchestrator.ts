import { Router, type IRouter } from "express";
import { getOrchestratorStatus, runOrchestrationCycle } from "../workers/orchestrator";

const router: IRouter = Router();

// GET /orchestrator/status — read-only snapshot of the last orchestration
// decision, current budget status, and extension dependency. Never crashes:
// getOrchestratorStatus() catches its own failures and returns a degraded
// "Failed" snapshot instead of throwing.
router.get("/orchestrator/status", async (req, res) => {
  const status = await getOrchestratorStatus();
  res.json(status);
});

// POST /orchestrator/run — manually runs one orchestration cycle (decides
// RUN/SKIP/PAUSE for all 6 workers and executes the RUN decisions).
router.post("/orchestrator/run", async (req, res) => {
  req.log.info("Manual orchestrator cycle trigger via API");
  const result = await runOrchestrationCycle(req.log, "manual");
  res.json(result);
});

export default router;
