"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { fr } from "@cetem-qc/i18n";
import { ConfirmDialog } from "./confirm-dialog";
import { Icon } from "./icons";

type Employee = { id: string; firstName: string; surname: string; email: string; active: boolean; activated: boolean };
type Credential = { employee: Employee; temporaryCredential: string; emailSent: boolean; title?: string; subtitle?: string };

export function employeeStatusLabel(employee: Pick<Employee, "active" | "activated">): string {
  if (!employee.active) return fr.employees.inactive;
  return employee.activated ? fr.employees.active : fr.employees.pendingActivation;
}
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
  const [copyFailed, setCopyFailed] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const secretRef = useRef<HTMLInputElement>(null);
  // Opening the form puts the cursor in its first field.
  useEffect(() => { if (creating) firstFieldRef.current?.focus(); }, [creating]);
  // Clipboard access can be refused (non-secure origin, permissions): the password is then selected for a manual copy.
  const copySecret = (secret: string) => {
    setCopied(false); setCopyFailed(false);
    const fallback = () => { setCopyFailed(true); secretRef.current?.focus(); secretRef.current?.select(); };
    if (!navigator.clipboard?.writeText) { fallback(); return; }
    void navigator.clipboard.writeText(secret).then(() => setCopied(true), fallback);
  };
  // The action waiting for the in-page confirmation (never the browser confirm popup, which blocked browsers answer « non » silently).
  const [pending, setPending] = useState<{ kind: "reset" | "deactivate" | "delete"; employee: Employee }>();

  async function resetPassword(employeeId: string) {
    setBusy(true); setError("");
    try {
      const outcome = await requestPasswordReset(employeeId);
      if (!outcome.ok) {
        setError(outcome.message);
        if (outcome.stale) await onRefresh();
        return;
      }
      setCredential(outcome.credential); setAcknowledged(false); setCopied(false); setCopyFailed(false);
    } finally { setBusy(false); setPending(undefined); }
  }

  async function changeStatus(employee: Employee) {
    const active = !employee.active;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/employees/${encodeURIComponent(employee.id)}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) });
      if (!response.ok) { setError("Le statut du compte n’a pas pu être modifié."); return; }
      await onRefresh();
    } catch { setError("Le service est momentanément indisponible."); }
    finally { setBusy(false); setPending(undefined); }
  }

  async function deleteEmployee(employee: Employee) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/employees/${encodeURIComponent(employee.id)}`, { method: "DELETE" });
      if (!response.ok && response.status !== 404) { setError(fr.employees.deleteFailed); return; }
      await onRefresh();
    } catch { setError("Le service est momentanément indisponible."); }
    finally { setBusy(false); setPending(undefined); }
  }

  const dialogText = pending && {
    reset: { title: fr.employees.resetPasswordTitle, label: fr.employees.resetPassword, body: fr.employees.resetPasswordConfirm },
    deactivate: { title: fr.employees.deactivateTitle, label: fr.employees.deactivate, body: fr.employees.deactivateConfirm },
    delete: { title: fr.employees.deleteTitle, label: fr.employees.delete, body: fr.employees.deleteConfirm },
  }[pending.kind];
  const confirmation = pending && dialogText && <ConfirmDialog
    title={dialogText.title}
    confirmLabel={dialogText.label}
    tone={pending.kind === "reset" ? "primary" : "danger"}
    busy={busy}
    onCancel={() => setPending(undefined)}
    onConfirm={() => void (pending.kind === "reset" ? resetPassword(pending.employee.id) : pending.kind === "delete" ? deleteEmployee(pending.employee) : changeStatus(pending.employee))}
  >
    <p className="dialog-subject"><strong>{`${pending.employee.firstName} ${pending.employee.surname}`}</strong> · {pending.employee.email}</p>
    <p>{dialogText.body}</p>
  </ConfirmDialog>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/employees/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName, surname, email }) });
      const payload = await response.json();
      if (!response.ok) { setError(response.status === 409 ? "Cette adresse e-mail est déjà utilisée." : "La création a échoué. Vérifiez les informations saisies."); return; }
      setCredential(payload as Credential); setCreating(false);
      setFirstName(""); setSurname(""); setEmail(""); setAcknowledged(false); setCopied(false); setCopyFailed(false);
    } catch { setError(fr.api.unavailable); }
    finally { setBusy(false); }
  }

  if (credential) return <section className="roster-card credential-card" role="dialog" aria-modal="true" aria-labelledby="credential-title">
    <div className="credential-header">
      <span className="credential-icon" aria-hidden="true"><Icon name="shield" size={22} /></span>
      <div><p className="eyebrow">Remise manuelle</p><h2 id="credential-title">{credential.title ?? "Compte créé"}</h2>
        <p className="subtitle">{credential.subtitle ?? "Remettez ce mot de passe temporaire en personne. Il devra être remplacé à la première connexion."}</p></div>
    </div>
    <div className="credential-body">
      <p role="status" className={credential.emailSent ? "alert alert-info" : "alert alert-error"}>{credential.emailSent ? `${fr.employees.credentialEmailSent} ${credential.employee.email}.` : fr.employees.credentialEmailNotSent}</p>
      <div className="credential-identity"><span className="avatar" aria-hidden="true">{initialsOf(credential.employee)}</span><span><strong>{credential.employee.firstName} {credential.employee.surname}</strong><small>{credential.employee.email}</small></span></div>
      <label className="credential-secret">Mot de passe temporaire
        <span className="credential-secret-row"><input ref={secretRef} readOnly value={credential.temporaryCredential} spellCheck={false} autoComplete="off" onFocus={(event) => event.target.select()} />
          <button className={copied ? "secondary-button with-icon is-copied" : "secondary-button with-icon"} type="button" disabled={busy} onClick={() => copySecret(credential.temporaryCredential)}><Icon name={copied ? "check" : "copy"} size={16} />Copier le mot de passe</button></span>
      </label>
      {copied && <p role="status" className="field-hint copy-feedback">Mot de passe copié.</p>}
      {copyFailed && <p role="status" className="field-hint">{fr.shell.copyFailed}</p>}
      <label className="checkbox-row"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> J’ai enregistré ou remis le mot de passe au technicien</label>
    </div>
    <div className="task-form-actions">{!acknowledged && <p className="field-hint credential-gate">Cochez la confirmation ci-dessus pour terminer.</p>}<button className="primary-button" type="button" disabled={!acknowledged || busy} onClick={() => { setCredential(undefined); setCopied(false); setCopyFailed(false); onCreated(credential.employee); void onRefresh(); }}>Terminer</button></div>
  </section>;

  return <section className="roster-card" aria-labelledby="create-employee-title">
    <div className="card-heading"><div><h2 id="create-employee-title">Techniciens</h2><p>Les membres de votre équipe</p></div>
      <div className="card-heading-actions"><span className="count-badge">{employees.length}</span>
        <button className={creating ? "secondary-button" : "primary-button with-icon"} type="button" disabled={busy} onClick={() => { setCreating((value) => !value); setError(""); }}>{creating ? "Annuler" : <><Icon name="plus" size={16} />Ajouter un technicien</>}</button></div></div>
    {creating && <form className="auth-form inline-form" onSubmit={(event) => void submit(event)} onKeyDown={(event) => { if (event.key === "Escape" && !busy) { setCreating(false); setError(""); } }}>
      <p className="inline-form-title">Ajouter un technicien <span>Créer un compte rattaché à votre équipe</span></p>
      <label>{fr.employees.firstName}<input ref={firstFieldRef} required maxLength={100} autoComplete="off" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
      <label>{fr.employees.surname}<input required maxLength={100} autoComplete="off" value={surname} onChange={(event) => setSurname(event.target.value)} /></label>
      <label>{fr.employees.email}<input required type="email" maxLength={254} autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <button className="primary-button" disabled={busy} aria-busy={busy}>{busy ? "Création en cours…" : "Créer le compte"}</button>
      {error && <p role="alert" className="error-state">{error}</p>}
    </form>}
    {error && !creating && <p role="alert" className="alert alert-error card-alert">{error}</p>}
    {employees.length === 0 ? <div className="state-message empty-state"><span className="empty-icon" aria-hidden="true"><Icon name="team" size={22} /></span><p>{fr.employees.empty}</p></div>
      : <ul className="employee-list">{employees.map((employee) => <li className="employee-row" key={employee.email}>
        <span className="avatar" aria-hidden="true">{initialsOf(employee)}</span>
        <span className="employee-identity"><span className="employee-name">{`${employee.firstName} ${employee.surname}`}</span><span className="employee-email">{employee.email}</span></span>
        <span className={`status-pill ${!employee.active ? "status-inactive" : employee.activated ? "status-active" : "status-pending"}`}><span className="status-dot" />{employeeStatusLabel(employee)}</span>
        <span className="employee-row-actions">{employee.active && <button className="text-button" disabled={busy} type="button" onClick={() => setPending({ kind: "reset", employee })}>{fr.employees.resetPassword}</button>}<button className={employee.active ? "text-button danger" : "text-button"} disabled={busy} type="button" onClick={() => employee.active ? setPending({ kind: "deactivate", employee }) : void changeStatus(employee)}>{employee.active ? "Désactiver" : "Activer"}</button><button className="text-button danger" disabled={busy} type="button" onClick={() => setPending({ kind: "delete", employee })}>{fr.employees.delete}</button></span>
      </li>)}</ul>}
    {confirmation}
  </section>;
}

function initialsOf(employee: Pick<Employee, "firstName" | "surname">) {
  return `${employee.firstName.trim()[0] ?? ""}${employee.surname.trim()[0] ?? ""}`.toUpperCase() || "?";
}
