import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
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

// ---------- Helpers ----------

// Runs several queries as ONE unit: all succeed, or none are saved.
async function inTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Writes one line to the audit log. Always called inside a transaction.
async function audit(
  client: PoolClient,
  ticketId: number,
  actorId: number,
  action: string,
  details: Record<string, unknown> = {},
) {
  await client.query(
    `INSERT INTO audit_log (ticket_id, actor_id, action, details)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, actorId, action, JSON.stringify(details)],
  );
}

type Outcome = { code: number; body: unknown };

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

// Is this ticket inside the user's scope? Used by comments and audit routes.
async function findScopedTicket(user: AuthUser, id: number): Promise<boolean> {
  const scope = ticketScope(user, 2);
  const result = await pool.query(
    `SELECT t.id FROM tickets t WHERE t.id = $1 AND ${scope.sql}`,
    [id, ...scope.params],
  );
  return result.rows.length > 0;
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
    const ticket = await inTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO tickets (title, description, priority, created_by, business_unit_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [title.trim(), description, priority, user.id, user.businessUnitId],
      );
      const created = result.rows[0];
      await audit(client, created.id, user.id, "TICKET_CREATED", {
        title: created.title,
        priority,
      });
      return created;
    });
    res.status(201).json(ticket);
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
    const user = req.user!;
    const id = Number(req.params.id);
    const { status } = req.body;

    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }
    if (typeof status !== "string" || !(status in TRANSITIONS)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const scope = ticketScope(user, 2);
    try {
      const outcome: Outcome = await inTransaction(async (client) => {
        // FOR UPDATE locks the row so two people can't change it at the same moment
        const current = await client.query(
          `SELECT t.status FROM tickets t WHERE t.id = $1 AND ${scope.sql} FOR UPDATE`,
          [id, ...scope.params],
        );
        if (current.rows.length === 0) {
          return { code: 404, body: { error: "Ticket not found" } };
        }

        const from: string = current.rows[0].status;
        if (!TRANSITIONS[from].includes(status)) {
          return {
            code: 400,
            body: { error: `Cannot change from ${from} to ${status}` },
          };
        }

        const updated = await client.query(
          "UPDATE tickets SET status = $1 WHERE id = $2 RETURNING *",
          [status, id],
        );
        await audit(client, id, user.id, "STATUS_CHANGED", {
          from,
          to: status,
        });
        return { code: 200, body: updated.rows[0] };
      });
      res.status(outcome.code).json(outcome.body);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  },
);

// ---------- Comments ----------

app.get("/tickets/:id/comments", requireAuth, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  try {
    if (!(await findScopedTicket(user, id))) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    // Requesters must never receive internal notes. Filtered here on the server.
    const hideInternal = user.role === "USER";
    const result = await pool.query(
      `SELECT c.id, c.body, c.is_internal, c.created_at,
              u.name AS author_name, u.role AS author_role
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.ticket_id = $1 ${hideInternal ? "AND c.is_internal = FALSE" : ""}
       ORDER BY c.id ASC`,
      [id],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/tickets/:id/comments", requireAuth, async (req, res) => {
  const user = req.user!;
  const id = Number(req.params.id);
  const { body, internal = false } = req.body;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }
  if (typeof body !== "string" || body.trim() === "") {
    return res.status(400).json({ error: "Comment cannot be empty" });
  }
  if (body.length > 5000) {
    return res
      .status(400)
      .json({ error: "Comment is too long (max 5000 characters)" });
  }
  if (internal === true && user.role === "USER") {
    return res.status(403).json({ error: "You do not have permission" });
  }

  try {
    if (!(await findScopedTicket(user, id))) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const comment = await inTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO comments (ticket_id, author_id, body, is_internal)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [id, user.id, body.trim(), internal === true],
      );
      await audit(client, id, user.id, "COMMENT_ADDED", {
        commentId: result.rows[0].id,
        internal: internal === true,
      });
      return result.rows[0];
    });
    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------- Audit history (IT and ADMIN only) ----------

app.get(
  "/tickets/:id/audit",
  requireAuth,
  requireRole("ADMIN", "IT"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Invalid ticket id" });
    }

    try {
      if (!(await findScopedTicket(req.user!, id))) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      const result = await pool.query(
        `SELECT a.id, a.action, a.details, a.created_at, u.name AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.ticket_id = $1
         ORDER BY a.id ASC`,
        [id],
      );
      res.json(result.rows);
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
