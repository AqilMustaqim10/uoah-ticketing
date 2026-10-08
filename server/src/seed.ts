import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db";

const users = [
  { name: "Admin", email: "admin@uoah.local", role: "ADMIN", unit: "HQ" },
  { name: "IT Support FNB", email: "it@uoah.local", role: "IT", unit: "FNB" },
  {
    name: "Staff Member",
    email: "staff@uoah.local",
    role: "USER",
    unit: "FNB",
  },
  {
    name: "IT Support Hotel",
    email: "it.hotel@uoah.local",
    role: "IT",
    unit: "HOTEL",
  },
  {
    name: "Hotel Staff",
    email: "staff.hotel@uoah.local",
    role: "USER",
    unit: "HOTEL",
  },
];

// Practice password for local testing only
const PASSWORD = "Password123!";

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role, business_unit_id)
       VALUES ($1, $2, $3, $4, (SELECT id FROM business_units WHERE code = $5))
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name,
           business_unit_id = EXCLUDED.business_unit_id`,
      [u.name, u.email.toLowerCase(), hash, u.role, u.unit],
    );
  }
  console.log("Seeded users");
  await pool.end();
}

main();
