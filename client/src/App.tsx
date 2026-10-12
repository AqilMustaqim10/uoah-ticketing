import { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Shell, { loadTab, saveTab } from "./Shell";
import type { Tab } from "./Shell";
import { StatusBadge, PriorityBadge } from "./Badges";
import TicketModal from "./TicketModal";
import AuthScreen from "./AuthScreen";
import UsersPage from "./UsersPage";

const API = "http://localhost:3000";

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

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("tickets");

  function go(next: Tab) {
    setTab(next);
    saveTab(next);
  }

  useEffect(() => {
    api("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  // When a user becomes known (login or page refresh), restore their last tab
  useEffect(() => {
    if (user) setTab(loadTab(user.role));
  }, [user]);

  async function loadTickets() {
    const res = await api("/tickets");
    if (res.ok) setTickets(await res.json());
  }

  useEffect(() => {
    if (user) loadTickets();
  }, [user]);

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

  if (checking) return <p>Loading...</p>;

  if (!user) {
    return <AuthScreen onLoggedIn={setUser} />;
  }

  const canManage = user.role === "ADMIN" || user.role === "IT";

  const comingSoon = (title: string) => (
    <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="text-slate-500 mt-1">
        This screen is built in a later step.
      </p>
    </div>
  );

  return (
    <Shell
      user={user}
      active={tab}
      onNavigate={go}
      onCreateTicket={() => go("tickets")}
      onLogout={handleLogout}
    >
      {tab === "dashboard" &&
        (canManage ? <Dashboard refresh={tickets} /> : null)}
      {tab === "tickets" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold text-slate-900">
              Tickets ({tickets.length})
            </h1>
            {canManage && (
              <button
                onClick={downloadCsv}
                className="px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white hover:bg-slate-100"
              >
                Export CSV
              </button>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="bg-white border border-slate-200 rounded-2xl shadow-xs p-4 grid gap-2"
          >
            <input
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Describe the problem"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className="px-3 py-2 text-sm rounded-lg border border-slate-200"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option>LOW</option>
                <option>MEDIUM</option>
                <option>HIGH</option>
                <option>URGENT</option>
              </select>
              <button
                type="submit"
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
              >
                Create ticket
              </button>
            </div>
            {error && <p className="text-sm text-rose-600">{error}</p>}
          </form>

          {tickets.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center text-slate-500">
              No tickets yet. Create the first one above.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-left">
                  <tr>
                    <th className="px-4 py-2 font-medium">Ticket</th>
                    <th className="px-4 py-2 font-medium">Title</th>
                    <th className="px-4 py-2 font-medium">Unit</th>
                    <th className="px-4 py-2 font-medium">Priority</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => setOpenId(t.id)}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-2 font-mono text-slate-600">
                        HD-{t.id}
                      </td>
                      <td className="px-4 py-2 text-slate-900">{t.title}</td>
                      <td className="px-4 py-2 text-slate-600">
                        {t.unit_code}
                      </td>
                      <td className="px-4 py-2">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-4 py-2 text-slate-500">
                        {new Date(t.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {tab === "kb" && comingSoon("Knowledge Base")}
      {tab === "email" && comingSoon("Email Integration Hub")}
      {tab === "users" && user.role === "ADMIN" && (
        <UsersPage meId={user.id} />
      )}{" "}
      {tab === "settings" && comingSoon("Settings")}
      {openId !== null &&
        (() => {
          const t = tickets.find((x) => x.id === openId);
          return t ? (
            <TicketModal
              ticket={t}
              canManage={canManage}
              onClose={() => setOpenId(null)}
              onChanged={loadTickets}
            />
          ) : null;
        })()}
    </Shell>
  );
}
