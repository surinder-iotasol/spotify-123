#!/usr/bin/env node
const { readStdin } = require('./adapter');
const { emitHookTrace } = require('./ralph-trace-bridge');
readStdin().then(raw => {
  try {
    const input = JSON.parse(raw);
    const agent = input.agent_name || input.agent || input.subagent_type || 'unknown';
    console.error(`[ECC] Agent completed: ${agent}`);
    emitHookTrace({
      kind: 'subagent_completed',
      toolName: 'Task',
      toolId: input.tool_call_id || input.call_id || `hook-subagent-${Date.now()}`,
      subAgentLabel: String(agent),
      isSubAgent: true,
      status: input.status || 'completed',
    });
  } catch {}
  process.stdout.write(raw);
}).catch(() => process.exit(0));
