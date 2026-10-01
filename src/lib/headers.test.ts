import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, '../..', file), 'utf8');
const directives = (policy: string) => policy.split(';').map((directive) => directive.trim()).filter(Boolean);

describe('the CSP the host sends', () => {
  const meta = read('index.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)![1];
  const rules = read('public/_headers').split('\n').filter((line) => line.trim() && !line.startsWith('#'));

  it('is the policy of index.html, with frame-ancestors added', () => {
    expect(rules[0]).toBe('/*');
    expect(directives(rules[1].replace(/^\s+Content-Security-Policy:/, ''))).toEqual([...directives(meta), "frame-ancestors 'none'"]);
  });

  it('is the only header, since the host drops a rule over one it does not allowlist', () => {
    expect(rules).toHaveLength(2);
  });
});
