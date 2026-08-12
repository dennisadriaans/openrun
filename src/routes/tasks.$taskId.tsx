import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTopBarActions } from "../components/AppChrome";
import { TaskForm } from "../components/TaskForm";
import {
  ActiveToggle,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  VerdictBadge,
} from "../components/ui";
import { describeCron, duration, relativeTime, taskScheduleStatus } from "../lib/format";
import { enableBlockedReason } from "../lib/enableGate";
import {
  useDeleteTask,
  useRunNow,
  useRuns,
  useTask,
  useToggleTask,
} from "../lib/queries";
import { runNowBlockedReason } from "../lib/runNowGate";

export const Route = createFileRoute("/tasks/$taskId")({
  component: TaskDetail,
});

type TaskRow = NonNullable<ReturnType<typeof useTask>["data"]>;

function detailSubtitle(
  task: TaskRow,
  runBlocked: string | null,
  enableBlock: string | null,
): string {
  if (!task.enabled && enableBlock) return enableBlock;
  if (runBlocked) return runBlocked;
  const parts = [task.runtimeLabel, describeCron(task.cron)];
  if (task.enabled && task.nextRunAt) parts.push(`next ${relativeTime(task.nextRunAt)}`);
  else if (!task.enabled) parts.push("paused");
  return parts.join(" · ");
}

function TaskDetail() {
  const { taskId } = Route.useParams();
  const { data: task, isLoading } = useTask(taskId);
  const { data: runs } = useRuns(taskId);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const runNow = useRunNow();
  const toggle = useToggleTask();
  const del = useDeleteTask();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [taskId]);

  const isRunning = useMemo(
    () => runs?.some((r) => r.status === "running") ?? false,
    [runs],
  );

  const runBlocked = task ? runNowBlockedReason(task) : null;
  const enableBlock = task && !task.enabled ? enableBlockedReason(task) : null;

  useTopBarActions(
    task && !editing ? (
      <>
        <Button
          variant="primary"
          title={runBlocked ?? undefined}
          onClick={() =>
            runNow.mutate(task.id, {
              onSuccess: ({ runId }) => {
                if (runId) {
                  navigate({ to: "/runs/$runId", params: { runId } });
                }
              },
              onError: (err) => {
                window.alert(err instanceof Error ? err.message : String(err));
              },
            })
          }
          disabled={runNow.isPending || runBlocked !== null}
        >
          <Play className="h-3.5 w-3.5" />
          Run
        </Button>
        <Button
          variant="ghost"
          aria-label="Edit automation"
          title="Edit"
          onClick={() => setEditing(true)}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          aria-label="Delete automation"
          title="Delete"
          onClick={() => {
            if (confirm(`Delete automation "${task.name}"?`)) {
              del.mutate(task.id);
              navigate({ to: "/tasks" });
            }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </>
    ) : null,
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">Loading…</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <EmptyState title="Automation not found">
          <Link
            to="/tasks"
            className="text-tier-secondary underline underline-offset-2 hover:text-foreground"
          >
            Back to automations
          </Link>
        </EmptyState>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <TaskForm
          initial={{
            id: task.id,
            name: task.name,
            description: task.description,
            runtimeId: task.runtimeId,
            prompt: task.prompt,
            workspaceId: task.workspaceId,
            cron: task.cron,
            enabled: !!task.enabled,
            model: task.model,
            effort: task.effort,
            verifyEnabled: task.verifyEnabled,
            maxRepairAttempts: task.maxRepairAttempts,
            timeoutMs: task.timeoutMs,
          }}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            qc.invalidateQueries({ queryKey: ["task", taskId] });
            qc.invalidateQueries({ queryKey: ["tasks"] });
          }}
        />
      </div>
    );
  }

  const subtitle = detailSubtitle(task, runBlocked, enableBlock);
  const warn = Boolean(runBlocked || (!task.enabled && enableBlock));

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title={task.name}
        description={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <StatusBadge status={taskScheduleStatus(!!task.enabled, isRunning)} />
            <span className={warn ? "text-warn" : undefined}>{subtitle}</span>
          </div>
        }
        actions={
          <ActiveToggle
            checked={!!task.enabled}
            title={
              task.enabled ? "Pause schedule" : (enableBlock ?? "Enable schedule")
            }
            disabled={Boolean(enableBlock) || toggle.isPending}
            onChange={(enabled) =>
              toggle.mutate(
                { id: task.id, enabled },
                {
                  onError: (err) => {
                    window.alert(err instanceof Error ? err.message : String(err));
                  },
                },
              )
            }
          />
        }
      />

      {task.prompt ? (
        <p className="mb-6 whitespace-pre-wrap text-ui-sm leading-relaxed text-tier-secondary">
          {task.prompt}
        </p>
      ) : null}

      <Card className="divide-y divide-[var(--border-quaternary)]">
        {runs && runs.length > 0 ? (
          runs.map((r) => (
            <Link
              key={r.id}
              to="/runs/$runId"
              params={{ runId: r.id }}
              className="flex items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-hover"
            >
              <div className="min-w-0">
                <div className="text-ui-sm text-tier-secondary">
                  {relativeTime(r.startedAt)}
                  <span className="text-tier-quaternary"> · </span>
                  {r.trigger}
                  <span className="text-tier-quaternary"> · </span>
                  <span className="tabular-nums">
                    {duration(r.startedAt, r.finishedAt)}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <VerdictBadge verdict={r.verdict} />
                <StatusBadge status={r.status} />
              </div>
            </Link>
          ))
        ) : (
          <div className="px-4 py-10 text-center text-ui-sm text-tier-tertiary">
            No runs yet
          </div>
        )}
      </Card>
    </div>
  );
}
