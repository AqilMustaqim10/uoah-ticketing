import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { StatusBadge, PriorityBadge } from "./Badges";

const API = "http://localhost:3000";

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

export type ModalTicket = {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  unit_code: string | null;
  source?: string;
  requester_email?: string | null;
  assigned_to?: number | null;
  assignee_name?: string | null;
  due_at?: string | null;
};

type Comment = {
  id: number;
  body: string;
  is_internal: boolean;
  created_at: string;
  author_name: string;
  author_role: string;
};

type AuditEntry = {
  id: number;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  actor_name: string | null;
};

function api(path: string, options: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

function describe(e: AuditEntry): string {
  const d = e.details;
  switch (e.action) {
    case "TICKET_CREATED":
      return "created the ticket";
    case "STATUS_CHANGED":
      return `changed status from ${d.from} to ${d.to}`;
    case "COMMENT_ADDED":
      return d.internal ? "added an internal note" : "added a comment";
    case "TICKET_UPDATED": {
      const parts: string[] = [];
      const a = d.assignee as
        | { from: string | null; to: string | null }
        | undefined;
      const due = d.dueAt as
        | { from: string | null; to: string | null }
        | undefined;
      if (a)
        parts.push(
          a.to ? `assigned the ticket to ${a.to}` : "removed the assignee",
        );
      if (due) {
        parts.push(
          due.to
            ? `set the due date to ${new Date(due.to).toLocaleString()}`
            : "cleared the due date",
        );
      }
      return parts.join(" and ");
    }
    default:
      return e.action;
  }
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className="text-sm text-slate-900">{children}</div>
    </div>
  );
}

type Props = {
  ticket: ModalTicket;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void; // tells the list to reload
};

// ISO date -> value for <input type="datetime-local"> in the user's own time zone
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

type Assignee = { id: number; name: string; role: string };

export default function TicketModal({
  ticket,
  canManage,
  onClose,
  onChanged,
}: Props) {
  const [current, setCurrent] = useState(ticket);
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState("");
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assignedTo, setAssignedTo] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const c = await api(`/tickets/${ticket.id}/comments`);
    if (c.ok) setComments(await c.json());
    if (canManage) {
      const a = await api(`/tickets/${ticket.id}/audit`);
      if (a.ok) setHistory(await a.json());
    }
  }

  useEffect(() => {
    setCurrent(ticket);
    load();
  }, [ticket.id]);

  // Close with the Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setAssignedTo(ticket.assigned_to ? String(ticket.assigned_to) : "");
    setDueLocal(toLocalInput(ticket.due_at));
    if (canManage) {
      api(`/tickets/${ticket.id}/assignees`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setAssignees)
        .catch(() => setAssignees([]));
    }
  }, [ticket.id]);

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await api(`/tickets/${ticket.id}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, internal }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    setBody("");
    setInternal(false);
    load();
  }

  async function saveDetails() {
    setError("");
    setSaving(true);
    const res = await api(`/tickets/${ticket.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        assignedTo: assignedTo === "" ? null : Number(assignedTo),
        dueAt: dueLocal === "" ? null : new Date(dueLocal).toISOString(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setError(data.error ?? "Could not save");
      return;
    }
    setCurrent({
      ...current,
      assigned_to: data.assigned_to,
      assignee_name:
        assignees.find((a) => a.id === data.assigned_to)?.name ?? null,
      due_at: data.due_at,
    });
    load();
    onChanged();
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm grid place-items-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-xs text-slate-500">
              HD-{current.id}
            </div>
            <h2 className="text-lg font-semibold text-slate-900 break-words">
              {current.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto grid md:grid-cols-[1fr_260px]">
          {/* Left: description, comments, history */}
          <div className="p-6 space-y-6 min-w-0">
            <section>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                Description
              </h3>
              <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
                {current.description || "No description."}
              </p>
            </section>

            <section>
              <h3 className="text-sm font-semibold text-slate-900 mb-2">
                Comments
              </h3>
              {comments.length === 0 && (
                <p className="text-sm text-slate-400">No comments yet.</p>
              )}
              <div className="space-y-2">
                {comments.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-xl border p-3 text-sm ${
                      c.is_internal
                        ? "bg-amber-50 border-amber-200"
                        : "bg-white border-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
                      <strong className="text-slate-900">
                        {c.author_name}
                      </strong>
                      <span>{c.author_role}</span>
                      {c.is_internal && (
                        <span className="text-amber-700">internal note</span>
                      )}
                      <span className="ml-auto">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-slate-800">
                      {c.body}
                    </p>
                  </div>
                ))}
              </div>

              <form onSubmit={addComment} className="mt-3 grid gap-2">
                <textarea
                  className="px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="Write a comment"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <div className="flex items-center gap-3">
                  {canManage && (
                    <label className="text-xs text-slate-600 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={internal}
                        onChange={(e) => setInternal(e.target.checked)}
                      />
                      Internal note (requester cannot see)
                    </label>
                  )}
                  <button
                    type="submit"
                    className="ml-auto px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                  >
                    Add comment
                  </button>
                </div>
                {error && <p className="text-sm text-rose-600">{error}</p>}
              </form>
            </section>

            {canManage && (
              <section>
                <h3 className="text-sm font-semibold text-slate-900 mb-2">
                  History
                </h3>
                {history.length === 0 && (
                  <p className="text-sm text-slate-400">No history recorded.</p>
                )}
                <ol className="border-l border-slate-200 ml-1 space-y-2">
                  {history.map((h) => (
                    <li key={h.id} className="pl-3 text-xs text-slate-600">
                      <span className="text-slate-400">
                        {new Date(h.created_at).toLocaleString()}
                      </span>
                      {": "}
                      <strong className="text-slate-900">
                        {h.actor_name ?? "System"}
                      </strong>{" "}
                      {describe(h)}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>

          {/* Right: metadata */}
          <aside className="border-t md:border-t-0 md:border-l border-slate-200 bg-slate-50 p-6 space-y-4">
            <Field label="Status">
              <StatusBadge status={current.status} />
            </Field>
            {canManage && current.status !== "CLOSED" ? (
              <>
                <Field label="Assigned to">
                  <select
                    className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 bg-white"
                    value={assignedTo}
                    onChange={(e) => setAssignedTo(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {assignees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Due date">
                  <input
                    type="datetime-local"
                    className="w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 bg-white"
                    value={dueLocal}
                    onChange={(e) => setDueLocal(e.target.value)}
                  />
                </Field>
                <button
                  onClick={saveDetails}
                  disabled={saving}
                  className="w-full px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save assignment and due date"}
                </button>
              </>
            ) : (
              <>
                <Field label="Assigned to">
                  {current.assignee_name ?? "Unassigned"}
                </Field>
                <Field label="Due date">
                  {current.due_at
                    ? new Date(current.due_at).toLocaleString()
                    : "None"}
                </Field>
              </>
            )}
            <Field label="Priority">
              <PriorityBadge priority={current.priority} />
            </Field>
            <Field label="Business unit">{current.unit_code ?? "None"}</Field>
            <Field label="Source">{current.source ?? "WEB"}</Field>
            {current.requester_email && (
              <Field label="Requester email">{current.requester_email}</Field>
            )}
            <Field label="Created">
              {new Date(current.created_at).toLocaleString()}
            </Field>
          </aside>
        </div>
      </div>
    </div>
  );
}
