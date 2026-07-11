import { HEARTBEAT_WINDOW_MS } from "../domain/HeartbeatWindow";

export function isRecentHeartbeat(lastHeartbeatAt: Date | null | undefined): boolean {
  return !!lastHeartbeatAt && Date.now() - lastHeartbeatAt.getTime() < HEARTBEAT_WINDOW_MS;
}
