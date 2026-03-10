# AGENTS.md

This file provides guidance to AI coding agents working in this repository.

## Project Overview

A Vue 3 + TypeScript application with Vite, Pinia, Vue Router, and Vitepress documentation.

- **Framework**: Vue 3 with Composition API (`<script setup lang="ts">`)
- **State Management**: Pinia (Composition API style with `defineStore`)
- **Router**: Vue Router with history mode
- **Docs**: Vitepress in `docs/` directory
- **Testing**: Vitest with jsdom environment
- **Node**: ^20.19.0 || >=22.12.0

## Commands

### Development

```bash
# Start dev server
npm run dev

# Type check
npm run type-check

# Build (runs type-check + build in parallel)
npm run build

# Build only (skip type check)
npm run build-only

# Preview production build
npm run preview
```

### Testing

```bash
# Run all unit tests
npm run test:unit

# Run tests in watch mode
npm run test:unit -- --watch

# Run a single test file
npm run test:unit -- src/components/__tests__/HelloWorld.spec.ts

# Run tests matching a pattern
npm run test:unit -- -t "test name pattern"
```

### Code Quality

```bash
# Lint and auto-fix all files
npm run lint

# Format with Prettier
npm run format
```

### Documentation

```bash
# Start docs dev server
npm run docs:dev

# Build docs
npm run docs:build

# Preview built docs
npm run docs:preview
```

## Project Structure

```
src/
├── assets/           # Static assets, global CSS
├── components/       # Reusable Vue components
│   ├── __tests__/    # Component tests
│   └── icons/        # Icon components
├── views/            # Page-level route components
├── router/           # Vue Router config
├── stores/           # Pinia stores
└── main.ts           # App entry point

docs/                 # Vitepress documentation
├── .vitepress/       # Vitepress config
├── code/             # Code docs
├── daily/            # Daily notes
├── guide/            # Guides
├── life/             # Life content
├── model/            # AI model docs
├── note/             # Notes
├── os/               # OS topics
└── tool/             # Tool docs
```

## Code Style Guidelines

### TypeScript

- **Target**: ESNext with strict mode enabled
- **Imports**: Use `@/` alias for src imports (e.g., `import Component from '@/components/Component.vue'`)
- **Types**: Explicit return types on exported functions, implicit within components
- **Enums**: Use const assertions or union types instead of traditional enums

### Vue Components

- Always use `<script setup lang="ts">` (Composition API)
- Define props with TypeScript interfaces: `defineProps<{ msg: string }>()`
- Single quotes in templates
- Use scoped styles: `<style scoped>`
- Component names: PascalCase (e.g., `HelloWorld.vue`)

### Formatting (Prettier)

- No semicolons
- Single quotes
- Print width: 100 characters
- Run `npm run format` before committing

### Naming Conventions

- **Components**: PascalCase (e.g., `HelloWorld.vue`)
- **Stores**: camelCase with `use` prefix (e.g., `useCounterStore`)
- **Files**: PascalCase for components, camelCase for utilities
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE for true constants

### Imports Order

1. Node.js built-ins (e.g., `node:url`, `node:path`)
2. External libraries (e.g., `vue`, `pinia`)
3. Internal aliases (e.g., `@/components`, `@/stores`)
4. Relative imports (e.g., `../components/Component.vue`)
5. Type-only imports last

### State Management (Pinia)

- Use Composition API style with `defineStore`
- Store names in camelCase
- Return reactive refs/computeds from store
- Example:

```typescript
export const useCounterStore = defineStore('counter', () => {
  const count = ref(0)
  const doubleCount = computed(() => count.value * 2)
  function increment() {
    count.value++
  }
  return { count, doubleCount, increment }
})
```

### Error Handling

- Prefer early returns over nested if statements
- Use optional chaining (`?.`) and nullish coalescing (`??`)
- For async operations, use try/catch in composables or components

### Testing

- Place tests in `src/**/__tests__/` directories
- Use Vitest with `@vue/test-utils`
- Test files: `*.spec.ts`
- Import from `vitest` explicitly: `import { describe, it, expect } from 'vitest'`

### Router

- Use lazy loading for route components: `() => import('../views/View.vue')`
- Route names in lowercase
- Use `import.meta.env.BASE_URL` for base URL

### CSS

- Use scoped styles in components
- Class naming: kebab-case (e.g., `.my-class`)
- Prefer CSS custom properties for theming

### Git

- No need to manually commit - only commit when explicitly asked
- Run `npm run lint` and `npm run type-check` before finalizing changes

## Key Configuration

- **Vite**: `vite.config.ts` - Vue plugin, `@` alias to `src/`
- **TypeScript**: `tsconfig.app.json` - Strict mode, paths config
- **ESLint**: `eslint.config.ts` - Vue essential, TypeScript recommended, Vitest
- **Prettier**: `.prettierrc.json` - No semis, single quotes, 100 width
- **Vitest**: `vitest.config.ts` - jsdom environment, excludes `e2e/`
