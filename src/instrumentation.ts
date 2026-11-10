export async function register() {
  // The checker needs Node APIs (SQLite, timers) and must not run during `next build`.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.DISABLE_SCHEDULER === "1") return;

  const { startScheduler } = await import("./lib/checker");
  startScheduler();
}
