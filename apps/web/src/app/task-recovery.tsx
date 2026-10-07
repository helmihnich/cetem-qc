"use client";

import { useRef, useState } from "react";
import { fr } from "@cetem-qc/i18n";
import type { TaskListResponse } from "@cetem-qc/api-client/v1";

type Task = TaskListResponse["tasks"][number];
type Assignee = { id: string; firstName: string; surname: string };

export function DeactivatedTaskRecovery({ task, onChanged }: { task: Task; onChanged: () => void }) {
  const [mode, setMode] = useState<"reassign" | "recover">();
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneeId, setAssigneeId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestPending = useRef(false);
  const start = async (next: "reassign" | "recover") => {
    setMode(next);
    setError("");
    setSuccess("");
    setConfirmed(false);
    setAssigneeId("");
    setLoadError(false);
    try {
      const response = await fetch("/api/task-assignees", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = await response.json() as { assignees: Assignee[] };
      setAssignees(result.assignees);
    } catch {
      setLoadError(true);
    }
  };

  const submit = async () => {
    if (!mode || !assigneeId || !confirmed || requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    setError("");
    try {
      const path = mode === "reassign" ? "deactivated-assignee-reassignment" : "deactivated-assignee-recovery";
      const body = mode === "reassign"
        ? { successorId: assigneeId, expectedAssignmentVersion: task.assignmentVersion }
        : { successorId: assigneeId, expectedAssignmentVersion: task.assignmentVersion, sourceRevision: task.recoveryRevision };
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => null) as { taskId?: string; task?: { id?: string }; error?: { code?: string } } | null;
      if (mode === "reassign" && response.status === 200 && payload?.taskId) {
        setSuccess(fr.tasks.reassignmentSucceeded);
        setMode(undefined);
        onChanged();
        return;
      }
      if (mode === "recover" && response.status === 201 && payload?.task?.id) {
        setSuccess(`${fr.tasks.recoveryCreated} — ${fr.tasks.taskId} : ${payload.task.id}`);
        setMode(undefined);
        onChanged();
        return;
      }
      setError(response.status === 503 ? fr.api.unavailable : mode === "recover" ? fr.tasks.recoveryFailed : fr.tasks.reassignmentFailed);
      if (response.status === 409 || response.status === 404) onChanged();
      if (response.status === 422) {
        const employees = await fetch("/api/task-assignees", { cache: "no-store" }).then((result) => result.ok ? result.json() : Promise.reject()).catch(() => null) as { assignees: Assignee[] } | null;
        if (employees) setAssignees(employees.assignees);
      }
    } catch {
      setError(fr.api.unavailable);
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  };

  const warning = task.recoveryState === "resolution-required"
    ? fr.tasks.pendingRecoveryUnavailable
    : task.recoveryState === "synchronized-draft" || task.recoveryState === "correction-draft"
      ? task.recoveryState === "correction-draft" ? fr.tasks.rejectedRecoveryUnavailable : ""
      : fr.tasks.tabletMayContain;

  return <div className="deactivated-recovery">
    {!task.assigneeActive && <>
    {task.recoveryState === "resolution-required"
      ? <><span className="status-pill task-state-draft">{fr.tasks.resolutionRequired}</span><p>{warning}</p><p>{fr.tasks.conflictRecoveryUnavailable}</p></>
      : task.state !== "submitted" && task.recoveryState !== "recovered"
        ? <><span className="status-pill task-state-draft">{fr.tasks.actionRequired}</span>{warning && <p>{warning}</p>}
          {task.recoveryState === "unstarted" && <><p>{fr.tasks.tabletRecoveryUnavailable}</p><button className="secondary-button" type="button" onClick={() => void start("reassign")}>{fr.tasks.reassignAction}</button></>}
          {(task.recoveryState === "synchronized-draft" || task.recoveryState === "correction-draft")
            && <button className="secondary-button" type="button" onClick={() => void start("recover")}>{fr.tasks.recoveryAction}</button>}
        </>
        : task.recoveryState === "recovered"
          ? <><span className="status-pill task-state-draft">{fr.tasks.recoveryCreated}</span>{task.recoverySuccessorTaskId && <p>{fr.tasks.recoverySuccessor.replace("{taskId}", task.recoverySuccessorTaskId)}</p>}</>
          : null}
    {task.recoverySource && <p>{fr.tasks.recoverySource.replace("{taskId}", task.recoverySource.taskId).replace("{revision}", String(task.recoverySource.revision))}</p>}
    {mode && <section className="task-recovery-form" aria-label={mode === "reassign" ? fr.tasks.reassignAction : fr.tasks.recoveryAction}>
      <p>{mode === "reassign" ? fr.tasks.reassignConfirmation : fr.tasks.recoveryConfirmation}</p>
      {mode === "recover" && task.recoveryState === "correction-draft" && <p>{fr.tasks.rejectedRecoveryUnavailable}</p>}
      {loadError ? <div role="alert">{fr.tasks.loadError} <button className="text-button" type="button" onClick={() => void start(mode)}>{fr.tasks.retry}</button></div>
        : <label>{fr.tasks.assignee}<select value={assigneeId} disabled={busy} onChange={(event) => setAssigneeId(event.target.value)}>
          <option value="">{fr.tasks.selectRecoveryEmployee}</option>
          {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.firstName} {assignee.surname}</option>)}
        </select></label>}
      <label className="recovery-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />
        {mode === "reassign" ? fr.tasks.confirmReassignment : fr.tasks.confirmRecovery}</label>
      <div className="task-form-actions">
        <button className="primary-button" type="button" disabled={busy || !assigneeId || !confirmed || loadError || (mode === "recover" && task.recoveryRevision === null)} onClick={() => void submit()}>
          {busy ? fr.tasks.creating : mode === "reassign" ? fr.tasks.reassignAction : fr.tasks.recoveryAction}
        </button>
        <button className="secondary-button" type="button" disabled={busy} onClick={() => setMode(undefined)}>{fr.common.cancel}</button>
      </div>
      {error && <p role="alert" className="error-state">{error}</p>}
    </section>}
    </>}
    {success && <p role="status">{success}</p>}
    {task.assignmentHistory.length > 0 && <details className="assignment-history">
      <summary>{fr.tasks.assignmentHistory}</summary>
      <ul>{task.assignmentHistory.map((event, index) => <li key={`${event.createdAt}-${index}`}>
        {fr.tasks.assignmentEvent.replace("{actor}", event.actor).replace("{newEmployee}", event.newEmployee)
          .replace("{previous}", event.previousEmployee ? fr.tasks.assignmentPrevious.replace("{previousEmployee}", event.previousEmployee) : "")
          .replace("{date}", new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt)))}
      </li>)}</ul>
    </details>}
  </div>;
}

