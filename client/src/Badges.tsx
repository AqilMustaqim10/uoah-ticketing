export function StatusBadge({ status }: { status: string }) {
  const style: Record<string, string> = {
    OPEN: "bg-emerald-50 text-emerald-700 border-emerald-200",
    IN_PROGRESS: "bg-amber-50 text-amber-700 border-amber-200",
    RESOLVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
    CLOSED: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-lg border ${style[status] ?? style.CLOSED}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const style: Record<string, string> = {
    URGENT: "bg-rose-50 text-rose-700 border-rose-200",
    HIGH: "bg-indigo-50 text-indigo-700 border-indigo-200",
    MEDIUM: "bg-slate-100 text-slate-700 border-slate-200",
    LOW: "bg-slate-50 text-slate-500 border-slate-200",
  };
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-lg border ${style[priority] ?? style.LOW}`}
    >
      {priority}
    </span>
  );
}
