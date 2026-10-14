"use client";

import { useCallback, useEffect, useState } from "react";
import { taskListResponseSchema } from "@cetem-qc/api-client/v1";
import type { TaskListResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { AcceptedEvidencePanel } from "./accepted-evidence";
import { loadHistoryList } from "./history";
import { Icon, ShortId } from "./icons";
import { TaskCreation } from "./task-creation";
import { DeactivatedTaskRecovery } from "./task-recovery";
import { LoadingSkeleton, SearchField, matchesQuery } from "./ui";

type TaskListItem = TaskListResponse["tasks"][number];

/** Client-side view filter over the rows already loaded; it never changes what is requested. */
export type TaskFilterState = "all" | "in-progress" | "accepted" | "attention";
export type TaskFilter = { query: string; state: TaskFilterState };

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export type TaskListViewProps = {
  tasks: TaskListItem[];
  loading: boolean;
  error: boolean;
  /** The original task whose replacement form is open. */
  replacingTaskId?: string;
  /** The replacement task just created (201), shown in the status message. */
  createdReplacementId?: string;
  onRetry: () => void;
  onReplace: (originalTaskId: string) => void;
  onCancelReplacement: () => void;
  onReplacementCreated: (taskId: string) => void;
  onStale: () => void;
  /** The accepted task whose evidence panel is open (Story 9.1). The row action is offered only when `onViewEvidence` is given. */
  evidenceTaskId?: string;
  onViewEvidence?: (taskId: string) => void;
  /** The evidence panel for `evidenceTaskId`, rendered under the list. */
  evidencePanel?: React.ReactNode;
  /** Search and state filter of the loaded rows; offered only when `onFilterChange` is given. */
  filter?: TaskFilter;
  onFilterChange?: (filter: TaskFilter) => void;
};

/** A replacement is offered only for an accepted task that has none yet. */
export const canReplace = (task: TaskListItem) => task.state === "submitted" && task.replacedBy === null;

/** A task whose assignee was deactivated before it was accepted still waits for a Responsable decision. */
const needsAttention = (task: TaskListItem) => !task.assigneeActive && (task.recoveryState === "resolution-required" || (task.state !== "submitted" && task.recoveryState !== "recovered"));

const STATE_FILTERS: Record<TaskFilterState, (task: TaskListItem) => boolean> = {
  all: () => true,
  "in-progress": (task) => task.state !== "submitted",
  accepted: (task) => task.state === "submitted",
  attention: needsAttention,
};

/** The API appends « — Inactif » to a deactivated assignee; the table shows that as a badge instead. */
const assigneeNameOf = (task: TaskListItem) => task.assigneeActive ? task.assignee : task.assignee.replace(/\s+—\s+Inactif$/, "");

/** Recovery, lineage and assignment history live behind a row toggle so they never stretch the row. */
const hasRecoveryDetails = (task: TaskListItem) => needsAttention(task) || (!task.assigneeActive && task.recoveryState === "recovered")
  || task.assignmentHistory.length > 0 || task.recoverySource !== null;

const stateLabelOf =(task: TaskListItem) => task.state === "submitted" ? fr.tasks.submittedAccepted : fr.tasks.draft;

export function TaskListView(props: TaskListViewProps) {
  const { tasks, loading, error, replacingTaskId, createdReplacementId, onFilterChange } = props;
  const filter = props.filter ?? { query: "", state: "all" };
  const ready = !loading && !error && tasks.length > 0;
  const stats: { id: TaskFilterState; label: string; value: number; tone: string }[] = [
    { id: "all", label: fr.shell.stats.total, value: tasks.length, tone: "neutral" },
    { id: "in-progress", label: fr.shell.stats.inProgress, value: tasks.filter(STATE_FILTERS["in-progress"]).length, tone: "info" },
    { id: "accepted", label: fr.shell.stats.accepted, value: tasks.filter(STATE_FILTERS.accepted).length, tone: "success" },
    { id: "attention", label: fr.shell.stats.attention, value: tasks.filter(needsAttention).length, tone: "warning" },
  ];
  const filtering = onFilterChange !== undefined && (filter.query.trim() !== "" || filter.state !== "all");
  const visible = onFilterChange ? tasks.filter((task) => STATE_FILTERS[filter.state](task)
    && matchesQuery([task.id, task.establishment, task.assignee, stateLabelOf(task), task.replacementOf, task.replacedBy], filter.query)) : tasks;
  const resetFilter = () => onFilterChange?.({ query: "", state: "all" });
  return <section className="roster-card task-list-card" aria-labelledby="task-list-title">
    <div className="card-heading"><div><h2 id="task-list-title">{fr.tasks.listTitle}</h2><p>{fr.tasks.listDescription}</p></div>{ready && <span className="count-badge">{tasks.length}</span>}</div>
    {ready && (onFilterChange
      ? <div className="stat-strip stat-filters" role="group" aria-label={fr.shell.filters.byState}>{stats.map((stat) => <button key={stat.id} type="button" className={`stat stat-${stat.tone}`} aria-pressed={filter.state === stat.id} onClick={() => onFilterChange({ ...filter, state: stat.id })}>
        <span className="stat-value">{stat.value}</span><span className="stat-label">{stat.label}</span>
      </button>)}</div>
      : <dl className="stat-strip">{stats.map((stat) => <div key={stat.label} className={`stat stat-${stat.tone}`}><dt>{stat.label}</dt><dd>{stat.value}</dd></div>)}</dl>)}
    {ready && onFilterChange && <div className="table-toolbar" role="search">
      <SearchField value={filter.query} placeholder={fr.shell.filters.tasksPlaceholder} onChange={(query) => onFilterChange({ ...filter, query })} />
      <span className="table-toolbar-count" aria-live="polite">{filtering ? fr.shell.filters.resultCount.replace("{shown}", String(visible.length)).replace("{total}", String(tasks.length)) : ""}</span>
    </div>}
    {createdReplacementId && <div className="task-created" role="status"><strong>{fr.tasks.replacementCreated}</strong><span>{fr.tasks.taskId} : {createdReplacementId}</span><span>{fr.tasks.draft}</span></div>}
    {loading ? <LoadingSkeleton rows={5} />
      : error ? <div className="state-message error-state" role="alert">{fr.tasks.listError}<button className="text-button" type="button" onClick={props.onRetry}>{fr.tasks.retry}</button></div>
        : tasks.length === 0 ? <div className="state-message empty-state" role="status"><span className="empty-icon" aria-hidden="true"><Icon name="inbox" size={22} /></span><p>{fr.tasks.listEmpty}</p></div>
          : visible.length === 0 ? <div className="state-message empty-state" role="status"><span className="empty-icon" aria-hidden="true"><Icon name="search" size={22} /></span><p>{fr.shell.filters.noMatch}</p><button className="text-button" type="button" onClick={resetFilter}>{fr.shell.filters.reset}</button></div>
          : <div className="table-wrap"><table className="responsive-table">
            <thead><tr><th scope="col">{fr.tasks.taskColumn}</th><th scope="col">{fr.tasks.establishment}</th><th scope="col">{fr.tasks.assignee}</th><th scope="col">{fr.tasks.state}</th><th scope="col">{fr.tasks.lastUpdatedShort}</th><th scope="col"><span className="visually-hidden">{fr.tasks.actions}</span></th></tr></thead>
            <tbody>{visible.map((task) => <tr key={task.id} className={needsAttention(task) ? "task-row task-row-attention" : "task-row"}>
              <td className="task-id-cell" data-label={fr.tasks.taskColumn}><ShortId id={task.id} />
                <span className="task-type">{fr.tasks.graphieMobile}</span>
                {task.replacementOf !== null && <span className="task-lineage">{fr.tasks.replacementOf.replace("{taskId}", task.replacementOf)}</span>}
                {task.replacedBy !== null && <span className="task-lineage">{fr.tasks.replacedBy.replace("{taskId}", task.replacedBy)}</span>}
              </td>
              <td className="wrap-cell" data-label={fr.tasks.establishment}>{task.establishment}</td>
              <td className="name-cell wrap-cell" data-label={fr.tasks.assignee}><span className="assignee">{assigneeNameOf(task)}{!task.assigneeActive && <span className="status-pill status-inactive assignee-flag">{fr.employees.inactive}</span>}</span></td>
              <td data-label={fr.tasks.state}><span className="task-states">{task.state === "submitted"
                ? <span className="status-pill task-state-submitted"><span className="status-dot" />{fr.tasks.submittedAccepted}</span>
                : <span className="status-pill task-state-draft"><span className="status-dot" />{fr.tasks.draft}</span>}
                {!task.assigneeActive && task.recoveryState === "resolution-required" && <span className="status-pill task-state-draft task-state-attention">{fr.tasks.resolutionRequired}</span>}
                {!task.assigneeActive && task.state !== "submitted" && task.recoveryState !== "resolution-required" && task.recoveryState !== "recovered" && <span className="status-pill task-state-draft task-state-attention">{fr.tasks.actionRequired}</span>}
              </span></td>
              <td className="date-cell" data-label={fr.tasks.lastUpdatedShort}><time dateTime={task.lastUpdatedAt}>{dateFormatter.format(new Date(task.lastUpdatedAt))}</time></td>
              <td className="task-actions-cell"><div className="task-actions">
                {task.state === "submitted" && props.onViewEvidence && <button id={`evidence-button-${task.id}`} className="primary-button compact-button" type="button" aria-expanded={props.evidenceTaskId === task.id} onClick={() => props.onViewEvidence?.(task.id)}>{fr.tasks.evidenceAction}</button>}
                {needsAttention(task)
                  ? <details className="row-disclosure">
                    <summary className="secondary-button compact-button disclosure-attention">{fr.tasks.resolve}</summary>
                    <DeactivatedTaskRecovery task={task} onChanged={props.onStale} showStatus={false} />
                  </details>
                  : (canReplace(task) || hasRecoveryDetails(task)) && <details className="row-disclosure row-menu">
                    <summary className="icon-button row-menu-toggle" aria-label={fr.tasks.moreActions} title={fr.tasks.moreActions}><span aria-hidden="true">⋯</span></summary>
                    <div className="row-menu-panel">
                      {canReplace(task) && <button className="text-button" type="button" aria-expanded={replacingTaskId === task.id} onClick={() => props.onReplace(task.id)}>{fr.tasks.replacementAction}</button>}
                      {hasRecoveryDetails(task) && <DeactivatedTaskRecovery task={task} onChanged={props.onStale} showStatus={false} />}
                    </div>
                  </details>}
              </div></td>
            </tr>)}</tbody>
          </table></div>}
    {replacingTaskId && <TaskCreation key={replacingTaskId} replacement={{
      originalTaskId: replacingTaskId,
      onCancel: props.onCancelReplacement,
      onCreated: (task) => props.onReplacementCreated(task.id),
      onStale: props.onStale,
    }} />}
    {props.evidenceTaskId && props.evidencePanel}
  </section>;
}

export function TaskList({ refreshKey }: { refreshKey?: number } = {}) {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [replacingTaskId, setReplacingTaskId] = useState<string>();
  const [createdReplacementId, setCreatedReplacementId] = useState<string>();
  const [evidenceTaskId, setEvidenceTaskId] = useState<string>();
  const [filter, setFilter] = useState<TaskFilter>({ query: "", state: "all" });

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(false);
    setTasks([]);
    try {
      const [response, history] = await Promise.all([fetch("/api/tasks", { cache: "no-store" }), loadHistoryList()]);
      if (!response.ok) throw new Error("task-list-request-failed");
      const result = taskListResponseSchema.parse(await response.json());
      // A task with an official report is finished: it is read in the history, not worked on here.
      const completed = new Set(history.kind === "ready" ? history.records.map((record) => record.taskId) : []);
      setTasks(result.tasks.filter((task) => !completed.has(task.id)));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // A change of `refreshKey` means a task or the team changed elsewhere on the page.
  useEffect(() => { void loadTasks(); }, [loadTasks, refreshKey]);
  // The row « ⋯ » menu closes on a click outside it, on Escape, or once one of its actions is chosen.
  useEffect(() => {
    const closeMenus = (keep?: Element | null) => document.querySelectorAll<HTMLDetailsElement>(".row-menu[open]").forEach((menu) => { if (menu !== keep) menu.open = false; });
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element;
      closeMenus(target.closest(".row-menu-panel button") ? null : target.closest(".row-menu"));
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeMenus(); };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); document.removeEventListener("keydown", onKey); };
  }, []);

  return <TaskListView
    tasks={tasks} loading={loading} error={error} replacingTaskId={replacingTaskId} createdReplacementId={createdReplacementId}
    filter={filter} onFilterChange={setFilter}
    onRetry={() => void loadTasks()}
    onReplace={(taskId) => { setCreatedReplacementId(undefined); setEvidenceTaskId(undefined); setReplacingTaskId(taskId); }}
    evidenceTaskId={evidenceTaskId}
    onViewEvidence={(taskId) => { setReplacingTaskId(undefined); setEvidenceTaskId(taskId === evidenceTaskId ? undefined : taskId); }}
    evidencePanel={evidenceTaskId ? <AcceptedEvidencePanel key={evidenceTaskId} taskId={evidenceTaskId} onStale={() => void loadTasks()} onBack={() => {
      setEvidenceTaskId(undefined);
      // The opening button stays rendered in the list, so focus can return to it at once.
      document.getElementById(`evidence-button-${evidenceTaskId}`)?.focus();
    }} /> : undefined}
    onCancelReplacement={() => setReplacingTaskId(undefined)}
    onReplacementCreated={(taskId) => { setReplacingTaskId(undefined); setCreatedReplacementId(taskId); void loadTasks(); }}
    onStale={() => void loadTasks()}
  />;
}
