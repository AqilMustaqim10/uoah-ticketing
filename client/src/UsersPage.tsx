import { useEffect, useState } from "react";

const API = "http://localhost:3000";

type Row = {
  id: number;
  name: string;
  email: string;
  role: "ADMIN" | "IT" | "USER";
  is_active: boolean;
  business_unit_id: number | null;
  unit_code: string | null;
};
type Unit = { id: number; code: string; name: string };

function api(path: string, options: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
  });
}

const ROLE_STYLE: Record<string, string> = {
  ADMIN: "bg-rose-50 text-rose-700 border-rose-200",
  IT: "bg-blue-50 text-blue-700 border-blue-200",
  USER: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function UsersPage({ meId }: { meId: number }) {
  const [users, setUsers] = useState<Row[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    const res = await api("/admin/users");
    if (res.ok) setUsers(await res.json());
    else setError("Could not load users");
  }

  useEffect(() => {
    load();
    fetch(`${API}/auth/units`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setUnits)
      .catch(() => setUnits([]));
  }, []);

  async function update(id: number, patch: Record<string, unknown>) {
    setError("");
    setBusyId(id);
    const res = await api(`/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Update failed");
    }
    await load();
    setBusyId(null);
  }

  function changeRole(u: Row, role: string) {
    if (
      role === "ADMIN" &&
      !window.confirm(`Make ${u.name} an ADMIN? Admins can see everything.`)
    )
      return;
    update(u.id, { role });
  }

  function toggleActive(u: Row) {
    const msg = u.is_active
      ? `Disable ${u.name}? They lose access immediately.`
      : `Enable ${u.name} again?`;
    if (window.confirm(msg)) update(u.id, { isActive: !u.is_active });
  }

  const q = search.trim().toLowerCase();
  const shown = users.filter(
    (u) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q),
  );

  const select =
    "px-2 py-1 text-sm rounded-lg border border-slate-200 bg-white disabled:bg-slate-50 disabled:text-slate-400";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">
          User Directory ({users.length})
        </h1>
        <input
          className="px-3 py-2 text-sm rounded-lg border border-slate-200 w-64"
          placeholder="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Unit</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => {
              const isMe = u.id === meId;
              const busy = busyId === u.id;
              return (
                <tr
                  key={u.id}
                  className={`border-t border-slate-100 ${u.is_active ? "" : "bg-slate-50 text-slate-400"}`}
                >
                  <td className="px-4 py-2">
                    {u.name}{" "}
                    {isMe && (
                      <span className="text-xs text-slate-400">(you)</span>
                    )}
                  </td>
                  <td className="px-4 py-2">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      className={`${select} ${ROLE_STYLE[u.role]}`}
                      value={u.role}
                      disabled={isMe || busy}
                      onChange={(e) => changeRole(u, e.target.value)}
                    >
                      <option>USER</option>
                      <option>IT</option>
                      <option>ADMIN</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      className={select}
                      value={u.business_unit_id ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        update(u.id, { businessUnitId: Number(e.target.value) })
                      }
                    >
                      {u.business_unit_id === null && (
                        <option value="">None</option>
                      )}
                      {units.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.code}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      disabled={isMe || busy}
                      onClick={() => toggleActive(u)}
                      className={`px-2 py-1 text-xs rounded-lg border disabled:opacity-40 ${
                        u.is_active
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-300 bg-white text-slate-600"
                      }`}
                    >
                      {u.is_active
                        ? "Active (click to disable)"
                        : "Disabled (click to enable)"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Moving a user changes where their future tickets go. Existing tickets
        stay in their original unit.
      </p>
    </div>
  );
}
