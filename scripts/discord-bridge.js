#!/usr/bin/env node
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Discord → NemoClaw bridge.
 *
 * Messages from Discord are forwarded to the OpenClaw agent running
 * inside the sandbox. When the agent needs external access, the
 * OpenShell TUI lights up for approval. Responses go back to Discord.
 *
 * Env:
 *   DISCORD_BOT_TOKEN     — from Discord Developer Portal
 *   NVIDIA_API_KEY        — for inference
 *   SANDBOX_NAME          — sandbox name (default: nemoclaw)
 *   ALLOWED_CHANNEL_IDS   — comma-separated Discord channel IDs to accept (optional, accepts all if unset)
 */

const { Client, GatewayIntentBits } = require("discord.js");
const { runAgentInSandbox, SANDBOX } = require("./bridge-core");

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error("DISCORD_BOT_TOKEN required"); process.exit(1); }

const ALLOWED_CHANNELS = process.env.ALLOWED_CHANNEL_IDS
  ? process.env.ALLOWED_CHANNEL_IDS.split(",").map((s) => s.trim())
  : null;

// ── Discord client setup ──────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// ── Message handling ──────────────────────────────────────────────

client.on("messageCreate", async (message) => {
  // Ignore bot messages (including our own)
  if (message.author.bot) return;

  // Access control
  const channelId = message.channel.id;
  if (ALLOWED_CHANNELS && !ALLOWED_CHANNELS.includes(channelId)) return;

  const userName = message.author.username;
  const text = message.content;
  if (!text) return;

  console.log(`[${channelId}] ${userName}: ${text}`);

  // Send typing indicator
  await message.channel.sendTyping().catch(() => {});
  const typingInterval = setInterval(
    () => message.channel.sendTyping().catch(() => {}),
    4000,
  );

  try {
    const response = await runAgentInSandbox(text, `dc-${channelId}`);
    clearInterval(typingInterval);
    console.log(`[${channelId}] agent: ${response.slice(0, 100)}...`);

    // Discord max message length is 2000
    const chunks = [];
    for (let i = 0; i < response.length; i += 1900) {
      chunks.push(response.slice(i, i + 1900));
    }
    for (const chunk of chunks) {
      await message.reply(chunk);
    }
  } catch (err) {
    clearInterval(typingInterval);
    await message.reply(`Error: ${err.message}`).catch(() => {});
  }
});

// ── Main ──────────────────────────────────────────────────────────

client.once("ready", () => {
  console.log("");
  console.log("  ┌─────────────────────────────────────────────────────┐");
  console.log("  │  NemoClaw Discord Bridge                           │");
  console.log("  │                                                     │");
  console.log(`  │  Bot:      ${(client.user.tag + "                         ").slice(0, 41)}│`);
  console.log("  │  Sandbox:  " + (SANDBOX + "                              ").slice(0, 40) + "│");
  console.log("  │  Model:    nvidia/nemotron-3-super-120b-a12b       │");
  console.log("  │                                                     │");
  console.log("  │  Messages are forwarded to the OpenClaw agent      │");
  console.log("  │  inside the sandbox. Run 'openshell term' in       │");
  console.log("  │  another terminal to monitor + approve egress.     │");
  console.log("  └─────────────────────────────────────────────────────┘");
  console.log("");
});

client.login(TOKEN);
