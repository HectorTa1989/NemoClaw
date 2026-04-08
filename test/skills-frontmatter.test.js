// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const skillsRoot = path.join(repoRoot, ".agents", "skills");
const spdxHeader = [
  "<!-- SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. -->",
  "<!-- SPDX-License-Identifier: Apache-2.0 -->",
].join("\n");
const frontmatterRe =
  /^<!-- SPDX-FileCopyrightText: Copyright \(c\) 2026 NVIDIA CORPORATION & AFFILIATES\. All rights reserved\. -->\r?\n<!-- SPDX-License-Identifier: Apache-2\.0 -->\r?\n(?:\r?\n)?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function listMarkdownFiles(root) {
  const files = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

describe("repo skill markdown files", () => {
  const markdownFiles = listMarkdownFiles(skillsRoot);
  const generatedUserSkillFiles = markdownFiles.filter((file) =>
    path.relative(skillsRoot, file).startsWith("nemoclaw-user-"),
  );

  it("finds generated user skill markdown files to validate", () => {
    expect(generatedUserSkillFiles.length).toBeGreaterThan(0);
  });

  for (const markdownFile of generatedUserSkillFiles) {
    const relPath = path.relative(repoRoot, markdownFile);

    it(`includes SPDX header for ${relPath}`, () => {
      const raw = fs.readFileSync(markdownFile, "utf8");
      expect(raw.startsWith(spdxHeader), `${relPath} is missing SPDX header`).toBe(true);
    });
  }

  const skillFiles = generatedUserSkillFiles.filter((file) => path.basename(file) === "SKILL.md");

  for (const skillFile of skillFiles) {
    const relPath = path.relative(repoRoot, skillFile);

    it(`parses valid YAML frontmatter for ${relPath}`, () => {
      const raw = fs.readFileSync(skillFile, "utf8");
      const match = raw.match(frontmatterRe);

      expect(match, `${relPath} must place the SPDX header before YAML frontmatter`).not.toBeNull();

      const frontmatterText = match[1];
      const doc = YAML.parseDocument(frontmatterText, { prettyErrors: true });
      const errors = doc.errors.map((error) => String(error));

      expect(errors, `${relPath} has invalid YAML frontmatter`).toEqual([]);

      const frontmatter = doc.toJS();
      expect(frontmatter).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
      });
      expect(
        frontmatter.name.trim().length,
        `${relPath} is missing frontmatter.name`,
      ).toBeGreaterThan(0);
      expect(
        frontmatter.description.trim().length,
        `${relPath} is missing frontmatter.description`,
      ).toBeGreaterThan(0);

      const body = raw.slice(match[0].length).trim();
      expect(body.length, `${relPath} body is too short`).toBeGreaterThan(20);
    });
  }
});
