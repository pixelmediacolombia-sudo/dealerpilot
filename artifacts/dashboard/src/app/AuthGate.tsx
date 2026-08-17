import { createContext, FormEvent, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, KeyRound, Loader2, LogOut, UserRound } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";

const TOKEN_KEY = "dealerpilot.sessionToken";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export interface AuthUser {
  id: number;
  dealerId: number;
  username: string;
  displayName: string;
  role: string;
}

interface AccountMenuContextValue {
  user: AuthUser;
  openPasswordPanel: () => void;
  logout: () => void;
}

const AccountMenuContext = createContext<AccountMenuContextValue | null>(null);

export function useAccount(): AuthUser {
  const account = useContext(AccountMenuContext);
  if (!account) throw new Error("useAccount must be used inside AuthGate");
  return account.user;
}

export function AccountMenu() {
  const account = useContext(AccountMenuContext);

  if (!account) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 max-w-[220px] shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          aria-label={`Open account menu for ${account.user.displayName}`}
        >
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <UserRound className="h-3.5 w-3.5" />
          </span>
          <span className="hidden min-w-0 truncate lg:inline">{account.user.displayName}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-56 p-1.5">
        <DropdownMenuLabel className="px-2 py-2">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Account</span>
          <span className="mt-1 block truncate text-sm text-foreground">{account.user.displayName}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer py-2" onSelect={account.openPasswordPanel}>
          <KeyRound className="h-4 w-4" />
          Change password
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer py-2 text-destructive focus:text-destructive" onSelect={account.logout}>
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-5 text-foreground">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-md rounded-xl border border-border bg-card p-7 shadow-lg sm:p-8"
      >
        <div className="mb-7 flex items-center gap-3">
          <span className="relative block h-10 w-10 shrink-0" aria-hidden="true">
            <img src="/dealerpilot-p-dark-tight-transparent.png" alt="" className="block h-full w-full object-contain outline-none dark:hidden" />
            <img src="/dealerpilot-p-transparent.png" alt="" className="hidden h-full w-full object-contain outline-none dark:block" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">DealerPilot</h1>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="dealerpilot-username" className="mb-1.5 block text-sm font-medium text-foreground">Username</label>
            <Input id="dealerpilot-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>
          <div>
            <label htmlFor="dealerpilot-password" className="mb-1.5 block text-sm font-medium text-foreground">Password</label>
            <Input
              id="dealerpilot-password"
              name="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          {error && <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/25 p-4 backdrop-blur-sm">
      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/25 bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Change password</h2>
            <p className="text-xs text-muted-foreground">Use a unique password with 14+ characters.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="current-password" className="mb-1.5 block text-sm font-medium text-foreground">Current password</label>
            <Input
              id="current-password"
              name="currentPassword"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-foreground">New password</label>
            <Input
              id="new-password"
              name="newPassword"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-foreground">Confirm new password</label>
            <Input
              id="confirm-password"
              name="confirmPassword"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
            />
          </div>
          {error && <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}
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
    <AccountMenuContext.Provider value={{ user, openPasswordPanel: () => setChangingPassword(true), logout: handleLogout }}>
      {changingPassword && token ? (
        <ChangePasswordPanel token={token} onClose={() => setChangingPassword(false)} onChanged={clearSession} />
      ) : null}
      {children}
    </AccountMenuContext.Provider>
  );
}
