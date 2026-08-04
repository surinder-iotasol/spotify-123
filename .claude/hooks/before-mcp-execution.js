#!/usr/bin/env node
const { readStdin } = require('./adapter');
const { emitHookTrace } = require('./ralph-trace-bridge');
readStdin().then(raw => {
  try {
    const input = JSON.parse(raw);
    const server = input.server || input.mcp_server || 'unknown';
    const tool = input.tool || input.mcp_tool || 'unknown';
    console.error(`[ECC] MCP invocation: ${server}/${tool}`);
    emitHookTrace({
      kind: 'mcp_call',
      mcpServer: String(server),
      toolName: String(tool),
      toolId: input.tool_call_id || input.call_id || `hook-mcp-${Date.now()}`,
      input: input.arguments || input.args || {},
    });
  } catch {}
  process.stdout.write(raw);
}).catch(() => process.exit(0));
