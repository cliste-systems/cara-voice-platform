import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactPii } from './gdpr.js';
import { isTenantBusinessFilePath } from './supabase.js';

describe('sensitive transcript redaction', () => {
  it('redacts the reported card and IBAN boundary cases', () => {
    assert.equal(redactPii('1234567890123'), '[redacted]');
    assert.equal(redactPii('one two three four five six seven eight'), '[redacted]');
    assert.equal(redactPii('ie29aibk93115212345678'), '[redacted]');
    assert.equal(redactPii('+353871234567'), '+353871234567');
  });
});

describe('business file signing path', () => {
  const org = '11111111-1111-4111-8111-111111111111';
  it('accepts only a path beneath the expected tenant prefix', () => {
    assert.equal(isTenantBusinessFilePath(org, `${org}/menu.pdf`), true);
    assert.equal(isTenantBusinessFilePath(org, '22222222-2222-4222-8222-222222222222/menu.pdf'), false);
    assert.equal(isTenantBusinessFilePath(org, `${org}/../foreign/menu.pdf`), false);
    assert.equal(isTenantBusinessFilePath(org, `${org}//menu.pdf`), false);
  });
});
