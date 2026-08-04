#!/usr/bin/env node
const { readStdin } = require('./adapter');
const { emitHookTrace } = require('./ralph-trace-bridge');
const SKILL_PATH_RE = /(?:^|\/)(?:\.cursor\/skills|\.claude\/skills|skills)\/([^/]+)\/SKILL\.md$/i;

readStdin().then(raw => {
  try {
    const input = JSON.parse(raw);
    const filePath = input.path || input.file || '';
    if (/\.(env|key|pem)$|\.env\.|credentials|secret/i.test(filePath)) {
      console.error('[ECC] WARNING: Reading sensitive file: ' + filePath);
      console.error('[ECC] Ensure this data is not exposed in outputs');
    }
    const normalized = String(filePath).replace(/\\/g, '/');
    const match = normalized.match(SKILL_PATH_RE);
    if (match) {
      emitHookTrace({
        kind: 'skill_loaded',
        skillName: match[1],
        skillPath: filePath,
        detectionMethod: 'hook',
      });
    }
  } catch {}
  process.stdout.write(raw);
}).catch(() => process.exit(0));
