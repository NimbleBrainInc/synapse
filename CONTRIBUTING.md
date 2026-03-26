# Contributing to Synapse

Thanks for your interest in contributing to Synapse! This document covers the basics.

## Development Setup

```bash
git clone https://github.com/NimbleBrainInc/synapse.git
cd synapse
npm install
npm run build
npm test
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build with tsup (ESM + CJS + IIFE) |
| `npm test` | Run tests with vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check with tsc |

## Pull Requests

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Ensure `npm run build && npm test && npm run typecheck` all pass
4. Open a PR with a clear description of what changed and why

## Code Style

- TypeScript strict mode
- No default exports
- Tests live in `src/__tests__/` mirroring the source structure

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
