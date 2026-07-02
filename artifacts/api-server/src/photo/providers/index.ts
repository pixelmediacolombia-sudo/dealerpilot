// Provider factory — resolves concrete implementations from env vars.
// Add new providers here; stages only depend on the interfaces in types.ts.
import { FalAiBackgroundRemoval } from "./falai";
import { OpenAiClassifier } from "./openai";
import type { IBackgroundRemovalProvider, IClassificationProvider } from "./types";

export type { IBackgroundRemovalProvider, IClassificationProvider };

let _bgRemoval: IBackgroundRemovalProvider | null = null;
let _classifier: IClassificationProvider | null = null;

export function getBackgroundRemovalProvider(): IBackgroundRemovalProvider | null {
  if (_bgRemoval !== undefined && _bgRemoval !== null) return _bgRemoval;
  if (FalAiBackgroundRemoval.isConfigured()) {
    _bgRemoval = new FalAiBackgroundRemoval();
    return _bgRemoval;
  }
  return null;
}

export function getClassificationProvider(): IClassificationProvider {
  if (_classifier) return _classifier;
  _classifier = new OpenAiClassifier();
  return _classifier;
}

export { FalAiBackgroundRemoval, OpenAiClassifier };
