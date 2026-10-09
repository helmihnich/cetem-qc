"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { fr } from "@cetem-qc/i18n";

type Assignee = { id: string; firstName: string; surname: string };
type CreatedTask = { id: string; state: "draft" };
type TaskInput = { establishment: string; service: string; type: "graphie_mobile"; assigneeId: string };

/** What the form does after a replacement request; `reloadList` and `reloadAssignees` ask for fresh data. */
export type ReplacementOutcome =
  | { ok: true; task: CreatedTask }
  | { ok: false; message: string; reloadList: boolean; reloadAssignees: boolean };

/** Posts a replacement control of `originalTaskId` through the web route handler and maps every documented outcome. */
export async function requestReplacementControl(originalTaskId: string, input: TaskInput, fetchImpl: typeof fetch = fetch): Promise<ReplacementOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/tasks/${encodeURIComponent(originalTaskId)}/replacements`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, message: fr.api.unavailable, reloadList: false, reloadAssignees: false };
  }
  const payload = await response.json().catch(() => null) as { task?: CreatedTask; error?: { code?: string } } | null;
  if (response.status === 201 && payload?.task) return { ok: true, task: payload.task };
  const code = payload?.error?.code;
  if (response.status === 409 && code === "REPLACEMENT_ALREADY_EXISTS") return { ok: false, message: fr.tasks.replacementAlreadyExists, reloadList: true, reloadAssignees: false };
  if ((response.status === 409 && code === "AUDIT_NOT_ACCEPTED") || response.status === 404) return { ok: false, message: fr.tasks.replacementUnavailable, reloadList: true, reloadAssignees: false };
  if (response.status === 422 && code === "TASK_ASSIGNEE_UNAVAILABLE") return { ok: false, message: fr.tasks.assigneeUnavailable, reloadList: false, reloadAssignees: true };
  if (response.status === 503) return { ok: false, message: fr.api.unavailable, reloadList: false, reloadAssignees: false };
  return { ok: false, message: fr.tasks.replacementFailed, reloadList: false, reloadAssignees: false };
}

/** Runs `work` only when no earlier call is still pending: a repeated click while busy sends nothing. */
export function singleFlight<A extends unknown[], R>(work: (...args: A) => Promise<R>): (...args: A) => Promise<R | undefined> {
  let pending = false;
  return async (...args: A) => {
    if (pending) return undefined;
    pending = true;
    try {
      return await work(...args);
    } finally {
      pending = false;
    }
  };
}

export type ReplacementMode = {
  originalTaskId: string;
  onCancel: () => void;
  onCreated: (task: CreatedTask) => void;
  /** The original may have changed: the task list must be reloaded. */
  onStale: () => void;
};

/** Normal task creation; with `replacement`, the same form creates a replacement control of an accepted task. */
export function TaskCreation({ replacement, refreshKey, onTaskCreated }: { replacement?: ReplacementMode; refreshKey?: number; onTaskCreated?: (task: CreatedTask) => void } = {}) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [establishment, setEstablishment] = useState("");
  const [service, setService] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdTask, setCreatedTask] = useState<CreatedTask>();
  const guard = useRef(singleFlight((run: () => Promise<void>) => run())).current;

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

  // A change of `refreshKey` means the team changed elsewhere on the page: the assignees are fetched again.
  useEffect(() => { void loadAssignees(); }, [refreshKey]);

  async function submitReplacement(mode: ReplacementMode) {
    const outcome = await requestReplacementControl(mode.originalTaskId, { establishment, service, type: "graphie_mobile", assigneeId });
    if (outcome.ok) {
      mode.onCreated(outcome.task);
      return;
    }
    setError(outcome.message);
    if (outcome.reloadAssignees) await loadAssignees();
    if (outcome.reloadList) mode.onStale();
  }

  async function submitTask() {
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
      onTaskCreated?.(payload.task);
      setEstablishment(""); setService(""); setAssigneeId("");
    } catch {
      setError(fr.api.unavailable);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A repeated click while busy sends nothing, even before the disabled button is rendered.
    await guard(async () => {
      setBusy(true); setError("");
      try {
        if (replacement) await submitReplacement(replacement);
        else await submitTask();
      } finally {
        setBusy(false);
      }
    });
  }

  const titleId = replacement ? `task-replacement-title-${replacement.originalTaskId}` : "task-create-title";
  return <section className={replacement ? "task-replacement-card" : "roster-card task-create-card"} aria-labelledby={titleId}>
    <div className="card-heading"><div>
      <h2 id={titleId}>{replacement ? fr.tasks.replacementTitle : fr.tasks.title}</h2>
      <p>{replacement ? fr.tasks.replacementContext.replace("{taskId}", replacement.originalTaskId) : fr.tasks.description}</p>
    </div></div>
    {!replacement && createdTask && <div className="task-created" role="status"><strong>{fr.tasks.created}</strong><span>{fr.tasks.taskId} : {createdTask.id}</span><span>{fr.tasks.draft}</span></div>}
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
      {replacement
        ? <div className="task-form-actions">
          <button className="primary-button" disabled={busy || assigneesLoading || loadError || assignees.length === 0}>{busy ? fr.tasks.creating : fr.tasks.replacementSubmit}</button>
          <button className="secondary-button" type="button" disabled={busy} onClick={replacement.onCancel}>{fr.common.cancel}</button>
        </div>
        : <button className="primary-button" disabled={busy || assigneesLoading || loadError || assignees.length === 0}>{busy ? fr.tasks.creating : fr.tasks.create}</button>}
      {error && <p role="alert" className="error-state">{error}</p>}
    </form>
  </section>;
}
