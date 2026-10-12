import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pool } from "./db";
import { requireAuth, requireRole } from "./auth";
import type { AuthUser } from "./auth";

export const kbRouter = Router();
kbRouter.use(requireAuth);

// ---------- Upload settings ----------

const UPLOAD_DIR = path.resolve(
  process.cwd(),
  process.env.UPLOAD_DIR ?? "uploads",
  "kb",
);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_ARTICLE = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
});

// Decide the real file type from its first bytes. The filename and the
// browser's claimed type are ignored because the user controls both.
function detectType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  if (
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: "image/png", ext: "png" };
  }
  const gif = buf.subarray(0, 6).toString("latin1");
  if (gif === "GIF87a" || gif === "GIF89a")
    return { mime: "image/gif", ext: "gif" };
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-")
    return { mime: "application/pdf", ext: "pdf" };
  return null;
}

function safeName(name: string): string {
  const base = path
    .basename(name || "file")
    .replace(/[^\w.\- ()]/g, "_")
    .trim();
  return (base || "file").slice(0, 150);
}

function receiveFile(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: any) => {
    if (err) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "File is too large (max 10 MB)"
          : "Upload failed";
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

// ---------- Visibility: THE one place that decides which articles a user may see ----------

function articleScope(user: AuthUser, idx: number) {
  if (user.role === "ADMIN") {
    return { sql: "a.status <> 'ARCHIVED'", params: [] as unknown[] };
  }
  if (user.role === "IT") {
    if (user.businessUnitId === null) {
      return {
        sql: "(a.status = 'PUBLISHED' AND a.business_unit_id IS NULL)",
        params: [] as unknown[],
      };
    }
    return {
      sql: `(a.status = 'PUBLISHED' AND (a.business_unit_id IS NULL OR a.business_unit_id = $${idx}))
            OR (a.status = 'DRAFT' AND a.business_unit_id = $${idx})`,
      params: [user.businessUnitId],
    };
  }
  return {
    sql:
      user.businessUnitId === null
        ? "(a.status = 'PUBLISHED' AND a.business_unit_id IS NULL)"
        : `(a.status = 'PUBLISHED' AND (a.business_unit_id IS NULL OR a.business_unit_id = $${idx}))`,
    params:
      user.businessUnitId === null ? ([] as unknown[]) : [user.businessUnitId],
  };
}

function canWriteUnit(user: AuthUser, unitId: number | null): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role !== "IT") return false;
  return unitId !== null && unitId === user.businessUnitId;
}

const SELECT = `
  SELECT a.id, a.title, a.body, a.tags, a.status, a.business_unit_id,
         bu.code AS unit_code, a.author_id, u.name AS author_name,
         a.created_at, a.updated_at,
         (SELECT count(*)::int FROM article_files f WHERE f.article_id = a.id) AS file_count
  FROM articles a
  LEFT JOIN business_units bu ON bu.id = a.business_unit_id
  LEFT JOIN users u ON u.id = a.author_id
`;

async function writeAudit(
  actorId: number,
  action: string,
  details: Record<string, unknown>,
) {
  await pool.query(
    "INSERT INTO audit_log (ticket_id, actor_id, action, details) VALUES (NULL, $1, $2, $3)",
    [actorId, action, JSON.stringify(details)],
  );
}

function cleanInput(body: any) {
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  const tags = typeof body?.tags === "string" ? body.tags.trim() : "";
  if (title.length < 3 || title.length > 200)
    return { error: "Title must be 3 to 200 characters" };
  if (text.length < 1 || text.length > 20000)
    return { error: "Body must be 1 to 20000 characters" };
  if (tags.length > 200) return { error: "Tags are too long" };
  return { title, text, tags };
}

// ---------- Articles ----------

