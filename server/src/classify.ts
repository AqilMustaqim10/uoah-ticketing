import { pool } from "./db";
import type { ParsedMail } from "./pop3";

export type Decision =
  | { action: "IGNORE"; reason: string }
  | { action: "REPLY"; ticketId: number; senderUserId: number; reason: string }
  | { action: "NEW_TICKET"; senderUserId: number | null; reason: string };

// ---------- 9D: is this email automatic? (pure function, no database) ----------

const AUTO_SENDERS =
  /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|noreply|bounce[s]?)@/i;
const AUTO_SUBJECTS =
  /^\s*(auto(matic)?[\s-]*(reply|response|acknowledg?ment)|\[auto-acknowledg?ment\]|out of office|undeliverable|delivery status notification|mail delivery failed|returned mail)/i;

export function looksAutomatic(mail: ParsedMail): string | null {
  const own = [process.env.POP3_USER, process.env.SMTP_USER]
    .filter(Boolean)
    .map((a) => a!.toLowerCase());

  if (!mail.from) return "no sender address";
  if (own.includes(mail.from)) return "sent by our own mailbox";
  if (AUTO_SENDERS.test(mail.from)) return "automatic sender address";

  if (mail.autoSubmitted && mail.autoSubmitted.toLowerCase().trim() !== "no")
    return "Auto-Submitted header";
  if (mail.autoResponseSuppress) return "X-Auto-Response-Suppress header";
  if (
    mail.precedence &&
    /^(bulk|junk|list|auto_reply)$/i.test(mail.precedence.trim())
  )
    return "Precedence header";
  if (mail.returnPath && mail.returnPath.trim() === "<>")
    return "empty return-path (bounce)";

  if (
    mail.contentType &&
    /multipart\/report|delivery-status/i.test(mail.contentType)
  )
    return "delivery report (bounce)";
  if (AUTO_SUBJECTS.test(mail.subject)) return "automatic subject line";

  return null; // looks like a real human email
}

// ---------- 9E: thread a reply onto an existing ticket ----------

const TICKET_TOKEN = /\[HD-(\d+)\]/i;

export async function decide(mail: ParsedMail): Promise<Decision> {
  const autoReason = looksAutomatic(mail);
  if (autoReason) return { action: "IGNORE", reason: autoReason };

  // Who is the sender? (null if not a known user)
  const senderRes = await pool.query(
    "SELECT id, role, business_unit_id FROM users WHERE lower(email) = $1",
    [mail.from],
  );
  const sender = senderRes.rows[0] ?? null;

  const match = mail.subject.match(TICKET_TOKEN);
  if (!match) {
    return {
      action: "NEW_TICKET",
      senderUserId: sender?.id ?? null,
      reason: sender
        ? "new request from known user"
        : "new request from unknown sender",
    };
  }

  const ticketId = Number(match[1]);
  const ticketRes = await pool.query(
    "SELECT id, created_by, business_unit_id FROM tickets WHERE id = $1",
    [ticketId],
  );
  const ticket = ticketRes.rows[0];

  if (!ticket) {
    return {
      action: "NEW_TICKET",
      senderUserId: sender?.id ?? null,
      reason: `HD-${ticketId} does not exist, treated as new request`,
    };
  }

  // Only people who may see this ticket can add to it
  const allowed =
    sender &&
    (sender.id === ticket.created_by ||
      sender.role === "ADMIN" ||
      (sender.role === "IT" &&
        sender.business_unit_id === ticket.business_unit_id));

  if (!allowed) {
    return {
      action: "NEW_TICKET",
      senderUserId: sender?.id ?? null,
      reason: `sender not allowed on HD-${ticketId}, treated as new request`,
    };
  }

  return {
    action: "REPLY",
    ticketId,
    senderUserId: sender.id,
    reason: `reply to HD-${ticketId}`,
  };
}
