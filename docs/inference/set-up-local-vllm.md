---
title:
  page: "Set Up Local vLLM for NemoClaw Offline Development"
  nav: "Set Up Local vLLM"
description: "Run NemoClaw offline by routing inference to a local vLLM server."
keywords: ["nemoclaw local vllm setup", "offline inference vllm nemoclaw"]
topics: ["generative_ai", "ai_agents"]
tags: ["openclaw", "openshell", "vllm", "inference_routing", "local_development"]
content:
  type: how_to
  difficulty: intermediate
  audience: ["developer", "engineer"]
status: published
---

<!--
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0
-->

# Set Up Local vLLM for Offline Development

Run NemoClaw entirely offline by routing inference to a vLLM server on your local machine.
This profile does not require an NVIDIA API key or network access to cloud endpoints.
OpenShell routes requests from the gateway to the host, so the provider endpoint must be reachable from outside the host loopback interface.

## Prerequisites

- A running NemoClaw sandbox.
- A GPU with enough VRAM for the target model.
- Python 3.10 or later.
- The `vllm` Python package installed.

## Start the vLLM Server

Start a vLLM server on port 8000 with the Nemotron 3 Nano 30B model:

```console
$ python -m vllm.entrypoints.openai.api_server \
    --model nvidia/nemotron-3-nano-30b-a3b \
    --host 0.0.0.0 \
    --port 8000
```

Wait until the server logs indicate that the model is loaded and ready to accept requests.

## Verify the Server

Confirm that the vLLM server is reachable by querying its models endpoint:

```console
$ curl http://localhost:8000/v1/models
```

The response should list `nvidia/nemotron-3-nano-30b-a3b` as an available model.

## Gateway Reachability

OpenShell configures local OpenAI-compatible providers with a host-visible endpoint such as `http://host.openshell.internal:8000/v1`.
Do not use `localhost` or `127.0.0.1` in the provider record, because those addresses resolve inside the gateway runtime, not on your workstation.

If your host uses UFW, allow the vLLM port from the Docker bridge subnet before switching providers:

```console
$ sudo ufw allow proto tcp from 172.18.0.0/16 to any port 8000 comment 'Allow OpenShell cluster to vLLM'
$ sudo ufw allow proto tcp from 172.17.0.0/16 to any port 8000 comment 'Allow Docker bridge to vLLM'
```

## Switch to the vLLM Provider

Set the active inference provider to `vllm-local`:

```console
$ openshell inference set --provider vllm-local --model nvidia/nemotron-3-nano-30b-a3b
```

The `vllm` profile uses the `OPENAI_API_KEY` environment variable.
For local use, this defaults to `dummy` and does not need to be set.
The provider endpoint is `http://host.openshell.internal:8000/v1`.

## Test Inference

Run a test inference request from inside the sandbox:

```console
$ nemoclaw my-assistant connect
$ openclaw agent --agent main --local -m "Hello, are you running locally?" --session-id test
```

## Select the vLLM Profile at Launch

To start a new sandbox with the vLLM profile from the beginning, pass `--profile vllm` during launch:

```console
$ openclaw nemoclaw launch --profile vllm
```

## Related Topics

- [Switch Inference Providers](switch-inference-providers.md) to change providers at runtime.
- [Inference Profiles](../reference/inference-profiles.md) for the full profile specification.
