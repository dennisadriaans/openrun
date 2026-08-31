/**
 * Workspace top-bar breadcrumb: project / branch [/ run title].
 *
 * Rendered as a single horizontal row (t3code style) rather than a stacked
 * title+subtitle block. Segments truncate individually so the branch stays
 * readable when the project name is long. The branch segment is a workspace
 * switcher when workspaces are provided.
 */
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, GitBranch } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { WorkspaceWithMeta } from '../../fns'
import { fetchLatestRunForWorkspace, useProjects } from '../../lib/queries'
import {
  fetchLatestRunForProject,
  useConversationNavigationRuns,
} from '../../lib/conversationNavigation'
import { truncateBranchLabel } from '../../lib/truncateLabel.ts'
import { threadNavigationIndex } from '../../lib/threadLens.ts'
import {
  NavigationProjectPicker,
  NavigationWorkspacePicker,
  type NavigationWorkspace,
} from './NavigationPicker'

function Separator() {
  return <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
}

function Segment({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span className={`min-w-0 truncate ${className}`} title={title}>
      {children}
    </span>
  )
}

function toNavigationWorkspace(ws: WorkspaceWithMeta): NavigationWorkspace {
  return { id: ws.id, branch: ws.branch, kind: ws.kind }
}

function BranchSwitcher({
  current,
  workspaces,
  disabled,
  muted,
  onRequestNewBranch,
  unreadWorkspaceIds,
  latestRunIdByWorkspace,
  onSelectWorkspace,
}: {
  current?: WorkspaceWithMeta | null
  workspaces: WorkspaceWithMeta[]
  disabled?: boolean
  muted?: boolean
  onRequestNewBranch?: () => void
  unreadWorkspaceIds: ReadonlySet<string>
  latestRunIdByWorkspace: ReadonlyMap<string, string>
  onSelectWorkspace?: (workspaceId: string) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const navigate = useNavigate()
  const ready = workspaces.filter((w) => w.status === 'ready' || w.id === current?.id)

  const switchTo = async (id: string) => {
    if (id === current?.id) return
    if (onSelectWorkspace) {
      onSelectWorkspace(id)
      return
    }
    const ws = workspaces.find((row) => row.id === id)
    if (!ws) return
    setBusyId(ws.id)
    try {
      const cachedId = latestRunIdByWorkspace.get(ws.id)
      const latestId = cachedId ?? (await fetchLatestRunForWorkspace(ws.id))?.id
      if (latestId) {
        navigate({ to: '/runs/$runId', params: { runId: latestId } })
      } else {
        navigate({ to: '/runs/new', search: { projectId: ws.projectId, workspaceId: ws.id } })
      }
    } finally {
      setBusyId(null)
    }
  }

  return (
    <NavigationWorkspacePicker
      workspaces={ready.map(toNavigationWorkspace)}
      workspaceId={current?.id ?? ''}
      disabled={disabled}
      muted={muted}
      busyId={busyId}
      unreadIds={unreadWorkspaceIds}
      onChange={(id) => void switchTo(id)}
      onRequestNewBranch={onRequestNewBranch}
    />
  )
}

export function WorkspaceBreadcrumb({
  projectId,
  projectName,
  branch,
  isMainCheckout,
  runTitle,
  trailing,
  workspace,
  workspaces,
  branchDisabled,
  onRequestNewBranch,
  onAddProject,
  onSelectProject,
  onSelectWorkspace,
}: {
  projectId?: string
  projectName?: string
  branch?: string
  isMainCheckout?: boolean
  runTitle?: string
  trailing?: ReactNode
  workspace?: WorkspaceWithMeta | null
  workspaces?: WorkspaceWithMeta[]
  branchDisabled?: boolean
  onRequestNewBranch?: () => void
  onAddProject?: () => void
  onSelectProject?: (projectId: string) => void
  onSelectWorkspace?: (workspaceId: string) => void
}) {
  const navigate = useNavigate()
  const { data: projects = [] } = useProjects()
  const { data: runs = [] } = useConversationNavigationRuns()
  const { unreadWorkspaceIds, latestRunIdByWorkspace, latestRunIdByProject } = threadNavigationIndex(runs)
  const showSwitcher = workspaces !== undefined
  const branchLabel = workspace?.branch ?? branch
  const currentProjectId = projectId ?? workspace?.projectId ?? ''
  const pickerProjects =
    currentProjectId && projectName && !projects.some((row) => row.id === currentProjectId)
      ? [{ id: currentProjectId, name: projectName }, ...projects]
      : projects

  const switchProject = async (nextId: string) => {
    if (!nextId || nextId === currentProjectId) return
    if (onSelectProject) {
      onSelectProject(nextId)
      return
    }
    const cachedId = latestRunIdByProject.get(nextId)
    const latestId = cachedId ?? (await fetchLatestRunForProject(nextId))?.id
    if (latestId) {
      navigate({ to: '/runs/$runId', params: { runId: latestId } })
      return
    }
    navigate({ to: '/runs/new', search: { projectId: nextId } })
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
      {currentProjectId && (projects.length > 0 || projectName) ? (
        <>
          <NavigationProjectPicker
            projects={pickerProjects}
            projectId={currentProjectId}
            disabled={branchDisabled}
            onChange={(id) => void switchProject(id)}
            onAddProject={onAddProject}
          />
          {branchLabel || showSwitcher || runTitle || trailing ? <Separator /> : null}
        </>
      ) : projectName ? (
        <>
          <span className="min-w-0 max-w-[30%] shrink truncate text-muted-foreground" title={projectName}>
            {projectName}
          </span>
          {branchLabel || showSwitcher || runTitle || trailing ? <Separator /> : null}
        </>
      ) : null}

      {showSwitcher ? (
        <>
          <BranchSwitcher
            current={workspace}
            workspaces={workspaces ?? []}
            disabled={branchDisabled}
            muted={Boolean(runTitle)}
            onRequestNewBranch={onRequestNewBranch}
            unreadWorkspaceIds={unreadWorkspaceIds}
            latestRunIdByWorkspace={latestRunIdByWorkspace}
            onSelectWorkspace={onSelectWorkspace}
          />
          {runTitle ? <Separator /> : null}
        </>
      ) : branchLabel ? (
        <>
          <Segment
            className={`flex max-w-44 shrink items-center gap-1.5 sm:max-w-52 ${
              runTitle ? 'text-muted-foreground' : 'font-medium text-foreground'
            }`}
            title={branchLabel}
          >
            <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="mono min-w-0 truncate">{truncateBranchLabel(branchLabel)}</span>
            {isMainCheckout ? <span className="shrink-0 text-[11px] text-muted-foreground/50">(main)</span> : null}
          </Segment>
          {runTitle ? <Separator /> : null}
        </>
      ) : null}

      {runTitle ? (
        <Segment className="font-medium text-foreground" title={runTitle}>
          {runTitle}
        </Segment>
      ) : null}

      {trailing ? (
        <>
          <Separator />
          <span className="min-w-0 shrink">{trailing}</span>
        </>
      ) : null}
    </nav>
  )
}
