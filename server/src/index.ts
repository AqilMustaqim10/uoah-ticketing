import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import { pool } from "./db";
import { requireAuth, requireRole, signToken } from "./auth";
import type { AuthUser } from "./auth";

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
      `SELECT u.id, u.name, u.role, u.password_hash, u.business_unit_id,
              bu.code AS unit_code
       FROM users u
       LEFT JOIN business_units bu ON bu.id = u.business_unit_id
       WHERE u.email = $1`,
      [email.trim().toLowerCase()],
    );
    const user = result.rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));

    if (!ok) {
      return res.status(401).json({ error: "Wrong email or password" });
    }

    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      role: user.role,
      businessUnitId: user.business_unit_id,
      unitCode: user.unit_code,
    };

    res.cookie("token", signToken(authUser), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 8 * 60 * 60 * 1000,
    });
    res.json(authUser);
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

// ---------- Ticket scoping: THE one place that decides who sees what ----------

function ticketScope(user: AuthUser, paramIndex: number) {
  if (user.role === "ADMIN") {
    return { sql: "TRUE", params: [] as unknown[] };
  }
  if (user.role === "IT") {
    // If an IT user somehow has no unit, match nothing (fail closed)
    if (user.businessUnitId === null) {
      return { sql: "FALSE", params: [] as unknown[] };
    }
    return {
      sql: `t.business_unit_id = $${paramIndex}`,
      params: [user.businessUnitId],
    };
  }
  return { sql: `t.created_by = $${paramIndex}`, params: [user.id] };
}

const TICKET_SELECT = `
  SELECT t.*, bu.code AS unit_code
  FROM tickets t
  LEFT JOIN business_units bu ON bu.id = t.business_unit_id
`;

// ---------- Tickets ----------

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

app.get("/tickets", requireAuth, async (req, res) => {
  const scope = ticketScope(req.user!, 1);
  try {
    const result = await pool.query(
      `${TICKET_SELECT} WHERE ${scope.sql} ORDER BY t.id DESC`,
      scope.params,
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/tickets/:id", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  const scope = ticketScope(req.user!, 2);
  try {
    const result = await pool.query(
      `${TICKET_SELECT} WHERE t.id = $1 AND ${scope.sql}`,
      [id, ...scope.params],
    );
    // 404 for "not yours" too, so we never reveal that it exists
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/tickets", requireAuth, async (req, res) => {
  const user = req.user!;
  const { title, description = "", priority = "MEDIUM" } = req.body;

  if (user.businessUnitId === null) {
    return res.status(400).json({ error: "Your account has no business unit" });
  }
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "Title is required" });
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Invalid priority" });
  }

  try {
    // The unit comes from the logged-in user, NEVER from the browser's request
    const result = await pool.query(
      `INSERT INTO tickets (title, description, priority, created_by, business_unit_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title.trim(), description, priority, user.id, user.businessUnitId],
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

    const scope = ticketScope(req.user!, 2);
    try {
      // Only finds the ticket if it is inside this user's scope
      const current = await pool.query(
        `SELECT t.status FROM tickets t WHERE t.id = $1 AND ${scope.sql}`,
        [id, ...scope.params],
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
