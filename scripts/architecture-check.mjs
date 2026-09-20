import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { prismaModelOwners } from './prisma-model-owners.mjs';

const sourceExtensions = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);

function collectSources(root, directory) {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(directory, entry.name);
    if (entry.isDirectory()) return collectSources(root, child);
    return entry.isFile() && sourceExtensions.has(extname(entry.name))
      ? [child]
      : [];
  });
}

function moduleLocation(path) {
  const normalized = path.replaceAll('\\', '/');
  const match = normalized.match(
    /^(backend\/src\/modules|frontend\/src\/modules)\/([^/]+)(?:\/|$)/,
  );
  return match ? { root: match[1], name: match[2] } : null;
}

function scriptText(file, text) {
  if (extname(file) !== '.vue') return text;
  const masked = [...text].map((character) =>
    character === '\n' || character === '\r' ? character : ' ',
  );
  for (const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1];
    const bodyOffset = match.index + match[0].indexOf(body);
    for (let index = 0; index < body.length; index += 1) {
      masked[bodyOffset + index] = body[index];
    }
  }
  return masked.join('');
}

function importedSpecifiers(file, text) {
  const source = ts.createSourceFile(
    file,
    scriptText(file, text),
    ts.ScriptTarget.Latest,
    true,
    extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = [];
  const add = (node, value) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    imports.push({ value, line: line + 1 });
  };
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      add(node.argument.literal, node.argument.literal.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      (ts.isStringLiteral(node.arguments[0]) ||
        ts.isNoSubstitutionTemplateLiteral(node.arguments[0])) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === 'require'))
    ) {
      add(node.arguments[0], node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

function publicEntry(target, location) {
  const normalized = target
    .replaceAll('\\', '/')
    .replace(/\.(?:ts|tsx|js|mjs)$/, '');
  const moduleRoot = `/${location.root}/${location.name}`;
  return (
    normalized.endsWith(moduleRoot) ||
    normalized.endsWith(`${moduleRoot}/index`)
  );
}

export function auditArchitecture(root, owners = prismaModelOwners) {
  const errors = [];
  const files = [
    ...collectSources(root, 'backend/src/modules'),
    ...collectSources(root, 'frontend/src/modules'),
  ];

  for (const file of files) {
    const sourceModule = moduleLocation(file);
    const text = readFileSync(join(root, file), 'utf8');
    for (const imported of importedSpecifiers(file, text)) {
      if (!imported.value.startsWith('.')) continue;
      const target = relative(
        root,
        resolve(root, dirname(file), imported.value),
      );
      const targetModule = moduleLocation(target);
      if (
        targetModule &&
        targetModule.root === sourceModule.root &&
        targetModule.name !== sourceModule.name &&
        !publicEntry(resolve(root, target), targetModule)
      ) {
        errors.push(
          `ARCH-MODULE-IMPORT ${file}:${imported.line} cannot import ${imported.value}; use ${targetModule.name}/index`,
        );
      }
    }
  }

  const schema = readFileSync(
    join(root, 'backend/prisma/schema.prisma'),
    'utf8',
  );
  const models = [
    ...schema.matchAll(/^model\s+([A-Za-z][A-Za-z0-9]*)\s*\{/gm),
  ].map((match) => match[1]);
  for (const model of models) {
    if (!owners[model]) {
      errors.push(`ARCH-MODEL-OWNER ${model} has no owner`);
    }
  }
  for (const model of Object.keys(owners)) {
    if (!models.includes(model)) {
      errors.push(`ARCH-MODEL-OWNER ${model} is not a Prisma model`);
    }
  }

  return {
    errors: [...new Set(errors)].sort(),
    moduleCount: new Set(
      files
        .map(moduleLocation)
        .filter(Boolean)
        .map((module) => `${module.root}/${module.name}`),
    ).size,
    modelCount: models.length,
  };
}

function run() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = auditArchitecture(root);
  if (result.errors.length) {
    console.error(`Architecture check failed (${result.errors.length}):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Architecture check passed: ${result.moduleCount} modules, ${result.modelCount} Prisma models.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run();
}
