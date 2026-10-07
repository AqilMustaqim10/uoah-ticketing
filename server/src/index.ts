import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { requireAuth, requireRole, signToken } from "./auth";

const app = express();

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ---------- Auth ----------

app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query(
      "SELECT id, name, role, password_hash FROM users WHERE email = $1",
      [email.trim().toLowerCase()],
    );
    const user = result.rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));

    // Same message for "no such user" and "wrong password" on purpose,
    // so attackers can't discover which emails exist.
    if (!ok) {
      return res.status(401).json({ error: "Wrong email or password" });
    }

    const token = signToken({ id: user.id, name: user.name, role: user.role });
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.json({ id: user.id, name: user.name, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/logout", (_req, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});

// ---------- Tickets ----------

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

app.get("/tickets", requireAuth, async (req, res) => {
  const user = req.user!;
  try {
    // USER sees only their own tickets; IT and ADMIN see all (for now)
    const result =
      user.role === "USER"
        ? await pool.query(
            "SELECT * FROM tickets WHERE created_by = $1 ORDER BY id DESC",
            [user.id],
          )
        : await pool.query("SELECT * FROM tickets ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/tickets/:id", requireAuth, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  try {
    const result = await pool.query("SELECT * FROM tickets WHERE id = $1", [
      id,
    ]);
    const ticket = result.rows[0];

    // 404 (not 403) for other people's tickets, so we don't reveal they exist
    if (!ticket || (user.role === "USER" && ticket.created_by !== user.id)) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    res.json(ticket);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/tickets", requireAuth, async (req, res) => {
  const user = req.user!;
  const { title, description = "", priority = "MEDIUM" } = req.body;

  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "Title is required" });
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Invalid priority" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tickets (title, description, priority, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [title.trim(), description, priority, user.id],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.patch(
  "/tickets/:id/status",
  requireAuth,
  requireRole("ADMIN", "IT"),
  async (req, res) => {
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    if (typeof status !== "string" || !(status in TRANSITIONS)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    try {
      const current = await pool.query(
        "SELECT status FROM tickets WHERE id = $1",
        [id],
      );
      if (current.rows.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }

      const from: string = current.rows[0].status;
      if (!TRANSITIONS[from].includes(status)) {
        return res
          .status(400)
          .json({ error: `Cannot change from ${from} to ${status}` });
      }

      const result = await pool.query(
        "UPDATE tickets SET status = $1 WHERE id = $2 RETURNING *",
        [status, id],
      );
      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  },
);

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
