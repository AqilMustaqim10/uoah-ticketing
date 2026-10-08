import "dotenv/config";
import { runIngestion } from "./ingest";

const intervalMs =
  Math.max(30, Number(process.env.INGEST_INTERVAL_SECONDS ?? 60)) * 1000;
let running = false;

async function tick() {
  if (running) {
    console.log("Previous ingestion still running, skipping this tick");
    return;
  }
  running = true;
  const started = new Date().toLocaleTimeString();
  try {
    console.log(`[${started}] Checking mailbox...`);
    await runIngestion();
  } catch (e) {
    console.error("Ingestion error (will retry):", (e as Error).message);
  } finally {
    running = false;
  }
}

console.log(
  `Mail worker started. Checking every ${intervalMs / 1000}s. Press Ctrl+C to stop.`,
);
tick();
setInterval(tick, intervalMs);
