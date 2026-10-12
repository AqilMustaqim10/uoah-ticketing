import { useEffect, useState } from "react";

const API = "http://localhost:3000";

type Stats = {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byUnit: Record<string, number>;
  overdue: number;
  overdueIds: number[];
};

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${tone}`}>{value}</div>
    </div>
  );
}

function Breakdown({
  title,
  data,
  keys,
}: {
  title: string;
  data: Record<string, number>;
  keys?: string[];
}) {
  const list = keys ?? Object.keys(data);
  const max = Math.max(1, ...list.map((k) => data[k] ?? 0));
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">{title}</h3>
      <div className="space-y-2">
        {list.map((k) => (
          <div key={k} className="flex items-center gap-2 text-sm">
            <span className="w-24 text-slate-600 truncate">
              {k.replace("_", " ")}
            </span>
            <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600"
                style={{ width: `${((data[k] ?? 0) / max) * 100}%` }}
              />
            </div>
            <span className="w-8 text-right text-slate-900 font-medium">
              {data[k] ?? 0}
            </span>
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-sm text-slate-400">No data yet</p>
        )}
      </div>
    </div>
  );
}

// `refresh` changes whenever the ticket list reloads, so the numbers stay current
export default function Dashboard({ refresh }: { refresh: unknown }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch(`${API}/stats`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => setStats(null));
  }, [refresh]);

  if (!stats) return <p className="text-slate-500">Loading...</p>;

  const total = Object.values(stats.byStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">Dashboard</h1>

      {stats.overdue > 0 && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl px-4 py-3 text-sm">
          <strong>{stats.overdue} overdue</strong>:{" "}
          {stats.overdueIds.map((id) => `#${id}`).join(", ")}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Total tickets" value={total} tone="text-slate-900" />
        <Kpi
          label="Open"
          value={stats.byStatus.OPEN ?? 0}
          tone="text-emerald-600"
        />
        <Kpi
          label="In progress"
          value={stats.byStatus.IN_PROGRESS ?? 0}
          tone="text-amber-600"
        />
        <Kpi
          label="Resolved"
          value={stats.byStatus.RESOLVED ?? 0}
          tone="text-emerald-600"
        />
        <Kpi
          label="Urgent"
          value={stats.byPriority.URGENT ?? 0}
          tone="text-rose-600"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-3">
        <Breakdown
          title="By status"
          data={stats.byStatus}
          keys={["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]}
        />
        <Breakdown
          title="By priority"
          data={stats.byPriority}
          keys={["URGENT", "HIGH", "MEDIUM", "LOW"]}
        />
        <Breakdown title="By business unit" data={stats.byUnit} />
      </div>
    </div>
  );
}
