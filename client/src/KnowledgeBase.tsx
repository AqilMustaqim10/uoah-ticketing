import { useEffect, useState } from "react";

const API = "http://localhost:3000";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 10;
const ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

type ArticleFile = {
  id: number;
  original_name: string;
  mime: string;
  size_bytes: number;
};

type Article = {
  id: number;
  title: string;
  body: string;
  tags: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  business_unit_id: number | null;
  unit_code: string | null;
  author_name: string | null;
  updated_at: string;
  file_count?: number;
  files?: ArticleFile[];
};
type Unit = { id: number; code: string; name: string };
type Me = {
  id: number;
  role: "ADMIN" | "IT" | "USER";
  businessUnitId: number | null;
};

function api(path: string, options: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

// Upload goes as multipart, so no JSON content type here
async function uploadFile(
  articleId: number,
  file: File,
): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API}/kb/articles/${articleId}/files`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error ?? "Upload failed";
}

function checkFile(file: File): string | null {
  if (!ALLOWED.includes(file.type))
    return `${file.name}: only JPG, PNG, GIF, WebP and PDF are allowed`;
  if (file.size > MAX_BYTES) return `${file.name}: larger than 10 MB`;
  return null;
}

const fmtSize = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
const fileUrl = (id: number) => `${API}/kb/files/${id}`;

const field =
  "w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600";

export default function KnowledgeBase({ me }: { me: Me }) {
  const canWrite = me.role === "ADMIN" || me.role === "IT";
  const [articles, setArticles] = useState<Article[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Article | null>(null);
  const [editing, setEditing] = useState<Partial<Article> | null>(null);
  const [pending, setPending] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await api(
      `/kb/articles?q=${encodeURIComponent(search.trim())}`,
    );
    if (res.ok) setArticles(await res.json());
  }

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    fetch(`${API}/auth/units`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setUnits)
      .catch(() => {});
  }, []);

  async function openArticle(id: number) {
    const res = await api(`/kb/articles/${id}`);
    if (res.ok) setOpen(await res.json());
  }

  async function refreshEditingFiles(id: number) {
    const res = await api(`/kb/articles/${id}`);
    if (res.ok) {
      const a: Article = await res.json();
      setEditing((prev) => (prev ? { ...prev, files: a.files } : prev));
    }
  }

  function startEdit(a: Partial<Article>) {
    setError("");
    setPending([]);
    setEditing(a);
  }

  // Files chosen in the editor
  async function pickFiles(list: FileList | null) {
    if (!list || !editing) return;
    setError("");
    const files = Array.from(list);
    const already = (editing.files?.length ?? 0) + pending.length;
    if (already + files.length > MAX_FILES)
      return setError(`At most ${MAX_FILES} files per article`);

    for (const f of files) {
      const problem = checkFile(f);
      if (problem) return setError(problem);
    }

    if (editing.id) {
      setBusy(true);
      for (const f of files) {
        const problem = await uploadFile(editing.id, f);
        if (problem) {
          setError(`${f.name}: ${problem}`);
          break;
        }
      }
      await refreshEditingFiles(editing.id);
      setBusy(false);
    } else {
      setPending([...pending, ...files]); // uploaded after the article is saved
    }
  }

  async function removeFile(fileId: number) {
    if (!editing?.id || !window.confirm("Remove this file?")) return;
    const res = await api(`/kb/files/${fileId}`, { method: "DELETE" });
    if (!res.ok) setError("Could not remove the file");
    await refreshEditingFiles(editing.id);
  }

  async function save(publish: boolean) {
    if (!editing) return;
    setError("");
    setBusy(true);
    const isNew = !editing.id;
    const payload: Record<string, unknown> = {
      title: editing.title ?? "",
      body: editing.body ?? "",
      tags: editing.tags ?? "",
    };
    if (isNew) {
      payload.businessUnitId = editing.business_unit_id ?? null;
      payload.publish = publish;
    } else if (publish) {
      payload.status = "PUBLISHED";
    }

    const res = await api(
      isNew ? "/kb/articles" : `/kb/articles/${editing.id}`,
      {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(payload),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      return setError(data.error ?? "Could not save");
    }

    // New article: upload the queued files now that it exists
    if (isNew && pending.length > 0) {
      const failures: string[] = [];
      for (const f of pending) {
        const problem = await uploadFile(data.id, f);
        if (problem) failures.push(`${f.name}: ${problem}`);
      }
      if (failures.length > 0) {
        // Keep the editor open on the saved article so the files can be retried
        setPending([]);
        setEditing({ ...editing, id: data.id });
        await refreshEditingFiles(data.id);
        setBusy(false);
        load();
        return setError(
          `Article saved, but some files failed. ${failures.join("; ")}`,
        );
      }
    }

    setBusy(false);
    setPending([]);
    setEditing(null);
    setOpen(null);
    load();
  }

  async function setStatus(a: Article, status: string) {
    if (
      status === "ARCHIVED" &&
      !window.confirm("Archive this article? It disappears from the list.")
    )
      return;
    await api(`/kb/articles/${a.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    setOpen(null);
    load();
  }

  const canEdit = (a: Article) =>
    me.role === "ADMIN" ||
    (me.role === "IT" &&
      a.business_unit_id !== null &&
      a.business_unit_id === me.businessUnitId);

  const images = (open?.files ?? []).filter((f) => f.mime.startsWith("image/"));
  const docs = (open?.files ?? []).filter((f) => !f.mime.startsWith("image/"));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-slate-900">Knowledge Base</h1>
        <input
          className="ml-auto px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white w-72"
          placeholder="Search articles"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canWrite && (
          <button
            onClick={() =>
              startEdit({
                title: "",
                body: "",
                tags: "",
                files: [],
                business_unit_id:
                  me.role === "ADMIN" ? null : me.businessUnitId,
              })
            }
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
          >
            New article
          </button>
        )}
      </div>

      {articles.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
          {search ? "No articles match your search." : "No articles yet."}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {articles.map((a) => (
            <button
              key={a.id}
              onClick={() => openArticle(a.id)}
              className="text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:border-blue-300"
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs px-2 py-0.5 rounded-lg border border-slate-200 text-slate-600">
                  {a.unit_code ?? "All units"}
                </span>
                {a.status === "DRAFT" && (
                  <span className="text-xs px-2 py-0.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-700">
                    Draft
                  </span>
                )}
                {!!a.file_count && (
                  <span className="text-xs text-slate-400">
                    {a.file_count} attachment(s)
                  </span>
                )}
              </div>
              <div className="font-medium text-slate-900">{a.title}</div>
              <p className="text-sm text-slate-500 mt-1 line-clamp-2 whitespace-pre-wrap">
                {a.body}
              </p>
              {a.tags && (
                <div className="text-xs text-slate-400 mt-2">{a.tags}</div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Reader */}
      {open && !editing && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm grid place-items-center p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs text-slate-500 mb-1">
              {open.unit_code ?? "All units"} · {open.author_name ?? "Unknown"}{" "}
              · updated {new Date(open.updated_at).toLocaleDateString()}
              {open.status === "DRAFT" && " · Draft"}
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-3">
              {open.title}
            </h2>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
              {open.body}
            </p>

            {images.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-4">
                {images.map((f) => (
                  <a
                    key={f.id}
                    href={fileUrl(f.id)}
                    target="_blank"
                    rel="noreferrer"
                    title={f.original_name}
                  >
                    <img
                      src={fileUrl(f.id)}
                      alt={f.original_name}
                      className="w-full h-28 object-cover rounded-xl border border-slate-200"
                    />
                  </a>
                ))}
              </div>
            )}

            {docs.length > 0 && (
              <div className="mt-4 space-y-1">
                {docs.map((f) => (
                  <a
                    key={f.id}
                    href={fileUrl(f.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-blue-700"
                  >
                    <span className="truncate">{f.original_name}</span>
                    <span className="ml-auto text-xs text-slate-400">
                      PDF · {fmtSize(f.size_bytes)}
                    </span>
                  </a>
                ))}
              </div>
            )}

            {open.tags && (
              <p className="text-xs text-slate-400 mt-4">Tags: {open.tags}</p>
            )}
            <div className="flex gap-2 mt-6">
              {canEdit(open) && (
                <>
                  <button
                    className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-100"
                    onClick={() => startEdit(open)}
                  >
                    Edit
                  </button>
                  {open.status === "DRAFT" && (
                    <button
                      className="px-3 py-1.5 text-sm rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700"
                      onClick={() => setStatus(open, "PUBLISHED")}
                    >
                      Publish
                    </button>
                  )}
                  {open.status === "PUBLISHED" && (
                    <button
                      className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-100"
                      onClick={() => setStatus(open, "DRAFT")}
                    >
                      Unpublish
                    </button>
                  )}
                  <button
                    className="px-3 py-1.5 text-sm rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
                    onClick={() => setStatus(open, "ARCHIVED")}
                  >
                    Archive
                  </button>
                </>
              )}
              <button
                className="ml-auto px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-100"
                onClick={() => setOpen(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editor */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm grid place-items-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">
              {editing.id ? "Edit article" : "New article"}
            </h2>
            <input
              className={field}
              placeholder="Title"
              value={editing.title ?? ""}
              onChange={(e) =>
                setEditing({ ...editing, title: e.target.value })
              }
            />
            <textarea
              className={field + " h-48"}
              placeholder="Write the steps or answer here"
              value={editing.body ?? ""}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            />
            <input
              className={field}
              placeholder="Tags, separated by commas"
              value={editing.tags ?? ""}
              onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
            />

            {!editing.id && (
              <select
                className={field}
                disabled={me.role !== "ADMIN"}
                value={editing.business_unit_id ?? ""}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    business_unit_id:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              >
                {me.role === "ADMIN" && <option value="">All units</option>}
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.code})
                  </option>
                ))}
              </select>
            )}

            {/* Attachments */}
            <div className="border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="text-sm font-medium text-slate-900">
                Attachments (photos and PDF, max 10 MB each)
              </div>

              {(editing.files ?? []).map((f) => (
                <div key={f.id} className="flex items-center gap-2 text-sm">
                  {f.mime.startsWith("image/") ? (
                    <img
                      src={fileUrl(f.id)}
                      alt=""
                      className="w-10 h-10 object-cover rounded-lg border border-slate-200"
                    />
                  ) : (
                    <span className="w-10 h-10 grid place-items-center rounded-lg border border-slate-200 text-xs text-slate-500">
                      PDF
                    </span>
                  )}
                  <span className="truncate flex-1">{f.original_name}</span>
                  <span className="text-xs text-slate-400">
                    {fmtSize(f.size_bytes)}
                  </span>
                  <button
                    className="text-xs text-rose-600 hover:underline"
                    onClick={() => removeFile(f.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}

              {pending.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-sm text-slate-600"
                >
                  <span className="truncate flex-1">
                    {f.name} (uploads when you save)
                  </span>
                  <span className="text-xs text-slate-400">
                    {fmtSize(f.size)}
                  </span>
                  <button
                    className="text-xs text-rose-600 hover:underline"
                    onClick={() =>
                      setPending(pending.filter((_, j) => j !== i))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}

              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
                disabled={busy}
                className="block text-sm"
                onChange={(e) => {
                  pickFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-100"
                disabled={busy}
                onClick={() => {
                  setEditing(null);
                  setPending([]);
                  load();
                }}
              >
                Cancel
              </button>
              <button
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-100 disabled:opacity-50"
                disabled={busy}
                onClick={() => save(false)}
              >
                {busy ? "Working..." : editing.id ? "Save" : "Save as draft"}
              </button>
              {(!editing.id || editing.status === "DRAFT") && (
                <button
                  className="px-3 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
                  disabled={busy}
                  onClick={() => save(true)}
                >
                  Save and publish
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
