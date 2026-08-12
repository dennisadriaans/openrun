import test from 'node:test'
import assert from 'node:assert/strict'
import { fileTypeKey } from './fileType.ts'

test('maps framework and language extensions', () => {
  assert.equal(fileTypeKey('app/pages/inbox.vue'), 'vue')
  assert.equal(fileTypeKey('src/components/Chat.tsx'), 'react')
  assert.equal(fileTypeKey('src/lib/cron.ts'), 'typescript')
  assert.equal(fileTypeKey('scripts/start.mjs'), 'javascript')
  assert.equal(fileTypeKey('app/Http/Kernel.php'), 'php')
  assert.equal(fileTypeKey('main.go'), 'go')
  assert.equal(fileTypeKey('lib/parser.rs'), 'rust')
  assert.equal(fileTypeKey('styles/app.scss'), 'sass')
})

test('compound suffixes beat the plain extension', () => {
  assert.equal(fileTypeKey('src/app/nav.component.ts'), 'angular')
  assert.equal(fileTypeKey('src/lib/cron.test.ts'), 'test')
  assert.equal(fileTypeKey('Button.stories.tsx'), 'storybook')
  assert.equal(fileTypeKey('resources/views/home.blade.php'), 'php')
})

test('exact file names beat everything', () => {
  assert.equal(fileTypeKey('package.json'), 'npm')
  assert.equal(fileTypeKey('pnpm-lock.yaml'), 'pnpm')
  assert.equal(fileTypeKey('yarn.lock'), 'lock')
  assert.equal(fileTypeKey('Dockerfile'), 'docker')
  assert.equal(fileTypeKey('vite.config.ts'), 'vite')
  assert.equal(fileTypeKey('some/dir/data.json'), 'json')
})

test('prefix and path rules', () => {
  assert.equal(fileTypeKey('.env.local'), 'dotenv')
  assert.equal(fileTypeKey('eslint.config.js'), 'eslint')
  assert.equal(fileTypeKey('tsconfig.build.json'), 'typescript')
  assert.equal(fileTypeKey('.github/workflows/ci.yml'), 'github')
  assert.equal(fileTypeKey('deploy/k8s/api.yaml'), 'kubernetes')
})

test('unknown and extensionless paths fall back', () => {
  assert.equal(fileTypeKey('LICENSE'), 'file')
  assert.equal(fileTypeKey('weird.qqq'), 'file')
})

test('case is ignored', () => {
  assert.equal(fileTypeKey('src/App.VUE'), 'vue')
  assert.equal(fileTypeKey('DOCKERFILE'), 'docker')
})
