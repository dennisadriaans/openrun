/**
 * Edition as "signed in to the control plane", not "URL is set".
 *
 * A baked-in cloud URL must not flip the app into `connected` — that would
 * make every clone look paid before anyone signs in. Session is the switch.
 */
import {
  hasControlPlaneCapability,
  resolveEdition,
  type ControlPlaneCapability,
  type Edition,
} from '../edition.ts'
import { resolveCloudUrl } from './url.ts'

export function editionFromSession(input: {
  cloudUrl?: string | null
  hasSession: boolean
}): Edition {
  if (!input.hasSession) return 'local'
  const cloudUrl = resolveCloudUrl(input.cloudUrl)
  return resolveEdition({ cloudUrl, hasSession: true })
}

export function cloudCapability(edition: Edition, capability: ControlPlaneCapability): boolean {
  return hasControlPlaneCapability(edition, capability)
}
