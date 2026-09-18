import { useState, type FormEvent } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Btn, Panel } from "@/components/game/ui";

export const Route = createFileRoute("/login")({ component: LoginPage });

/**
 * Email/password sign-in — the only sign-in method that actually works on
 * this deployment (see `src/lib/auth/email-password.ts`: the Google/X
 * buttons in `providers.ts` federate through a Grok-hosted broker that isn't
 * part of this app's own deploy, so they're intentionally not rendered here).
 */
function LoginPage() {
  const { user, isPending } = useCurrentUserState();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (isPending) return null;
  if (user) return <Navigate to="/" />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { error: authError } =
        mode === "signUp"
          ? await authClient.signUp.email({ email, password, name: name || email })
          : await authClient.signIn.email({ email, password });
      if (authError) {
        setError(authError.message ?? "Something went wrong.");
        return;
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-5 px-4">
      <header className="text-center">
        <p className="text-xs uppercase tracking-[0.35em] text-muted">Operator access</p>
        <h1 className="font-display text-4xl font-semibold tracking-[0.14em] text-ice">
          {mode === "signUp" ? "New callsign" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-muted">Sync your save and streak across devices.</p>
      </header>

      <Panel className="space-y-3">
        <form className="space-y-3" onSubmit={submit}>
          {mode === "signUp" && (
            <input
              className="w-full rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-cyan"
              placeholder="Callsign (display name)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
            />
          )}
          <input
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-cyan"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <input
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-cyan"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            minLength={8}
            required
          />
          {error && <p className="text-sm text-signal">{error}</p>}
          <Btn type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? "Working…" : mode === "signUp" ? "Create account" : "Sign in"}
          </Btn>
        </form>
        <Btn
          variant="quiet"
          className="w-full"
          onClick={() => {
            setError(null);
            setMode(mode === "signUp" ? "signIn" : "signUp");
          }}
        >
          {mode === "signUp" ? "Have an account? Sign in" : "New here? Create an account"}
        </Btn>
      </Panel>

      <Btn variant="ghost" className="mx-auto" onClick={() => (window.location.href = "/")}>
        Keep playing without an account
      </Btn>
    </div>
  );
}
