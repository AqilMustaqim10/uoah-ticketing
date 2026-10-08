import { pool } from "./db";
import { listMessages } from "./pop3";

async function main() {
  const messages = await listMessages();
  let added = 0;
  for (const m of messages) {
    const r = await pool.query(
      `INSERT INTO processed_messages (uidl, outcome)
       VALUES ($1, 'BASELINE')
       ON CONFLICT (uidl) DO NOTHING`,
      [m.uidl],
    );
    added += r.rowCount ?? 0;
  }
  console.log(
    `Baseline done: ${added} new, ${messages.length} total in mailbox`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
