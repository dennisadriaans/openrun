/**
 * The addresses a phone on the same Wi-Fi can reach this machine on.
 *
 * Imports only `node:os` on purpose: `vite.config.ts` needs the same list to
 * build `server.allowedHosts`, and Vite's config is evaluated outside the app
 * module graph, so anything app-shaped in here would break it.
 */
import { networkInterfaces } from 'node:os'

/**
 * Non-internal IPv4 addresses, most-likely-LAN first.
 *
 * Ordering matters only for which one the QR code offers by default: a machine
 * on Wi-Fi plus a Docker bridge plus a VPN can easily have four, and the one
 * the phone can reach is almost always the 192.168/10 one.
 */
export function lanAddresses(): string[] {
  const found: string[] = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // Node 18+ reports family as 'IPv4'; older typings used the number 4.
      const isV4 = addr.family === 'IPv4' || (addr.family as unknown as number) === 4
      if (!isV4 || addr.internal) continue
      found.push(addr.address)
    }
  }
  return found.sort((a, b) => lanRank(a) - lanRank(b) || a.localeCompare(b))
}

/** Lower ranks sort first. Home/office ranges beat container and CGNAT ranges. */
function lanRank(ip: string): number {
  if (ip.startsWith('192.168.')) return 0
  if (ip.startsWith('10.')) return 1
  const m = /^172\.(\d+)\./.exec(ip)
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return 2
  if (ip.startsWith('169.254.')) return 4
  return 3
}

/** Base URLs to offer in the pairing modal, e.g. `http://192.168.1.24:3000`. */
export function lanBaseUrls(port: number): string[] {
  return lanAddresses().map((ip) => `http://${ip}:${port}`)
}

/**
 * Hostnames the dev server must accept in the Host header once it binds beyond
 * loopback. Vite rejects unknown hosts by default, and that rejection looks
 * exactly like "the phone cannot reach my Mac".
 */
export function lanAllowedHosts(extra: string | undefined): string[] {
  const hosts = new Set<string>(['localhost', '127.0.0.1', '[::1]'])
  for (const ip of lanAddresses()) hosts.add(ip)
  for (const raw of (extra ?? '').split(',')) {
    const host = raw.trim()
    if (host) hosts.add(host)
  }
  return [...hosts]
}
