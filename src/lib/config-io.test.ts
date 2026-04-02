// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Import from compiled dist/ for coverage attribution.
import {
  ensureConfigDir,
  readConfigFile,
  writeConfigFile,
  ConfigPermissionError,
} from "../../dist/lib/config-io";

describe("config-io", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nemoclaw-config-io-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("ensureConfigDir", () => {
    it("creates a directory with mode 0o700", () => {
      const dir = path.join(tmpDir, "nested", "config");
      ensureConfigDir(dir);
      expect(fs.existsSync(dir)).toBe(true);
      const stat = fs.statSync(dir);
      expect(stat.mode & 0o777).toBe(0o700);
    });

    it("succeeds if directory already exists", () => {
      const dir = path.join(tmpDir, "existing");
      fs.mkdirSync(dir, { mode: 0o700 });
      expect(() => ensureConfigDir(dir)).not.toThrow();
    });
  });

  describe("writeConfigFile + readConfigFile", () => {
    it("round-trips JSON data with atomic write", () => {
      const file = path.join(tmpDir, "test.json");
      const data = { key: "value", nested: { a: 1 } };
      writeConfigFile(file, data);

      expect(fs.existsSync(file)).toBe(true);
      const stat = fs.statSync(file);
      expect(stat.mode & 0o777).toBe(0o600);

      const loaded = readConfigFile(file, {});
      expect(loaded).toEqual(data);
    });

    it("creates parent directories", () => {
      const file = path.join(tmpDir, "deep", "nested", "config.json");
      writeConfigFile(file, { ok: true });
      expect(readConfigFile(file, null)).toEqual({ ok: true });
    });

    it("returns default for missing files", () => {
      const file = path.join(tmpDir, "nonexistent.json");
      expect(readConfigFile(file, { fallback: true })).toEqual({ fallback: true });
    });

    it("returns default for corrupt JSON", () => {
      const file = path.join(tmpDir, "corrupt.json");
      fs.writeFileSync(file, "not-json");
      expect(readConfigFile(file, "default")).toBe("default");
    });

    it("cleans up temp file on write failure", () => {
      // Write to a read-only directory to trigger failure
      const readonlyDir = path.join(tmpDir, "readonly");
      fs.mkdirSync(readonlyDir, { mode: 0o700 });
      const file = path.join(readonlyDir, "test.json");
      // Write once successfully, then make dir read-only
      writeConfigFile(file, { first: true });
      fs.chmodSync(readonlyDir, 0o500);

      try {
        expect(() => writeConfigFile(file, { second: true })).toThrow();
      } finally {
        fs.chmodSync(readonlyDir, 0o700);
      }

      // No temp files left behind
      const files = fs.readdirSync(readonlyDir);
      expect(files.filter((f) => f.includes(".tmp."))).toHaveLength(0);
    });
  });

  describe("ConfigPermissionError", () => {
    it("includes remediation message and config path", () => {
      const err = new ConfigPermissionError("test error", "/some/path");
      expect(err.name).toBe("ConfigPermissionError");
      expect(err.code).toBe("EACCES");
      expect(err.configPath).toBe("/some/path");
      expect(err.message).toContain("test error");
      expect(err.remediation).toContain("sudo chown");
      expect(err.remediation).toContain(".nemoclaw");
    });
  });
});
