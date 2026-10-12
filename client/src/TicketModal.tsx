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

  async function changeStatus(status: string) {
    setError("");
    const res = await api(`/tickets/${ticket.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong");
      return;
    }
    setCurrent({ ...current, status: data.status });
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
            {canManage && TRANSITIONS[current.status]?.length > 0 && (
              <div className="flex flex-col gap-2">
                {TRANSITIONS[current.status].map((next) => (
                  <button
                    key={next}
                    onClick={() => changeStatus(next)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-left"
                  >
                    Move to {next.replace("_", " ")}
                  </button>
                ))}
              </div>
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
