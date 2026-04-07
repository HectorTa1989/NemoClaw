---
name: nemoclaw-maintainer-salvage-pr
description: Rescues a near-mergeable NemoClaw PR by gathering full context, landing the smallest safe fix set, adding focused tests for touched risky code, pushing updates, and routing through the merge gate. Use when a contributor PR is close but blocked on CI, a small review fix, or a narrow conflict. Trigger keywords - rescue PR, salvage PR, fix contributor PR, make CI green, push maintainer fix, unblock PR.
user_invocable: true
---

# NemoClaw Maintainer PR Salvage

Take one near-mergeable PR and make the smallest safe change to unblock it.

## Step 1: Gather Context

```bash
gh pr view <number> --repo NVIDIA/NemoClaw \
  --json number,title,url,body,baseRefName,headRefName,author,files,commits,comments,reviews,statusCheckRollup,mergeStateStatus,reviewDecision

gh pr diff <number> --repo NVIDIA/NemoClaw
```

Also read: maintainer and CodeRabbit comments, linked issues, recent `main` changes in touched files. Understand the PR's purpose before coding.

## Step 2: Assess Fit

**Good candidates:** one or two failing checks with obvious fix, missing test for risky path, mechanical conflict, small correctness fix from review, narrow gate cleanup.

**Stop and ask:** design change needed, large refactor, multiple subsystems, unclear intent, non-obvious security risk.

## Step 3: Check Out and Reproduce

```bash
gh pr checkout <number>
git fetch origin --prune
```

Reproduce locally. Run narrowest relevant commands first.

## Step 4: Review PR Scope Before Fixing

Before fixing, review **all** changed files in the PR — not just the ones causing failures. Flag any files that expand the PR's scope unnecessarily (config changes, unrelated refactors, tool settings). Revert those to `main` if they aren't needed for the feature to work.

## Step 5: Fix Narrowly

Smallest change that clears the blocker. No opportunistic reformatting.

If risky code is touched (see [RISKY-AREAS.md](../nemoclaw-maintainer-loop/RISKY-AREAS.md)), treat missing tests as part of the fix — load `nemoclaw-maintainer-test-gaps` when needed.

## Step 5: Conflicts

Resolve only mechanical conflicts (import ordering, adjacent additions, branch drift). Stop and summarize if the conflict changes behavior.

## Step 6: Validate

```bash
npm test                          # root integration tests
cd nemoclaw && npm test           # plugin tests
npm run typecheck:cli             # CLI type check
make check                        # all linters
```

Use only commands matching the changed area.

## Step 7: Push

Push when: fix is small, improves mergeability, validation passed, you have push permission. Never force-push. If you cannot push, prepare a comment describing the fix.

**Fork PRs:** Most PRs come from contributor forks. Check where to push:

```bash
gh pr view <number> --repo NVIDIA/NemoClaw --json headRepositoryOwner,headRepository,headRefName,maintainerCanModify
```

If `maintainerCanModify` is true, push directly to the fork:

```bash
git push git@github.com:<owner>/<repo>.git <local-branch>:<headRefName>
```

Do **not** push to `origin` — that creates a separate branch on NVIDIA/NemoClaw that won't appear in the PR.

## Step 8: Route to Merge Gate

If PR looks ready, load `nemoclaw-maintainer-merge-gate`.

## Step 9: Update State

Record in `.nemoclaw-maintainer/state.json`: PR URL, blocker fixed, tests added/run, push status, advancement to merge gate.

## Notes

- Goal is safe backlog reduction, not finishing the PR at any cost.
- Never hide unresolved reviewer concerns.
- Use full GitHub links.
