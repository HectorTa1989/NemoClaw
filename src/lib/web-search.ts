// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export type WebSearchProvider = "brave" | "searxng";

export interface WebSearchConfig {
  fetchEnabled: boolean;
  /** Web search provider. Defaults to "brave". */
  provider?: WebSearchProvider;
  /** Base URL for SearXNG instance (required when provider is "searxng"). */
  searxngUrl?: string;
}

export const BRAVE_API_KEY_ENV = "BRAVE_API_KEY";
export const SEARXNG_URL_ENV = "SEARXNG_URL";
export const DEFAULT_WEB_SEARCH_PROVIDER: WebSearchProvider = "brave";

export function encodeDockerJsonArg(value: unknown): string {
  return Buffer.from(JSON.stringify(value ?? {}), "utf8").toString("base64");
}

export function getBraveExposureWarningLines(): string[] {
  return [
    "NemoClaw will store the Brave API key in the sandbox agent config.",
    "The sandboxed agent will be able to read that key.",
  ];
}

export function getSearxngExposureWarningLines(): string[] {
  return [
    "NemoClaw will store the SearXNG instance URL in the sandbox agent config.",
    "The sandboxed agent will be able to read that URL.",
  ];
}

export function getProviderExposureWarningLines(provider: WebSearchProvider): string[] {
  if (provider === "searxng") return getSearxngExposureWarningLines();
  return getBraveExposureWarningLines();
}

export function buildWebSearchDockerConfig(
  config: WebSearchConfig | null,
  braveApiKey: string | null,
  searxngUrl?: string | null,
): string {
  if (!config || config.fetchEnabled !== true) return encodeDockerJsonArg({});

  const provider: WebSearchProvider = config.provider ?? DEFAULT_WEB_SEARCH_PROVIDER;

  if (provider === "searxng") {
    const instanceUrl = config.searxngUrl || searxngUrl || "";
    return encodeDockerJsonArg({
      provider: "searxng",
      fetchEnabled: true,
      searxngUrl: instanceUrl,
    });
  }

  // Default: brave
  return encodeDockerJsonArg({
    provider: "brave",
    fetchEnabled: true,
    apiKey: braveApiKey || "",
  });
}