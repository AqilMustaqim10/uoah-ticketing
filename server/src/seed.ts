import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db";

const users = [
  { name: "Admin", email: "admin@uoah.local", role: "ADMIN" },
  { name: "IT Support", email: "it@uoah.local", role: "IT" },
  { name: "Staff Member", email: "staff@uoah.local", role: "USER" },
];

// Practice password for local testing only
const PASSWORD = "Password123!";

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [u.name, u.email, hash, u.role],
    );
  }
  console.log("Seeded users");
  await pool.end();
}

main();
