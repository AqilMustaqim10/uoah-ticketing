import "dotenv/config";
import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { pool } from "./db";
import { sendCodeEmail } from "./mailer";

export const accountsRouter = Router();

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;

// Same answer whether or not the email exists, so nobody can probe for accounts
const GENERIC = {
  ok: true,
  message: "If this email can be used, a code has been sent. Check your inbox.",
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." },
});
// Only limit the routes that send or check codes, not /auth/me, /auth/units or /auth/login
accountsRouter.use(["/signup", "/reset"], limiter);
// ---------- helpers ----------

function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (e.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function domainAllowed(email: string): boolean {
  const domain = email.split("@")[1] ?? "";
  const allowed = (process.env.ALLOWED_SENDER_DOMAINS ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(domain);
}

function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password is required";
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (pw.length > 100) return "Password is too long";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))
    return "Password needs letters and numbers";
  return null;
}

function hashCode(email: string, purpose: string, code: string): string {
  return crypto
    .createHmac("sha256", process.env.JWT_SECRET as string)
    .update(`${email}|${purpose}|${code}`)
    .digest("hex");
}

type Pending = { name: string; passwordHash: string; unitId: number } | null;

// Creates a code and emails it. Returns silently if asked too soon after the last one.
async function issueCode(
  email: string,
  purpose: "SIGNUP" | "RESET",
  pending: Pending,
) {
  const recent = await pool.query(
    `SELECT 1 FROM email_codes
     WHERE email = $1 AND purpose = $2
       AND created_at > now() - ($3 || ' seconds')::interval
     LIMIT 1`,
    [email, purpose, String(RESEND_SECONDS)],
  );
  if (recent.rows.length > 0) return;

  // Only the newest code works
  await pool.query(
    "UPDATE email_codes SET used_at = now() WHERE email = $1 AND purpose = $2 AND used_at IS NULL",
    [email, purpose],
  );

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await pool.query(
    `INSERT INTO email_codes
       (email, purpose, code_hash, pending_name, pending_password_hash, pending_unit_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' minutes')::interval)`,
    [
      email,
      purpose,
      hashCode(email, purpose, code),
      pending?.name ?? null,
      pending?.passwordHash ?? null,
      pending?.unitId ?? null,
      String(CODE_MINUTES),
    ],
  );

  // Local testing only: print the code if email is not working yet
  if (process.env.DEV_LOG_CODES === "true")
    console.log(`[DEV] ${purpose} code for ${email}: ${code}`);

  sendCodeEmail(email, code, purpose, CODE_MINUTES).catch((e) =>
    console.error("Code email failed:", e.message),
  );
}

// Checks a code. Returns the saved row if correct, otherwise null.
async function checkCode(
  email: string,
  purpose: "SIGNUP" | "RESET",
  code: unknown,
) {
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim())) return null;

  // Count the attempt FIRST, so guessing always costs a try
  const r = await pool.query(
    `UPDATE email_codes SET attempts = attempts + 1
     WHERE id = (
       SELECT id FROM email_codes
       WHERE email = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY id DESC LIMIT 1
     ) AND attempts < $3
     RETURNING *`,
    [email, purpose, MAX_ATTEMPTS],
  );
  const row = r.rows[0];
  if (!row) return null;

  const a = Buffer.from(row.code_hash, "hex");
  const b = Buffer.from(hashCode(email, purpose, code.trim()), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  // Mark used. If two requests race, only one gets the row back.
  const used = await pool.query(
    "UPDATE email_codes SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING *",
    [row.id],
  );
  return used.rows[0] ?? null;
}

// ---------- routes ----------

// Units shown on the sign-up form
accountsRouter.get("/units", async (_req, res) => {
  try {
    const r = await pool.query(
      "SELECT id, code, name FROM business_units ORDER BY name",
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Step 1 of sign up: send the code
accountsRouter.post("/signup/request", async (req, res) => {
  const { name, password, unitId } = req.body ?? {};
  const email = normalizeEmail(req.body?.email);

  if (!email)
    return res.status(400).json({ error: "Enter a valid email address" });
  if (!domainAllowed(email)) {
    return res
      .status(400)
      .json({ error: "Registration is only open to company email addresses" });
  }
  if (typeof name !== "string" || name.trim().length < 2 || name.length > 100) {
    return res.status(400).json({ error: "Enter your full name" });
  }
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  try {
    const unit = await pool.query(
      "SELECT id FROM business_units WHERE id = $1",
      [Number(unitId)],
    );
    if (unit.rows.length === 0)
      return res.status(400).json({ error: "Choose your business unit" });

    const exists = await pool.query(
      "SELECT 1 FROM users WHERE lower(email) = $1",
      [email],
    );
    if (exists.rows.length === 0) {
      await issueCode(email, "SIGNUP", {
        name: name.trim(),
        passwordHash: await bcrypt.hash(password, 10),
        unitId: unit.rows[0].id,
      });
    }
    res.json(GENERIC);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Step 2 of sign up: check the code, create the account
accountsRouter.post("/signup/verify", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ error: "Invalid or expired code" });

  try {
    const row = await checkCode(email, "SIGNUP", req.body?.code);
    if (!row) return res.status(400).json({ error: "Invalid or expired code" });

    // Role is ALWAYS USER here. Only an admin can promote someone.
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, business_unit_id)
       VALUES ($1, $2, $3, 'USER', $4)
       ON CONFLICT (email) DO NOTHING`,
      [row.pending_name, email, row.pending_password_hash, row.pending_unit_id],
    );
    res.json({ ok: true, message: "Account created. You can log in now." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Reset step 1: send the code
accountsRouter.post("/reset/request", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email)
    return res.status(400).json({ error: "Enter a valid email address" });

  try {
    if (domainAllowed(email)) {
      const u = await pool.query(
        "SELECT password_hash, is_active FROM users WHERE lower(email) = $1",
        [email],
      );
      if (
        u.rows[0] &&
        u.rows[0].password_hash !== "!disabled!" &&
        u.rows[0].is_active
      ) {
        await issueCode(email, "RESET", null);
      }
    }
    res.json(GENERIC);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Reset step 2: check the code, set the new password
accountsRouter.post("/reset/confirm", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const pwProblem = passwordProblem(req.body?.newPassword);
  if (pwProblem) return res.status(400).json({ error: pwProblem });
  if (!email) return res.status(400).json({ error: "Invalid or expired code" });

  try {
    const row = await checkCode(email, "RESET", req.body?.code);
    if (!row) return res.status(400).json({ error: "Invalid or expired code" });

    await pool.query(
      "UPDATE users SET password_hash = $1, password_changed_at = now() WHERE lower(email) = $2 AND password_hash <> '!disabled!'",
      [await bcrypt.hash(req.body.newPassword, 10), email],
    );
    res.json({ ok: true, message: "Password changed. You can log in now." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
