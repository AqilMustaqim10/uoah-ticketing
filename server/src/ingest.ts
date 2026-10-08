import type { PoolClient } from "pg";
import { pool } from "./db";
import { getNewMail } from "./newmail";
import { decide } from "./classify";
import { sendTicketAck, sendRejection } from "./mailer";
import type { ParsedMail } from "./pop3";

const MAX_BODY = 5000;

// Light cleanup for now. Stage 9G does the real signature stripping.
function cleanBody(text: string): string {
  return text.trim().slice(0, MAX_BODY);
}

function cleanSubject(subject: string): string {
  return subject
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .trim()
    .slice(0, 200);
}

async function audit(
  client: PoolClient,
  ticketId: number,
  actorId: number | null,
  action: string,
  details: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO audit_log (ticket_id, actor_id, action, details) VALUES ($1, $2, $3, $4)`,
    [ticketId, actorId, action, JSON.stringify(details)],
  );
}

// Returns null if another worker already claimed this message
async function claim(
  client: PoolClient,
  mail: ParsedMail,
  outcome: string,
): Promise<number | null> {
  const r = await client.query(
    `INSERT INTO processed_messages (uidl, message_id, from_address, subject, outcome)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (uidl) DO NOTHING
     RETURNING id`,
    [mail.uidl, mail.messageId, mail.from, mail.subject.slice(0, 300), outcome],
  );
  return r.rows[0]?.id ?? null;
}

export async function processMail(mail: ParsedMail): Promise<string> {
  const decision = await decide(mail);
  const client = await pool.connect();
  let ackTicket: { id: number; title: string; priority: string } | null = null;
  let ackUserId: number | null = null;
  let rejectTo: string | null = null;
  let summary = "";

  try {
    await client.query("BEGIN");
    const claimed = await claim(client, mail, decision.action);
    if (claimed === null) {
      await client.query("ROLLBACK");
      return "skipped (already processed)";
    }

    if (decision.action === "IGNORE") {
      await client.query(
        "UPDATE processed_messages SET outcome = 'IGNORED_AUTO' WHERE id = $1",
        [claimed],
      );
      summary = `ignored: ${decision.reason}`;
    } else if (decision.action === "REPLY") {
      const c = await client.query(
        `INSERT INTO comments (ticket_id, author_id, body, is_internal)
         VALUES ($1, $2, $3, FALSE) RETURNING id`,
        [
          decision.ticketId,
          decision.senderUserId,
          cleanBody(mail.text) || "(empty email)",
        ],
      );
      await audit(
        client,
        decision.ticketId,
        decision.senderUserId,
        "COMMENT_ADDED",
        {
          commentId: c.rows[0].id,
          internal: false,
          via: "email",
        },
      );
      await client.query(
        "UPDATE processed_messages SET outcome = 'REPLY_ADDED', ticket_id = $2 WHERE id = $1",
        [claimed, decision.ticketId],
      );
      summary = `reply added to HD-${decision.ticketId}`;
    } else if (
      decision.action === "NEW_TICKET" &&
      decision.senderUserId === null
    ) {
      // Unknown sender: no ticket. Maybe send one rejection email.
      const domain = (mail.from ?? "").split("@")[1] ?? "";
      const allowedDomains = (process.env.ALLOWED_SENDER_DOMAINS ?? "")
        .toLowerCase()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const recent = await client.query(
        `SELECT 1 FROM processed_messages
         WHERE from_address = $1 AND outcome = 'REJECTED_UNKNOWN'
           AND id <> $2 AND created_at > now() - interval '24 hours'
         LIMIT 1`,
        [mail.from, claimed],
      );

      if (allowedDomains.includes(domain) && recent.rows.length === 0) {
        rejectTo = mail.from;
        await client.query(
          "UPDATE processed_messages SET outcome = 'REJECTED_UNKNOWN' WHERE id = $1",
          [claimed],
        );
        summary = "unknown sender: rejection email will be sent";
      } else {
        await client.query(
          "UPDATE processed_messages SET outcome = 'REJECTED_NO_REPLY' WHERE id = $1",
          [claimed],
        );
        summary =
          "unknown sender: ignored silently (outside allowed domains, or already told in last 24h)";
      }
    } else if (decision.action === "NEW_TICKET") {
      // Known sender: create the ticket
      const requesterId = decision.senderUserId as number;
      const unit = await client.query(
        "SELECT business_unit_id FROM users WHERE id = $1",
        [requesterId],
      );
      const title = cleanSubject(mail.subject) || "(no subject)";

      const t = await client.query(
        `INSERT INTO tickets (title, description, priority, created_by, business_unit_id, source, requester_email)
         VALUES ($1, $2, 'MEDIUM', $3, $4, 'EMAIL', $5)
         RETURNING id, title, priority`,
        [
          title,
          cleanBody(mail.text),
          requesterId,
          unit.rows[0].business_unit_id,
          mail.from,
        ],
      );
      const ticket = t.rows[0];
      await audit(client, ticket.id, requesterId, "TICKET_CREATED", {
        title,
        priority: "MEDIUM",
        via: "email",
        from: mail.from,
      });
      await client.query(
        "UPDATE processed_messages SET outcome = 'TICKET_CREATED', ticket_id = $2 WHERE id = $1",
        [claimed, ticket.id],
      );
      summary = `ticket HD-${ticket.id} created (${decision.reason})`;
      ackTicket = ticket;
      ackUserId = requesterId;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // After commit, so an email failure can never undo the ticket
  if (ackTicket && ackUserId !== null) {
    sendTicketAck(ackTicket, ackUserId).catch((e) =>
      console.error("Acknowledgment email failed:", e.message),
    );
  }
  if (rejectTo) {
    sendRejection(rejectTo).catch((e) =>
      console.error("Rejection email failed:", e.message),
    );
  }
  return summary;
}

export async function runIngestion(): Promise<void> {
  const mails = await getNewMail();
  console.log(`Ingestion: ${mails.length} new email(s)`);
  for (const mail of mails) {
    try {
      const result = await processMail(mail);
      console.log(`- "${mail.subject}" -> ${result}`);
    } catch (e) {
      console.error(`- "${mail.subject}" FAILED:`, (e as Error).message);
    }
  }
}
