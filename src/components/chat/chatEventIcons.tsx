import {
  Blocks,
  Bot,
  Brain,
  FileText,
  FolderInput,
  Globe,
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

const TOOL_KIND_ICONS: Record<ToolKind, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: FolderInput,
  search: Search,
  execute: Terminal,
  think: Brain,
  fetch: Globe,
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

export function iconForToolKind(kind?: ToolKind): LucideIcon {
  return TOOL_KIND_ICONS[kind ?? 'other'] ?? Wrench
}

export function iconForCallRole(role: ToolCallRole, toolKind?: ToolKind): LucideIcon {
  if (role === 'tool') return iconForToolKind(toolKind)
  return ROLE_ICONS[role]
}

export function eyebrowForCallRole(role: ToolCallRole): string | undefined {
  return ROLE_EYEBROWS[role]
}
