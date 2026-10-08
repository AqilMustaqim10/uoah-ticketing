import "dotenv/config";
import nodemailer from "nodemailer";
import { pool } from "./db";

export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "localhost",
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure: process.env.SMTP_SECURE === "true",
  // Real mail servers need a login. Mailpit does not.
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

// Turns user text into harmless HTML text
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type TicketInfo = { id: number; title: string; priority: string };

export function ticketRef(id: number): string {
  return `[HD-${id}]`;
}

export async function sendTicketAck(ticket: TicketInfo, requesterId: number) {
  const result = await pool.query(
    "SELECT name, email FROM users WHERE id = $1",
    [requesterId],
  );
  const requester = result.rows[0];
  if (!requester) return;

  // Remove line breaks so a title can't smuggle extra email headers
  const safeTitle = ticket.title.replace(/[\r\n]+/g, " ");

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: requester.email,
    subject: `${ticketRef(ticket.id)} We received your request: ${safeTitle}`,
    text:
      `Hi ${requester.name},\n\n` +
      `We received your request and IT will look at it soon.\n\n` +
      `Reference: ${ticketRef(ticket.id)}\n` +
      `Title: ${safeTitle}\n` +
      `Priority: ${ticket.priority}\n`,
    html:
      `<p>Hi ${escapeHtml(requester.name)},</p>` +
      `<p>We received your request and IT will look at it soon.</p>` +
      `<p><strong>Reference:</strong> ${ticketRef(ticket.id)}<br>` +
      `<strong>Title:</strong> ${escapeHtml(safeTitle)}<br>` +
      `<strong>Priority:</strong> ${escapeHtml(ticket.priority)}</p>`,
    // Tell other mail systems "this is automatic, don't auto-reply to it"
    headers: {
      "Auto-Submitted": "auto-generated",
      Precedence: "bulk",
      "X-Auto-Response-Suppress": "All",
    },
  });
}
