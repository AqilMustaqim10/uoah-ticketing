import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";

const API = "http://localhost:3000";

const TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS"],
  IN_PROGRESS: ["RESOLVED", "OPEN"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};

type Ticket = {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  created_at: string;
  unit_code: string | null;
};

type User = {
  id: number;
  name: string;
  role: "ADMIN" | "IT" | "USER";
  unitCode: string | null;
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

// Every request sends the login cookie automatically
function api(path: string, options: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

function describe(entry: AuditEntry): string {
  const d = entry.details;
  switch (entry.action) {
    case "TICKET_CREATED":
      return "created the ticket";
    case "STATUS_CHANGED":
      return `changed status from ${d.from} to ${d.to}`;
    case "COMMENT_ADDED":
      return d.internal ? "added an internal note" : "added a comment";
    default:
      return entry.action;
  }
}

function TicketDetail({
  ticketId,
  canManage,
}: {
  ticketId: number;
  canManage: boolean;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const c = await api(`/tickets/${ticketId}/comments`);
    if (c.ok) setComments(await c.json());
    if (canManage) {
      const a = await api(`/tickets/${ticketId}/audit`);
      if (a.ok) setHistory(await a.json());
    }
  }

  useEffect(() => {
    load();
  }, [ticketId]);

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await api(`/tickets/${ticketId}/comments`, {
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

  return (
    <div style={{ background: "#f6f6f6", padding: 8, marginTop: 8 }}>
      <h4>Comments</h4>
      {comments.length === 0 && <p>No comments yet.</p>}
      {comments.map((c) => (
        <div
          key={c.id}
          style={{
            padding: 6,
            marginBottom: 4,
            background: c.is_internal ? "#fff4cc" : "white",
            border: "1px solid #ddd",
          }}
        >
          <strong>{c.author_name}</strong> ({c.author_role})
          {c.is_internal && " 🔒 internal note"}
          <div>{c.body}</div>
          <small>{new Date(c.created_at).toLocaleString()}</small>
        </div>
      ))}

      <form onSubmit={addComment} style={{ display: "grid", gap: 6 }}>
        <textarea
          placeholder="Write a comment"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {canManage && (
          <label>
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />{" "}
            Internal note (requester cannot see)
          </label>
        )}
        <button type="submit">Add comment</button>
        {error && <span style={{ color: "red" }}>{error}</span>}
      </form>

      {canManage && (
        <>
          <h4>History</h4>
          {history.map((h) => (
            <div key={h.id}>
              <small>
                {new Date(h.created_at).toLocaleString()}:{" "}
                <strong>{h.actor_name}</strong> {describe(h)}
              </small>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (user) loadTickets();
  }, [user]);

  async function loadTickets() {
    const res = await api("/tickets");
    if (res.ok) setTickets(await res.json());
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Login failed");
      return;
    }
    setPassword("");
    setUser(data);
  }

  async function downloadCsv() {
    setError("");
    const res = await api("/export/tickets.csv");
    if (!res.ok) {
      setError("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tickets.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setTickets([]);
    setOpenId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await api("/tickets", {
      method: "POST",
      body: JSON.stringify({ title, description, priority }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    setTitle("");
    setDescription("");
    setPriority("MEDIUM");
    loadTickets();
  }

  async function changeStatus(id: number, status: string) {
    setError("");
    const res = await api(`/tickets/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Something went wrong");
      return;
    }
    await loadTickets();
    // Re-open the panel so the history refreshes
    if (openId === id) {
      setOpenId(null);
      setTimeout(() => setOpenId(id), 0);
    }
  }

  if (checking) return <p>Loading...</p>;

  if (!user) {
    return (
      <div
        style={{ maxWidth: 360, margin: "4rem auto", fontFamily: "sans-serif" }}
      >
        <h1>UOA Helpdesk</h1>
        <form onSubmit={handleLogin} style={{ display: "grid", gap: 8 }}>
          <input
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit">Log in</button>
          {error && <p style={{ color: "red" }}>{error}</p>}
        </form>
      </div>
    );
  }

  const canManage = user.role === "ADMIN" || user.role === "IT";

  return (
    <div
      style={{ maxWidth: 700, margin: "2rem auto", fontFamily: "sans-serif" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h1>UOA Helpdesk</h1>
        <div>
          {user.name} ({user.role}, {user.unitCode ?? "no unit"}){" "}
          <button onClick={handleLogout}>Log out</button>
        </div>
      </div>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 8 }}>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          placeholder="Describe the problem"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <select value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option>LOW</option>
          <option>MEDIUM</option>
          <option>HIGH</option>
          <option>URGENT</option>
        </select>
        <button type="submit">Create ticket</button>
      </form>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {canManage && <Dashboard refresh={tickets} />}
      <h2>
        Tickets ({tickets.length}){" "}
        {canManage && <button onClick={downloadCsv}>Export CSV</button>}
      </h2>{" "}
      {tickets.map((t) => (
        <div
          key={t.id}
          style={{ border: "1px solid #ccc", padding: 8, marginBottom: 8 }}
        >
          <strong>
            #{t.id} {t.title}
          </strong>{" "}
          [{t.priority}] ({t.status}) {t.unit_code}
          <p>{t.description}</p>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {canManage &&
              TRANSITIONS[t.status]?.map((next) => (
                <button key={next} onClick={() => changeStatus(t.id, next)}>
                  Move to {next}
                </button>
              ))}
            <button onClick={() => setOpenId(openId === t.id ? null : t.id)}>
              {openId === t.id ? "Hide details" : "Details"}
            </button>
          </div>
          <small>{new Date(t.created_at).toLocaleString()}</small>
          {openId === t.id && (
            <TicketDetail ticketId={t.id} canManage={canManage} />
          )}
        </div>
      ))}
    </div>
  );
}
