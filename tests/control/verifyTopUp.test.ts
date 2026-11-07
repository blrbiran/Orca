import {describe, expect, it} from 'vitest';
import {verifySavedResultPayloadSchema} from '../../src/control/webProtocol.js';

const source = {sourceRunId: 'source-1', sourceAttempt: 1, capsuleHash: 'a'.repeat(64)};

describe('verify-saved-result optional work payload', () => {
  it('accepts partial work without changing an omitted work payload', () => {
    expect(verifySavedResultPayloadSchema.parse(source)).toEqual(source);
    expect(verifySavedResultPayloadSchema.parse({...source, work: {tokens: 50_000, attempts: 1}})).toEqual({...source, work: {tokens: 50_000, attempts: 1}});
  });
  it.each([{tokens: -1}, {sessions: 1.5}, {tokens: 1, unexpected: 2}, {tokens: null}])('rejects invalid work %j', work => {
    expect(verifySavedResultPayloadSchema.safeParse({...source, work}).success).toBe(false);
  });
});
