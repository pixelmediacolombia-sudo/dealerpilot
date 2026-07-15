import fs from "fs";
import path from "path";

const AI_PHOTO_STATIC_PREFIX = "/api/static/ai-photos/";
const DEFAULT_AI_PHOTOS_DIR = path.join("artifacts", "api-server", "uploads", "ai-photos");

export function getAiPhotosDir(): string {
  const configuredDir = process.env["AI_PHOTOS_UPLOAD_DIR"];
  const dir = configuredDir
    ? path.resolve(configuredDir)
    : path.join(process.cwd(), DEFAULT_AI_PHOTOS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function aiPhotoStaticUrl(filename: string): string {
  return `${AI_PHOTO_STATIC_PREFIX}${filename}`;
}

export function isLocalAiPhotoUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith(AI_PHOTO_STATIC_PREFIX);
}

export function getLocalAiPhotoPath(url: string | null | undefined): string | null {
  if (!isLocalAiPhotoUrl(url)) return null;

  const relativePath = url.slice(AI_PHOTO_STATIC_PREFIX.length);
  const normalized = path.normalize(relativePath);
  if (
    normalized.startsWith("..") ||
    path.isAbsolute(normalized)
  ) {
    return null;
  }

  return path.join(getAiPhotosDir(), normalized);
}

export function hasLocalAiPhotoAsset(url: string | null | undefined): boolean {
  const filepath = getLocalAiPhotoPath(url);
  return !!filepath && fs.existsSync(filepath);
}

export function resolveLocalAiPhotoUrl<T extends string | null | undefined>(
  url: T,
  fallbackUrl: string | null,
): string | null {
  if (!url) return fallbackUrl;
  if (isLocalAiPhotoUrl(url) && !hasLocalAiPhotoAsset(url)) return fallbackUrl;
  return url;
}