kbRouter.get("/articles", async (req, res) => {
  const user = req.user!;
  const scope = articleScope(user, 1);
  const params: unknown[] = [...scope.params];
  const where: string[] = [`(${scope.sql})`];

  const q =
    typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, "\\$&")}%`);
    const p = `$${params.length}`;
    where.push(
      `(a.title ILIKE ${p} OR a.body ILIKE ${p} OR a.tags ILIKE ${p})`,
    );
  }

  try {
    const r = await pool.query(
      `${SELECT} WHERE ${where.join(" AND ")} ORDER BY a.updated_at DESC LIMIT 200`,
      params,
    );
    res.json(r.rows.map((a) => ({ ...a, body: a.body.slice(0, 200) })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

kbRouter.get("/articles/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id))
    return res.status(400).json({ error: "Invalid article id" });
  const scope = articleScope(req.user!, 2);
  try {
    const r = await pool.query(`${SELECT} WHERE a.id = $1 AND (${scope.sql})`, [
      id,
      ...scope.params,
    ]);
    if (r.rows.length === 0)
      return res.status(404).json({ error: "Article not found" });
    const files = await pool.query(
      "SELECT id, original_name, mime, size_bytes FROM article_files WHERE article_id = $1 ORDER BY id",
      [id],
    );
    res.json({ ...r.rows[0], files: files.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

kbRouter.post("/articles", requireRole("ADMIN", "IT"), async (req, res) => {
  const user = req.user!;
  const input = cleanInput(req.body);
  if ("error" in input) return res.status(400).json({ error: input.error });

  const unitId =
    req.body?.businessUnitId === null || req.body?.businessUnitId === undefined
      ? user.role === "ADMIN"
        ? null
        : user.businessUnitId
      : Number(req.body.businessUnitId);
  if (unitId !== null && !Number.isInteger(unitId))
    return res.status(400).json({ error: "Invalid unit" });
  if (!canWriteUnit(user, unitId)) {
    return res
      .status(403)
      .json({ error: "You can only write articles for your own unit" });
  }
  const status = req.body?.publish === true ? "PUBLISHED" : "DRAFT";

  try {
    const r = await pool.query(
      `INSERT INTO articles (title, body, tags, business_unit_id, status, author_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.title, input.text, input.tags, unitId, status, user.id],
    );
    await writeAudit(user.id, "ARTICLE_CREATED", {
      articleId: r.rows[0].id,
      title: input.title,
      status,
    });
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

