import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useMemo } from "react";
import { NeedProjectEmpty } from "../components/NeedProjectEmpty";
import {
  ActiveToggle,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
} from "../components/ui";
import { describeCron, relativeTime, taskScheduleStatus } from "../lib/format";
import { queueDepthLabel } from "../lib/runQueue";

import { enableBlockedReason } from "../lib/enableGate";
import { automationsEmptyKind } from "../lib/projectGate";
import { useProjects, useRuns, useTasks, useToggleTask } from "../lib/queries";
import { runNowBlockedReason } from "../lib/runNowGate";

type TaskRow = NonNullable<ReturnType<typeof useTasks>["data"]>[number];

export const Route = createFileRoute("/tasks/")({ component: TasksPage });

/**
 * One line under the name, not eight chips. A blocked automation says the one
 * thing standing in the way; a healthy one says when it runs next.
 */
function subtitle(t: TaskRow, blocked: string | null): string {
  if (blocked) return blocked;
  const parts = [describeCron(t.cron)];
  if (t.queuedCount > 0) parts.push(queueDepthLabel(t.queuedCount));
  if (t.enabled && t.nextRunAt) parts.push(`next ${relativeTime(t.nextRunAt)}`);
  else if (t.lastRunAt) parts.push(`last ${relativeTime(t.lastRunAt)}`);
  return parts.join(" · ");
}

function TasksPage() {
  const { data: tasks, isLoading } = useTasks();
  const { data: projects, isLoading: loadingProjects } = useProjects();
  const { data: runs } = useRuns();
  const runningTaskIds = useMemo(
    () =>
      new Set(
        runs?.filter((r) => r.status === "running").map((r) => r.taskId) ?? [],
      ),
    [runs],
  );
  const navigate = useNavigate();
  const toggle = useToggleTask();
  const emptyKind = automationsEmptyKind(projects?.length ?? 0);

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title="Automations"
        actions={
          <Button variant="primary" onClick={() => navigate({ to: "/tasks/new" })}>
            <Plus className="h-3.5 w-3.5" />
            New automation
          </Button>
        }
      />

      {isLoading || loadingProjects ? (
        <div className="py-12 text-center text-ui-sm text-tier-quaternary">
          Loading…
        </div>
      ) : tasks && tasks.length > 0 ? (
        <Card className="divide-y divide-[var(--border-quaternary)]">
          {tasks.map((t) => {
            const blockEnable = t.enabled ? null : enableBlockedReason(t);
            const runBlocked = runNowBlockedReason(t);
            const line = subtitle(t, runBlocked);
            return (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2.5"
              >
                <Link
                  to="/tasks/$taskId"
                  params={{ taskId: t.id }}
                  className="min-w-0 flex-1"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-ui-base text-foreground">
                      {t.name}
                    </span>
                    <StatusBadge
                      status={taskScheduleStatus(
                        !!t.enabled,
                        runningTaskIds.has(t.id),
                      )}
                    />
                  </div>
                  <div
                    className={`mt-0.5 truncate text-ui-sm ${
                      runBlocked ? "text-warn" : "text-tier-tertiary"
                    }`}
                  >
                    {line}
                  </div>
                </Link>
                <ActiveToggle
                  checked={!!t.enabled}
                  title={
                    t.enabled
                      ? "Pause schedule"
                      : (blockEnable ?? "Enable schedule")
                  }
                  disabled={Boolean(blockEnable) || toggle.isPending}
                  onChange={(enabled) =>
                    toggle.mutate(
                      { id: t.id, enabled },
                      {
                        onError: (err) => {
                          window.alert(
                            err instanceof Error ? err.message : String(err),
                          );
                        },
                      },
                    )
                  }
                />
              </div>
            );
          })}
        </Card>
      ) : emptyKind === "need-project" ? (
        <NeedProjectEmpty />
      ) : (
        <EmptyState title="No automations yet">
          Describe a job once, pick when it runs, and an agent does it for you.
          <div className="mt-3">
            <Button variant="primary" onClick={() => navigate({ to: "/tasks/new" })}>
              <Plus className="h-3.5 w-3.5" /> New automation
            </Button>
          </div>
        </EmptyState>
      )}
    </div>
  );
}
