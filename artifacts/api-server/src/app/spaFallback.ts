import path from "path";
import express, { type Express, type Request, type Response } from "express";

export function registerSpaFallback(app: Express): void {
  if (process.env["NODE_ENV"] !== "production") {
    return;
  }

  const dashboardDist = path.join(process.cwd(), "artifacts/dashboard/dist/public");
  app.use(express.static(dashboardDist, {
    maxAge: "1h",
    etag: true,
    setHeaders: (res, filePath) => {
      // The HTML entrypoint must always discover the current hashed bundle after
      // a deployment; long-lived caching is safe for hashed JS/CSS assets only.
      if (path.basename(filePath) === "index.html") {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      }
    },
  }));
  app.get("/{*path}", (_req: Request, res: Response) => {
    res.sendFile(path.join(dashboardDist, "index.html"));
  });
}
