#!/usr/bin/env node
'use strict';

/**
 * Emit [STREAM_EVENT] lines during Ralph-managed cursor-agent builds so the
 * backend trace pipeline can ingest hook-originated MCP/subagent/skill signals.
 */

function emitHookTrace(item) {
  if (!process.env.RALPH_WORKSPACE) return;
  const payload = { source: 'ecc_hook', ...item };
  const line = `[STREAM_EVENT] ${JSON.stringify(payload)}\n`;
  process.stderr.write(line);
}

module.exports = { emitHookTrace };
