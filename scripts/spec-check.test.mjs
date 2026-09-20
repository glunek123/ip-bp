import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditImplementationStatusOwnership,
  auditSpec,
} from './spec-check.mjs';

function fixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dev-cor-spec-'));
  t.onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(root, { recursive: true });
  const files = {
    'DECISIONS.md':
      '# Decisions\n\n| 编号 | 决定 |\n| --- | --- |\n| SD-01 | first |\n| SD-02 | second |\n',
    'README.md':
      '# Spec\n\n当前决定：[SD-01～02](DECISIONS.md)，设计TD-BASE-05／TD-TRACE-UX-01。\n\n当前实现状态与开发顺序只见[功能开发路线图](../../feature-roadmap.md)，当前活动任务只见[项目状态](../../project-status.md)。\n',
    'COVERAGE.md': '# Coverage\n\nREQ-CU-001映射到SD-01。\n',
    'READINESS.md':
      '# Ready\n\n按SD-01～02回填，使用TD-BASE-05／TD-TRACE-UX-01。\n',
    'TECHNICAL-DESIGN.md':
      '# Design\n\n版本：TD-BASE-05／TD-TRACE-UX-01；依据SD-02。\n',
    'module.md': '# Module\n\n## REQ-CU-001 Create customer\n\n见SD-01。\n',
    ...overrides,
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content, 'utf8');
  }
  return root;
}

test('accepts unique requirements, resolved decisions and current versions', (t) => {
  const result = auditSpec(fixture(t));
  assert.deepEqual(result.errors, []);
  assert.equal(result.requirementCount, 1);
  assert.equal(result.decisionCount, 2);
});

test('rejects duplicate requirement headings', (t) => {
  const root = fixture(t, {
    'other.md': '## REQ-CU-001 Duplicate customer requirement\n',
  });
  assert.match(auditSpec(root).errors.join('\n'), /duplicate REQ-CU-001/i);
});

test('rejects references to missing requirements and decisions', (t) => {
  const root = fixture(t, {
    'module.md':
      '# Module\n\n## REQ-CU-001 Create customer\n\n见REQ-CU-999和SD-03。\n',
  });
  const errors = auditSpec(root).errors.join('\n');
  assert.match(errors, /missing REQ-CU-999/i);
  assert.match(errors, /missing SD-03/i);
});

test('rejects markdown table rows with a different column count', (t) => {
  const root = fixture(t, {
    'module.md':
      '# Module\n\n## REQ-CU-001 Create customer\n\n| A | B |\n| --- | --- |\n| one | two | three |\n',
  });
  assert.match(auditSpec(root).errors.join('\n'), /table columns/i);
});

test('rejects stale current summary versions', (t) => {
  const root = fixture(t, {
    'READINESS.md': '# Ready\n\n仅按SD-01回填。\n',
    'TECHNICAL-DESIGN.md': '# Design\n\n版本：TD-BASE-04。\n',
  });
  const errors = auditSpec(root).errors.join('\n');
  assert.match(errors, /READINESS\.md.*SD-02/i);
  assert.match(errors, /TECHNICAL-DESIGN\.md.*TD-BASE-05/i);
  assert.match(errors, /TECHNICAL-DESIGN\.md.*TD-TRACE-UX-01/i);
});

test('requires the Spec README to delegate implementation state', () => {
  assert.deepEqual(
    auditImplementationStatusOwnership(
      '# Spec\n\n当前实现状态与开发顺序只见[功能开发路线图](../../feature-roadmap.md)，当前活动任务只见[项目状态](../../project-status.md)。\n',
    ),
    [],
  );
});

test('rejects copied current implementation progress in the Spec README', () => {
  const errors = auditImplementationStatusOwnership(
    '# Spec\n\n本地账号第一切片待计划／实现，客户能力已内部集成。\n',
  );
  assert.match(errors.join('\n'), /implementation state source/i);
  assert.match(errors.join('\n'), /copied implementation progress/i);
});
