import { looksAutomatic } from "./classify";
import type { ParsedMail } from "./pop3";

function mail(overrides: Partial<ParsedMail>): ParsedMail {
  return {
    uidl: "x",
    messageId: null,
    from: "person@company.com",
    subject: "Printer broken",
    text: "",
    date: null,
    autoSubmitted: null,
    precedence: null,
    autoResponseSuppress: null,
    returnPath: null,
    contentType: "text/plain",
    inReplyTo: null,
    references: [],
    ...overrides,
  };
}

const cases: [string, Partial<ParsedMail>, boolean][] = [
  ["normal human email", {}, false],
  ["mailer-daemon bounce", { from: "mailer-daemon@mail.com" }, true],
  ["no-reply sender", { from: "noreply@vendor.com" }, true],
  ["auto-generated header", { autoSubmitted: "auto-generated" }, true],
  ["Auto-Submitted: no (human)", { autoSubmitted: "no" }, false],
  ["bulk precedence", { precedence: "bulk" }, true],
  ["delivery report", { contentType: "multipart/report" }, true],
  ["out of office subject", { subject: "Out of Office: back Monday" }, true],
  [
    "our own mailbox",
    { from: (process.env.POP3_USER ?? "helpdesk@x.com").toLowerCase() },
    true,
  ],
];

let failed = 0;
for (const [name, o, expectIgnore] of cases) {
  const reason = looksAutomatic(mail(o));
  const ok = (reason !== null) === expectIgnore;
  if (!ok) failed++;
  console.log(ok ? "PASS" : "FAIL", "-", name, reason ? `(${reason})` : "");
}
console.log(failed === 0 ? "\nAll passed" : `\n${failed} FAILED`);
