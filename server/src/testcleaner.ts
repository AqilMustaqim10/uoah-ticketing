import { cleanEmailBody } from "./cleaner";

const cases: [string, string, string][] = [
  [
    "simple + signature delimiter",
    "Printer is offline\n\n--\nAqil\nOfficer, IT\nM. 010-4454212",
    "Printer is offline",
  ],
  [
    "regards",
    "Wi-Fi is down in lobby.\n\nBest regards,\nAqil",
    "Wi-Fi is down in lobby.",
  ],
  [
    "gmail reply",
    "Thanks, fixed.\n\nOn Mon, 5 Oct 2026 at 10:00, Helpdesk <h@x.com> wrote:\n> We received your request",
    "Thanks, fixed.",
  ],
  [
    "outlook reply",
    "Still not working.\n\n-----Original Message-----\nFrom: IT\nSent: Monday",
    "Still not working.",
  ],
  ["iphone", "POS not printing\n\nSent from my iPhone", "POS not printing"],
  ["only a signature (fail safe)", "Regards,\nAqil", "Regards,\nAqil"],
  [
    "phone number is the problem",
    "Call me on 010-4454212 about the broken printer",
    "Call me on 010-4454212 about the broken printer",
  ],
  [
    "outlook signature, no regards",
    "Printer at front desk is offline.\n\nAqil Mustaqim\nOfficer, Information Technology\nE. <mailto:aqil@x.com> aqil@x.com\nM. 010-4454212",
    "Printer at front desk is offline.",
  ],
  [
    "phone number inside the sentence is kept",
    "Call me on 010-4454212 about the printer\n\nThanks for your help",
    "Call me on 010-4454212 about the printer\n\nThanks for your help",
  ],
];

let failed = 0;
for (const [name, input, expected] of cases) {
  const out = cleanEmailBody(input);
  const ok = out === expected;
  if (!ok) {
    failed++;
    console.log("FAIL -", name, "\n  got:     ", JSON.stringify(out));
  } else console.log("PASS -", name);
}
console.log(failed === 0 ? "\nAll passed" : `\n${failed} FAILED`);
