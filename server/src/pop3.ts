import "dotenv/config";
import POP3Client from "poplib";
import { simpleParser } from "mailparser";

export type ParsedMail = {
  uidl: string;
  messageId: string | null;
  from: string | null;
  subject: string;
  text: string;
  date: Date | null;
  autoSubmitted: string | null;
  precedence: string | null;
  autoResponseSuppress: string | null;
  returnPath: string | null;
  contentType: string | null;
  inReplyTo: string | null;
  references: string[];
};

// Connects, runs one job, then disconnects. Read-only: never deletes anything.
function withPop3<T>(
  job: (client: any, done: (r: T) => void, fail: (e: Error) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const client = new POP3Client(
      Number(process.env.POP3_PORT ?? 995),
      process.env.POP3_HOST,
      {
        tlserrs: false,
        enabletls: process.env.POP3_TLS !== "false",
        debug: false,
      },
    );

    const fail = (e: Error) => {
      try {
        client.quit();
      } catch {}
      reject(e);
    };

    const done = (r: T) => {
      client.quit();
      resolve(r);
    };

    client.on("error", (err: Error) => fail(err));

    client.on("connect", () =>
      client.login(process.env.POP3_USER, process.env.POP3_PASS),
    );

    client.on("login", (ok: boolean) => {
      if (!ok) return fail(new Error("POP3 login failed"));
      job(client, done, fail);
    });
  });
}

// Returns [{ number, uidl }] for every message in the mailbox
export function listMessages(): Promise<{ number: number; uidl: string }[]> {
  return withPop3((client, done, fail) => {
    client.on("uidl", (ok: boolean, ...args: any[]) => {
      if (!ok) return fail(new Error("UIDL not supported"));

      // The raw server reply is the long string containing line breaks
      const raw = args.find((a) => typeof a === "string" && a.includes("\n"));

      if (!raw) return done([]);

      const rows = String(raw)
        .split(/\r?\n/)
        .map((line) => line.trim().match(/^(\d+)\s+(\S+)$/))
        // lines like "3 abc123"
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => ({
          number: Number(m[1]),
          uidl: m[2],
        }));

      done(rows);
    });

    client.uidl();
  });
}

// Downloads and parses ONE message by its POP3 number
export function fetchMessage(
  number: number,
  uidl: string,
): Promise<ParsedMail> {
  return withPop3((client, done, fail) => {
    client.on("retr", async (ok: boolean, _n: number, raw: string) => {
      if (!ok) {
        return fail(
          new Error(
            `Could not read message ${number}: ${String(raw).slice(0, 200)}`,
          ),
        );
      }

      try {
        const m = await simpleParser(raw);

        const header = (name: string): string | null => {
          const v: any = m.headers.get(name);

          if (v === undefined || v === null) return null;

          if (typeof v === "string") return v;

          if (typeof v === "object" && typeof v.value === "string") {
            return v.value;
          }

          if (typeof v === "object" && typeof v.text === "string") {
            return v.text;
          }

          return String(v);
        };

        done({
          uidl,
          messageId: m.messageId ?? null,
          from: m.from?.value?.[0]?.address?.toLowerCase() ?? null,
          subject: m.subject ?? "(no subject)",
          text: m.text ?? "",
          date: m.date ?? null,

          autoSubmitted: header("auto-submitted"),
          precedence: header("precedence"),
          autoResponseSuppress: header("x-auto-response-suppress"),
          returnPath: header("return-path"),
          contentType: header("content-type"),

          inReplyTo: m.inReplyTo ?? null,

          references: Array.isArray(m.references)
            ? m.references
            : m.references
              ? [m.references]
              : [],
        });
      } catch (e) {
        fail(e as Error);
      }
    });

    client.retr(number);
  });
}
