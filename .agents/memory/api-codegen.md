---
name: OpenAPI codegen quirks
description: Typecheck pitfalls in the workspace Orval outputs.
---

Orval generates runtime Zod schemas and TypeScript model types into separate files, then the API Zod package re-exports them. An operation that combines path parameters with query parameters can produce the same exported `*Params` name in both files. Multipart `format: binary` schemas may also reference `Blob`; generated browser fetch code using `Headers.entries()` needs the `DOM.Iterable` library.

**Why:** These generator and TypeScript-library failures are not obvious from the API handler code and can make an otherwise valid OpenAPI change fail the workspace typecheck.

**How to apply:** After changing `lib/api-spec/openapi.yaml`, run API codegen and the root typecheck. If generated names collide, inspect the generated types and adjust the contract shape or exports before implementing handlers; ensure the generated packages have the required DOM libraries.
