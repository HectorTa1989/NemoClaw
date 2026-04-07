// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deterministic NemoClaw maintainer triage queue builder.
 *
 * Calls gh-pr-merge-now for baseline data, enriches top candidates with
 * file-level risky-area detection, applies scoring weights, filters
 * exclusions from the state file, and outputs a ranked JSON queue.
 *
 * Usage: node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-loop/scripts/triage.ts [--limit N] [--approved-only]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MergeNowItem {
  number: number;
  title: string;
  url: string;
  author: string;
  churn: number;
  changed_files: number;
  checks_green: boolean;
  coderabbit: { critical: number; major: number; minor: number };
  reasons: string[];
  merge_now: boolean;
  near_miss: boolean;
  updated_at: string;
  draft: boolean;
}

interface MergeNowOutput {
  repo: string;
  scanned: number;
  merge_now: MergeNowItem[];
  near_miss: MergeNowItem[];
  excluded: MergeNowItem[];
  excluded_reason_counts: Record<string, number>;
}

interface PrFiles {
  files: Array<{ path: string }>;
}

interface StateFile {
  excluded: {
    prs: Record<string, { reason: string; excludedAt: string }>;
    issues: Record<string, { reason: string; excludedAt: string }>;
  };
}

interface QueueItem {
  rank: number;
  number: number;
  url: string;
  title: string;
  author: string;
  score: number;
  bucket: "ready-now" | "salvage-now" | "blocked";
  reasons: string[];
  riskyFiles: string[];
  churn: number;
  changedFiles: number;
  nextAction: string;
}

interface HotCluster {
  path: string;
  openPrCount: number;
}

interface TriageOutput {
  generatedAt: string;
  repo: string;
  scanned: number;
  queue: QueueItem[];
  nearMisses: QueueItem[];
  hotClusters: HotCluster[];
  excludedReasonCounts: Record<string, number>;
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

function ghApi(path: string): unknown {
  const out = run("gh", ["api", path]);
  return out ? JSON.parse(out) : null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function runMergeNow(approvedOnly: boolean): MergeNowOutput | null {
  const args = ["--json"];
  if (approvedOnly) args.push("--approved-only");

  const out = run("gh-pr-merge-now", args);
  if (!out) return null;
  try {
    return JSON.parse(out) as MergeNowOutput;
  } catch {
    return null;
  }
}

function fetchPrFiles(repo: string, number: number): string[] {
  const data = ghApi(`repos/${repo}/pulls/${number}/files?per_page=100`) as
    | Array<{ filename: string }>
    | null;
  if (!Array.isArray(data)) return [];
  return data.map((f) => f.filename);
}

function loadState(): StateFile | null {
  const stateDir = resolve(".nemoclaw-maintainer");
  const statePath = resolve(stateDir, "state.json");
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as StateFile;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function scoreItem(
  item: MergeNowItem,
  riskyFiles: string[],
): { score: number; bucket: "ready-now" | "salvage-now" | "blocked"; nextAction: string } {
  let score = 0;
  let bucket: "ready-now" | "salvage-now" | "blocked" = "blocked";
  let nextAction = "review";

  if (item.merge_now) {
    score += 40;
    bucket = "ready-now";
    nextAction = "merge-gate";
  } else if (item.near_miss) {
    score += 30;
    bucket = "salvage-now";
    nextAction = "salvage-pr";
  }

  // Security / risky area bonus (only if actionable)
  if (riskyFiles.length > 0 && bucket !== "blocked") {
    score += 20;
    nextAction = bucket === "ready-now" ? "security-sweep → merge-gate" : "security-sweep → salvage-pr";
  }

  // Age bonus: +5 if updated > 7 days ago
  if (item.updated_at) {
    const age = Date.now() - new Date(item.updated_at).getTime();
    if (age > 7 * 24 * 60 * 60 * 1000) score += 5;
  }

  // Negative weights
  const reasons = new Set(item.reasons);
  if (item.draft) score -= 100;
  if (reasons.has("merge-conflict")) score -= 100;
  if (item.coderabbit.major > 0) score -= 80;
  if (item.coderabbit.critical > 0) score -= 80;
  if (reasons.has("failing-checks") && !item.near_miss) score -= 60;
  if (reasons.has("merge-blocked")) score -= 20;

  return { score, bucket, nextAction };
}

// ---------------------------------------------------------------------------
// Hotspot detection from PR file overlap
// ---------------------------------------------------------------------------

function detectHotClusters(
  items: MergeNowItem[],
  repo: string,
  fileCache: Map<number, string[]>,
): HotCluster[] {
  const fileCounts = new Map<string, number>();

  for (const item of items.slice(0, 30)) {
    let files = fileCache.get(item.number);
    if (!files) {
      files = fetchPrFiles(repo, item.number);
      fileCache.set(item.number, files);
    }
    const seen = new Set<string>();
    for (const f of files) {
      if (!seen.has(f)) {
        seen.add(f);
        fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
      }
    }
  }

  return [...fileCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([path, count]) => ({ path, openPrCount: count }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);
  const approvedOnly = args.includes("--approved-only");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 10;

  // 1. Run gh-pr-merge-now
  let data = runMergeNow(approvedOnly);
  if (!data && approvedOnly) {
    // Fallback to full scan
    data = runMergeNow(false);
  }
  if (!data) {
    console.error("Failed to run gh-pr-merge-now. Is it installed and on PATH?");
    process.exit(1);
  }

  // 2. Load exclusions
  const state = loadState();
  const excludedPrs = new Set(
    Object.keys(state?.excluded?.prs ?? {}).map(Number),
  );

  // 3. Merge all items and filter exclusions
  const allItems = [...data.merge_now, ...data.near_miss, ...data.excluded].filter(
    (item) => !excludedPrs.has(item.number),
  );

  // 4. Enrich top candidates with file data and scoring
  const fileCache = new Map<number, string[]>();
  const topCandidates = allItems
    .filter((item) => item.merge_now || item.near_miss)
    .slice(0, limit * 2);

  const scored: QueueItem[] = [];
  for (const item of topCandidates) {
    const files = fetchPrFiles(data.repo, item.number);
    fileCache.set(item.number, files);
    const riskyFiles = files.filter(isRiskyFile);
    const { score, bucket, nextAction } = scoreItem(item, riskyFiles);

    scored.push({
      rank: 0,
      number: item.number,
      url: item.url,
      title: item.title,
      author: item.author,
      score,
      bucket,
      reasons: item.reasons,
      riskyFiles,
      churn: item.churn,
      changedFiles: item.changed_files,
      nextAction,
    });
  }

  // 5. Sort and rank
  scored.sort((a, b) => b.score - a.score);
  const queue = scored.filter((s) => s.bucket === "ready-now").slice(0, limit);
  const nearMisses = scored.filter((s) => s.bucket === "salvage-now").slice(0, limit);
  queue.forEach((item, i) => (item.rank = i + 1));
  nearMisses.forEach((item, i) => (item.rank = i + 1));

  // 6. Detect hot clusters
  const hotClusters = detectHotClusters(allItems.slice(0, 30), data.repo, fileCache);

  // 7. Output
  const output: TriageOutput = {
    generatedAt: new Date().toISOString(),
    repo: data.repo,
    scanned: data.scanned,
    queue,
    nearMisses,
    hotClusters,
    excludedReasonCounts: data.excluded_reason_counts,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
