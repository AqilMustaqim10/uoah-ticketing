import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/tickets", async (_req, res) => {
  try {
    const result = await pool.query("SELECT * FROM tickets ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

app.post("/tickets", async (req, res) => {
  const { title, description = "", priority = "MEDIUM" } = req.body;

  // Never trust data from the browser: validate it on the server
  if (typeof title !== "string" || title.trim() === "") {
    return res.status(400).json({ error: "Title is required" });
  }
  if (!VALID_PRIORITIES.includes(priority)) {
    return res.status(400).json({ error: "Invalid priority" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO tickets (title, description, priority)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title.trim(), description, priority],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

// Get one ticket
app.get("/tickets/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: "Invalid ticket id" });
  }

  try {
    const result = await pool.query("SELECT * FROM tickets WHERE id = $1", [
      id,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Change status
app.patch("/tickets/:id/status", async (req, res) => {
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
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
