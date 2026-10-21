import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useMe, useUnreadNotifications } from "../hooks";
import { api, initials } from "../lib/api";
import { disconnectSocket } from "../lib/socket";

const tabs = [
  { to: "/app/groups", label: "Groups", icon: "M17 20h5v-2a4 4 0 0 0-3-3.87M9 20H4v-2a4 4 0 0 1 3-3.87m6-3.13a4 4 0 1 0-4-4 4 4 0 0 0 4 4Zm6-4a3 3 0 1 1-3-3", key: "groups" },
  { to: "/app/dm", label: "Messages", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z", key: "dm" },
  { to: "/app/notifications", label: "Alerts", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0 1 18 14.158V11a6.002 6.002 0 0 0-4-5.659V5a2 2 0 1 0-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9", key: "alerts" },
  { to: "/app/profile", label: "Profile", icon: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 14a7 7 0 0 0-7 7h14a7 7 0 0 0-7-7Z", key: "profile" },
];

export default function Layout() {
  const { data } = useMe();
  const user = data?.user;
  const [unread] = useUnreadNotifications(user?.unreadNotifications || 0);
  const nav = useNavigate();

  async function signOut() {
    try {
      await api("/api/auth/sign-out", { method: "POST" });
    } finally {
      disconnectSocket();
      location.href = "/";
    }
  }

  return (
    <div className="app-bg flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-black/40 px-4 py-6 md:flex">
        <a href="/app/groups" className="mb-8 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-sm font-bold">
            O
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            Omnivex Academy
          </span>
        </a>
        <nav className="flex flex-1 flex-col gap-1">
          {[...tabs, { to: "/app/announcements", label: "Announcements", icon: "M11 5.882V19.24a1.76 1.76 0 0 1-3.417.592l-2.147-6.15M18 13a3 3 0 1 0 0-6M5.436 13.683A4.001 4.001 0 0 1 7 6h1.832c4.1 0 7.834-2.661 9.336-6.36a1.76 1.76 0 0 1 3.164-.477c.507.96.258 2.144-.507 2.924A11.996 11.996 0 0 1 18 13Z", key: "ann" }].map((t) => (
            <NavLink
              key={t.key}
              to={t.to}
              className={({ isActive }) =>
                `focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  isActive
                    ? "bg-accent-soft text-white"
                    : "text-mist hover:bg-surface-2/60 hover:text-white"
                }`
              }
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
              </svg>
              <span className="flex-1">{t.label}</span>
              {t.key === "alerts" && unread > 0 && (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-bold leading-none">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </NavLink>
          ))}
          {user?.isAdmin && (
            <NavLink
              to="/admin"
              className="focus-ring flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-warning hover:bg-surface-2/60"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
              </svg>
              <span>Admin panel</span>
            </NavLink>
          )}
        </nav>

        <div className="mt-auto border-t border-line pt-4">
          <button
            onClick={() => nav("/app/profile")}
            className="focus-ring flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2/60"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-white">
              {initials(user?.name || "?")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{user?.name}</span>
              <span className="block truncate text-xs text-mist">
                {user?.membershipStatus === "active" || user?.isAdmin
                  ? "Active member"
                  : "Member"}
              </span>
            </span>
          </button>
          <button
            onClick={signOut}
            className="focus-ring mt-2 w-full rounded-xl px-3 py-2 text-left text-sm text-mist hover:bg-surface-2/60 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-black/70 px-4 py-3 backdrop-blur-md md:hidden">
          <a href="/app/groups" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-xs font-bold">
              O
            </span>
            <span className="text-sm font-semibold">Omnivex Academy</span>
          </a>
          <div className="flex items-center gap-2">
            {user?.isAdmin && (
              <a
                href="/admin"
                className="rounded-lg border border-warning/40 px-2 py-1 text-[11px] font-medium text-warning"
              >
                Admin
              </a>
            )}
            <button
              onClick={() => nav("/app/profile")}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-[11px] font-bold"
              aria-label="Profile"
            >
              {initials(user?.name || "?")}
            </button>
          </div>
        </header>

        <main className="flex-1 pb-24 md:pb-0">
          <Outlet />
        </main>

        {/* Mobile bottom tabs */}
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-black/85 backdrop-blur-md md:hidden">
          {tabs.map((t) => (
            <NavLink
              key={t.key}
              to={t.to}
              className={({ isActive }) =>
                `relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] transition ${
                  isActive ? "text-white" : "text-mist"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={t.icon} />
                  </svg>
                  <span>{t.label}</span>
                  {t.key === "alerts" && unread > 0 && (
                    <span className="absolute right-[22%] top-1.5 h-2 w-2 rounded-full bg-accent" />
                  )}
                  {isActive && (
                    <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
