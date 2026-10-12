import "dotenv/config";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { pool } from "./db";

export type Role = "ADMIN" | "IT" | "USER";
export type AuthUser = {
  id: number;
  name: string;
  role: Role;
  businessUnitId: number | null;
  unitCode: string | null;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is missing in .env");
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, JWT_SECRET as string, { expiresIn: "8h" });
}

// Gate 1: must be logged in, and the account must still be active
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }

  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET as string);
  } catch {
    return res
      .status(401)
      .json({ error: "Session expired, please log in again" });
  }

  try {
    // Role, unit and status come from the DATABASE, not from the cookie
    const r = await pool.query(
      `SELECT u.id, u.name, u.role, u.business_unit_id, u.is_active,
              u.password_changed_at, bu.code AS unit_code
       FROM users u
       LEFT JOIN business_units bu ON bu.id = u.business_unit_id
       WHERE u.id = $1`,
      [payload.id],
    );
    const u = r.rows[0];

    if (!u || !u.is_active) {
      return res
        .status(401)
        .json({ error: "Account is disabled or no longer exists" });
    }
    // A password reset invalidates every older login
    const changedAt = Math.floor(
      new Date(u.password_changed_at).getTime() / 1000,
    );
    if (typeof payload.iat !== "number" || payload.iat < changedAt) {
      return res
        .status(401)
        .json({ error: "Session expired, please log in again" });
    }

    req.user = {
      id: u.id,
      name: u.name,
      role: u.role,
      businessUnitId: u.business_unit_id,
      unitCode: u.unit_code,
    };
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}

// Gate 2: must have one of these roles
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission" });
    }
    next();
  };
}
