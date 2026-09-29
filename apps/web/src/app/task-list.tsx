"use client";

import { useCallback, useEffect, useState } from "react";
import { taskListResponseSchema } from "@cetem-qc/api-client/v1";
import type { TaskListResponse } from "@cetem-qc/api-client/v1";
import { fr } from "@cetem-qc/i18n";

type TaskListItem = TaskListResponse["tasks"][number];

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

export function TaskList() {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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

  return <section className="roster-card task-list-card" aria-labelledby="task-list-title">
    <div className="card-heading"><div><h2 id="task-list-title">{fr.tasks.listTitle}</h2><p>{fr.tasks.listDescription}</p></div></div>
    {loading ? <div className="state-message" role="status">{fr.common.loading}</div>
      : error ? <div className="state-message error-state" role="alert">{fr.tasks.listError}<button className="text-button" type="button" onClick={() => void loadTasks()}>{fr.tasks.retry}</button></div>
        : tasks.length === 0 ? <div className="state-message empty-state" role="status"><span className="empty-icon" aria-hidden="true">○</span><p>{fr.tasks.listEmpty}</p></div>
          : <div className="table-wrap"><table>
            <thead><tr><th scope="col">{fr.tasks.taskId}</th><th scope="col">{fr.tasks.type}</th><th scope="col">{fr.tasks.establishment}</th><th scope="col">{fr.tasks.assignee}</th><th scope="col">{fr.tasks.state}</th><th scope="col">{fr.tasks.lastUpdated}</th></tr></thead>
            <tbody>{tasks.map((task) => <tr key={task.id}>
              <td className="task-id-cell">{task.id}</td><td>{fr.tasks.graphieMobile}</td><td>{task.establishment}</td><td className="name-cell">{task.assignee}</td>
              <td><span className="status-pill task-state-draft"><span className="status-dot" />{fr.tasks.draft}</span></td>
              <td>{dateFormatter.format(new Date(task.lastUpdatedAt))}</td>
            </tr>)}</tbody>
          </table></div>}
  </section>;
}
