import path from "path";
import express, { type Express, type Request, type Response } from "express";

export function registerSpaFallback(app: Express): void {
  if (process.env["NODE_ENV"] !== "production") {
    return;
  }

  const dashboardDist = path.join(process.cwd(), "artifacts/dashboard/dist/public");
  app.use(express.static(dashboardDist, { maxAge: "1h", etag: true }));
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
}
