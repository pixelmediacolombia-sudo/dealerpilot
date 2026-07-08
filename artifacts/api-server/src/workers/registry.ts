import type { WorkerDefinition } from "./types";

const workers = new Map<string, WorkerDefinition>();

export function registerWorker(worker: WorkerDefinition): void {
  if (workers.has(worker.id)) {
    throw new Error(`Worker "${worker.id}" is already registered`);
  }
  workers.set(worker.id, worker);
}

export function getWorker(id: string): WorkerDefinition | undefined {
  return workers.get(id);
}

export function getAllWorkers(): WorkerDefinition[] {
  return [...workers.values()];
}
