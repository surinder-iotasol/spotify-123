#!/usr/bin/env node
const { readStdin } = require('./adapter');
const { emitHookTrace } = require('./ralph-trace-bridge');
readStdin().then(raw => {
  try {
    const input = JSON.parse(raw);
    const agent = input.agent_name || input.agent || input.subagent_type || 'unknown';
    console.error(`[ECC] Agent spawned: ${agent}`);
    emitHookTrace({
      kind: 'sub_agent',
      toolName: 'Task',
      toolId: input.tool_call_id || input.call_id || `hook-subagent-${Date.now()}`,
      subAgentLabel: String(agent),
      input: {
        subagent_type: input.subagent_type,
        description: input.description,
      },
      isSubAgent: true,
    });
  } catch {}
  process.stdout.write(raw);
}).catch(() => process.exit(0));