kbRouter.patch(
  "/articles/:id",
  requireRole("ADMIN", "IT"),
  async (req, res) => {
    const user = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({ error: "Invalid article id" });

    try {
      const cur = await pool.query(
        "SELECT * FROM articles WHERE id = $1 AND status <> 'ARCHIVED'",
        [id],
      );
      const row = cur.rows[0];
      if (!row || !canWriteUnit(user, row.business_unit_id)) {
        return res.status(404).json({ error: "Article not found" });
      }

      const input = cleanInput({
        title: req.body?.title ?? row.title,
        body: req.body?.body ?? row.body,
        tags: req.body?.tags ?? row.tags,
      });
      if ("error" in input) return res.status(400).json({ error: input.error });

      let status = row.status;
      if (req.body?.status !== undefined) {
        if (!["DRAFT", "PUBLISHED", "ARCHIVED"].includes(req.body.status)) {
          return res.status(400).json({ error: "Invalid status" });
        }
        status = req.body.status;
      }

      await pool.query(
        "UPDATE articles SET title=$1, body=$2, tags=$3, status=$4, updated_at=now() WHERE id=$5",
        [input.title, input.text, input.tags, status, id],
      );
      await writeAudit(user.id, "ARTICLE_UPDATED", {
        articleId: id,
        title: input.title,
        statusFrom: row.status,
        statusTo: status,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  },
);

// ---------- Files ----------

// Upload one file to an article
kbRouter.post(
  "/articles/:id/files",
  requireRole("ADMIN", "IT"),
  receiveFile,
  async (req, res) => {
    const user = req.user!;
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      return res.status(400).json({ error: "Invalid article id" });
    if (!req.file) return res.status(400).json({ error: "No file received" });

    const type = detectType(req.file.buffer);
    if (!type) {
      return res
        .status(400)
        .json({ error: "Only JPG, PNG, GIF, WebP and PDF files are allowed" });
    }

    try {
      const a = await pool.query(
        "SELECT business_unit_id FROM articles WHERE id = $1 AND status <> 'ARCHIVED'",
        [id],
      );
      if (
        a.rows.length === 0 ||
        !canWriteUnit(user, a.rows[0].business_unit_id)
      ) {
        return res.status(404).json({ error: "Article not found" });
      }
      const count = await pool.query(
        "SELECT count(*)::int AS n FROM article_files WHERE article_id = $1",
        [id],
      );
      if (count.rows[0].n >= MAX_FILES_PER_ARTICLE) {
        return res
          .status(400)
          .json({
            error: `An article can have at most ${MAX_FILES_PER_ARTICLE} files`,
          });
      }

      const storedName = `${crypto.randomUUID()}.${type.ext}`;
      await fs.promises.writeFile(
        path.join(UPLOAD_DIR, storedName),
        req.file.buffer,
        { flag: "wx" },
      );

      try {
        const r = await pool.query(
          `INSERT INTO article_files (article_id, original_name, stored_name, mime, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, original_name, mime, size_bytes`,
          [
            id,
            safeName(req.file.originalname),
            storedName,
            type.mime,
            req.file.size,
            user.id,
          ],
        );
        await writeAudit(user.id, "ARTICLE_FILE_ADDED", {
          articleId: id,
          fileId: r.rows[0].id,
          name: r.rows[0].original_name,
          mime: type.mime,
        });
        res.status(201).json(r.rows[0]);
      } catch (e) {
        // Database failed, so do not leave an orphan file on disk
        await fs.promises
          .unlink(path.join(UPLOAD_DIR, storedName))
          .catch(() => {});
        throw e;
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

// Download or display a file. Only people who may see the article can get it.
kbRouter.get("/files/:fileId", async (req, res) => {
  const fileId = Number(req.params.fileId);
  if (!Number.isInteger(fileId))
    return res.status(400).json({ error: "Invalid file id" });

  const scope = articleScope(req.user!, 2);
  try {
    const r = await pool.query(
      `SELECT f.stored_name, f.original_name, f.mime
       FROM article_files f JOIN articles a ON a.id = f.article_id
       WHERE f.id = $1 AND (${scope.sql})`,
      [fileId, ...scope.params],
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "File not found" });

    res.setHeader("Content-Type", row.mime);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    );
    res.setHeader("Cache-Control", "private, max-age=300");

    const stream = fs.createReadStream(
      path.join(UPLOAD_DIR, path.basename(row.stored_name)),
    );
    stream.on("error", () => {
      if (!res.headersSent) res.status(404).json({ error: "File not found" });
      else res.end();
    });
    stream.pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

kbRouter.delete(
  "/files/:fileId",
  requireRole("ADMIN", "IT"),
  async (req, res) => {
    const user = req.user!;
    const fileId = Number(req.params.fileId);
    if (!Number.isInteger(fileId))
      return res.status(400).json({ error: "Invalid file id" });

    try {
      const r = await pool.query(
        `SELECT f.id, f.article_id, f.stored_name, f.original_name, a.business_unit_id
       FROM article_files f JOIN articles a ON a.id = f.article_id
       WHERE f.id = $1`,
        [fileId],
      );
      const row = r.rows[0];
      if (!row || !canWriteUnit(user, row.business_unit_id)) {
        return res.status(404).json({ error: "File not found" });
      }
      await pool.query("DELETE FROM article_files WHERE id = $1", [fileId]);
      await fs.promises
        .unlink(path.join(UPLOAD_DIR, path.basename(row.stored_name)))
        .catch(() => {});
      await writeAudit(user.id, "ARTICLE_FILE_REMOVED", {
        articleId: row.article_id,
        fileId,
        name: row.original_name,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Database error" });
    }
  },
);
