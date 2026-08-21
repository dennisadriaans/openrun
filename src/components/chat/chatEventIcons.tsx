import type { ComponentType } from 'react'
import {
  Blocks,
  Bot,
  Brain,
  FileText,
  FolderInput,
  Pencil,
  Search,
  Shuffle,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ToolKind } from '../../lib/acp'
import type { ToolCallRole } from '../../lib/toolCallRole'

/** mdi:world — Material Design Icons globe for web fetch / browse tools. */
export function MdiWorldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.9,17.39C17.64,16.59 16.89,16 16,16H15V13A1,1 0 0,0 14,12H8V10H10A1,1 0 0,0 11,9V7H13A2,2 0 0,0 15,5V4.59C17.93,5.77 20,8.64 20,12C20,14.08 19.2,15.97 17.9,17.39M11,19.93C7.05,19.44 4,16.08 4,12C4,11.38 4.08,10.78 4.21,10.21L9,15V16A2,2 0 0,0 11,18M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z" />
    </svg>
  )
}

type ToolKindIcon = ComponentType<{ className?: string }>

const TOOL_KIND_ICONS: Record<ToolKind, ToolKindIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: FolderInput,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: MdiWorldIcon,
  switch_mode: Shuffle,
  other: Wrench,
}

const ROLE_ICONS: Record<ToolCallRole, LucideIcon> = {
  tool: Wrench,
  mcp: Blocks,
  skill: Sparkles,
  subagent: Bot,
}

const ROLE_EYEBROWS: Record<ToolCallRole, string | undefined> = {
  tool: undefined,
  mcp: 'MCP',
  skill: 'Skill',
  subagent: 'Subagent',
}

export function iconForToolKind(kind?: ToolKind): ToolKindIcon {
  return TOOL_KIND_ICONS[kind ?? 'other'] ?? Wrench
}

export function iconForCallRole(role: ToolCallRole, toolKind?: ToolKind): ToolKindIcon {
  if (role === 'tool') return iconForToolKind(toolKind)
  return ROLE_ICONS[role]
}

export function eyebrowForCallRole(role: ToolCallRole): string | undefined {
  return ROLE_EYEBROWS[role]
}
