import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { KeyRound, Lock, Loader2, LogOut } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

const TOKEN_KEY = "dealerpilot.sessionToken";

interface AuthUser {
  id: number;
  dealerId: number;
  username: string;
  displayName: string;
  role: string;
}

async function authFetch(path: string, token?: string, init?: RequestInit) {
  return fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
  });
}

function LoginScreen({ onLogin }: { onLogin: (token: string, user: AuthUser) => void }) {
  const [username, setUsername] = useState("alpha.manassas");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await authFetch("/auth/login", undefined, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Login failed");
      localStorage.setItem(TOKEN_KEY, data.token);
      onLogin(data.token, data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center p-6">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-sm border border-white/[0.08] bg-card rounded-lg p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg border border-primary/25 bg-primary/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">DealerPilot</h1>
            <p className="text-xs text-muted-foreground">Alpha Motorsport access</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Username</label>
            <Input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Password</label>
            <Input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          {error && <div className="text-xs text-destructive">{error}</div>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Sign in
          </Button>
        </div>
      </form>
    </main>
  );
}

function ChangePasswordPanel({
  token,
  onClose,
  onChanged,
}: {
  token: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    setLoading(true);
    try {
      const response = await authFetch("/auth/change-password", token, {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = Array.isArray(data.details) ? ` ${data.details.join(" ")}` : "";
        throw new Error(`${data.error ?? "Password change failed"}${detail}`);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password change failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-md rounded-lg border border-white/[0.08] bg-card p-5 shadow-2xl"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">Change password</h2>
            <p className="text-xs text-muted-foreground">Use a unique password with 14+ characters.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Current password</label>
            <Input
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">New password</label>
            <Input
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Confirm new password</label>
            <Input
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </div>
          {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save password
          </Button>
        </div>
      </form>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(Boolean(token));
  const [changingPassword, setChangingPassword] = useState(false);

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setChangingPassword(false);
  }

  function handleLogout() {
    if (token) void authFetch("/auth/logout", token, { method: "POST", body: "{}" });
    clearSession();
  }

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setChecking(true);
    authFetch("/auth/me", token)
      .then(async (response) => {
        if (!response.ok) throw new Error("Session expired");
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) {
          clearSession();
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (checking) {
    return (
      <main className="min-h-screen bg-background text-muted-foreground flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin" />
      </main>
    );
  }

  if (!token || !user) {
    return <LoginScreen onLogin={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser); }} />;
  }

  return (
    <>
      <div className="fixed right-4 top-3 z-50 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-background/90 px-2 py-1.5 text-xs text-muted-foreground shadow-xl shadow-black/20 backdrop-blur">
        <span className="hidden max-w-[160px] truncate px-1.5 font-medium text-white/70 sm:inline">
          {user.displayName}
        </span>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-[11px] font-semibold text-white/70 transition hover:border-primary/35 hover:bg-primary/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          title="Change password"
          aria-label="Change password"
          onClick={() => setChangingPassword(true)}
        >
          <KeyRound className="w-3.5 h-3.5" />
          Password
        </button>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-[11px] font-semibold text-white/70 transition hover:border-primary/35 hover:bg-primary/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          title="Log out"
          aria-label="Log out and remove access token"
          onClick={handleLogout}
        >
          <LogOut className="w-3.5 h-3.5" />
          Log out
        </button>
      </div>
      {changingPassword && token ? (
        <ChangePasswordPanel token={token} onClose={() => setChangingPassword(false)} onChanged={clearSession} />
      ) : null}
      {children}
    </>
  );
}
