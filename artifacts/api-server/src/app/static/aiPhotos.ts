import fs from "fs";
import path from "path";
import express, { type Express } from "express";

export function registerAiPhotoStaticFiles(app: Express): void {
  const aiPhotosDir = path.join(process.cwd(), "artifacts/api-server/uploads/ai-photos");
  fs.mkdirSync(aiPhotosDir, { recursive: true });
  app.use("/api/static/ai-photos", express.static(aiPhotosDir, { maxAge: "1d" }));
}
