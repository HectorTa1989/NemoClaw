---
name: nemoclaw-maintainer-triage
description: Builds a deterministic NemoClaw maintainer queue from open PRs and issues using gh-pr-merge-now as its data engine. Ranks highest-value actionable items, filters out blocked work, explains near misses, and updates the local state file. Use when deciding what to work on next, rebuilding the review queue, or ranking backlog burn-down work. Trigger keywords - triage queue, what next, next PR, backlog ranking, merge now, near miss, review queue.
user_invocable: true
---

# NemoClaw Maintainer Triage

Build a deterministic queue for `NVIDIA/NemoClaw`.

Priorities: (1) reduce PR backlog, (2) reduce security risk, (3) increase test coverage, (4) cool hot files.

## Step 1: Run the Triage Script

The deterministic triage pipeline is a script. Run it:

```bash
node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/triage.ts --approved-only
```

This calls `gh-pr-merge-now --json` under the hood, enriches top candidates with file-level risky-area detection, filters state file exclusions, and applies the scoring model. Output is JSON with `queue`, `nearMisses`, `hotClusters`, and `excludedReasonCounts`.

If `--approved-only` yields too few results, run without the flag:

```bash
node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/triage.ts
```

Pipe the output into the state file:

```bash
node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/triage.ts | node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/state.ts set-queue
```

## Step 2: Discover Security Items

Use `find-review-pr` to surface PRs with `security` + `priority: high` labels. Merge these into the candidate pool with elevated priority.

## Step 3: Review the Queue

The script already applied these weights:

| Weight | Condition |
|--------|-----------|
| +40 | merge-now, needs only maintainer review |
| +30 | near-miss with clear small fix path |
| +20 | security-sensitive and actionable |
| +15 | risky code with narrow test plan |
| +10 | hotspot relief, reduces conflict pressure |
| +5 | unusually old item |
| -100 | draft or non-trivial conflict |
| -80 | unresolved major CodeRabbit finding |
| -60 | broad red CI, no clear local fix |
| -40 | large semantic rewrite needed |
| -20 | blocked on external admin action |

Prefer PRs over issues. Only elevate issues when no actionable PR ranks above.

## Step 6: Output

### Action queue

| Rank | Type | Item | Why now | Next action |
|------|------|------|---------|-------------|
| 1 | PR | [#1234](https://github.com/NVIDIA/NemoClaw/pull/1234) | Green, waiting on maintainer | Run merge gate |

### Near misses

| Item | Why excluded | What would make it actionable |
|------|--------------|-------------------------------|
| [#999](https://github.com/NVIDIA/NemoClaw/pull/999) | Major CodeRabbit finding | Fix validation, rerun CI |

Always use full GitHub links.

## Step 7: Update State

Update `.nemoclaw-maintainer/state.json` with queue generation time, ranked items, near misses, hotspot clusters, and `topAction`.

## Notes

- This skill ranks work. Other maintainer skills execute it.
- Only block on CodeRabbit findings that affect correctness, safety, or mergeability.
- Fewer, better queue items over a noisy long list.
