---
name: nemoclaw-maintainer-hotspots
description: Detects NemoClaw hot files and subsystems, ranks by churn, conflict pressure, risk, and missing tests, then proposes or lands small cooling changes that reduce future merge pain. Use when the same files keep conflicting, review velocity is collapsing, or you need to reduce maintainer load. Trigger keywords - hotspot, hot file, cool down conflicts, churn, repeated conflicts, conflict pressure.
user_invocable: true
---

# NemoClaw Maintainer Hotspots

Find files hurting throughput and reduce their future blast radius.

## Step 1: Run the Hotspot Script

```bash
node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/hotspots.ts
```

This combines 30-day git churn on `main` with open PR file overlap, flags risky areas, and outputs a ranked JSON list. Each entry has `path`, `mainTouchCount`, `openPrCount`, `combinedScore`, and `isRisky`.

Pipe into state:

```bash
node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/hotspots.ts | node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/state.ts set-hotspots
```

## Step 2: Prioritize

Review the ranked output. Most urgent: high `combinedScore` + `isRisky: true` + weak tests.

## Step 3: Choose Cooling Strategy

Smallest change to reduce future collisions:

- extract stable logic from giant file into tested helper
- split parsing from execution
- add regression tests around repeated breakage
- deduplicate workflow logic
- narrow interfaces with typed helpers

Prefer changes that also improve testability.

## Step 4: Keep Small

One file cluster per pass. Examples: extract one helper from `bin/lib/onboard.js`, add installer flag-parsing tests, deduplicate one workflow block, isolate one policy routine.

Stop if next step is large redesign → route to `nemoclaw-maintainer-sequence-work`.

## Step 5: Validate

Run relevant tests. If risky code, also load `nemoclaw-maintainer-test-gaps`.

## Step 6: Update State

Record in `.nemoclaw-maintainer/state.json`: hottest files, why hot, mitigation tried, whether landed/queued/needs PR.

## Step 7: Output

One of: small cooling change made and validated, prioritized hotspot table with next slices, or reason the hotspot needs larger sequencing.

Use full GitHub links.

## Notes

- Goal is lower future merge pain, not aesthetic cleanup.
- No giant refactors inside contributor PRs.
