import { listMessages, fetchMessage } from "./pop3";

async function main() {
  const messages = await listMessages();
  console.log(`Mailbox has ${messages.length} message(s)`);

  // Read only the 3 newest, so we never download a huge mailbox
  for (const m of messages.slice(-3)) {
    const mail = await fetchMessage(m.number, m.uidl);
    console.log("-----");
    console.log("From:   ", mail.from);
    console.log("Subject:", mail.subject);
    console.log("Body:   ", mail.text.slice(0, 200).replace(/\s+/g, " "));
  }
}

main().catch((err) => {
  console.error("POP3 failed:", err.message);
  process.exit(1);
});
