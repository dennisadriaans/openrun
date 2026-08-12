---
title: Brand icons for changed files
status: done
area: ui
---

Changed files no longer wear a two-letter monospace badge that read `VUE`, `TS`
or `···` and told you less than the extension already did. Every file row —
"Files changed", the workspace file tree, the diff card header — now shows the
real logo for its type via [Simple Icons](https://simpleicons.org): Vue, React,
Angular, TypeScript, JavaScript, PHP, Python, Go, Rust, Ruby, Java, Kotlin,
Swift, Svelte, Astro, Next, Nuxt, Tailwind, Docker, Terraform, Prisma, GraphQL
and the rest of the common set, with Lucide glyphs for the formats that have no
logo (JSON, YAML, SQL, shell, text, images, lockfiles).

- Deleted files are struck through instead of only being tinted red, so the
  status is still legible now that the icon carries the brand's own colour.
- Near-black logos (Next.js, Prisma) fall back to the foreground colour rather
  than disappearing into the dark chrome.
