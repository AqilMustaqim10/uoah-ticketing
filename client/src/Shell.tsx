import { useState } from "react";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  Ticket,
  BookOpen,
  Mail,
  Users,
  Settings,
  LogOut,
  Plus,
  Menu,
} from "lucide-react";

export type Tab =
  | "dashboard"
  | "tickets"
  | "kb"
  | "email"
  | "users"
  | "settings";
type Role = "ADMIN" | "IT" | "USER";

const ITEMS: { id: Tab; label: string; icon: typeof Ticket; roles: Role[] }[] =
  [
    {
      id: "dashboard",
      label: "Dashboard",
      icon: LayoutDashboard,
      roles: ["ADMIN", "IT"],
    },
    {
      id: "tickets",
      label: "Tickets",
      icon: Ticket,
      roles: ["ADMIN", "IT", "USER"],
    },
    {
      id: "kb",
      label: "Knowledge Base",
      icon: BookOpen,
      roles: ["ADMIN", "IT", "USER"],
    },
    { id: "email", label: "Email Hub", icon: Mail, roles: ["ADMIN", "IT"] },
    {
      id: "users",
      label: "User Directory",
      icon: Users,
      roles: ["ADMIN", "IT"],
    },
    { id: "settings", label: "Settings", icon: Settings, roles: ["ADMIN"] },
  ];

const STORAGE_KEY = "helpdesk.activeTab";

export function allowedTabs(role: Role): Tab[] {
  return ITEMS.filter((i) => i.roles.includes(role)).map((i) => i.id);
}

// Reads the saved tab, but only if this role may open it
export function loadTab(role: Role): Tab {
  const allowed = allowedTabs(role);
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as Tab | null;
    if (saved && allowed.includes(saved)) return saved;
  } catch {
    // storage can be blocked; just use the default
  }
  return role === "USER" ? "tickets" : "dashboard";
}

export function saveTab(tab: Tab) {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // ignore
  }
}

const ROLE_STYLE: Record<Role, string> = {
  ADMIN: "bg-rose-50 text-rose-700 border-rose-200",
  IT: "bg-blue-50 text-blue-700 border-blue-200",
  USER: "bg-slate-100 text-slate-600 border-slate-200",
};

type Props = {
  user: { name: string; role: Role; unitCode: string | null };
  active: Tab;
  onNavigate: (tab: Tab) => void;
  onCreateTicket: () => void;
  onLogout: () => void;
  children: ReactNode;
};

export default function Shell({
  user,
  active,
  onNavigate,
  onCreateTicket,
  onLogout,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const items = ITEMS.filter((i) => i.roles.includes(user.role));

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? "w-16" : "w-60"} shrink-0 bg-white border-r border-slate-200 flex flex-col transition-all duration-200`}
      >
        <div className="h-16 px-4 flex items-center gap-3 border-b border-slate-200">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white grid place-items-center font-bold text-sm shrink-0">
            U
          </div>
          {!collapsed && (
            <div className="leading-tight overflow-hidden">
              <div className="font-semibold text-sm truncate">UOA Helpdesk</div>
              <div className="text-xs text-slate-500 truncate">
                {user.unitCode ?? "No unit"}
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {items.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={label}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                active === id
                  ? "bg-blue-50 text-blue-700 font-medium"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white border-b border-slate-200 px-4 flex items-center gap-3">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
            title="Collapse sidebar"
          >
            <Menu size={18} />
          </button>

          {/* Search is a placeholder for now: it is wired up in a later step */}
          <input
            disabled
            placeholder="Search (coming soon)"
            className="flex-1 max-w-md px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-400"
          />

          <div className="ml-auto flex items-center gap-3">
            <span
              className="hidden sm:inline text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600"
              title="Your business unit"
            >
              {user.role === "ADMIN"
                ? "All units"
                : (user.unitCode ?? "No unit")}
            </span>

            <button
              onClick={onCreateTicket}
              className="flex items-center gap-1 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
            >
              <Plus size={16} /> Create Ticket
            </button>

            <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
              <div className="text-right leading-tight hidden sm:block">
                <div className="text-sm font-medium">{user.name}</div>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-md border ${ROLE_STYLE[user.role]}`}
                >
                  {user.role}
                </span>
              </div>
              <button
                onClick={onLogout}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
                title="Log out"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
