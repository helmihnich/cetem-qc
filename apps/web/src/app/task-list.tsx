"use client";

import { useCallback, useEffect, useState } from "react";
import { taskListResponseSchema } from "@cetem-qc/api-client/v1";
import type { TaskListResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";
import { TaskCreation } from "./task-creation";

type TaskListItem = TaskListResponse["tasks"][number];

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
};

/** A replacement is offered only for an accepted task that has none yet. */
export const canReplace = (task: TaskListItem) => task.state === "submitted" && task.replacedBy === null;

export function TaskListView(props: TaskListViewProps) {
  const { tasks, loading, error, replacingTaskId, createdReplacementId } = props;
  return <section className="roster-card task-list-card" aria-labelledby="task-list-title">
    <div className="card-heading"><div><h2 id="task-list-title">{fr.tasks.listTitle}</h2><p>{fr.tasks.listDescription}</p></div></div>
    {createdReplacementId && <div className="task-created" role="status"><strong>{fr.tasks.replacementCreated}</strong><span>{fr.tasks.taskId} : {createdReplacementId}</span><span>{fr.tasks.draft}</span></div>}
    {loading ? <div className="state-message" role="status">{fr.common.loading}</div>
      : error ? <div className="state-message error-state" role="alert">{fr.tasks.listError}<button className="text-button" type="button" onClick={props.onRetry}>{fr.tasks.retry}</button></div>
        : tasks.length === 0 ? <div className="state-message empty-state" role="status"><span className="empty-icon" aria-hidden="true">○</span><p>{fr.tasks.listEmpty}</p></div>
          : <div className="table-wrap"><table>
            <thead><tr><th scope="col">{fr.tasks.taskId}</th><th scope="col">{fr.tasks.type}</th><th scope="col">{fr.tasks.establishment}</th><th scope="col">{fr.tasks.assignee}</th><th scope="col">{fr.tasks.state}</th><th scope="col">{fr.tasks.lastUpdated}</th><th scope="col"><span className="visually-hidden">{fr.tasks.actions}</span></th></tr></thead>
            <tbody>{tasks.map((task) => <tr key={task.id}>
              <td className="task-id-cell">{task.id}
                {task.replacementOf !== null && <span className="task-lineage">{fr.tasks.replacementOf.replace("{taskId}", task.replacementOf)}</span>}
                {task.replacedBy !== null && <span className="task-lineage">{fr.tasks.replacedBy.replace("{taskId}", task.replacedBy)}</span>}
              </td>
              <td>{fr.tasks.graphieMobile}</td><td>{task.establishment}</td><td className="name-cell">{task.assignee}</td>
              <td>{task.state === "submitted"
                ? <span className="status-pill task-state-submitted"><span className="status-dot" />{fr.tasks.submittedAccepted}</span>
                : <span className="status-pill task-state-draft"><span className="status-dot" />{fr.tasks.draft}</span>}</td>
              <td>{dateFormatter.format(new Date(task.lastUpdatedAt))}</td>
              <td className="task-actions-cell">{canReplace(task) && <button className="secondary-button" type="button" aria-expanded={replacingTaskId === task.id} onClick={() => props.onReplace(task.id)}>{fr.tasks.replacementAction}</button>}</td>
            </tr>)}</tbody>
          </table></div>}
    {replacingTaskId && <TaskCreation key={replacingTaskId} replacement={{
      originalTaskId: replacingTaskId,
      onCancel: props.onCancelReplacement,
      onCreated: (task) => props.onReplacementCreated(task.id),
      onStale: props.onStale,
    }} />}
  </section>;
}

export function TaskList() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [replacingTaskId, setReplacingTaskId] = useState<string>();
  const [createdReplacementId, setCreatedReplacementId] = useState<string>();

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(false);
    setTasks([]);
    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      if (!response.ok) throw new Error("task-list-request-failed");
      const result = taskListResponseSchema.parse(await response.json());
      setTasks(result.tasks);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  return <TaskListView
    tasks={tasks} loading={loading} error={error} replacingTaskId={replacingTaskId} createdReplacementId={createdReplacementId}
    onRetry={() => void loadTasks()}
    onReplace={(taskId) => { setCreatedReplacementId(undefined); setReplacingTaskId(taskId); }}
    onCancelReplacement={() => setReplacingTaskId(undefined)}
    onReplacementCreated={(taskId) => { setReplacingTaskId(undefined); setCreatedReplacementId(taskId); void loadTasks(); }}
    onStale={() => void loadTasks()}
  />;
}
