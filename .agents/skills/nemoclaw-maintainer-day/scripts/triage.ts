// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Deterministic NemoClaw maintainer triage queue builder.
 *
 * Lists open PRs via gh, classifies them as merge-ready / near-miss / blocked,
 * enriches top candidates with file-level risky-area detection, applies
 * scoring weights, filters exclusions from the state file, and outputs
 * a ranked JSON queue.
 *
 * Usage: node --experimental-strip-types --no-warnings .agents/skills/nemoclaw-maintainer-day/scripts/triage.ts [--limit N] [--approved-only]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  isRiskyFile,
  run,
  SCORE_MERGE_NOW,
  SCORE_NEAR_MISS,
  SCORE_SECURITY_ACTIONABLE,
  SCORE_STALE_AGE,
  PENALTY_DRAFT_OR_CONFLICT,
  PENALTY_CODERABBIT_MAJOR,
  PENALTY_BROAD_CI_RED,
  PENALTY_MERGE_BLOCKED,
} from "./shared.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PrData {
  number: number;
  title: string;
  url: string;
  author: { login: string };
  additions: number;
  deletions: number;
  changedFiles: number;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergeStateStatus: string;
  reviewDecision: string;
  labels: Array<{ name: string }>;
  statusCheckRollup: Array<{
    name: string;
    status: string;
    conclusion: string;
  }>;
}

interface ClassifiedPr {
  number: number;
  title: string;
  url: string;
  author: string;
  churn: number;
  changedFiles: number;
  checksGreen: boolean;
  coderabbitMajor: boolean;
  reasons: string[];
  mergeNow: boolean;
  nearMiss: boolean;
  updatedAt: string;
  createdAt: string;
  draft: boolean;
  labels: string[];
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
  ageHours: number;
  labels: string[];
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
}

interface StateFile {
  excluded: {
    prs: Record<string, { reason: string; excludedAt: string }>;
    issues: Record<string, { reason: string; excludedAt: string }>;
  };
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function ghApi(path: string): unknown {
  const out = run("gh", ["api", path]);
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

function fetchOpenPrs(repo: string, approvedOnly: boolean): PrData[] {
  // Fetch basic PR data first (lightweight — no statusCheckRollup)
  const basicFields = [
    "number", "title", "url", "author", "additions", "deletions",
    "changedFiles", "isDraft", "createdAt", "updatedAt",
    "mergeStateStatus", "reviewDecision", "labels",
  ].join(",");

  const out = run("gh", [
    "pr", "list", "--repo", repo,
    "--state", "open", "--limit", "100",
    "--json", basicFields,
  ]);
  if (!out) return [];

  try {
    let prs = JSON.parse(out) as PrData[];
    if (approvedOnly) {
      prs = prs.filter((pr) => pr.reviewDecision === "APPROVED");
    }
    // statusCheckRollup is fetched lazily per-PR in enrichWithChecks()
    for (const pr of prs) {
      pr.statusCheckRollup = [];
    }
    return prs;
  } catch {
    return [];
  }
}

/**
 * Fetch statusCheckRollup for a single PR. This is the expensive field
 * that causes GraphQL timeouts when requested for many PRs at once.
 */
function enrichWithChecks(repo: string, pr: PrData): void {
  const out = run("gh", [
    "pr", "view", String(pr.number), "--repo", repo,
    "--json", "statusCheckRollup",
  ]);
  if (!out) return;
  try {
    const data = JSON.parse(out) as { statusCheckRollup: PrData["statusCheckRollup"] };
    pr.statusCheckRollup = data.statusCheckRollup ?? [];
  } catch { /* leave empty */ }
}

function classifyPr(pr: PrData): ClassifiedPr {
  const reasons: string[] = [];
  const draft = pr.isDraft;
  if (draft) reasons.push("draft");

  // Check CI status
  const checks = pr.statusCheckRollup ?? [];
  const passing = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);
  let checksGreen = checks.length > 0;
  for (const check of checks) {
    const conclusion = (check.conclusion ?? "").toUpperCase();
    const status = (check.status ?? "").toUpperCase();
    const done = status === "COMPLETED" || (!status && conclusion);
    if (!done || !passing.has(conclusion)) {
      checksGreen = false;
      break;
    }
  }
  if (checks.length === 0) checksGreen = false;
  if (!checksGreen && !draft) reasons.push("failing-checks");

  // Check merge state
  const mergeClean = ["CLEAN", "HAS_HOOKS", "UNSTABLE"];
  const mergeState = (pr.mergeStateStatus ?? "UNKNOWN").toUpperCase();
  const hasConflict = !mergeClean.includes(mergeState) && mergeState !== "UNKNOWN";
  if (hasConflict) reasons.push("merge-conflict");

  // Check review decision
  const approved = pr.reviewDecision === "APPROVED";
  const blocked = mergeState === "BLOCKED";
  if (blocked && !hasConflict) reasons.push("merge-blocked");

  // Simple CodeRabbit heuristic: check labels for major findings
  // (Full CodeRabbit check is in check-gates.ts via GraphQL)
  const coderabbitMajor = false; // conservative — gate checker does the real check

  // Classify
  const mergeNow = !draft && checksGreen && !hasConflict && approved && !coderabbitMajor;
  // Near miss: not draft, most things pass but one blocker that looks fixable
  const nearMiss = !draft && !mergeNow && reasons.length <= 2 &&
    !reasons.includes("draft") &&
    (checksGreen || reasons.includes("failing-checks")) &&
    !hasConflict;

  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    author: pr.author?.login ?? "unknown",
    churn: pr.additions + pr.deletions,
    changedFiles: pr.changedFiles,
    checksGreen,
    coderabbitMajor,
    reasons,
    mergeNow,
    nearMiss,
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    draft,
    labels: (pr.labels ?? []).map((l) => l.name),
  };
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
  item: ClassifiedPr,
  riskyFiles: string[],
): { score: number; bucket: "ready-now" | "salvage-now" | "blocked"; nextAction: string } {
  let score = 0;
  let bucket: "ready-now" | "salvage-now" | "blocked" = "blocked";
  let nextAction = "review";

  if (item.mergeNow) {
    score += SCORE_MERGE_NOW;
    bucket = "ready-now";
    nextAction = "merge-gate";
  } else if (item.nearMiss) {
    score += SCORE_NEAR_MISS;
    bucket = "salvage-now";
    nextAction = "salvage-pr";
  }

  if (riskyFiles.length > 0 && bucket !== "blocked") {
    score += SCORE_SECURITY_ACTIONABLE;
    nextAction = bucket === "ready-now" ? "security-sweep → merge-gate" : "security-sweep → salvage-pr";
  }

  if (item.updatedAt) {
    const age = Date.now() - new Date(item.updatedAt).getTime();
    if (age > 7 * 24 * 60 * 60 * 1000) score += SCORE_STALE_AGE;
  }

  const reasons = new Set(item.reasons);
  if (item.draft) score += PENALTY_DRAFT_OR_CONFLICT;
  if (reasons.has("merge-conflict")) score += PENALTY_DRAFT_OR_CONFLICT;
  if (item.coderabbitMajor) score += PENALTY_CODERABBIT_MAJOR;
  if (reasons.has("failing-checks") && !item.nearMiss) score += PENALTY_BROAD_CI_RED;
  if (reasons.has("merge-blocked")) score += PENALTY_MERGE_BLOCKED;

  return { score, bucket, nextAction };
}

