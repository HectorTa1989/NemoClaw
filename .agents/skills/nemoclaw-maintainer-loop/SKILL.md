---
name: nemoclaw-maintainer-loop
description: Orchestrates a continuous NemoClaw maintenance loop - rebuilds the queue via gh-pr-merge-now, picks the highest-value actionable item, delegates to focused maintainer skills, approves when gates pass, and surfaces only blockers needing a human decision. Designed for /loop (e.g. /loop 10m /nemoclaw-maintainer-loop). Trigger keywords - maintainer loop, backlog sweep, burn down PRs, what next, continuous maintenance, next best item, triage queue.
user_invocable: true
---

# NemoClaw Maintainer Loop

Run one bounded maintenance pass for `NVIDIA/NemoClaw`.

Priorities: (1) reduce PR backlog, (2) reduce security risk, (3) increase test coverage, (4) cool hot files.

**Autonomy:** push small fixes and approve when gates pass. Never merge. Stop and ask for merge decisions, architecture decisions, and unclear contributor intent.

## State and References

- State schema: [STATE-SCHEMA.md](STATE-SCHEMA.md)
- Risky code areas: [RISKY-AREAS.md](RISKY-AREAS.md)

If `.nemoclaw-maintainer/state.json` does not exist, create it from the schema. Ensure `.nemoclaw-maintainer` is in `.git/info/exclude`.

## Step 1: Refresh

```bash
git fetch origin --prune
```

## Step 2: Rebuild Queue

Load `nemoclaw-maintainer-triage`. It calls `gh-pr-merge-now --json` for baseline data, enriches top candidates, and updates state.

## Step 3: Pick One Action

1. **Ready-now PR** — green CI, no conflicts, no major CodeRabbit, has tests → `nemoclaw-maintainer-merge-gate`
2. **Salvage-now PR** — close to ready, needs small fix → `nemoclaw-maintainer-salvage-pr`
3. **Security item** — touches policy, sandboxing, credentials, SSRF → `nemoclaw-maintainer-security-sweep`
4. **Test-gap item** — risky churn with weak tests → `nemoclaw-maintainer-test-gaps`
5. **Hotspot cooling** — repeated conflicts in one area → `nemoclaw-maintainer-hotspots`
6. **Sequencing** — no safe fix to land now → `nemoclaw-maintainer-sequence-work`

Prefer finishing one almost-ready contribution over starting a new refactor.

## Step 4: Execute

Delegate to the chosen skill. A good pass ends with one of:

- a PR approved, a fix pushed, a test gap closed, a hotspot mitigated, or a blocker list for the user.

Before approving, all gates must pass (see `nemoclaw-maintainer-merge-gate`).

## Step 5: Update State

Update `.nemoclaw-maintainer/state.json`: `updatedAt`, queue summary, hotspots, `activeWork`, and a short history entry.

## Commit Hygiene

The prek "Regenerate agent skills from docs" hook auto-stages `.agents/skills/` files. Before every `git add` and `git commit` on a PR branch, run `git reset HEAD .agents/skills/nemoclaw-maintainer-*` to unstage them. Only commit skill files in dedicated skill PRs.

## Stop and Ask When

- Broad refactor or architecture decision needed
- Contributor intent unclear and diff would change semantics
- Multiple subsystems must change for CI
- Sensitive security boundaries with unclear risk
- Next step is opening a new PR or merging

## /loop Integration

Designed for `/loop 10m /nemoclaw-maintainer-loop`. Each pass should produce compact output: what was done, what changed, what needs the user. Check `state.json` history to avoid re-explaining prior context on repeat runs.
