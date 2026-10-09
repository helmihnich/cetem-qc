"use client";

import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { PASSWORD_MIN_LENGTH, isPasswordCompliant } from "@cetem-qc/domain";
import { fr } from "@cetem-qc/i18n";
import { EmployeeManagement } from "./employee-management";
import { HistoryPanel } from "./history";
import { BrandMark, Icon, type IconName } from "./icons";
import { PasswordRequirements } from "./password-requirements";
import { ResponsableSignInForm } from "./sign-in-form";
import { TaskCreation } from "./task-creation";
import { TaskList } from "./task-list";

type Session = { user: { id: string; email: string; displayName: string; role: "responsable" | "employe"; mustChangePassword: boolean }; sessionExpiresAt: string };
type Employee = { id: string; firstName: string; surname: string; email: string; active: boolean; activated: boolean };
type View = "tasks" | "new-task" | "history" | "team";

const VIEWS: { id: View; icon: IconName; label: string; title: string; description: string }[] = [
  { id: "tasks", icon: "tasks", label: fr.shell.nav.tasks, title: fr.shell.nav.tasks, description: fr.shell.tasksOverview },
  { id: "new-task", icon: "plus", label: fr.shell.nav.newTask, title: fr.shell.nav.newTask, description: fr.shell.newTaskDescription },
  { id: "history", icon: "history", label: fr.shell.nav.history, title: fr.shell.nav.history, description: fr.shell.historyOverview },
  { id: "team", icon: "team", label: fr.shell.nav.team, title: fr.employees.title, description: fr.shell.teamDescription },
];

const todayFormatter = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

async function responseError(response: Response, fallback: string) {
  await response.json().catch(() => undefined);
  return response.status === 401 ? fr.auth.invalidCredentials : fallback;
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase() || "?";
}

/** The signed-out frame: a brand panel beside the form card. */
function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-shell">
    <section className="auth-hero" aria-hidden="true">
      <div className="auth-hero-brand"><BrandMark size={40} /><span><strong>CETEM-QC</strong><small>{fr.shell.brandTagline}</small></span></div>
      <div className="auth-hero-copy">
        <h2>{fr.shell.heroTitle}</h2>
        <p>{fr.shell.heroDescription}</p>
        <ul>{fr.shell.heroPoints.map((point) => <li key={point}><span className="auth-hero-check"><Icon name="check" size={14} /></span>{point}</li>)}</ul>
      </div>
      <p className="auth-hero-footer">CETEM-QC · {fr.shell.footer}</p>
    </section>
    <section className="auth-panel">
      <div className="auth-mobile-brand"><BrandMark size={34} /><strong>CETEM-QC</strong></div>
      {children}
    </section>
  </main>;
}

