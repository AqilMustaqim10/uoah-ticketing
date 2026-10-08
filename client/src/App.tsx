import { useEffect, useState } from "react";

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

// Every request sends the login cookie automatically
function api(path: string, options: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [error, setError] = useState("");

  // On page load: am I already logged in?
  useEffect(() => {
    api("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  // Once logged in, load tickets
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

  async function handleLogout() {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
    setTickets([]);
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
    loadTickets();
  }

  if (checking) return <p>Loading...</p>;

  // ----- Not logged in: show login form -----
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

  // ----- Logged in: show the helpdesk -----
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

      <h2>Tickets ({tickets.length})</h2>
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
          {canManage && (
            <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              {TRANSITIONS[t.status]?.map((next) => (
                <button key={next} onClick={() => changeStatus(t.id, next)}>
                  Move to {next}
                </button>
              ))}
            </div>
          )}
          <small>{new Date(t.created_at).toLocaleString()}</small>
        </div>
      ))}
    </div>
  );
}
