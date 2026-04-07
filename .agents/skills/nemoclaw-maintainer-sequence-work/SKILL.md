---
name: nemoclaw-maintainer-sequence-work
description: Breaks a NemoClaw issue, umbrella effort, or backlog cluster into mergeable PR-sized slices with explicit dependencies, tests, and blocker handling. Use when a fix is too large for one pass, an umbrella issue needs a realistic implementation order, or you need the next few high-value slices. Trigger keywords - sequence work, break down issue, plan PR stack, umbrella issue, roadmap slice, what should land first.
user_invocable: true
---

# NemoClaw Maintainer Sequence Work

Turn a large problem into a short sequence of mergeable slices.

## Step 1: Read the Full Problem Surface

Read greedily: issue body and comments, linked issues, linked PRs with review comments and status, touched code/tests/docs, recent `main` changes if the area is active.

Do not sequence work from the title alone.

## Step 2: Identify What Is Moving

Inventory overlapping open PRs and recently merged changes. For each: blocker that must land first? Dependency to build on? Conflict to avoid? Noise?

## Step 3: Define Slices

Each slice should have: one core objective, short file list, explicit tests, merge dependency list, stop condition.

Prefer substrate-first sequencing:

1. Extract stable helper or type boundary
2. Add regression tests for current behavior
3. Land behavioral fix or refactor on top
4. Remove duplication afterward

## Step 4: Rank

Use repo priorities: (1) backlog reduction, (2) security, (3) test coverage, (4) hotspot cooling.

A slice that unblocks several PRs moves up. An elegant but non-urgent slice moves down.

## Step 5: Output

| Order | Slice | Why now | Depends on | Tests |
|-------|-------|---------|------------|-------|
| 1 | Extract timeout parsing from onboard | Enables safe tests, reduces conflicts | None | Unit tests for invalid env values |

Also include: outstanding blockers, which slices are safe for the maintainer loop, where human design decisions are needed.

## Step 6: Update State

Write sequence into `.nemoclaw-maintainer/state.json`: target issue, slice order, blockers, delta since last pass.

## Notes

- Every slice maps to real files, tests, and merge behavior — not abstract architecture.
- Prefer small serially mergeable changes over one ambitious cleanup branch.
