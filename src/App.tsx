import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router-dom";
import { useMe } from "./hooks";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import AuthPage from "./pages/Auth";
import VerifyPage from "./pages/Verify";
import ForgotPasswordPage from "./pages/ForgotPassword";
import ResetPasswordPage from "./pages/ResetPassword";
import PaywallPage from "./pages/Paywall";
import PayCallbackPage from "./pages/PayCallback";
import GroupsPage from "./pages/Groups";
import GroupChatPage from "./pages/GroupChat";
import DmListPage from "./pages/DmList";
import DmChatPage from "./pages/DmChat";
import NotificationsPage from "./pages/Notifications";
import ProfilePage from "./pages/Profile";
import AnnouncementsPage from "./pages/Announcements";
import AdminPage from "./pages/Admin";
import type { ReactNode } from "react";

function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-mist">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-accent" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Requires a signed-in, verified, active member (admins bypass membership). */
function RequireMember({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Spinner />;
  const user = data?.user;
  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  if (!user.emailVerified) return <Navigate to="/verify" replace />;
  if (user.banned) return <Navigate to="/banned" replace />;
  const isActive = user.membershipStatus === "active" || user.isAdmin;
  if (!isActive) return <Navigate to="/paywall" replace />;
  return <>{children}</>;
}

/** Signed-in + verified only (paywall still allowed, e.g. payment callback). */
function RequireVerified({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Spinner />;
  const user = data?.user;
  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  if (!user.emailVerified) return <Navigate to="/verify" replace />;
  if (user.banned) return <Navigate to="/banned" replace />;
  return <>{children}</>;
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Spinner />;
  if (!data?.user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { data, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <Spinner />;
  const user = data?.user;
  if (!user) {
    return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname)}`} replace />;
  }
  if (!user.isAdmin) return <Navigate to="/app/groups" replace />;
  return <>{children}</>;
}

/** Forwards an old-style callback URL (with reference) to /pay/callback. */
function LegacyPayCallback() {
  const [params] = useSearchParams();
  const reference = params.get("reference");
  return (
    <Navigate
      to={reference ? `/pay/callback?reference=${encodeURIComponent(reference)}` : "/paywall"}
      replace
    />
  );
}

function BannedPage() {
  return (
    <div className="app-bg flex min-h-screen items-center justify-center px-6">
      <div className="card max-w-md rounded-2xl p-8 text-center">
        <div className="mb-3 text-4xl">⛔</div>
        <h1 className="text-xl font-semibold">Account suspended</h1>
        <p className="mt-2 text-sm text-mist">
          Your account has been suspended by an administrator. Please contact
          support if you believe this is a mistake.
        </p>
        <a href="/" className="btn-primary mt-6 inline-block rounded-xl px-5 py-2.5 text-sm font-medium">
          Back home
        </a>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/verify" element={<VerifyPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/banned" element={<BannedPage />} />
      {/* Legacy Paystack callback path (older transactions) */}
      <Route
        path="/app/pay/callback"
        element={<LegacyPayCallback />}
      />

      <Route
        path="/paywall"
        element={
          <RequireVerified>
            <PaywallPage />
          </RequireVerified>
        }
      />
      <Route
        path="/pay/callback"
        element={
          <RequireVerified>
            <PayCallbackPage />
          </RequireVerified>
        }
      />

      {/* Authenticated app shell */}
      <Route
        path="/app"
        element={
          <RequireMember>
            <Layout />
          </RequireMember>
        }
      >
        <Route index element={<Navigate to="/app/groups" replace />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="groups/:id" element={<GroupChatPage />} />
        <Route path="dm" element={<DmListPage />} />
        <Route path="dm/:id" element={<DmChatPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* Admin panel (server enforces admin on every API call) */}
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminPage />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
