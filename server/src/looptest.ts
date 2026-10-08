import "dotenv/config";
import { transporter } from "./mailer";

async function main() {
  const helpdesk = process.env.POP3_USER!;

  // 1. Looks like our own mail coming back
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: helpdesk,
    subject: "Loop test 1 (plain, from own mailbox)",
    text: "This should be ignored.",
  });

  // 2. Carries the automatic-mail headers
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: helpdesk,
    subject: "Loop test 2 (auto headers)",
    text: "This should be ignored too.",
    headers: { "Auto-Submitted": "auto-generated", Precedence: "bulk" },
  });

  console.log("Sent 2 loop-test emails to", helpdesk);
}

main().catch((e) => {
  console.error("Failed:", e.message);
  process.exit(1);
});
