import { useEffect, useState } from "react";

const API = "http://localhost:3000";

type Stats = {
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byUnit: Record<string, number>;
  overdue: number;
  overdueIds: number[];
};

function Box({
  label,
  value,
  red,
}: {
  label: string;
  value: number;
  red?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid #ccc",
        padding: "6px 12px",
        minWidth: 90,
        textAlign: "center",
        background: red && value > 0 ? "#ffe0e0" : "white",
      }}
    >
      <div style={{ fontSize: 22, fontWeight: "bold" }}>{value}</div>
      <small>{label}</small>
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

  if (!stats) return null;

  const row = (
    title: string,
    data: Record<string, number>,
    keys?: string[],
  ) => (
    <div style={{ marginBottom: 8 }}>
      <small>{title}</small>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(keys ?? Object.keys(data)).map((k) => (
          <Box key={k} label={k} value={data[k] ?? 0} />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ background: "#f6f6f6", padding: 10, margin: "12px 0" }}>
      <h2 style={{ marginTop: 0 }}>Dashboard</h2>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <Box label="OVERDUE" value={stats.overdue} red />
      </div>
      {stats.overdueIds.length > 0 && (
        <p style={{ color: "#b00020", marginTop: 0 }}>
          Overdue tickets: {stats.overdueIds.map((id) => `#${id}`).join(", ")}
        </p>
      )}
      {row("By status", stats.byStatus, [
        "OPEN",
        "IN_PROGRESS",
        "RESOLVED",
        "CLOSED",
      ])}
      {row("By priority", stats.byPriority, [
        "URGENT",
        "HIGH",
        "MEDIUM",
        "LOW",
      ])}
      {row("By business unit", stats.byUnit)}
    </div>
  );
}
