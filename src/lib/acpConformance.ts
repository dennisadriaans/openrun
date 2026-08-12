/**
 * Compile-time guard: our hand-written ACP subset (`lib/acp.ts`) must stay
 * assignable to the real protocol types.
 *
 * `lib/` has to stay browser-safe and dependency-free, so `acp.ts` re-declares
 * the handful of ACP shapes the chat transcript needs instead of importing the
 * SDK. This file is the seam that keeps that copy honest: it imports the SDK
 * **types only** (erased at build time, nothing reaches the client bundle) and
 * asserts both directions of assignability. If the protocol renames a field or
 * adds a status, `pnpm typecheck` fails here rather than at runtime in a parser.
 *
 * Nothing imports this module — `tsc --noEmit` checking it is the entire point.
 */
import type {
  PermissionOption as AcpPermissionOption,
  PlanEntry as AcpPlanEntry,
  RequestPermissionResponse,
  StopReason as AcpStopReason,
  ToolCallLocation as AcpToolCallLocation,
  ToolCallStatus as AcpToolCallStatus,
  ToolKind as AcpToolKind,
} from '@agentclientprotocol/sdk'
import type {
  PermissionOption,
  PermissionOutcome,
  PlanEntry,
  StopReason,
  ToolCallLocation,
  ToolCallStatus,
  ToolKind,
} from './acp.ts'

/** Compiles only when `A` is assignable to `B`. */
type AssignableTo<A extends B, B> = A

// String unions are checked both ways, so a value added or removed on either
// side breaks the build: a new spec ToolKind fails the second assertion.
export type _ToolKindNarrows = AssignableTo<ToolKind, AcpToolKind>
export type _ToolKindWidens = AssignableTo<AcpToolKind, ToolKind>
export type _StatusNarrows = AssignableTo<ToolCallStatus, AcpToolCallStatus>
export type _StatusWidens = AssignableTo<AcpToolCallStatus, ToolCallStatus>
export type _StopReasonNarrows = AssignableTo<StopReason, AcpStopReason>
export type _StopReasonWidens = AssignableTo<AcpStopReason, StopReason>

/**
 * Object shapes only need one direction: ours must be usable wherever the
 * protocol type is expected. The SDK's generated types carry `_meta` and
 * `| null` variants we deliberately drop, so the reverse does not hold.
 */
export type _PermissionOption = AssignableTo<PermissionOption, AcpPermissionOption>
export type _PlanEntry = AssignableTo<PlanEntry, AcpPlanEntry>
export type _ToolCallLocation = AssignableTo<ToolCallLocation, AcpToolCallLocation>
export type _PermissionOutcome = AssignableTo<
  PermissionOutcome,
  RequestPermissionResponse['outcome']
>
