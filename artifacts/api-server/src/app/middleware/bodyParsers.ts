import express, { type Express } from "express";

export function registerBodyParsers(app: Express): void {
  app.use("/api/meta/webhooks/messenger", express.raw({ type: "application/json" }));
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true }));
}
