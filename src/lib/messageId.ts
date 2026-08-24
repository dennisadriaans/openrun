const MESSAGE_ID = /^msg_[a-z0-9]{6,32}$/i

export function newMessageId(): string {
  return `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function isMessageId(id: string): boolean {
  return id.length <= 40 && MESSAGE_ID.test(id)
}
