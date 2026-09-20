import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const requiredFiles = [
  'README.md',
  'DECISIONS.md',
  'READINESS.md',
  'COVERAGE.md',
  'TECHNICAL-DESIGN.md',
];
const currentTechnicalMarkers = ['TD-BASE-05', 'TD-TRACE-UX-01'];
const implementationSourceSentence =
  '当前实现状态与开发顺序只见[功能开发路线图](../../feature-roadmap.md)，当前活动任务只见[项目状态](../../project-status.md)。';
const copiedProgressPatterns = [
  /待计划[／/]实现/,
  /已内部集成/,
  /已取得(?:PostgreSQL|数据库|浏览器)/,
  /(?:当前|唯一)Next Slice/i,
  /[✅🟡🔵⚪🔴]/u,
];

export function auditImplementationStatusOwnership(readmeText) {
  const errors = [];
  if (!readmeText.includes(implementationSourceSentence)) {
    errors.push('README.md must declare the implementation state source');
  }
  if (copiedProgressPatterns.some((pattern) => pattern.test(readmeText))) {
    errors.push('README.md contains copied implementation progress');
  }
  return errors;
}

function collectMarkdown(root, directory = '') {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const child = directory ? join(directory, entry.name) : entry.name;
      if (entry.isDirectory()) return collectMarkdown(root, child);
      return entry.isFile() && extname(entry.name) === '.md' ? [child] : [];
    },
  );
}

function withoutCodeFences(text) {
  return text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
}

function expandedIds(text, prefix) {
  const ids = new Set();
  const pattern = new RegExp(`(${prefix}-(\\d+))(?:[～~](\\d+))?`, 'g');
  for (const match of text.matchAll(pattern)) {
    const width = match[2].length;
    const start = Number(match[2]);
    const end = match[3] ? Number(match[3]) : start;
    if (end < start || end - start > 200) continue;
    const base = match[1].slice(0, -width);
    for (let value = start; value <= end; value += 1) {
      ids.add(`${base}${String(value).padStart(width, '0')}`);
    }
  }
  return ids;
}

function unescapedPipeCount(line) {
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '|' && line[index - 1] !== '\\') count += 1;
  }
  return count;
}

function addDefinition(map, id, file, line) {
  const locations = map.get(id) ?? [];
  locations.push(`${file}:${line}`);
  map.set(id, locations);
}

export function auditSpec(specRoot) {
  const root = resolve(specRoot);
  const errors = [];
  for (const file of requiredFiles) {
    if (!existsSync(join(root, file))) errors.push(`missing required ${file}`);
  }
  if (errors.length) return { errors, requirementCount: 0, decisionCount: 0 };

  const documents = new Map();
  const definitions = {
    REQ: new Map(),
    AC: new Map(),
    BQ: new Map(),
    SD: new Map(),
  };
  for (const absoluteOrRelative of collectMarkdown(root)) {
    const file = relative(root, join(root, absoluteOrRelative)).replaceAll(
      '\\',
      '/',
    );
    const text = withoutCodeFences(
      readFileSync(join(root, absoluteOrRelative), 'utf8').replace(
        /\r\n/g,
        '\n',
      ),
    );
    documents.set(file, text);
    const lines = text.split('\n');
    let expectedTableColumns;
    lines.forEach((line, index) => {
      const req = line.match(/^#{2,6}\s+(REQ-[A-Z]+-\d+)\b/);
      const ac = line.match(
        /^\s*(?:-\s+)?(AC-[A-Z]+-\d+)(?:\s*[:：]|\s*[（(])/,
      );
      const bq = line.match(/^\|\s*(BQ-\d+)\s*\|/);
      const sd = line.match(/^\|\s*(SD-\d+)\s*\|/);
      if (req) addDefinition(definitions.REQ, req[1], file, index + 1);
      if (ac) addDefinition(definitions.AC, ac[1], file, index + 1);
      if (bq && file === 'BUSINESS-REVIEW.md' && !definitions.BQ.has(bq[1])) {
        addDefinition(definitions.BQ, bq[1], file, index + 1);
      }
      if (sd && file === 'DECISIONS.md') {
        addDefinition(definitions.SD, sd[1], file, index + 1);
      }

      if (/^\s*\|/.test(line)) {
        const columns = unescapedPipeCount(line);
        expectedTableColumns ??= columns;
        if (columns !== expectedTableColumns) {
          errors.push(
            `${file}:${index + 1} table columns ${columns}, expected ${expectedTableColumns}`,
          );
        }
      } else {
        expectedTableColumns = undefined;
      }
    });
  }

  for (const [kind, entries] of Object.entries(definitions)) {
    for (const [id, locations] of entries) {
      if (locations.length > 1) {
        errors.push(`duplicate ${id}: ${locations.join(', ')}`);
      }
    }
    const prefix = kind === 'REQ' || kind === 'AC' ? `${kind}-[A-Z]+` : kind;
    for (const [file, text] of documents) {
      for (const id of expandedIds(text, prefix)) {
        if (!entries.has(id)) errors.push(`${file} references missing ${id}`);
      }
    }
  }

  const decisions = [...definitions.SD.keys()].sort();
  const currentDecision = decisions.at(-1);
  for (const file of ['README.md', 'READINESS.md', 'TECHNICAL-DESIGN.md']) {
    if (
      currentDecision &&
      !expandedIds(documents.get(file), 'SD').has(currentDecision)
    ) {
      errors.push(`${file} does not declare current ${currentDecision}`);
    }
  }
  for (const marker of currentTechnicalMarkers) {
    for (const file of ['README.md', 'READINESS.md', 'TECHNICAL-DESIGN.md']) {
      if (!documents.get(file).includes(marker)) {
        errors.push(`${file} does not declare current ${marker}`);
      }
    }
  }

  errors.push(
    ...auditImplementationStatusOwnership(documents.get('README.md')),
  );

  return {
    errors: [...new Set(errors)].sort(),
    requirementCount: definitions.REQ.size,
    acceptanceCount: definitions.AC.size,
    reviewQuestionCount: definitions.BQ.size,
    decisionCount: definitions.SD.size,
  };
}

function run() {
  const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = auditSpec(join(projectRoot, 'docs/spec/v0.1'));
  if (result.errors.length) {
    console.error(`Spec check failed (${result.errors.length}):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Spec check passed: ${result.requirementCount} REQ, ${result.acceptanceCount} AC, ${result.reviewQuestionCount} BQ, ${result.decisionCount} SD.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run();
}
