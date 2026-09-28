"use client";

import { FormEvent, useEffect, useState } from "react";
import { fr } from "@cetem-qc/i18n";

type Assignee = { id: string; firstName: string; surname: string };
type CreatedTask = { id: string; state: "draft" };

export function TaskCreation() {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [establishment, setEstablishment] = useState("");
  const [service, setService] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdTask, setCreatedTask] = useState<CreatedTask>();

  async function loadAssignees() {
    setAssigneesLoading(true);
    setLoadError(false);
    try {
      const response = await fetch("/api/task-assignees", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as { assignees: Assignee[] };
      setAssignees(result.assignees);
      setAssigneeId((current) => result.assignees.some((assignee) => assignee.id === current) ? current : "");
    } catch {
      setLoadError(true);
    } finally {
      setAssigneesLoading(false);
    }
  }

  useEffect(() => { void loadAssignees(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ establishment, service, type: "graphie_mobile", assigneeId }),
      });
      const payload = await response.json() as { task?: CreatedTask; error?: { code?: string } };
      if (!response.ok || !payload.task) {
        setError(payload.error?.code === "TASK_ASSIGNEE_UNAVAILABLE" ? fr.tasks.assigneeUnavailable : fr.tasks.createError);
        if (response.status === 422) await loadAssignees();
        return;
      }
      setCreatedTask(payload.task);
      setEstablishment(""); setService(""); setAssigneeId("");
    } catch {
      setError(fr.api.unavailable);
    } finally {
      setBusy(false);
    }
  }

  return <section className="roster-card task-create-card" aria-labelledby="task-create-title">
    <div className="card-heading"><div><h2 id="task-create-title">{fr.tasks.title}</h2><p>{fr.tasks.description}</p></div></div>
    {createdTask && <div className="task-created" role="status"><strong>{fr.tasks.created}</strong><span>{fr.tasks.taskId} : {createdTask.id}</span><span>{fr.tasks.draft}</span></div>}
    <form className="auth-form task-form" onSubmit={(event) => void submit(event)}>
      <label>{fr.tasks.establishment}<input required maxLength={200} value={establishment} onChange={(event) => setEstablishment(event.target.value)} /></label>
      <label>{fr.tasks.service}<input maxLength={200} value={service} onChange={(event) => setService(event.target.value)} /></label>
      <fieldset className="task-type-options"><legend>{fr.tasks.type}</legend>
        <label><input type="radio" name="taskType" checked readOnly aria-label={fr.tasks.graphieMobile} /> {fr.tasks.graphieMobile}</label>
        <label className="disabled-option"><input type="radio" name="taskType" disabled /> {fr.tasks.graphieFixe}</label>
        <label className="disabled-option"><input type="radio" name="taskType" disabled /> {fr.tasks.scopie}</label>
      </fieldset>
      {loadError ? <div className="task-assignee-state" role="alert">{fr.tasks.loadError} <button className="text-button" type="button" onClick={() => void loadAssignees()}>{fr.tasks.retry}</button></div>
        : <label>{fr.tasks.assignee}<select required disabled={assigneesLoading || busy || assignees.length === 0} value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">{assigneesLoading ? fr.common.loading : assignees.length === 0 ? fr.tasks.noAssignees : fr.tasks.selectAssignee}</option>{assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.firstName} {assignee.surname}</option>)}</select></label>}
      <button className="primary-button" disabled={busy || assigneesLoading || loadError || assignees.length === 0}>{busy ? fr.tasks.creating : fr.tasks.create}</button>
      {error && <p role="alert" className="error-state">{error}</p>}
    </form>
  </section>;
}