export default function HomePage() {
  const [session, setSession] = useState<Session>();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("tasks");
  // Bumped after any creation or team change so the task list and the assignee choices reload without a page refresh.
  const [dataVersion, setDataVersion] = useState(0);
  const refreshData = useCallback(() => setDataVersion((version) => version + 1), []);

  const loadEmployees = useCallback(async () => {
    const response = await fetch("/api/employees", { cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setSession(undefined);
      setEmployees([]);
      setNotice(fr.employees.signIn);
      return;
    }
    if (!response.ok) throw new Error(fr.employees.loadError);
    const result = await response.json() as { employees: Employee[] };
    setEmployees(result.employees);
  }, []);

  const restoreSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      if (!response.ok) { setSession(undefined); return; }
      const current = await response.json() as Session;
      setSession(current);
      if (!current.user.mustChangePassword && current.user.role === "responsable") await loadEmployees();
      else setEmployees([]);
    } catch {
      setError(fr.api.unavailable);
    } finally {
      setLoading(false);
    }
  }, [loadEmployees]);

  useEffect(() => { void restoreSession(); }, [restoreSession]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (!response.ok) { setError(await responseError(response, fr.auth.invalidCredentials)); return; }
      setPassword("");
      setView("tasks");
      await restoreSession();
    } catch { setError(fr.api.unavailable); }
    finally { setBusy(false); }
  }

  async function activateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/session/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword }) });
      if (!response.ok) { setError(await responseError(response, fr.auth.activationError)); return; }
      setNewPassword("");
      await restoreSession();
    } catch { setError(fr.api.unavailable); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) { setError(fr.auth.logoutError); return; }
      setSession(undefined); setEmployees([]); setNotice(fr.auth.signedOut); setPassword("");
    } catch { setError(fr.auth.logoutError); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="boot-screen" role="status"><BrandMark size={44} /><span className="spinner" aria-hidden="true" /><span>{fr.common.loading}</span></main>;

  if (!session) return <AuthLayout>
    <div className="auth-card">
      <p className="eyebrow">{fr.shell.workspace}</p>
      <h1>{fr.auth.title}</h1>
      <p className="subtitle">{fr.auth.description}</p>
      <ResponsableSignInForm email={email} password={password} busy={busy} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={(event) => void signIn(event)} />
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error-state" role="alert">{error}</p>}
    </div>
  </AuthLayout>;

  if (session.user.mustChangePassword) return <AuthLayout>
    <div className="auth-card">
      <p className="eyebrow">{fr.shell.workspace}</p>
      <h1>{fr.auth.activationTitle}</h1>
      <p className="subtitle">{fr.auth.activationDescription}</p>
      <form onSubmit={(event) => void activateAccount(event)} className="auth-form">
        <label>{fr.auth.newPassword}<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <PasswordRequirements password={newPassword} />
        <button className="primary-button" disabled={busy || !isPasswordCompliant(newPassword)}>{busy ? fr.common.loading : fr.auth.activate}</button>
      </form>
      {error && <p className="error-state" role="alert">{error}</p>}
    </div>
  </AuthLayout>;

  if (session.user.role !== "responsable") return <AuthLayout>
    <div className="auth-card">
      <p className="error-state" role="alert">{fr.auth.responsableOnly}</p>
      <button className="secondary-button" type="button" onClick={() => void signOut()}>{fr.auth.logout}</button>
    </div>
  </AuthLayout>;

  const current = VIEWS.find((item) => item.id === view)!;
  const displayName = session.user.displayName || session.user.email;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><BrandMark /><span><strong>CETEM-QC</strong><small>{fr.shell.brandTagline}</small></span></div>
        <nav className="sidebar-nav" aria-label={fr.shell.navigation}>
          <p className="sidebar-label">{fr.shell.workspace}</p>
          {VIEWS.map((item) => <button key={item.id} type="button" className="nav-item" aria-current={item.id === view ? "page" : undefined} onClick={() => setView(item.id)}>
            <Icon name={item.icon} /><span>{item.label}</span>
            {item.id === "team" && employees.length > 0 && <span className="nav-count">{employees.length}</span>}
          </button>)}
        </nav>
        <div className="sidebar-user">
          <span className="avatar" aria-hidden="true">{initialsOf(displayName)}</span>
          <span className="sidebar-user-copy"><strong title={displayName}>{displayName}</strong><small>{fr.shell.roleResponsable}</small></span>
          <button className="icon-button" type="button" disabled={busy} onClick={() => void signOut()} aria-label={fr.auth.logout} title={fr.auth.logout}><Icon name="logout" /></button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <nav className="breadcrumb" aria-label="Fil d’Ariane"><span>{fr.shell.workspace}</span><span aria-hidden="true">/</span><strong>{current.label}</strong></nav>
          <span className="topbar-date">{todayFormatter.format(new Date())}</span>
        </header>

        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{fr.shell.workspace}</p>
              <h1>{current.title}</h1>
              <p className="subtitle">{current.description}</p>
            </div>
            {view === "tasks" && <button className="primary-button with-icon" type="button" onClick={() => setView("new-task")}><Icon name="plus" size={16} />{fr.shell.nav.newTask}</button>}
          </div>
          {error && <p className="alert alert-error" role="alert">{error}</p>}

          {view === "tasks" && <TaskList refreshKey={dataVersion} />}
          {view === "new-task" && <TaskCreation refreshKey={dataVersion} onTaskCreated={refreshData} />}
          {view === "history" && <HistoryPanel />}
          {view === "team" && <EmployeeManagement employees={employees} onCreated={(employee) => setEmployees((list) => list.some((item) => item.email === employee.email) ? list : [...list, employee].sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName)))} onRefresh={async () => { try { await loadEmployees(); } finally { refreshData(); } }} />}
        </main>

        <footer className="footer">CETEM-QC <span>·</span> {fr.shell.footer}</footer>
      </div>
    </div>
  );
}
