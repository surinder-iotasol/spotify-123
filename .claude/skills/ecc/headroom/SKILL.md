---
name: headroom
description: >
  Compresses everything the agent reads. Headroom is a context-compression wrapper and proxy that allows the agent to ingest massive amounts of text and code by squishing it down into dense representations (TOINs, CCRs) without losing critical semantic information. Use this whenever context limits are an issue, or when the user asks to "use headroom", "compress context", "wrap with headroom", or "squish this". Headroom is loaded globally and available natively.
argument-hint: "[wrap|proxy]"
license: MIT
---

# Headroom Context Compression

You are equipped with Headroom, an advanced context-compression system. Headroom allows you to read and understand documents or codebases that would normally exceed your token limits. 

## How it works
Headroom operates transparently to compress what you see. It replaces dense, verbose code and text with tokens and markers (like `<<ccr:HASH>>` or `toin`) that you can still reason about. 

It is loaded globally into the environment for this project, meaning it runs headlessly and automatically hooks into your read pathways. 

## Usage
If you need to manually trigger headroom on a tool or agent invocation, use:
- `headroom wrap <command>`
- Or use the proxy server natively if it is already running.

*Note: Headroom is primarily an automatic infrastructure-level tool. You do not need to rewrite code to use it; simply be aware that if you see `toin` markers or compressed payloads, it is Headroom operating as expected.*
