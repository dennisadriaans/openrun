/** id capability implementation. */

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

// Internal collaborators; the public facade exports only the API surface.
export { id }
