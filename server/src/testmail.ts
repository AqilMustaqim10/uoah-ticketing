import "dotenv/config";
import { transporter } from "./mailer";

async function main() {
  await transporter.verify();
  console.log("SMTP login OK");

  const to = process.argv[2];
  if (to) {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Helpdesk test email",
      text: "If you can read this, SMTP works.",
    });
    console.log("Test email sent to", to);
  }
}

main().catch((err) => {
  console.error("SMTP failed:", err.message);
  process.exit(1);
});
