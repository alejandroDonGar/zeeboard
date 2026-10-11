// Which address of this PC the iPad should use. Pure: src/lib/ipad.ts does the talking to the app.
import type { CommissionStageImage } from "./database";

/** Tailscale gives every device an address in 100.64.0.0/10 */
export function isTailscale(ip: string): boolean {
  const [first, second] = ip.split(".").map(Number);

  return first === 100 && second >= 64 && second <= 127;
}

/** Best first: Tailscale works over mobile data; the others only on the same network */
export function sortAddresses(ips: string[]): string[] {
  return [...ips].sort((a, b) => Number(isTailscale(b)) - Number(isTailscale(a)));
}

export function ipadLink(ip: string, port: number, token: string): string {
  return `http://${ip}:${port}/?k=${token}`;
}

/** The newest version of an alternative of a stage (what a new version is built on); undefined if it is gone */
export function latestOfAlternative(images: CommissionStageImage[], stageId: number, alt: number): CommissionStageImage | undefined {
  return images
    .filter((image) => image.stage_id === stageId && image.alt === alt)
    .sort((a, b) => a.version - b.version || a.id - b.id)
    .pop();
}
