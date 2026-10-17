import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const paths = {
  spec: new URL(
    '../e2e/execution-feedback-minimal-page.spec.ts',
    import.meta.url,
  ),
  panel: new URL(
    '../../frontend/src/modules/cases/CaseExecutionFilingFollowupPanel.vue',
    import.meta.url,
  ),
  login: new URL(
    '../../frontend/src/modules/auth/LoginPage.vue',
    import.meta.url,
  ),
  shell: new URL('../../frontend/src/app/AppShell.vue', import.meta.url),
  list: new URL(
    '../../frontend/src/modules/cases/CaseListPage.vue',
    import.meta.url,
  ),
};

async function sources() {
  return Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([name, path]) => [
        name,
        await readFile(path, 'utf8'),
      ]),
    ),
  );
}

function literal(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : undefined;
}

function calledMethod(node, method) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === method
  );
}

function collectSpecSelectors(specText) {
  const source = ts.createSourceFile(
    'execution-feedback-minimal-page.spec.ts',
    specText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const testIds = new Set();
  const labels = new Set();
  const buttonNames = new Set();
  const textPatterns = new Set();
  const locatorTags = new Set();
  const locatorTestIds = new Set();

  function visit(node) {
    if (calledMethod(node, 'getByTestId')) {
      const value = literal(node.arguments[0]);
      if (value !== undefined) testIds.add(value);
    }
    if (calledMethod(node, 'getByLabel')) {
      const value = literal(node.arguments[0]);
      if (value !== undefined) labels.add(value);
    }
    if (calledMethod(node, 'getByRole')) {
      const [roleArg, options] = node.arguments;
      if (
        literal(roleArg) === 'button' &&
        options &&
        ts.isObjectLiteralExpression(options)
      ) {
        for (const property of options.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            property.name.text === 'name'
          ) {
            const value = literal(property.initializer);
            if (value !== undefined) buttonNames.add(value);
          }
        }
      }
    }
    if (calledMethod(node, 'getByText')) {
      const value = node.arguments[0];
      if (value && ts.isRegularExpressionLiteral(value)) {
        const raw = value.text;
        const lastSlash = raw.lastIndexOf('/');
        if (raw.startsWith('/') && lastSlash > 0) {
          const pattern = raw.slice(1, lastSlash);
          if (pattern.includes('查看登记')) textPatterns.add(pattern);
        }
      }
    }
    if (calledMethod(node, 'locator')) {
      const value = literal(node.arguments[0]);
      if (value?.startsWith('[data-test="') && value.endsWith('"]'))
        locatorTestIds.add(value.slice('[data-test="'.length, -2));
      else if (value && /^[a-z][a-z0-9-]*$/u.test(value))
        locatorTags.add(value);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return {
    testIds,
    labels,
    buttonNames,
    textPatterns,
    locatorTags,
    locatorTestIds,
  };
}

function assertSelectorContract(specText, vueSources) {
  const selectors = collectSpecSelectors(specText);
  const templateText = Object.values(vueSources).join('\n');
  const panelText = vueSources.panel;
  const loginText = vueSources.login;
  const caseListText = vueSources.list;

  for (const testId of [...selectors.testIds, ...selectors.locatorTestIds]) {
    assert.match(
      templateText,
      new RegExp(`data-test=["']${escapeRegExp(testId)}["']`, 'u'),
      `No Vue template exposes data-test=${testId}`,
    );
  }
  for (const label of selectors.labels)
    assert.ok(
      loginText.includes(label),
      `Login template is missing label text: ${label}`,
    );
  for (const name of selectors.buttonNames)
    assert.ok(
      templateText.includes(name),
      `Vue templates are missing button text: ${name}`,
    );
  for (const pattern of selectors.textPatterns)
    assert.ok(
      panelText.includes(pattern),
      `Feedback panel is missing heading text: ${pattern}`,
    );
  for (const tag of selectors.locatorTags)
    assert.match(
      panelText,
      new RegExp(`<${tag}(?:\\s|>)`, 'u'),
      `Panel has no <${tag}> element`,
    );

  // The case link's accessible name is read from the response, so the source
  // contract checks the rendered business-number link rather than inventing a
  // fixture value for it.
  assert.match(caseListText, /<RouterLink[\s\S]*?item\.businessNo/u);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

test('real EF acceptance selectors resolve to current Vue templates', async () => {
  const [spec, vueSources] = await Promise.all([
    readFile(paths.spec, 'utf8'),
    sources(),
  ]);
  assertSelectorContract(spec, vueSources);
});

test('previous incorrect correction button and history heading fail the same contract', async () => {
  const [spec, vueSources] = await Promise.all([
    readFile(paths.spec, 'utf8'),
    sources(),
  ]);
  const oldSelectorFixture = spec
    .replace('更正这条反馈', '更正执行反馈')
    .replaceAll('查看登记与更正历史', '查看登记更正历史');
  assert.notEqual(
    oldSelectorFixture,
    spec,
    'The owned red fixture must change both selectors',
  );
  assert.throws(
    () => assertSelectorContract(oldSelectorFixture, vueSources),
    /Vue templates are missing button text|Feedback panel is missing heading text/u,
  );
});

test('minimal Playwright config maps getByTestId to Vue data-test attributes', async (context) => {
  const configPath = new URL(
    '../../playwright.minimal-pages.config.ts',
    import.meta.url,
  );
  let config;
  try {
    config = await readFile(configPath, 'utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      context.skip(
        'The managed minimal-pages config has not landed in this tree yet.',
      );
      return;
    }
    throw cause;
  }
  assert.match(config, /testIdAttribute\s*:\s*['"]data-test['"]/u);
});
