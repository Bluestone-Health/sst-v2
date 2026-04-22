---
title: feat: Reduce NextjsSite Lambda bundle size with post-build cleanup
type: feat
status: active
date: 2026-04-21
issue: https://github.com/Bluestone-Health/bluestone-scheduler/issues/578
---

# feat: Reduce NextjsSite Lambda bundle size with post-build cleanup

## Overview

Issue #578 reports oversized `NextjsSite` Lambda artifacts in pnpm monorepos because Next.js/OpenNext tracing pulls build-time dependencies into `.open-next/server-functions/*/node_modules/.pnpm`. The target outcome is smaller server bundles and improved cold starts without breaking runtime behavior.

## Problem Statement

Observed in production (from #578):

- Unzipped server bundle size is about `104MB`
- Build-time deps included at runtime (examples): `typescript`, `@esbuild`, `webpack`, `terser`
- Impact: slower cold starts
- Impact: larger deploy artifacts
- Impact: higher risk of hitting Lambda `250MB` unzipped limit

## Scope and Decisions

1. Implement **Option C** from the issue: built-in cleanup + optional user hook.
2. Keep initial implementation scoped to `NextjsSite` (do not generalize to all `SsrSite` constructs in v1 of this fix).
3. Default cleanup behavior is enabled, with explicit opt-out.
4. Include OpenNext default version bump as a separate, reviewable change in the same PR if compatibility checks pass.

## Code Touchpoints

- `packages/sst/src/constructs/NextjsSite.ts`: add props, default package list, cleanup routine, hook execution
- `packages/sst/src/constructs/SsrSite.ts`: no changes in v1 unless implementation review identifies a required shared hook
- `packages/sst/test/constructs/NextjsSite.test.ts`: add construct-level cleanup/hook tests
- `packages/sst/CHANGELOG.md`: add changelog entry
- `.changeset/*`: add release note for new `NextjsSite` options

## Proposed API

```ts
interface NextjsSiteProps {
  // existing props...

  /**
   * Remove matched package folders from .open-next server-function bundles.
   * Set to false to disable automatic cleanup.
   * @default ["typescript", "@esbuild", "esbuild", "webpack", "webpack-sources", "terser", "terser-webpack-plugin", "@babel", "tailwindcss", "@tailwindcss"]
   */
  bundleCleanup?: string[] | false;

  /**
   * Runs after OpenNext build and SST cleanup, before CDK assets are created.
   */
  afterBuild?: (input: {
    sitePath: string;
    openNextPath: string;
    removedPackages: string[];
    bytesRemoved: number;
  }) => void;
}
```

## Implementation Phases

### Phase 1: Baseline and API Wiring

- [ ] Add `bundleCleanup` and `afterBuild` to `NextjsSiteProps`
- [ ] Define `DEFAULT_BUNDLE_CLEANUP_PACKAGES`
- [ ] Keep `bundleCleanup: false` as hard opt-out
- [ ] Keep `afterBuild` synchronous (constructor/build flow is synchronous today)

### Phase 2: Bundle Cleanup Engine

- [ ] Add internal method in `NextjsSite` to scan `.open-next/server-functions/*/node_modules/.pnpm/`
- [ ] Add optional fallback scan for `.open-next/server-function/node_modules/.pnpm/`
- [ ] Remove package folders matching configured prefixes (`pkg@`, `@scope+pkg@` patterns)
- [ ] Compute and track `removedPackages` and `bytesRemoved`
- [ ] Log cleanup summary with `Logger.debug`
- [ ] Run cleanup before `validatePlan(...)` so generated Lambda assets use cleaned output

### Phase 3: Hook Execution

- [ ] Execute `afterBuild` after cleanup and before plan finalization
- [ ] Pass `sitePath`, `openNextPath`, `removedPackages`, `bytesRemoved`
- [ ] Wrap user hook errors in a clear construct-scoped message (fail fast)

### Phase 4: OpenNext Version Update (Optional but Recommended)

- [ ] Validate compatibility of bumping `DEFAULT_OPEN_NEXT_VERSION` from `3.5.5`
- [ ] As of `2026-04-21`, npm latest is `@opennextjs/aws@3.10.2`
- [ ] If bump is accepted, update default and add test/docs note

### Phase 5: Tests

Add tests in `packages/sst/test/constructs/NextjsSite.test.ts`:

- [ ] Default cleanup removes known dev packages from synthetic `.pnpm` folder
- [ ] `bundleCleanup: false` keeps packages intact
- [ ] Custom `bundleCleanup` list only removes configured packages
- [ ] `afterBuild` hook is called with expected payload
- [ ] Cleanup no-ops when `.open-next/server-functions` path is missing

### Phase 6: Documentation and Release

- [ ] Add JSDoc for new props in `NextjsSite.ts`
- [ ] Add `.changeset` entry
- [ ] Update `packages/sst/CHANGELOG.md`

## Verification Plan

### Local verification

- `pnpm --filter sst test -- test/constructs/NextjsSite.test.ts`
- `pnpm --filter sst test`

### Real-world validation (issue reproduction)

- Deploy issue repro app before/after patch with same commit and infra settings
- Compare server bundle sizes using `du -hs .open-next/server-functions/*/node_modules/.pnpm/* | sort -rh`
- Compare CloudWatch cold-start metrics (`Init Duration` p50/p95/p99)

## Acceptance Criteria

- [ ] `NextjsSite` removes default dev/build dependencies from `.open-next` server bundles
- [ ] Cleanup is configurable via `bundleCleanup`
- [ ] Cleanup can be fully disabled with `bundleCleanup: false`
- [ ] `afterBuild` hook is available and receives cleanup summary
- [ ] Construct tests cover default, opt-out, custom list, and hook behavior
- [ ] No regressions in existing `NextjsSite` construct tests

## Risks and Mitigations

- Risk: Removing a package that is unexpectedly required at runtime.
- Mitigation: conservative default list, opt-out switch, and custom override list.

- Risk: OpenNext output structure changes in future releases.
- Mitigation: tolerate missing paths and support both singular/plural server-function folder shapes.

- Risk: Hook misuse causing non-deterministic builds.
- Mitigation: explicit hook contract and fail-fast error reporting.

## References

- Issue: https://github.com/Bluestone-Health/bluestone-scheduler/issues/578
- Current default OpenNext version: `packages/sst/src/constructs/NextjsSite.ts`
- Build flow location: `packages/sst/src/constructs/SsrSite.ts`
- OpenNext bundle-size guidance: https://opennext.js.org/aws/v2/common_issues/bundle_size
