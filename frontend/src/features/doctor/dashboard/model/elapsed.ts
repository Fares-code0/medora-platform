/**
 * "12 min ago" / "3 h ago" / "2 d ago", from an instant the server sent.
 * Shared by both adapters, so the demo and a live build age a row alike.
 */
export function waitedFor(since: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${String(hours)} h ago`;
  return `${String(Math.round(hours / 24))} d ago`;
}
