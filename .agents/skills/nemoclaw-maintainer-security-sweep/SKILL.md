---
name: nemoclaw-maintainer-security-sweep
description: Triage and review security-sensitive NemoClaw PRs and issues, focusing on sandbox escape, installer trust, workflow enforcement, credential handling, SSRF, and policy bypasses. Uses find-review-pr for discovery and security-code-review for deep analysis, then decides salvage-now or blocked. Use when a PR is security-relevant or backlog reduction must not trade away safety. Trigger keywords - security sweep, security triage, risky PR, sandbox escape, credential leak, SSRF, policy bypass.
user_invocable: true
---

# NemoClaw Maintainer Security Sweep

Review a security-sensitive item before it enters the normal maintainer fast path.

## Step 1: Discover Security Items

Use `find-review-pr` to surface PRs with `security` + `priority: high` labels and detect duplicates. Also check the triage queue for PRs touching risky areas (see [RISKY-AREAS.md](../nemoclaw-maintainer-loop/RISKY-AREAS.md)).

## Step 2: Gather Context

Read the PR or issue, all comments, linked items, changed files, diff, current checks, and recent relevant `main` commits.

## Step 3: Classify Risk

Which bucket applies?

- **escape or policy bypass**
- **credential or secret exposure**
- **installer or release integrity**
- **workflow or governance bypass**
- **input validation or SSRF weakness**
- **test gap in risky code**

If none apply, route back to normal triage.

## Step 4: Deep Security Pass

Load `security-code-review` for the nine-category review whenever the item changes behavior in a security-sensitive area. Do not skip this step just because the diff is small.

## Step 5: Decide Action

### Salvage-now

All true: risk is understood, fix is small/local, required tests are clear, no unresolved design question. Route to `nemoclaw-maintainer-salvage-pr` and `nemoclaw-maintainer-test-gaps`.

### Blocked

Any true: fix changes core trust assumptions, review found real vulnerability needing redesign, PR adds risk without tests, reviewer disagreement. Summarize blocker clearly; do not approve.

## Step 6: Update State

Record in `.nemoclaw-maintainer/state.json`: item, security bucket, whether deep pass was done, salvage-now vs blocked, tests required.

## Notes

- Backlog reduction never outranks a credible security concern.
- No security-sensitive approvals without both deep review and tests.
- Use full GitHub links.
