# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - Unreleased

### Added

- `createSynapse()` — framework-agnostic core with typed tool calls, data sync, theme tracking, and keyboard forwarding
- `createStore()` — reactive state store with optional persistence and agent visibility
- React bindings (`@nimblebrain/synapse/react`): `SynapseProvider`, `useSynapse`, `useCallTool`, `useDataSync`, `useTheme`, `useAction`, `useChat`, `useVisibleState`, `useStore`
- Vite plugin (`@nimblebrain/synapse/vite`): dev server CORS, HMR for sandboxed iframes, runtime injection
- Code generation CLI (`@nimblebrain/synapse/codegen`): generate TypeScript types from manifests, running servers, or schema directories
- IIFE build (`synapse-runtime.iife.js`) for iframe injection without a bundler
