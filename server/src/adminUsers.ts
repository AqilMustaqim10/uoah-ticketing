import { Router } from "express";
import { pool } from "./db";
import { requireAuth, requireRole } from "./auth";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole("ADMIN"));

const ROLES = ["ADMIN", "IT", "USER"];

adminRouter.get("/users", async (_req, res) => {
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.is_active, u.business_unit_id,
              bu.code AS unit_code, u.created_at
       FROM users u
       LEFT JOIN business_units bu ON bu.id = u.business_unit_id
       WHERE u.password_hash <> '!disabled!'
       ORDER BY u.is_active DESC, u.name`,
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

adminRouter.patch("/users/:id", async (req, res) => {
  const me = req.user!;
  const id = Number(req.params.id);
  const { role, businessUnitId, isActive } = req.body ?? {};

  if (!Number.isInteger(id))
    return res.status(400).json({ error: "Invalid user id" });
  if (role !== undefined && !ROLES.includes(role))
    return res.status(400).json({ error: "Invalid role" });
  if (businessUnitId !== undefined && !Number.isInteger(businessUnitId)) {
    return res.status(400).json({ error: "Invalid business unit" });
  }
  if (isActive !== undefined && typeof isActive !== "boolean") {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (
    role === undefined &&
    businessUnitId === undefined &&
    isActive === undefined
  ) {
    return res.status(400).json({ error: "Nothing to change" });
  }

  const client = await pool.connect();
  const stop = async (code: number, error: string) => {
    await client.query("ROLLBACK");
    res.status(code).json({ error });
  };

  try {
    await client.query("BEGIN");

    // Lock the active admins and the target, so two changes can't race
    const admins = await client.query(
      "SELECT id FROM users WHERE role = 'ADMIN' AND is_active FOR UPDATE",
    );
    const t = await client.query(
      "SELECT id, role, business_unit_id, is_active, password_hash FROM users WHERE id = $1 FOR UPDATE",
      [id],
    );
    const target = t.rows[0];
    if (!target || target.password_hash === "!disabled!")
      return stop(404, "User not found");

    if (businessUnitId !== undefined) {
      const unit = await client.query(
        "SELECT 1 FROM business_units WHERE id = $1",
        [businessUnitId],
      );
      if (unit.rows.length === 0) return stop(400, "Invalid business unit");
    }

    const newRole: string = role ?? target.role;
    const newUnit: number | null = businessUnitId ?? target.business_unit_id;
    const newActive: boolean = isActive ?? target.is_active;

    // You cannot demote or disable yourself
    if (id === me.id && (newRole !== target.role || newActive === false)) {
      return stop(
        400,
        "You cannot change your own role or disable your own account",
      );
    }
    // The system must always keep at least one active admin
    const losingAdmin =
      target.role === "ADMIN" &&
      target.is_active &&
      (newRole !== "ADMIN" || !newActive);
    if (losingAdmin && admins.rows.length <= 1) {
      return stop(400, "At least one active admin is required");
    }

    await client.query(
      "UPDATE users SET role = $1, business_unit_id = $2, is_active = $3 WHERE id = $4",
      [newRole, newUnit, newActive, id],
    );
    await client.query(
      `INSERT INTO audit_log (ticket_id, actor_id, action, details)
       VALUES (NULL, $1, 'USER_UPDATED', $2)`,
      [
        me.id,
        JSON.stringify({
          userId: id,
          from: {
            role: target.role,
            unitId: target.business_unit_id,
            active: target.is_active,
          },
          to: { role: newRole, unitId: newUnit, active: newActive },
        }),
      ],
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "Database error" });
  } finally {
    client.release();
  }
});
