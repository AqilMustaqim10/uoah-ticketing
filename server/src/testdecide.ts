import { getNewMail } from "./newmail";
import { decide } from "./classify";
import { pool } from "./db";

async function main() {
  // Look at ALL mail without relying on the baseline, to see decisions
  const mails = await getNewMail();
  console.log(`New emails: ${mails.length}`);
  for (const m of mails) {
    const d = await decide(m);
    console.log("-----");
    console.log("From:   ", m.from);
    console.log("Subject:", m.subject);
    console.log("Decision:", d.action, "|", d.reason);
  }
  await pool.end();
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
