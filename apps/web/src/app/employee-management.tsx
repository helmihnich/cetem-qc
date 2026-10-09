"use client";

import { FormEvent, useState } from "react";
import { fr } from "@cetem-qc/i18n";

type Employee = { id: string; firstName: string; surname: string; email: string; active: boolean };
type Credential = { employee: Employee; temporaryCredential: string; title?: string; subtitle?: string };
export type PasswordResetOutcome = { ok: true; credential: Credential } | { ok: false; message: string; stale: boolean };

export async function requestPasswordReset(employeeId: string, fetchImpl: typeof fetch = fetch): Promise<PasswordResetOutcome> {
  try {
    const response = await fetchImpl(`/api/employees/${encodeURIComponent(employeeId)}/password-reset`, { method: "POST" });
    const payload = await response.json() as Credential | { error?: { message?: string } } | null;
    if (!response.ok) {
      const stale = response.status === 404 || response.status === 409;
      const message = payload && typeof payload === "object" && "error" in payload ? payload.error?.message : undefined;
      return { ok: false, message: stale && message ? message : fr.employees.passwordResetFailed, stale };
    }
    return { ok: true, credential: { ...(payload as Credential), title: fr.employees.passwordResetTitle, subtitle: fr.employees.passwordResetSubtitle } };
  } catch { return { ok: false, message: fr.api.unavailable, stale: false }; }
}

export function EmployeeManagement({ employees, onCreated, onRefresh }: { employees: Employee[]; onCreated: (employee: Employee) => void; onRefresh: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [surname, setSurname] = useState("");
  const [email, setEmail] = useState("");
  const [credential, setCredential] = useState<Credential>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  async function resetPassword(employeeId: string) {
    if (!window.confirm(fr.employees.resetPasswordConfirm)) return;
    setBusy(true); setError("");
    try {
      const outcome = await requestPasswordReset(employeeId);
      if (!outcome.ok) {
        setError(outcome.message);
        if (outcome.stale) await onRefresh();
        return;
      }
      setCredential(outcome.credential); setAcknowledged(false); setCopied(false);
    } finally { setBusy(false); }
  }

  async function changeStatus(employee: Employee) {
    const active = !employee.active;
    if (!active && !window.confirm("Désactiver ce compte ? Le technicien ne pourra plus se connecter ni recevoir de nouveau travail. Son historique sera conservé.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/employees/${encodeURIComponent(employee.id)}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) });
      if (!response.ok) { setError("Le statut du compte n’a pas pu être modifié."); return; }
      await onRefresh();
    } catch { setError("Le service est momentanément indisponible."); }
    finally { setBusy(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/employees/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName, surname, email }) });
      const payload = await response.json();
      if (!response.ok) { setError(response.status === 409 ? "Cette adresse e-mail est deja utilisee." : "La creation a echoue. Verifiez les informations saisies."); return; }
      setCredential(payload as Credential); setCreating(false);
      setFirstName(""); setSurname(""); setEmail(""); setAcknowledged(false);
    } catch { setError("Le service est momentanement indisponible."); }
    finally { setBusy(false); }
  }

  if (credential) return <section className="roster-card" role="dialog" aria-modal="true" aria-labelledby="credential-title">
    <p className="eyebrow">REMISE MANUELLE</p><h2 id="credential-title">{credential.title ?? "Compte cree"}</h2>
    <p className="subtitle">{credential.subtitle ?? "Remettez ce mot de passe temporaire en personne. Il devra etre remplace a la premiere connexion."}</p>
    <p>{credential.employee.firstName} {credential.employee.surname} · {credential.employee.email}</p>
    <label>Mot de passe temporaire<input readOnly value={credential.temporaryCredential} /></label>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void navigator.clipboard.writeText(credential.temporaryCredential).then(() => setCopied(true))}>Copier le mot de passe</button>
    {copied && <p role="status">Mot de passe copie.</p>}
    <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> J’ai enregistre ou remis le mot de passe au technicien</label>
    <button className="primary-button" type="button" disabled={!acknowledged || busy} onClick={() => { setCredential(undefined); setCopied(false); onCreated(credential.employee); void onRefresh(); }}>Terminer</button>
  </section>;

  return <section className="roster-card" aria-labelledby="create-employee-title">
    <div className="card-heading"><div><h2 id="create-employee-title">Ajouter un technicien</h2><p>Creer un compte rattache a votre equipe</p></div><button className="secondary-button" type="button" disabled={busy} onClick={() => setCreating((value) => !value)}>{creating ? "Annuler" : "Ajouter un technicien"}</button></div>
    {creating && <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>Prenom<input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
      <label>Nom<input required maxLength={100} value={surname} onChange={(event) => setSurname(event.target.value)} /></label>
      <label>Adresse e-mail<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <button className="primary-button" disabled={busy}>{busy ? "Creation en cours…" : "Creer le compte"}</button>
      {error && <p role="alert" className="error-state">{error}</p>}
    </form>}
    {error && !creating && <p role="alert" className="error-state">{error}</p>}
    <ul className="employee-actions">{employees.map((employee) => <li key={employee.email}><span>{employee.firstName} {employee.surname} · {employee.active ? "Actif" : "Inactif"}</span><span>{employee.active && <button className="text-button" disabled={busy} type="button" onClick={() => void resetPassword(employee.id)}>{fr.employees.resetPassword}</button>}<button className="text-button" disabled={busy} type="button" onClick={() => void changeStatus(employee)}>{employee.active ? "Désactiver" : "Activer"}</button></span></li>)}</ul>
  </section>;
}
