#!/usr/bin/env node
const { readStdin } = require('./adapter');
const { emitHookTrace } = require('./ralph-trace-bridge');
readStdin().then(raw => {
  try {
    const input = JSON.parse(raw);
    const server = input.server || input.mcp_server || 'unknown';
    const tool = input.tool || input.mcp_tool || 'unknown';
    const success = input.error ? 'FAILED' : 'OK';
    console.error(`[ECC] MCP result: ${server}/${tool} - ${success}`);
    emitHookTrace({
      kind: 'mcp_result',
      mcpServer: String(server),
      toolName: String(tool),
      toolId: input.tool_call_id || input.call_id || `hook-mcp-${Date.now()}`,
      isError: !!input.error,
      content: typeof input.result === 'string' ? input.result.slice(0, 500) : success,
    });
  } catch {}
  process.stdout.write(raw);
}).catch(() => process.exit(0));
