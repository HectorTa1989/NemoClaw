// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Runtime config overrides for sandboxed OpenClaw instances.
// Reads/writes the config-overrides.json5 file in the sandbox's writable
// partition.  Changes trigger OpenClaw's config file watcher for hot-reload.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { runCapture, shellQuote } = require("./runner");

const OVERRIDES_PATH = "/sandbox/.openclaw-data/config-overrides.json5";

/**
 * Run a script inside the sandbox via `sandbox connect` with stdin piping.
 * Throws on sandbox connectivity failures so callers can distinguish
 * "sandbox unreachable" from "command produced no output".
 */
function sandboxRun(sandboxName, script) {
  const tmpFile = path.join(os.tmpdir(), `nemoclaw-cfg-${Date.now()}.sh`);
  fs.writeFileSync(tmpFile, script + "\nexit\n", { mode: 0o600 });
  try {
    return runCapture(
      `openshell sandbox connect ${shellQuote(sandboxName)} < ${shellQuote(tmpFile)} 2>&1`
    );
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

/**
 * Read the current overrides file from inside the sandbox.
 * Returns {} when no overrides file exists (non-fatal).
 * Throws on sandbox connectivity errors.
 */
function readOverrides(sandboxName) {
  let raw;
  try {
    raw = sandboxRun(sandboxName, `cat ${OVERRIDES_PATH} 2>/dev/null || true`);
  } catch (err) {
    throw new Error(`Cannot reach sandbox '${sandboxName}': ${err.message}`, { cause: err });
  }
  if (!raw || raw.trim() === "") return {};
  // sandbox connect may include shell prompt noise — extract the JSON.
  // writeOverrides always produces strict JSON (via JSON.stringify), so
  // JSON.parse is safe here.  The .json5 extension is for the runtime shim
  // which uses JSON5.parse (a superset).
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
}

/**
 * Write the overrides object back into the sandbox.
 * Always writes strict JSON (valid JSON5 superset).
 */
function writeOverrides(sandboxName, overrides) {
  const json = JSON.stringify(overrides, null, 2);
  const script = `cat > ${OVERRIDES_PATH} <<'EOF_OV'\n${json}\nEOF_OV`;
  try {
    return sandboxRun(sandboxName, script);
  } catch (err) {
    throw new Error(`Cannot write to sandbox '${sandboxName}': ${err.message}`, { cause: err });
  }
}

/**
 * Set a value at a dotted path in a nested object.
 */
function setNestedValue(obj, dottedPath, value) {
  const parts = dottedPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Get a value at a dotted path from a nested object.
 */
function getNestedValue(obj, dottedPath) {
  const parts = dottedPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Parse a string value into the appropriate JS type.
 * Default: treat as string (safe for tokens, IDs, etc.).
 * Pass json=true to parse booleans, numbers, null, arrays, and objects.
 */
function parseValue(raw, { json = false } = {}) {
  if (!json) return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (!isNaN(raw) && raw !== "") return Number(raw);
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object") return parsed;
  } catch { /* not JSON, treat as string */ }
  return raw;
}

/**
 * nemoclaw <sandbox> config-set --key <path> --value <value> [--json]
 */
function configSet(sandboxName, args) {
  let key = null;
  let value = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--key" && i + 1 < args.length) {
      key = args[++i];
    } else if (args[i] === "--value" && i + 1 < args.length) {
      value = args[++i];
    } else if (args[i] === "--json") {
      json = true;
    }
  }

  if (!key || value === null) {
    console.error("  Usage: nemoclaw <sandbox> config-set --key <path> --value <value> [--json]");
    console.error("  Example: nemoclaw my-assistant config-set --key channels.telegram.token --value '<token>'");
    console.error("  Use --json to parse booleans, numbers, and objects instead of storing as string.");
    process.exit(1);
  }

  // Security: block gateway.* regardless of anything else
  if (key.startsWith("gateway.") || key === "gateway") {
    console.error(`  Refused: gateway.* fields are immutable (security-enforced).`);
    process.exit(1);
  }

  const overrides = readOverrides(sandboxName);
  const parsedValue = parseValue(value, { json });
  setNestedValue(overrides, key, parsedValue);
  writeOverrides(sandboxName, overrides);

  console.log(`  Set ${key} = ${JSON.stringify(parsedValue)}`);
  console.log(`  OpenClaw will hot-reload the change automatically.`);
}

/**
 * nemoclaw <sandbox> config-get [--key <path>]
 */
function configGet(sandboxName, args) {
  let key = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--key" && i + 1 < args.length) {
      key = args[++i];
    }
  }

  const overrides = readOverrides(sandboxName);

  if (key) {
    const val = getNestedValue(overrides, key);
    if (val === undefined) {
      console.log(`  ${key}: (not set — using frozen config default)`);
    } else {
      console.log(`  ${key}: ${JSON.stringify(val)}`);
    }
  } else {
    // Show all overrides
    if (Object.keys(overrides).length === 0) {
      console.log("  No runtime config overrides active.");
      console.log("  All values are from the frozen openclaw.json defaults.");
    } else {
      console.log("  Active runtime config overrides:");
      console.log(JSON.stringify(overrides, null, 2).split("\n").map(l => `  ${l}`).join("\n"));
    }
  }
}

module.exports = { configSet, configGet, OVERRIDES_PATH };
