---
name: Railway Node ESM imports
description: Import rules for the Railway server runtime.
---

Railway runs the server entrypoint with Node's ESM loader. Server-side local imports must use resolvable file extensions, and server code should not import browser/Vite service modules that depend on extensionless imports.

**Why:** Railway's runtime parsed the TypeScript entrypoint but crashed while resolving an extensionless Firebase import pulled in indirectly from the browser license service. The application repeatedly restarted even though the type check and Vite build passed.

**How to apply:** Keep shared constants in side-effect-free modules that both browser and server can safely import. Review transitive local imports from the server entrypoint and verify the production start path, not only Vite or TypeScript checks.
