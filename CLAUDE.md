# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Vue 3 application built with Vite and TypeScript. It includes:
- Vue 3 with Composition API
- Pinia for state management
- Vue Router for routing
- Vitepress for documentation site
- Vitest for unit testing with jsdom environment
- ESLint and Prettier for code quality

## Development Commands

### Core Development
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Type check only
npm run type-check

# Build for production (runs type-check and build in parallel)
npm run build

# Build only (without type checking)
npm run build-only

# Preview production build
npm run preview
```

### Testing
```bash
# Run unit tests with Vitest
npm run test:unit

# Run tests in watch mode
npm run test:unit -- --watch

# Run specific test file
npm run test:unit -- src/path/to/test.spec.ts
```

### Code Quality
```bash
# Lint and auto-fix
npm run lint

# Format with Prettier
npm run format
```

### Documentation (Vitepress)
```bash
# Start documentation dev server
npm run docs:dev

# Build documentation
npm run docs:build

# Preview built documentation
npm run docs:preview
```

## Architecture

### Project Structure
```
src/
├── assets/         # Static assets (images, fonts, etc.)
├── components/     # Reusable Vue components
├── views/          # Page-level components
├── router/         # Vue Router configuration
├── stores/         # Pinia stores for state management
└── main.ts         # Application entry point

docs/               # Vitepress documentation site
├── .vitepress/     # Vitepress configuration
├── code/           # Code-related documentation
├── daily/          # Daily notes
├── guide/          # Guides
├── life/           # Life-related content
├── model/          # AI model documentation
├── note/           # Notes
├── os/             # Operating system topics
├── tool/           # Tools documentation
└── index.md        # Documentation homepage
```

### Key Configuration Files
- `vite.config.ts` - Vite configuration with Vue plugin and `@` alias to `src/`
- `vitest.config.ts` - Vitest configuration extending Vite config, uses jsdom environment
- `eslint.config.ts` - ESLint configuration with Vue, TypeScript, and Vitest plugins
- `tsconfig.json` - TypeScript project references (app, node, vitest configs)
- `.prettierrc.json` - Prettier formatting rules

### Build System
- Uses `npm-run-all2` for parallel execution of type checking and build
- Type checking via `vue-tsc` (required for `.vue` file type checking)
- Production build outputs to `dist/` directory

### Testing Setup
- Unit tests use Vitest with jsdom environment
- Test files should be placed in `src/**/__tests__/` directories
- `@vue/test-utils` for Vue component testing
- Test configuration excludes `e2e/` directory

### Documentation
- Separate Vitepress site in `docs/` directory
- Documentation can be developed and built independently
- Uses the same Vue/TypeScript tooling as main application