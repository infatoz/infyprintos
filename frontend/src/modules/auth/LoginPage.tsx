import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Eye, EyeOff, Moon, Sun } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";
import { APP_NAME, APP_SHORT, APP_TAGLINE } from "@/lib/brand";

const EMAIL_KEY = "infatoz_login_email";
const SEED_EMAIL = "printfactorykoteshwara@gmail.com";

function readSavedEmail() {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function clockLabel() {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    return "";
  }
}

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const { theme, toggle, hydrate } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState(readSavedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [capsOn, setCapsOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [now, setNow] = useState(clockLabel);

  useEffect(() => {
    hydrate();
    const id = window.setInterval(() => setNow(clockLabel()), 30_000);
    return () => window.clearInterval(id);
  }, [hydrate]);

  function onCaps(e: KeyboardEvent<HTMLInputElement>) {
    setCapsOn(e.getModifierState("CapsLock"));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
      try {
        if (remember) localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
        else localStorage.removeItem(EMAIL_KEY);
      } catch {
        /* ignore */
      }
      toast.success("Signed in");
      navigate("/");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string }; status?: number } })?.response;
      const text =
        msg?.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : msg?.data?.message || "Email or password is incorrect.";
      setError(text);
      toast.error(text);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-dvh bg-paper lg:grid-cols-[minmax(280px,42%)_1fr]">
      <aside className="relative hidden flex-col justify-between bg-sidebar px-10 py-10 text-white lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-white/10 text-[11px] font-semibold tracking-[0.08em]">{APP_SHORT.slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="text-[15px] font-semibold tracking-tight">{APP_NAME}</div>
              <div className="text-[12px] text-sidebar-text">{APP_TAGLINE}</div>
            </div>
          </div>
          <h1 className="mt-14 max-w-sm text-[28px] font-semibold leading-tight tracking-tight">Staff console for the press floor.</h1>
          <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-sidebar-text">
            Sign in to POS, orders, production, stock and collections. Amounts and stock are calculated on the server.
          </p>
          <ul className="mt-10 space-y-3 text-[13px] text-sidebar-text">
            {["Quotations and GST invoices", "Shop-floor jobs and machines", "Inventory ledger", "Receivables and expenses"].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-mark" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-end justify-between gap-4 text-[12px] text-sidebar-text">
          <span>Asia/Kolkata · INR</span>
          <span className="font-mono tabular-nums">{now}</span>
        </div>
      </aside>

      <main className="relative flex min-h-dvh flex-col px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8">
        <div className="mb-8 flex items-center justify-between gap-3 lg:mb-0 lg:justify-end">
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-sidebar text-[10px] font-semibold tracking-[0.08em] text-white">{APP_SHORT.slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="text-[14px] font-semibold leading-none">{APP_NAME}</div>
              <div className="mt-0.5 text-[11px] text-muted">{APP_TAGLINE}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={toggle}
            className="grid h-10 w-10 place-items-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-paper"
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
          <h2 className="text-[22px] font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">Use the email assigned to you. Keep this device private — sessions stay on this browser.</p>

          <form className="mt-7 space-y-4" onSubmit={(e) => void onSubmit(e)} noValidate>
            {error ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200" role="alert">
                {error}
              </div>
            ) : null}

            <div>
              <Label htmlFor="login-email">Email</Label>
              <Input
                id="login-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                required
                className="h-11"
                placeholder="you@press.example"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <Label htmlFor="login-password" className="mb-0">
                  Password
                </Label>
                <button type="button" className="text-[12px] font-medium text-accent hover:underline" onClick={() => setHelpOpen((v) => !v)}>
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={onCaps}
                  onKeyUp={onCaps}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  minLength={6}
                  className="h-11 pr-11"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-ink"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {capsOn ? <p className="mt-1.5 text-[12px] text-amber-700 dark:text-amber-300">Caps Lock is on</p> : null}
            </div>

            {helpOpen ? (
              <p className="rounded-lg border border-line bg-paper px-3 py-2.5 text-[12px] leading-relaxed text-ink-2">
                Password reset is not sent by email. Ask an owner to set a new password in Admin → People.
              </p>
            ) : null}

            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="size-4 rounded border-line accent-[var(--accent)]"
              />
              Remember email on this device
            </label>

            <Button className="h-11 w-full" size="lg" disabled={loading || !email.trim() || password.length < 6}>
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          {import.meta.env.DEV ? (
            <button
              type="button"
              className="mt-5 text-left text-[12px] text-muted hover:text-ink hover:underline"
              onClick={() => {
                setEmail(SEED_EMAIL);
                setPassword("Owner@12345");
              }}
            >
              Local seed account: {SEED_EMAIL}
            </button>
          ) : null}

          <p className={cn("mt-8 text-[12px] text-muted lg:hidden")}>Asia/Kolkata · {now}</p>
        </div>
      </main>
    </div>
  );
}
