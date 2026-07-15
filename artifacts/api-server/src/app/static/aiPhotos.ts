import express, { type Express } from "express";
import { getAiPhotosDir } from "../../photo/staticAssets";

export function registerAiPhotoStaticFiles(app: Express): void {
  const aiPhotosDir = getAiPhotosDir();
  app.use("/api/static/ai-photos", express.static(aiPhotosDir, { maxAge: "1d" }));
  app.use("/api/static/ai-photos", (_req, res) => {
    res.status(404).json({ error: "AI photo asset not found" });
  });
}