// ---------------------------------------------------------------------------
// Hotspot detection from PR file overlap
// ---------------------------------------------------------------------------

function detectHotClusters(
  items: ClassifiedPr[],
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
  const repoIdx = args.indexOf("--repo");
  const repo = repoIdx >= 0 ? args[repoIdx + 1] : "NVIDIA/NemoClaw";

  // 1. Fetch open PRs (lightweight — no statusCheckRollup yet)
  // Retry once on transient GitHub GraphQL failures (502/504)
  process.stderr.write("Fetching open PRs...\n");
  let prs = fetchOpenPrs(repo, approvedOnly);
  if (prs.length === 0) {
    process.stderr.write("First attempt failed, retrying in 3s...\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    prs = fetchOpenPrs(repo, approvedOnly);
  }
  if (prs.length === 0 && approvedOnly) {
    process.stderr.write("No approved PRs found, falling back to all open PRs...\n");
    prs = fetchOpenPrs(repo, false);
  }
  if (prs.length === 0) {
    console.error("No open PRs found. GitHub API may be experiencing issues.");
    process.exit(1);
  }

  // Pre-filter to non-draft, non-conflict candidates worth enriching
  const candidates = prs.filter((pr) => !pr.isDraft);
  const enrichCount = Math.min(candidates.length, limit * 3);
  process.stderr.write(`Enriching top ${enrichCount} candidates with CI status...\n`);
  for (const pr of candidates.slice(0, enrichCount)) {
    enrichWithChecks(repo, pr);
  }

  const classified = prs.map(classifyPr);

  // 2. Load exclusions
  const state = loadState();
  const excludedPrs = new Set(
    Object.keys(state?.excluded?.prs ?? {}).map(Number),
  );

  const allItems = classified.filter((item) => !excludedPrs.has(item.number));

  // 3. Enrich top candidates with file data and scoring
  const fileCache = new Map<number, string[]>();
  const topCandidates = allItems
    .filter((item) => item.mergeNow || item.nearMiss)
    .slice(0, limit * 2);

  // Also include non-merge/near-miss items so we have a full picture
  const remaining = allItems
    .filter((item) => !item.mergeNow && !item.nearMiss && !item.draft)
    .slice(0, limit);

  const toScore = [...topCandidates, ...remaining];

  const scored: QueueItem[] = [];
  for (const item of toScore) {
    const files = fetchPrFiles(repo, item.number);
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
      changedFiles: item.changedFiles,
      nextAction,
      ageHours: item.createdAt
        ? Math.floor((Date.now() - new Date(item.createdAt).getTime()) / 3_600_000)
        : 0,
      labels: item.labels,
    });
  }

  // 4. Sort and rank
  scored.sort((a, b) => b.score - a.score);
  const queue = scored.filter((s) => s.bucket === "ready-now").slice(0, limit);
  const nearMisses = scored.filter((s) => s.bucket === "salvage-now").slice(0, limit);
  queue.forEach((item, i) => (item.rank = i + 1));
  nearMisses.forEach((item, i) => (item.rank = i + 1));

  // 5. Detect hot clusters
  const hotClusters = detectHotClusters(allItems, repo, fileCache);

  // 6. Output
  const output: TriageOutput = {
    generatedAt: new Date().toISOString(),
    repo,
    scanned: prs.length,
    queue,
    nearMisses,
    hotClusters,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
