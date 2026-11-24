import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const CHECK = process.argv.includes('--check');

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name).replace(/\\/g, '/');
    if (entry.isDirectory()) collect(p, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const RANK = {
  typeImport: 0,
  valueImport: 1,
  reexport: 2,
  constant: 3,
  type: 4,
  func: 5,
  lateConstant: 5.5,
  other: 6,
};

const RANK_LABEL = {
  0: 'import type',
  1: '值 import',
  2: '转口',
  3: '常量',
  4: '类型',
  5: '函数/class',
  5.5: '依赖 class 的常量',
  6: '其他语句',
};

const modsOf = s => (ts.canHaveModifiers(s) ? ts.getModifiers(s) ?? [] : []);
const hasMod = (s, kind) => modsOf(s).some(m => m.kind === kind);
const relOf = file => file.slice(ROOT.length + 1).replace(/\\/g, '/');

function analyzeFile(file, problems, constants) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const rel = relOf(file);
  const at = node => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const fail = (node, message) => problems.push(`${rel}:${node ? at(node) : 1}  ${message}`);

  const callableNames = new Set();
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s)) continue;
    const callable = s.declarationList.declarations.every(d => d.initializer
      && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)));
    if (!callable) continue;
    for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) callableNames.add(d.name.text);
    }
  }

  const classNames = new Set(
    sf.statements.filter(s => ts.isClassDeclaration(s) && s.name).map(s => s.name.text),
  );
  const isLateConstant = s => {
    let hit = false;
    const visit = node => {
      if (hit) return;
      if (ts.isIdentifier(node) && (classNames.has(node.text) || callableNames.has(node.text))) {
        hit = true;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(s);
    return hit;
  };

  const isIndex = /\/index\.tsx?$/.test(file);
  const isBarrel = isIndex && sf.statements.length > 0
    && sf.statements.every(s => ts.isExportDeclaration(s) && Boolean(s.moduleSpecifier));
  let rank = -1;
  let lastImportSpec = null;
  let lastImportRank = -1;
  let previous = null;
  let previousRank = -1;

  for (const s of sf.statements) {
    let current;
    let spec = null;

    if (ts.isImportDeclaration(s)) {
      const typeOnly = Boolean(s.importClause?.isTypeOnly);
      current = typeOnly ? RANK.typeImport : RANK.valueImport;
      spec = s.moduleSpecifier.text;
    } else if (ts.isExportDeclaration(s) && s.moduleSpecifier) {
      current = RANK.reexport;
      spec = s.moduleSpecifier.text;
    } else if (ts.isExportDeclaration(s)) {
      fail(s, '不要末尾 export {} 汇总块，直接在声明处 export');
      current = rank < 0 ? RANK.other : rank;
    } else if (ts.isExportAssignment(s)) {
      fail(s, '不使用 export default');
      current = RANK.other;
    } else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) {
      current = RANK.type;
    } else if (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) {
      current = RANK.func;
    } else if (ts.isVariableStatement(s)) {
      const callable = s.declarationList.declarations.every(d => d.initializer
        && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)));
      if (callable) current = RANK.func;
      else current = isLateConstant(s) ? RANK.lateConstant : RANK.constant;
      if (!isBarrel) {
        for (const d of s.declarationList.declarations) {
          if (!ts.isIdentifier(d.name)) continue;
          const isUpper = /^[A-Z][A-Z0-9_]*$/.test(d.name.text);
          if (!isUpper) continue;
          constants.push({
            name: d.name.text,
            file: rel,
            line: at(d),
            value: (d.initializer ? d.initializer.getText(sf) : '').replace(/\s+/g, ' '),
          });
        }
      }
    } else {
      current = RANK.other;
    }

    if (hasMod(s, ts.SyntaxKind.DefaultKeyword)) fail(s, '不使用 export default');

    if (current < rank) {
      fail(s, `顺序错误：${RANK_LABEL[current]} 出现在 ${RANK_LABEL[rank]} 之后`);
    }
    rank = Math.max(rank, current);

    if (spec !== null) {
      if (current === lastImportRank && lastImportSpec !== null && spec < lastImportSpec) {
        fail(s, `import 未按路径升序：'${spec}' 排在 '${lastImportSpec}' 之后`);
      }
      lastImportSpec = spec;
      lastImportRank = current;
    } else if (current <= RANK.valueImport) {
      lastImportSpec = null;
      lastImportRank = -1;
    }

    if (previous && spec !== null && previousRank === current) {
      const gap = text.slice(previous.getEnd(), s.getStart());
      if (/\n\s*\n/.test(gap)) fail(s, '同一 import 块内不得空行');
    }
    previous = s;
    previousRank = current;
  }

  if (isBarrel) {
    for (const s of sf.statements) {
      if (ts.isImportDeclaration(s) || !ts.isExportDeclaration(s)) {
        fail(s, 'barrel 只放 export ... from');
        break;
      }
    }
  }
}

function reportDuplicates(constants) {
  const byName = new Map();
  for (const c of constants) {
    if (!byName.has(c.name)) byName.set(c.name, []);
    byName.get(c.name).push(c);
  }
  const conflicts = [];
  const duplicates = [];
  for (const [name, list] of byName) {
    if (list.length < 2) continue;
    const values = new Set(list.map(c => c.value));
    if (values.size > 1) conflicts.push({ name, list });
    else duplicates.push({ name, list });
  }
  const byValue = new Map();
  for (const c of constants) {
    if (!c.value || c.value.length < 3) continue;
    if (/^[-+]?\d*\.?\d+$/.test(c.value)) continue;
    if (!byValue.has(c.value)) byValue.set(c.value, []);
    byValue.get(c.value).push(c);
  }
  const sameValue = [...byValue.entries()].filter(([, list]) => {
    const names = new Set(list.map(c => c.name));
    return names.size > 1;
  });

  console.log('\n重复常量检查');
  console.log(`  同名同值        ${duplicates.length}`);
  console.log(`  同名不同值      ${conflicts.length}`);
  console.log(`  同值不同名      ${sameValue.length}`);

  for (const { name, list } of conflicts.slice(0, 20)) {
    console.log(`\n  同名不同值: ${name}`);
    for (const c of list) console.log(`    ${c.file}:${c.line}  = ${c.value}`);
  }
  for (const { name, list } of duplicates.slice(0, 20)) {
    console.log(`\n  同名同值: ${name}`);
    for (const c of list) console.log(`    ${c.file}:${c.line}  = ${c.value}`);
  }
  for (const [value, list] of sameValue.slice(0, 20)) {
    console.log(`\n  同值不同名: ${value}`);
    for (const c of list) console.log(`    ${c.file}:${c.line}  ${c.name}`);
  }
  return duplicates.length;
}

const files = collect(SRC).sort();
const problems = [];
const constants = [];
for (const file of files) analyzeFile(file, problems, constants);
const conflictCount = reportDuplicates(constants);

console.log(`\n结构检查（${files.length} 个文件）`);
if (!problems.length) {
  console.log('  无问题');
} else {
  console.log(`  ${problems.length} 处`);
  for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
  if (problems.length > 60) console.log(`  ... 另有 ${problems.length - 60} 处`);
}

if (CHECK) {
  if (problems.length) {
    console.error(`\nFAIL: ${problems.length} 处结构问题。`);
    process.exit(1);
  }
  if (conflictCount) {
    console.error(`\nFAIL: ${conflictCount} 个常量在不同文件重复定义。`);
    process.exit(1);
  }
  console.log('\nPASS: 文件结构符合规范。');
}
