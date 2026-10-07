import "dotenv/config";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export type Role = "ADMIN" | "IT" | "USER";
export type AuthUser = { id: number; name: string; role: Role };

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
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role },
    JWT_SECRET as string,
    { expiresIn: "8h" },
  );
}

// Gate 1: must be logged in
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ error: "Not logged in" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as AuthUser;
    req.user = { id: payload.id, name: payload.name, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: "Session expired, please log in again" });
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
