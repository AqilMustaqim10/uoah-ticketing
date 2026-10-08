import "dotenv/config";
import { runIngestion } from "./ingest";
import { pool } from "./db";

runIngestion()
  .catch((e) => {
    console.error("Ingestion failed:", e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
