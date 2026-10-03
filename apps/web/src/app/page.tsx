"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { fr } from "@cetem-qc/i18n";
import { EmployeeManagement } from "./employee-management";
import { ResponsableSignInForm } from "./sign-in-form";
import { TaskCreation } from "./task-creation";
import { TaskList } from "./task-list";

type Session = { user: { id: string; email: string; displayName: string; role: "responsable" | "employe"; mustChangePassword: boolean }; sessionExpiresAt: string };
type Employee = { id: string; firstName: string; surname: string; email: string; active: boolean };

async function responseError(response: Response, fallback: string) {
  await response.json().catch(() => undefined);
  return response.status === 401 ? fr.auth.invalidCredentials : fallback;
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
      await restoreSession();
    } catch { setError(fr.api.unavailable); }
    finally { setBusy(false); }
  }

  async function activateAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/session/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword: password, newPassword }) });
      if (!response.ok) { setError(await responseError(response, fr.auth.activationError)); return; }
      setPassword(""); setNewPassword("");
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

  const signedIn = !!session && session.user.role === "responsable" && !session.user.mustChangePassword;

  return (
    <main className="page-shell">
      <aside className="sidebar" aria-label="Navigation principale"><div className="brand-mark">CQ</div>{signedIn && <span className="nav-active">Équipe</span>}</aside>
      <section className="content">
        <header className="topbar"><span className="eyebrow">CETEM-QC</span>{signedIn && <button className="text-button" type="button" disabled={busy} onClick={() => void signOut()}>{fr.auth.logout}</button>}</header>
        {loading ? <section className="roster-card state-message" role="status">{fr.common.loading}</section>
          : !session ? <section className="auth-card"><p className="eyebrow">ESPACE RESPONSABLE</p><h1>{fr.auth.title}</h1><p className="subtitle">{fr.auth.description}</p>
            <ResponsableSignInForm email={email} password={password} busy={busy} onEmailChange={setEmail} onPasswordChange={setPassword} onSubmit={(event) => void signIn(event)} />
            {notice && <p className="notice" role="status">{notice}</p>}{error && <p className="error-state" role="alert">{error}</p>}</section>
          : session.user.mustChangePassword ? <section className="auth-card"><p className="eyebrow">ESPACE RESPONSABLE</p><h1>{fr.auth.activationTitle}</h1><p className="subtitle">{fr.auth.activationDescription}</p>
            <form onSubmit={(event) => void activateAccount(event)} className="auth-form"><label>{fr.auth.currentPassword}<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>{fr.auth.newPassword}<input type="password" autoComplete="new-password" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? fr.common.loading : fr.auth.activate}</button></form>{error && <p className="error-state" role="alert">{error}</p>}</section>
          : session.user.role !== "responsable" ? <section className="auth-card"><p className="error-state" role="alert">{fr.auth.responsableOnly}</p><button className="secondary-button" type="button" onClick={() => void signOut()}>{fr.auth.logout}</button></section>
          : <><div className="page-heading"><div><p className="eyebrow">ESPACE RESPONSABLE</p><h1>{fr.tasks.listTitle}</h1><p className="subtitle">{fr.tasks.listDescription}</p></div></div>
            <TaskList />
            <EmployeeManagement employees={employees} onCreated={(employee) => setEmployees((current) => current.some((item) => item.email === employee.email) ? current : [...current, employee].sort((a, b) => a.surname.localeCompare(b.surname) || a.firstName.localeCompare(b.firstName)))} onRefresh={loadEmployees} />
            <TaskCreation />
            <section className="roster-card" aria-labelledby="roster-title"><div className="card-heading"><div><h2 id="roster-title">Employés</h2><p>Les membres de votre équipe</p></div>{!error && <span className="count-badge">{employees.length}</span>}</div>
              {error ? <div className="state-message error-state" role="alert">{error}</div> : employees.length === 0 ? <div className="state-message empty-state"><span className="empty-icon" aria-hidden="true">○</span><p>{fr.employees.empty}</p></div>
                : <div className="table-wrap"><table><thead><tr><th>{fr.employees.firstName}</th><th>{fr.employees.surname}</th><th>{fr.employees.email}</th><th>{fr.employees.status}</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.email}><td className="name-cell">{employee.firstName}</td><td className="name-cell">{employee.surname}</td><td>{employee.email}</td><td><span className={`status-pill ${employee.active ? "status-active" : "status-inactive"}`}><span className="status-dot" />{employee.active ? fr.employees.active : fr.employees.inactive}</span></td></tr>)}</tbody></table></div>}</section>
          </>}
        <footer className="footer">CETEM-QC <span>·</span> Gestion de la qualité</footer>
      </section>
    </main>
  );
}
