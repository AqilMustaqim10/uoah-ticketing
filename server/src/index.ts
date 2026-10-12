import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { requireAuth, requireRole, signToken } from "./auth";
import type { AuthUser } from "./auth";
import { sendTicketAck } from "./mailer";
import { accountsRouter } from "./accounts";
import { adminRouter } from "./adminUsers";

const app = express();

app.use(cors({ origin: "http://localhost:5173", credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/auth", accountsRouter);
app.use("/admin", adminRouter);

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
      `SELECT u.id, u.name, u.role, u.password_hash, u.business_unit_id, u.is_active,
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

    if (!user.is_active) {
      return res
        .status(403)
        .json({ error: "This account has been disabled. Contact IT." });
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
  SELECT t.*, bu.code AS unit_code, a.name AS assignee_name
  FROM tickets t
  LEFT JOIN business_units bu ON bu.id = t.business_unit_id
  LEFT JOIN users a ON a.id = t.assigned_to
`;

// ---------- Tickets ----------

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

app.get("/tickets", requireAuth, async (req, res) => {
  const user = req.user!;
  const q = req.query;

  const scope = ticketScope(user, 1);
  const params: unknown[] = [...scope.params];
  const where: string[] = [scope.sql];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const status = typeof q.status === "string" ? q.status : "";
  if (status) {
    if (!STATUSES.includes(status))
      return res.status(400).json({ error: "Invalid status" });
    where.push(`t.status = ${add(status)}`);
  }

  const priority = typeof q.priority === "string" ? q.priority : "";
  if (priority) {
    if (!VALID_PRIORITIES.includes(priority))
      return res.status(400).json({ error: "Invalid priority" });
    where.push(`t.priority = ${add(priority)}`);
  }

  // Unit and assignee are only filters INSIDE the user's scope
  const unit = typeof q.unit === "string" ? q.unit : "";
  if (unit) {
    const n = Number(unit);
    if (!Number.isInteger(n))
      return res.status(400).json({ error: "Invalid unit" });
    where.push(`t.business_unit_id = ${add(n)}`);
  }

  const assignee = typeof q.assignee === "string" ? q.assignee : "";
  if (assignee === "none") {
    where.push("t.assigned_to IS NULL");
  } else if (assignee) {
    const n = Number(assignee);
    if (!Number.isInteger(n))
      return res.status(400).json({ error: "Invalid assignee" });
    where.push(`t.assigned_to = ${add(n)}`);
  }

  const search = typeof q.q === "string" ? q.q.trim().slice(0, 100) : "";
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    const p = add(like);
    const idMatch = search.match(/^(?:hd-)?(\d+)$/i);
    const idClause = idMatch ? ` OR t.id = ${add(Number(idMatch[1]))}` : "";
    where.push(
      `(t.title ILIKE ${p} OR t.description ILIKE ${p} OR t.requester_email ILIKE ${p}${idClause})`,
    );
  }

  try {
    const result = await pool.query(
      `${TICKET_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.id DESC LIMIT 500`,
      params,
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

    // Send the acknowledgment AFTER responding. If email fails, the ticket still exists.
    sendTicketAck(ticket, user.id).catch((err) =>
      console.error("Acknowledgment email failed:", err.message),
    );
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

// ---------- Dashboard stats (IT and ADMIN only) ----------

app.get("/stats", requireAuth, requireRole("ADMIN", "IT"), async (req, res) => {
  const scope = ticketScope(req.user!, 1);

  // A manual due date wins. Without one, fall back to the priority rule.
  const OVERDUE = `
    t.status IN ('OPEN', 'IN_PROGRESS')
    AND (CASE
      WHEN t.due_at IS NOT NULL THEN t.due_at < now()
      ELSE t.created_at < now() - (CASE t.priority
        WHEN 'URGENT' THEN interval '4 hours'
        WHEN 'HIGH'   THEN interval '8 hours'
        WHEN 'MEDIUM' THEN interval '24 hours'
        ELSE interval '72 hours' END)
    END)
  `;

  try {
    const [byStatus, byPriority, byUnit, overdue, overdueList] =
      await Promise.all([
        pool.query(
          `SELECT t.status AS key, count(*)::int AS n
         FROM tickets t WHERE ${scope.sql} GROUP BY t.status`,
          scope.params,
        ),
        pool.query(
          `SELECT t.priority AS key, count(*)::int AS n
         FROM tickets t WHERE ${scope.sql} GROUP BY t.priority`,
          scope.params,
        ),
        pool.query(
          `SELECT COALESCE(bu.code, 'none') AS key, count(*)::int AS n
         FROM tickets t
         LEFT JOIN business_units bu ON bu.id = t.business_unit_id
         WHERE ${scope.sql} GROUP BY bu.code`,
          scope.params,
        ),
        pool.query(
          `SELECT count(*)::int AS n FROM tickets t WHERE ${scope.sql} AND ${OVERDUE}`,
          scope.params,
        ),
        pool.query(
          `SELECT t.id FROM tickets t WHERE ${scope.sql} AND ${OVERDUE} ORDER BY t.id`,
          scope.params,
        ),
      ]);

    const toMap = (rows: { key: string; n: number }[]) =>
      Object.fromEntries(rows.map((r) => [r.key, r.n]));

    res.json({
      byStatus: toMap(byStatus.rows),
      byPriority: toMap(byPriority.rows),
      byUnit: toMap(byUnit.rows),
      overdue: overdue.rows[0].n,
      overdueIds: overdueList.rows.map((r) => r.id),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// ---------- CSV export (IT and ADMIN only) ----------

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  s = s.replace(/\r?\n/g, " ");
  // Stop Excel running formulas that came from ticket text
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

app.get(
  "/export/tickets.csv",
  requireAuth,
  requireRole("ADMIN", "IT"),
  async (req, res) => {
    const scope = ticketScope(req.user!, 1);
    try {
      const result = await pool.query(
        `SELECT t.id, t.title, t.status, t.priority, bu.code AS unit,
              t.source, t.requester_email, t.created_at
       FROM tickets t
       LEFT JOIN business_units bu ON bu.id = t.business_unit_id
       WHERE ${scope.sql}
       ORDER BY t.id`,
        scope.params,
      );

      const header = [
        "ID",
        "Title",
        "Status",
        "Priority",
        "Unit",
        "Source",
        "Requester email",
        "Created",
      ];
      const lines = [header.map(csvCell).join(",")];
      for (const r of result.rows) {
        lines.push(
          [
            r.id,
            r.title,
            r.status,
            r.priority,
            r.unit,
            r.source,
            r.requester_email,
            new Date(r.created_at).toISOString(),
          ]
            .map(csvCell)
            .join(","),
        );
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="tickets.csv"',
      );
      // The BOM makes Excel read accents and other characters correctly
      res.send("\uFEFF" + lines.join("\r\n"));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  },
);

// ---------- Assignment and due date (IT and ADMIN only) ----------

// Who can this ticket be assigned to?
app.get(
  "/tickets/:id/assignees",
  requireAuth,
  requireRole("ADMIN", "IT"),
  async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({ error: "Invalid ticket id" });

    const scope = ticketScope(req.user!, 2);
    try {
      const t = await pool.query(
        `SELECT t.business_unit_id FROM tickets t WHERE t.id = $1 AND ${scope.sql}`,
        [id, ...scope.params],
      );
      if (t.rows.length === 0)
        return res.status(404).json({ error: "Ticket not found" });

      const r = await pool.query(
        `SELECT id, name, role FROM users
       WHERE is_active AND password_hash <> '!disabled!'
         AND (role = 'ADMIN' OR (role = 'IT' AND business_unit_id = $1))
       ORDER BY name`,
        [t.rows[0].business_unit_id],
      );
      res.json(r.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  },
);

app.patch(
  "/tickets/:id",
  requireAuth,
  requireRole("ADMIN", "IT"),
  async (req, res) => {
    const user = req.user!;
    const id = Number(req.params.id);
    const body = req.body ?? {};
    const hasAssignee = "assignedTo" in body;
    const hasDue = "dueAt" in body;

    if (!Number.isInteger(id))
      return res.status(400).json({ error: "Invalid ticket id" });
    if (!hasAssignee && !hasDue)
      return res.status(400).json({ error: "Nothing to change" });
    if (
      hasAssignee &&
      body.assignedTo !== null &&
      !Number.isInteger(body.assignedTo)
    ) {
      return res.status(400).json({ error: "Invalid assignee" });
    }

    let dueAt: Date | null = null;
    if (hasDue && body.dueAt !== null) {
      if (typeof body.dueAt !== "string")
        return res.status(400).json({ error: "Invalid due date" });
      dueAt = new Date(body.dueAt);
      if (isNaN(dueAt.getTime()))
        return res.status(400).json({ error: "Invalid due date" });
      if (dueAt.getTime() > Date.now() + 2 * 365 * 24 * 3600 * 1000) {
        return res.status(400).json({ error: "Due date is too far away" });
      }
    }

    const scope = ticketScope(user, 2);
    try {
      const outcome: Outcome = await inTransaction(async (client) => {
        const cur = await client.query(
          `SELECT t.id, t.status, t.business_unit_id, t.assigned_to, t.due_at,
                a.name AS assignee_name
         FROM tickets t
         LEFT JOIN users a ON a.id = t.assigned_to
         WHERE t.id = $1 AND ${scope.sql}
         FOR UPDATE OF t`,
          [id, ...scope.params],
        );
        const row = cur.rows[0];
        if (!row) return { code: 404, body: { error: "Ticket not found" } };
        if (row.status === "CLOSED") {
          return {
            code: 400,
            body: { error: "Closed tickets cannot be changed" },
          };
        }

        let newAssignee: number | null = row.assigned_to;
        let newName: string | null = row.assignee_name;
        if (hasAssignee) {
          newAssignee = body.assignedTo;
          newName = null;
          if (newAssignee !== null) {
            // The server re-checks who may be assigned, whatever the browser sent
            const a = await client.query(
              `SELECT name FROM users
             WHERE id = $1 AND is_active AND password_hash <> '!disabled!'
               AND (role = 'ADMIN' OR (role = 'IT' AND business_unit_id = $2))`,
              [newAssignee, row.business_unit_id],
            );
            if (a.rows.length === 0) {
              return {
                code: 400,
                body: {
                  error: "That person cannot be assigned to this ticket",
                },
              };
            }
            newName = a.rows[0].name;
          }
        }

        const oldDueMs = row.due_at ? new Date(row.due_at).getTime() : null;
        const newDue: Date | null = hasDue
          ? dueAt
          : row.due_at
            ? new Date(row.due_at)
            : null;

        const assigneeChanged = hasAssignee && newAssignee !== row.assigned_to;
        const dueChanged =
          hasDue && (newDue ? newDue.getTime() : null) !== oldDueMs;

        if (dueChanged && newDue && newDue.getTime() < Date.now()) {
          return {
            code: 400,
            body: { error: "Due date must be in the future" },
          };
        }
        if (!assigneeChanged && !dueChanged) {
          return {
            code: 200,
            body: {
              id: row.id,
              assigned_to: row.assigned_to,
              due_at: row.due_at,
            },
          };
        }

        const updated = await client.query(
          "UPDATE tickets SET assigned_to = $1, due_at = $2 WHERE id = $3 RETURNING id, assigned_to, due_at",
          [newAssignee, newDue, id],
        );

        const details: Record<string, unknown> = {};
        if (assigneeChanged)
          details.assignee = { from: row.assignee_name, to: newName };
        if (dueChanged) {
          details.dueAt = {
            from: row.due_at,
            to: newDue ? newDue.toISOString() : null,
          };
        }
        await audit(client, id, user.id, "TICKET_UPDATED", details);

        return { code: 200, body: updated.rows[0] };
      });
      res.status(outcome.code).json(outcome.body);
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
