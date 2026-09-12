#!/usr/bin/env bun
// Unit check for build-fallow-package.ts's deriveMcpEntry — no scratch dir, no shellout.
// Run: bun scripts/test-build-fallow-package.ts
//
// The expected shape below was cross-checked against a real
// `apm mcp install fallow -- fallow-mcp` run, which independently wrote:
//   { name: fallow, registry: false, transport: stdio, command: fallow-mcp }
// into a scratch apm.yml's dependencies.mcp — confirming deriveMcpEntry produces the same
// shape APM's own MCP installer does.

import assert from 'node:assert';
import { deriveMcpEntry } from './build-fallow-package.ts';

let pass = 0;

function check<T>(name: string, actual: T, expected: T): void {
  assert.deepStrictEqual(actual, expected, name);
  pass += 1;
  console.log(`ok - ${name}`);
}

check(
  'derives stdio entry with no args (matches scratch .mcp.json / apm mcp install shape)',
  deriveMcpEntry({ mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp', args: [] } } }),
  { name: 'fallow', registry: false, transport: 'stdio', command: 'fallow-mcp' }
);

check(
  'includes args only when non-empty',
  deriveMcpEntry({ mcpServers: { fallow: { type: 'stdio', command: 'fallow-mcp', args: ['--foo'] } } }),
  { name: 'fallow', registry: false, transport: 'stdio', command: 'fallow-mcp', args: ['--foo'] }
);

console.log(`\n${pass} passed`);
