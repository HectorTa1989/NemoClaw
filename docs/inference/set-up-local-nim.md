---
title:
  page: "Set Up a Local NIM Service for NemoClaw On-Premises Inference"
  nav: "Set Up Local NIM"
description: "Route NemoClaw inference to an NVIDIA NIM container on your network."
keywords: ["nemoclaw local nim setup", "on-premises nim inference nemoclaw"]
topics: ["generative_ai", "ai_agents"]
tags: ["openclaw", "openshell", "nim", "inference_routing", "containers"]
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

# Set Up a Local NIM Service

Route inference to an NVIDIA NIM container running on your local network.
This profile keeps all inference on-premises while using the same models available through NVIDIA cloud.

## Prerequisites

- A running NemoClaw sandbox.
- Docker or a compatible container runtime.
- A GPU with enough VRAM for the target model.
- An NVIDIA NGC API key for pulling NIM container images.

## Pull and Start the NIM Container

Pull the NIM container image and start it on port 8000:

```console
$ docker run -d --gpus all \
    -p 8000:8000 \
    --name nim-service \
    nvcr.io/nim/nvidia/nemotron-3-super-120b-a12b:latest
```

Wait until the container logs show that the model is loaded and ready to serve requests.
Check the logs with the following command:

```console
$ docker logs -f nim-service
```

## Verify the NIM Service

Confirm that the NIM container is reachable:

```console
$ curl http://nim-service.local:8000/v1/models
```

If `nim-service.local` does not resolve, use the container IP address or configure DNS to resolve the hostname.

## Set the NIM API Key

Export the `NIM_API_KEY` environment variable.
The `nim-local` profile uses this variable to authenticate with the NIM service:

```console
$ export NIM_API_KEY=<your-nim-api-key>
```

## Switch to the NIM Provider

Set the active inference provider to `nim-local`:

```console
$ openshell inference set --provider nim-local --model nvidia/nemotron-3-super-120b-a12b
```

The change takes effect immediately.
No sandbox restart is required.

## Verify Inference Routing

Check the sandbox status to confirm the active provider:

```console
$ openclaw nemoclaw status
```

The output should show `nim-local` as the active provider with the endpoint `nim-service.local:8000`.

## Network Policy

The sandbox network policy includes a `nim_service` entry that allows traffic to `nim-service.local:8000`.
This entry is part of the baseline policy in `nemoclaw-blueprint/policies/openclaw-sandbox.yaml`.
No additional policy changes are required.

## Select the NIM Profile at Launch

To start a new sandbox with the `nim-local` profile, pass `--profile nim-local` during launch:

```console
$ openclaw nemoclaw launch --profile nim-local
```

## Related Topics

- [Switch Inference Providers](switch-inference-providers.md) to change providers at runtime.
- [Inference Profiles](../reference/inference-profiles.md) for the full profile specification.
- [Network Policies](../reference/network-policies.md) for the `nim_service` policy entry.
