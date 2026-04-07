// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deterministic hotspot detection for NemoClaw.
 *
 * Combines 30-day git churn on main with open PR file overlap to rank
 * the files causing the most merge pain. Outputs structured JSON.
 *
 * Usage: node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/hotspots.ts [--days N] [--repo OWNER/REPO]
 */

import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hotspot {
  path: string;
  mainTouchCount: number;
  openPrCount: number;
  combinedScore: number;
  isRisky: boolean;
}

interface HotspotOutput {
  generatedAt: string;
  repo: string;
  days: number;
  hotspots: Hotspot[];
}

// ---------------------------------------------------------------------------
// Risky area patterns
// ---------------------------------------------------------------------------

const RISKY_PATTERNS: RegExp[] = [
  /^install\.sh$/,
  /^setup\.sh$/,
  /^brev-setup\.sh$/,
  /^scripts\/.*\.sh$/,
  /^bin\/lib\/onboard\.js$/,
  /^bin\/.*\.js$/,
  /^nemoclaw\/src\/blueprint\//,
  /^nemoclaw-blueprint\//,
  /^\.github\/workflows\//,
  /\.prek\./,
  /policy/i,
  /ssrf/i,
  /credential/i,
  /inference/i,
];

function isRiskyFile(path: string): boolean {
  return RISKY_PATTERNS.some((re) => re.test(path));
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf-8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

function gitChurn(days: number): Map<string, number> {
  const out = run("git", [
    "log",
    `--since=${days} days ago`,
    "--name-only",
    "--format=",
    "origin/main",
  ]);

  const counts = new Map<string, number>();
  if (!out) return counts;

  for (const line of out.split("\n")) {
    const path = line.trim();
    if (path) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

function openPrFileOverlap(repo: string): Map<string, number> {
  // Get open PR numbers
  const prListOut = run("gh", [
    "pr", "list",
    "--repo", repo,
    "--state", "open",
    "--limit", "200",
    "--json", "number",
  ]);

  const counts = new Map<string, number>();
  if (!prListOut) return counts;

  let prs: Array<{ number: number }>;
  try {
    prs = JSON.parse(prListOut);
  } catch {
    return counts;
  }

  // Sample up to 50 PRs for file data (API rate limit friendly)
  const sample = prs.slice(0, 50);
  for (const pr of sample) {
    const filesOut = run("gh", [
      "pr", "view", String(pr.number),
      "--repo", repo,
      "--json", "files",
    ]);
    if (!filesOut) continue;

    let data: { files?: Array<{ path: string }> };
    try {
      data = JSON.parse(filesOut);
    } catch {
      continue;
    }

    const seen = new Set<string>();
    for (const f of data.files ?? []) {
      if (!seen.has(f.path)) {
        seen.add(f.path);
        counts.set(f.path, (counts.get(f.path) ?? 0) + 1);
      }
    }
  }

  return counts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const daysIdx = args.indexOf("--days");
  const days = daysIdx >= 0 ? parseInt(args[daysIdx + 1], 10) : 30;
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : "NVIDIA/NemoClaw";

  process.stderr.write("Collecting git churn...\n");
  const churn = gitChurn(days);

  process.stderr.write("Collecting open PR file overlap...\n");
  const prOverlap = openPrFileOverlap(repo);

  // Merge signals
  const allPaths = new Set([...churn.keys(), ...prOverlap.keys()]);
  const hotspots: Hotspot[] = [];

  for (const path of allPaths) {
    const mainTouchCount = churn.get(path) ?? 0;
    const openPrCount = prOverlap.get(path) ?? 0;

    // Only include files with meaningful signal
    if (mainTouchCount < 2 && openPrCount < 2) continue;

    const risky = isRiskyFile(path);
    // Score: main churn weight 1x, PR overlap 3x (conflict proxy), risky 2x bonus
    const combinedScore =
      mainTouchCount + openPrCount * 3 + (risky ? (mainTouchCount + openPrCount) * 2 : 0);

    hotspots.push({
      path,
      mainTouchCount,
      openPrCount,
      combinedScore,
      isRisky: risky,
    });
  }

  hotspots.sort((a, b) => b.combinedScore - a.combinedScore);

  const output: HotspotOutput = {
    generatedAt: new Date().toISOString(),
    repo,
    days,
    hotspots: hotspots.slice(0, 25),
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
