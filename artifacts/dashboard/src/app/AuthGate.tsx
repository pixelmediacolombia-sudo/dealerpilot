import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { Lock, Loader2, LogOut } from "lucide-react";
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

export function AuthGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(Boolean(token));

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
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
          title="Log out"
          aria-label="Log out and remove access token"
          onClick={handleLogout}
        >
          <LogOut className="w-3.5 h-3.5" />
          Log out
        </button>
      </div>
      {children}
    </>
  );
}
