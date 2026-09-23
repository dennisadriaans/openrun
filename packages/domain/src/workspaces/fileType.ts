/**
 * Path → file-type key.
 *
 * Pure and dependency-free so it can be unit tested and run anywhere; the key is
 * looked up against the icon table in `components/FileTypeIcon.tsx`. Keep the two
 * in sync: a new key here needs an entry there or it renders the generic file icon.
 */

export type FileTypeKey =
  | 'angular'
  | 'astro'
  | 'bash'
  | 'biome'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'css'
  | 'dart'
  | 'docker'
  | 'dotenv'
  | 'editorconfig'
  | 'elixir'
  | 'eslint'
  | 'flutter'
  | 'git'
  | 'github'
  | 'go'
  | 'gradle'
  | 'graphql'
  | 'groovy'
  | 'haskell'
  | 'html'
  | 'image'
  | 'java'
  | 'javascript'
  | 'jupyter'
  | 'kotlin'
  | 'kubernetes'
  | 'latex'
  | 'less'
  | 'lock'
  | 'lua'
  | 'markdown'
  | 'mdx'
  | 'json'
  | 'next'
  | 'nginx'
  | 'node'
  | 'npm'
  | 'nuxt'
  | 'ocaml'
  | 'perl'
  | 'php'
  | 'pnpm'
  | 'prettier'
  | 'prisma'
  | 'pug'
  | 'python'
  | 'r'
  | 'react'
  | 'ruby'
  | 'rust'
  | 'sass'
  | 'shell'
  | 'sql'
  | 'storybook'
  | 'svelte'
  | 'svg'
  | 'swift'
  | 'tailwind'
  | 'terraform'
  | 'test'
  | 'text'
  | 'toml'
  | 'typescript'
  | 'vite'
  | 'vue'
  | 'wasm'
  | 'yaml'
  | 'zig'
  | 'file'

/** Exact file names win over any extension rule. */
const BY_NAME: Record<string, FileTypeKey> = {
  '.editorconfig': 'editorconfig',
  '.gitattributes': 'git',
  '.gitignore': 'git',
  '.gitmodules': 'git',
  '.npmrc': 'npm',
  '.nvmrc': 'node',
  'angular.json': 'angular',
  'astro.config.mjs': 'astro',
  'astro.config.ts': 'astro',
  'biome.json': 'biome',
  'biome.jsonc': 'biome',
  'bun.lockb': 'lock',
  'cargo.lock': 'lock',
  'cargo.toml': 'rust',
  'composer.json': 'php',
  'composer.lock': 'lock',
  containerfile: 'docker',
  dockerfile: 'docker',
  'docker-compose.yaml': 'docker',
  'docker-compose.yml': 'docker',
  'compose.yaml': 'docker',
  'compose.yml': 'docker',
  gemfile: 'ruby',
  'gemfile.lock': 'lock',
  'go.mod': 'go',
  'go.sum': 'lock',
  'next.config.js': 'next',
  'next.config.mjs': 'next',
  'next.config.ts': 'next',
  'nuxt.config.ts': 'nuxt',
  'package.json': 'npm',
  'package-lock.json': 'lock',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'requirements.txt': 'python',
  'tailwind.config.js': 'tailwind',
  'tailwind.config.ts': 'tailwind',
  'vite.config.js': 'vite',
  'vite.config.ts': 'vite',
  'yarn.lock': 'lock',
}

/** Compound suffixes, longest first — `foo.component.ts` is Angular, not TypeScript. */
const BY_SUFFIX: [string, FileTypeKey][] = [
  ['.component.ts', 'angular'],
  ['.component.html', 'angular'],
  ['.directive.ts', 'angular'],
  ['.module.ts', 'angular'],
  ['.pipe.ts', 'angular'],
  ['.guard.ts', 'angular'],
  ['.service.ts', 'angular'],
  ['.stories.ts', 'storybook'],
  ['.stories.tsx', 'storybook'],
  ['.stories.js', 'storybook'],
  ['.stories.jsx', 'storybook'],
  ['.test.ts', 'test'],
  ['.test.tsx', 'test'],
  ['.test.js', 'test'],
  ['.test.jsx', 'test'],
  ['.spec.ts', 'test'],
  ['.spec.tsx', 'test'],
  ['.spec.js', 'test'],
  ['.blade.php', 'php'],
]

const BY_EXT: Record<string, FileTypeKey> = {
  astro: 'astro',
  bash: 'bash',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dart: 'dart',
  env: 'dotenv',
  ex: 'elixir',
  exs: 'elixir',
  gif: 'image',
  go: 'go',
  gradle: 'gradle',
  graphql: 'graphql',
  gql: 'graphql',
  groovy: 'groovy',
  hs: 'haskell',
  htm: 'html',
  html: 'html',
  ico: 'image',
  ipynb: 'jupyter',
  java: 'java',
  cjs: 'javascript',
  js: 'javascript',
  mjs: 'javascript',
  json: 'json',
  json5: 'json',
  jsonc: 'json',
  jpeg: 'image',
  jpg: 'image',
  jsx: 'react',
  kt: 'kotlin',
  kts: 'kotlin',
  less: 'less',
  lua: 'lua',
  md: 'markdown',
  mdx: 'mdx',
  ml: 'ocaml',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  png: 'image',
  prisma: 'prisma',
  pug: 'pug',
  py: 'python',
  pyi: 'python',
  r: 'r',
  rb: 'ruby',
  rs: 'rust',
  sass: 'sass',
  scss: 'sass',
  sh: 'shell',
  zsh: 'shell',
  fish: 'shell',
  sql: 'sql',
  svelte: 'svelte',
  svg: 'svg',
  swift: 'swift',
  tex: 'latex',
  tf: 'terraform',
  tfvars: 'terraform',
  toml: 'toml',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'react',
  txt: 'text',
  vue: 'vue',
  wasm: 'wasm',
  wat: 'wasm',
  webp: 'image',
  yaml: 'yaml',
  yml: 'yaml',
  zig: 'zig',
}

export function fileTypeKey(path: string): FileTypeKey {
  const name = (path.split('/').pop() ?? path).toLowerCase()

  const byName = BY_NAME[name]
  if (byName) return byName

  if (name.startsWith('.env')) return 'dotenv'
  if (name.includes('eslint')) return 'eslint'
  if (name.includes('prettier')) return 'prettier'
  if (name.startsWith('dockerfile')) return 'docker'
  if (name.startsWith('makefile')) return 'shell'
  if (name.startsWith('nginx')) return 'nginx'
  if (name.startsWith('tsconfig') && name.endsWith('.json')) return 'typescript'
  if (path.includes('.github/workflows/')) return 'github'
  if (path.includes('/k8s/') || name.endsWith('.k8s.yaml')) return 'kubernetes'

  for (const [suffix, key] of BY_SUFFIX) {
    if (name.endsWith(suffix)) return key
  }

  const ext = name.includes('.') ? name.split('.').pop()! : ''
  return BY_EXT[ext] ?? 'file'
}
