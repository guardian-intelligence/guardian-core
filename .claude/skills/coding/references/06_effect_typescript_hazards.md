# Effect TypeScript Hazards

```yaml
module_id: ETS-06
domain: hazards
inputs: [ChangeSetBundle]
outputs: [Finding[]]
```

## Hazard Catalog

This catalog documents compile-time and runtime hazards specific to Effect TypeScript in a NodeNext ESM environment. Each hazard has been encountered in this codebase.

---

### HAZ-001: Returning Instead of Yielding Errors

```yaml
id: HAZ-001
severity: BLOCKER
pattern: "return new TaggedError(...) without yield*"
symptom: "Effect succeeds with error object as the success value"
fix: "return yield* new TaggedError(...)"
```

```typescript
// HAZARD: succeeds with FooError as the return value
return new FooError({ message: 'broke' });

// CORRECT: fails the Effect with FooError
return yield* new FooError({ message: 'broke' });
```

---

### HAZ-002: Readonly Array Mismatch

```yaml
id: HAZ-002
severity: BLOCKER
pattern: "Function parameter typed as T[] receiving Schema-derived readonly T[]"
symptom: "TS2345: readonly T[] is not assignable to mutable T[]"
fix: "Change parameter to readonly T[]"
```

Effect Schema's `Schema.Array` produces `readonly` arrays. Every helper function that accepts arrays from Schema types must use `readonly` in parameters.

```typescript
// HAZARD: rejects Schema-derived arrays
function process(items: string[]): void { ... }

// CORRECT
function process(items: readonly string[]): void { ... }
```

---

### HAZ-003: LogLevel.fromLiteral Type Narrowing

```yaml
id: HAZ-003
severity: MAJOR
pattern: "LogLevel.fromLiteral(process.env.LOG_LEVEL)"
symptom: "TS2345: string not assignable to LogLevel literal union"
fix: "Cast with as Parameters<typeof LogLevel.fromLiteral>[0]"
```

```typescript
type LogLevelLiteral = Parameters<typeof LogLevel.fromLiteral>[0];
LogLevel.fromLiteral((process.env.LOG_LEVEL ?? 'Info') as LogLevelLiteral);
```

---

### HAZ-004: Forgetting yield* in Effect.gen

```yaml
id: HAZ-004
severity: BLOCKER
pattern: "const x = Effect.succeed(42) inside Effect.gen (no yield*)"
symptom: "x is Effect<number>, not number — silent type error or runtime surprise"
fix: "const x = yield* Effect.succeed(42)"
```

`yield*` is the load-bearing operator in `Effect.gen`. Without it, you get the Effect wrapper, not the unwrapped value.

---

### HAZ-005: Effect.try catch Throwing Instead of Returning

```yaml
id: HAZ-005
severity: BLOCKER
pattern: "catch: (err) => { throw new MyError(...) }"
symptom: "Unhandled exception — the catch function must RETURN the error"
fix: "catch: (err) => new MyError(...)"
```

`Effect.try`'s `catch` function is a mapper, not an error handler. It maps the caught exception to a typed error. The Effect runtime handles the failure propagation.

---

### HAZ-006: ESM Import Extension

```yaml
id: HAZ-006
severity: BLOCKER
pattern: "import { Foo } from './Foo' (missing .js extension)"
symptom: "ERR_MODULE_NOT_FOUND at runtime"
fix: "import { Foo } from './Foo.js'"
```

With `"module": "NodeNext"` and `"type": "module"`, all relative imports must use `.js` extensions, even for `.ts` source files.

---

### HAZ-007: Pino Logger as Record Type Cast

```yaml
id: HAZ-007
severity: MINOR
pattern: "pinoLogger as Record<string, (m: string) => void>"
symptom: "TS2352: conversion may be a mistake"
fix: "Cast through unknown: pinoLogger as unknown as Record<...>"
```

TypeScript's structural type checker won't allow direct casting between pino's Logger type and a plain Record. Double-cast through `unknown`.

---

### HAZ-008: @effect/vitest Peer Dependencies

```yaml
id: HAZ-008
severity: MAJOR
pattern: "Mismatched effect/vitest versions with @effect/vitest"
symptom: "bun install fails due to peer dependency mismatch"
fix: "Check bunx npm info @effect/vitest peerDependencies"
```

`@effect/vitest` has strict peer dependency requirements:
- `@effect/vitest@0.27.0` requires `effect@^3.19.0` and `vitest@^3.2.0`
- Always check peer deps before version bumps.

---

### HAZ-009: ESM Module Mocking in Vitest

```yaml
id: HAZ-009
severity: MAJOR
pattern: "vi.mock('fs') only mocking named exports"
symptom: "Default import (import fs from 'fs') uses real implementation"
fix: "Mock both default and named exports"
```

```typescript
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    default: { ...actual, readFileSync: vi.fn() },
    readFileSync: vi.fn(),
  };
});
```

ESM uses both `import fs from 'fs'` (default) and `import { readFileSync } from 'fs'` (named). Both paths must be mocked.

---

### HAZ-010: Effect.runSync on Async Effects

```yaml
id: HAZ-010
severity: BLOCKER
pattern: "Effect.runSync(effectContainingTryPromise)"
symptom: "AsyncFiberException: cannot run async effect synchronously"
fix: "Use Effect.runPromise for async effects, Effect.runSync only for sync"
```

If any part of the Effect pipeline uses `Effect.tryPromise`, `Effect.async`, or `Effect.sleep`, it cannot be run with `Effect.runSync`. Use `Effect.runPromise` instead.
