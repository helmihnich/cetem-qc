"use client";

import { FormEvent, useState } from "react";

type Employee = { id: string; firstName: string; surname: string; email: string; active: boolean };
type Credential = { employee: Employee; temporaryCredential: string };

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

  async function regenerate(employeeId: string) {
    if (!window.confirm("L’ancien mot de passe temporaire cessera immediatement de fonctionner.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/employees/${encodeURIComponent(employeeId)}/credential`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) { setError("Le mot de passe temporaire n’a pas pu etre regenere."); return; }
      setCredential(payload as Credential); setAcknowledged(false); setCopied(false);
    } catch { setError("Le service est momentanement indisponible."); }
    finally { setBusy(false); }
  }

  async function changeStatus(employee: Employee) {
    const active = !employee.active;
    if (!active && !window.confirm("Désactiver ce compte ? L’employé ne pourra plus se connecter ni recevoir de nouveau travail. Son historique sera conservé.")) return;
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
    <p className="eyebrow">REMISE MANUELLE</p><h2 id="credential-title">Compte cree</h2>
    <p className="subtitle">Remettez ce mot de passe temporaire en personne. Il devra etre remplace a la premiere connexion.</p>
    <p>{credential.employee.firstName} {credential.employee.surname} · {credential.employee.email}</p>
    <label>Mot de passe temporaire<input readOnly value={credential.temporaryCredential} /></label>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void navigator.clipboard.writeText(credential.temporaryCredential).then(() => setCopied(true))}>Copier le mot de passe</button>
    {copied && <p role="status">Mot de passe copie.</p>}
    <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> J’ai enregistre ou remis le mot de passe a l’employe</label>
    <button className="primary-button" type="button" disabled={!acknowledged || busy} onClick={() => { setCredential(undefined); setCopied(false); onCreated(credential.employee); void onRefresh(); }}>Terminer</button>
  </section>;

  return <section className="roster-card" aria-labelledby="create-employee-title">
    <div className="card-heading"><div><h2 id="create-employee-title">Ajouter un employe</h2><p>Creer un compte rattache a votre equipe</p></div><button className="secondary-button" type="button" disabled={busy} onClick={() => setCreating((value) => !value)}>{creating ? "Annuler" : "Ajouter un employe"}</button></div>
    {creating && <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>Prenom<input required maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
      <label>Nom<input required maxLength={100} value={surname} onChange={(event) => setSurname(event.target.value)} /></label>
      <label>Adresse e-mail<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <button className="primary-button" disabled={busy}>{busy ? "Creation en cours…" : "Creer le compte"}</button>
      {error && <p role="alert" className="error-state">{error}</p>}
    </form>}
    {error && !creating && <p role="alert" className="error-state">{error}</p>}
    <ul className="employee-actions">{employees.map((employee) => <li key={employee.email}><span>{employee.firstName} {employee.surname} · {employee.active ? "Actif" : "Inactif"}</span><span>{employee.active && <button className="text-button" disabled={busy} type="button" onClick={() => void regenerate(employee.id)}>Regenerer le mot de passe temporaire</button>}<button className="text-button" disabled={busy} type="button" onClick={() => void changeStatus(employee)}>{employee.active ? "Désactiver" : "Activer"}</button></span></li>)}</ul>
  </section>;
}
