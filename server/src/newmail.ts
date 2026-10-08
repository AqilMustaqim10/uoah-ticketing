import { pool } from "./db";
import { listMessages, fetchMessage } from "./pop3";
import type { ParsedMail } from "./pop3";

// Returns only emails we have never processed before
export async function getNewMail(): Promise<ParsedMail[]> {
  const messages = await listMessages();
  if (messages.length === 0) return [];

  const seen = await pool.query(
    "SELECT uidl FROM processed_messages WHERE uidl = ANY($1)",
    [messages.map((m) => m.uidl)],
  );
  const seenSet = new Set(seen.rows.map((r) => r.uidl));

  const fresh = messages.filter((m) => !seenSet.has(m.uidl));
  const result: ParsedMail[] = [];
  for (const m of fresh) {
    try {
      result.push(await fetchMessage(m.number, m.uidl));
    } catch (e) {
      console.error(`Skipping message ${m.number}:`, (e as Error).message);
    }
  }
  return result;
}
