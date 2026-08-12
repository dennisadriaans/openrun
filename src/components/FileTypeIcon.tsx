/**
 * Brand icon for a file path — Simple Icons for anything with a real logo,
 * Lucide glyphs for the plain formats that don't have one.
 *
 * The path → key resolution lives in `lib/fileType.ts` so it stays testable and
 * dependency-free; this module is only the key → drawing table.
 */
import type { ComponentType } from 'react'
import {
  Braces,
  Database,
  FileCode,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Lock,
  Settings2,
  Terminal,
} from 'lucide-react'
import {
  siAngular,
  siAstro,
  siBiome,
  siC,
  siCplusplus,
  siCss,
  siDart,
  siDocker,
  siDotenv,
  siDotnet,
  siEditorconfig,
  siElixir,
  siEslint,
  siFlutter,
  siGit,
  siGithubactions,
  siGnubash,
  siGo,
  siGradle,
  siApachegroovy,
  siGraphql,
  siHaskell,
  siHtml5,
  siJavascript,
  siJupyter,
  siKotlin,
  siKubernetes,
  siLatex,
  siLess,
  siLua,
  siMarkdown,
  siMdx,
  siNextdotjs,
  siNginx,
  siNodedotjs,
  siNpm,
  siNuxt,
  siOcaml,
  siOpenjdk,
  siPerl,
  siPhp,
  siPnpm,
  siPrettier,
  siPrisma,
  siPug,
  siPython,
  siR,
  siReact,
  siRuby,
  siRust,
  siSass,
  siStorybook,
  siSvelte,
  siSvg,
  siSwift,
  siTailwindcss,
  siTerraform,
  siToml,
  siTypescript,
  siVite,
  siVuedotjs,
  siWebassembly,
  siZig,
} from 'simple-icons'
import { fileTypeKey, type FileTypeKey } from '../lib/fileType'

type SimpleIcon = { title: string; path: string; hex: string }
type Drawing =
  | { icon: SimpleIcon }
  | { lucide: ComponentType<{ className?: string }>; title: string }

const TABLE: Record<FileTypeKey, Drawing> = {
  angular: { icon: siAngular },
  astro: { icon: siAstro },
  bash: { icon: siGnubash },
  biome: { icon: siBiome },
  c: { icon: siC },
  cpp: { icon: siCplusplus },
  csharp: { icon: siDotnet },
  css: { icon: siCss },
  dart: { icon: siDart },
  docker: { icon: siDocker },
  dotenv: { icon: siDotenv },
  editorconfig: { icon: siEditorconfig },
  elixir: { icon: siElixir },
  eslint: { icon: siEslint },
  flutter: { icon: siFlutter },
  git: { icon: siGit },
  github: { icon: siGithubactions },
  go: { icon: siGo },
  gradle: { icon: siGradle },
  graphql: { icon: siGraphql },
  groovy: { icon: siApachegroovy },
  haskell: { icon: siHaskell },
  html: { icon: siHtml5 },
  image: { lucide: ImageIcon, title: 'Image' },
  java: { icon: siOpenjdk },
  javascript: { icon: siJavascript },
  json: { lucide: Braces, title: 'JSON' },
  jupyter: { icon: siJupyter },
  kotlin: { icon: siKotlin },
  kubernetes: { icon: siKubernetes },
  latex: { icon: siLatex },
  less: { icon: siLess },
  lock: { lucide: Lock, title: 'Lockfile' },
  lua: { icon: siLua },
  markdown: { icon: siMarkdown },
  mdx: { icon: siMdx },
  next: { icon: siNextdotjs },
  nginx: { icon: siNginx },
  node: { icon: siNodedotjs },
  npm: { icon: siNpm },
  nuxt: { icon: siNuxt },
  ocaml: { icon: siOcaml },
  perl: { icon: siPerl },
  php: { icon: siPhp },
  pnpm: { icon: siPnpm },
  prettier: { icon: siPrettier },
  prisma: { icon: siPrisma },
  pug: { icon: siPug },
  python: { icon: siPython },
  r: { icon: siR },
  react: { icon: siReact },
  ruby: { icon: siRuby },
  rust: { icon: siRust },
  sass: { icon: siSass },
  shell: { lucide: Terminal, title: 'Shell' },
  sql: { lucide: Database, title: 'SQL' },
  storybook: { icon: siStorybook },
  svelte: { icon: siSvelte },
  svg: { icon: siSvg },
  swift: { icon: siSwift },
  tailwind: { icon: siTailwindcss },
  terraform: { icon: siTerraform },
  test: { lucide: FlaskConical, title: 'Test' },
  text: { lucide: FileText, title: 'Text' },
  toml: { icon: siToml },
  typescript: { icon: siTypescript },
  vite: { icon: siVite },
  vue: { icon: siVuedotjs },
  wasm: { icon: siWebassembly },
  yaml: { lucide: Settings2, title: 'YAML' },
  zig: { icon: siZig },
  file: { lucide: FileCode, title: 'File' },
}

/** Brands whose logo is near-black (Next.js, Prisma…) would vanish on the dark chrome. */
function tooDarkForChrome(hex: string): boolean {
  const n = Number.parseInt(hex, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.28
}

export function FileTypeIcon({
  path,
  className = 'size-3.5',
}: {
  path: string
  className?: string
}) {
  const drawing = TABLE[fileTypeKey(path)]

  if ('lucide' in drawing) {
    const Glyph = drawing.lucide
    return <Glyph className={`${className} shrink-0 text-muted-foreground`} />
  }

  const { title, path: d, hex } = drawing.icon
  const dim = tooDarkForChrome(hex)
  return (
    <svg
      role="img"
      aria-label={title}
      viewBox="0 0 24 24"
      className={`${className} shrink-0 ${dim ? 'text-foreground/70' : ''}`}
      fill={dim ? 'currentColor' : `#${hex}`}
    >
      <path d={d} />
    </svg>
  )
}
