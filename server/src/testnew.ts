import { getNewMail } from "./newmail";
import { pool } from "./db";

async function main() {
  const mails = await getNewMail();
  console.log(`New emails: ${mails.length}`);
  for (const m of mails) {
    console.log("-", m.from, "|", m.subject);
  }
  await pool.end();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
