// Client-safe formatting helpers.

const priceFormat = new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR" });

export function formatPrice(value: number | null | undefined): string | null {
  return typeof value === "number" ? priceFormat.format(value) : null;
}

export function timeAgo(timestamp: number | null | undefined, now = Date.now()): string {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = minutes / 60;
  if (Number.isInteger(hours)) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${minutes} minutes`;
}
