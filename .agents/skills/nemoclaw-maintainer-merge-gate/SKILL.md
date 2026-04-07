---
name: nemoclaw-maintainer-merge-gate
description: Performs the final NemoClaw approval pass for a PR, enforcing green CI, no conflicts, no unresolved major CodeRabbit findings, and tests for touched risky code. Approves automatically when those gates pass, but never merges. Use when checking whether a PR is ready for maintainer approval. Trigger keywords - merge gate, ready to approve, final review, approval check, approve if ready.
user_invocable: true
---

# NemoClaw Maintainer Merge Gate

Run the last maintainer check before approval. Never merge automatically.

## Gates

A PR is approval-ready only when **all** pass:

1. **CI green** — all required checks in `statusCheckRollup`.
2. **No conflicts** — `mergeStateStatus` clean.
3. **No major CodeRabbit** — ignore style nits; block on correctness/security bugs.
4. **Risky code tested** — see [RISKY-AREAS.md](../nemoclaw-maintainer-loop/RISKY-AREAS.md). Confirm tests exist (added or pre-existing).

## Step 1: Run the Gate Checker

```bash
node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/check-gates.ts <pr-number>
```

This checks all 4 gates programmatically (CI via statusCheckRollup, conflicts via mergeStateStatus, CodeRabbit via GraphQL reviewThreads, risky-file test coverage) and returns structured JSON with `allPass` and per-gate `pass`/`details`.

## Step 2: Interpret Results

The script handles the deterministic checks. You handle judgment calls:

- **CI failing but narrow:** Route to `nemoclaw-maintainer-salvage-pr`.
- **Conflicts:** Route to salvage only when mechanical and small.
- **CodeRabbit:** Script flags unresolved major/critical threads. Review the `snippet` to confirm it's a real issue vs style nit. If doubt, leave unapproved.
- **Tests:** If `riskyCodeTested.pass` is false, route to `nemoclaw-maintainer-test-gaps`.

## Step 3: Approve or Report

**All pass:** Approve and summarize why.

**Any fail:**

| Gate | Status | What is needed |
|------|--------|----------------|
| CI | Failing | Fix flaky timeout test |

Use full GitHub links.

## Step 4: Update State

Record in `.nemoclaw-maintainer/state.json`: PR, approval given, blockers, which gate failed.
