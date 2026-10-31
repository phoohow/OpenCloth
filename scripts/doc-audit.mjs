#!/usr/bin/env node
/**
 * Audits docs/ for cross-references, heading levels and oversized paragraphs.
 * Exits with code 1 when any error is found; warnings alone exit 0.
 *
 * docs/draft holds target and historical documents whose filenames carry no
 * numeric prefix, so their findings are reported as warnings and never gate
 * the run; docs/user and docs/dev findings keep their own severity.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC_DIRS = ['docs/user', 'docs/dev', 'docs/draft'];
const ADVISORY_DIRS = ['docs/draft'];
const MAX_PARAGRAPH_CHARS = 220;

const toPosix = value => value.split(path.sep).join('/');

/** Lists every Markdown file below the given directory; absent directories contribute none. */
function listMarkdown(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

const files = DOC_DIRS.flatMap(dir => listMarkdown(path.join(ROOT, dir)))
  .map(file => toPosix(path.relative(ROOT, file)))
  .sort();

const docDirOf = file => file.split('/').slice(0, 2).join('/');
const basenameOf = file => path.posix.basename(file);

// Numeric prefix index per document directory, e.g. docs/user/02-版型设计.md -> "02".
const prefixIndex = new Map();
for (const file of files) {
  const dir = docDirOf(file);
  const match = /^(\d{2})-/.exec(basenameOf(file));
  if (!match) continue;
  if (!prefixIndex.has(dir)) prefixIndex.set(dir, new Map());
  const index = prefixIndex.get(dir);
  if (index.has(match[1])) index.set(match[1], null);
  else index.set(match[1], file);
}

/** Splits a file into lines, marking fenced code blocks. */
function readLines(file) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
  let fenced = false;
  return lines.map((text, i) => {
    if (/^\s*(```|~~~)/.test(text)) {
      fenced = !fenced;
      return { line: i + 1, text, fenced: true };
    }
    return { line: i + 1, text, fenced };
  });
}

const issues = new Map();
let advisoryCount = 0;

/** Records one finding for a file, merging repeats of the same message. */
function report(file, severity, line, message) {
  const advisory = ADVISORY_DIRS.some(dir => file.startsWith(`${dir}/`));
  const finalSeverity = advisory ? 'warning' : severity;
  if (advisory && severity === 'error') advisoryCount += 1;
  if (!issues.has(file)) issues.set(file, new Map());
  const key = `${finalSeverity}|${message}`;
  const bucket = issues.get(file);
  const existing = bucket.get(key);
  if (existing) existing.count += 1;
  else bucket.set(key, { severity: finalSeverity, line, message, count: 1 });
}

const headingsByFile = new Map();

/** Checks heading depth and duplicate numbering, and indexes section numbers. */
function auditHeadings(file, entries) {
  const headings = entries.filter(e => !e.fenced && /^#{1,6}\s+\S/.test(e.text));
  const numbers = new Set();
  const numbersSeen = new Map();
  let previous = null;
  for (const entry of headings) {
    const match = /^(#{1,6})\s+(.+)$/.exec(entry.text);
    const level = match[1].length;
    const title = match[2].trim();
    if (level > 4) {
      report(file, 'error', entry.line, `标题层级 h${level} 超过四级：${title}`);
    }
    if (previous && level > previous.level + 1) {
      report(file, 'error', entry.line, `标题层级跳级 h${previous.level} → h${level}：${title}`);
    }
    const number = /^(\d+(?:\.\d+)*)\.?(?=\s|$)/.exec(title);
    if (number) {
      const id = number[1];
      if (numbersSeen.has(id)) {
        report(file, 'error', entry.line, `重复的编号标题 §${id}（首见第 ${numbersSeen.get(id)} 行）：${title}`);
      } else {
        numbersSeen.set(id, entry.line);
        numbers.add(id);
      }
    }
    previous = { level };
  }
  headingsByFile.set(file, numbers);
}

const LINK_REF = /!?\[[^\]]*\]\(\s*([^)\s]+\.md)(?:#[^)]*)?\s*\)\s*(§\s*\d+(?:\.\d+)*(?:\s*[、，,]\s*§\s*\d+(?:\.\d+)*)*)?/g;
const NUMBERED_REF = /(?<![\d.])(\d{2})\s*§\s*(\d+(?:\.\d+)*)((?:\s*[、，,]\s*§\s*\d+(?:\.\d+)*)*)/g;
const SELF_REF = /[（(]\s*§\s*(\d+(?:\.\d+)*)((?:\s*[、，,]\s*§\s*\d+(?:\.\d+)*)*)\s*[）)]/g;

const refsOf = tail => [...tail.matchAll(/§\s*(\d+(?:\.\d+)*)/g)].map(m => m[1]);

/** Resolves a link target to an audited document, or null when it is outside docs/. */
function resolveLink(file, target) {
  const resolved = toPosix(path.posix.normalize(path.posix.join(path.posix.dirname(file), target)));
  if (files.includes(resolved)) return resolved;
  if (fs.existsSync(path.join(ROOT, resolved))) return null;
  report(file, 'warning', 0, `链接目标不存在：${target}`);
  return null;
}

/** Checks that every referenced section exists in its target document. */
function auditReferences(file, entries) {
  const self = headingsByFile.get(file);
  const dir = docDirOf(file);
  for (const entry of entries) {
    if (entry.fenced) continue;
    const text = entry.text;

    for (const match of text.matchAll(LINK_REF)) {
      const target = resolveLink(file, match[1]);
      if (!target || !match[2]) continue;
      for (const section of refsOf(match[2])) {
        if (!headingsByFile.get(target).has(section)) {
          report(file, 'error', entry.line, `§${section} 不存在于 ${basenameOf(target)}（${match[1]}）`);
        }
      }
    }

    for (const match of text.matchAll(NUMBERED_REF)) {
      const sections = [match[2], ...refsOf(match[3])];
      const local = prefixIndex.get(dir)?.get(match[1]);
      const candidates = local ? [local] : [...prefixIndex.values()].map(index => index.get(match[1])).filter(Boolean);
      if (!candidates.length) {
        report(file, 'warning', entry.line, `文档编号 ${match[1]} 无法解析：docs/ 下没有 ${match[1]}-*.md`);
        continue;
      }
      const hits = candidates.filter(candidate => sections.every(section => headingsByFile.get(candidate).has(section)));
      if (hits.length) continue;
      const names = candidates.map(basenameOf).join('、');
      const scope = local ? '' : '（文档编号按 docs/ 全局解析）';
      report(file, 'error', entry.line, `${match[1]} §${sections.join('、§')} 不存在于 ${names}${scope}`);
    }

    for (const match of text.matchAll(SELF_REF)) {
      for (const section of [match[1], ...refsOf(match[2])]) {
        if (!self.has(section)) {
          report(file, 'error', entry.line, `本篇 §${section} 不存在`);
        }
      }
    }
  }
}

const isPlainText = text => {
  const trimmed = text.trim();
  if (trimmed === '') return false;
  if (/^#{1,6}\s/.test(trimmed)) return false;
  if (trimmed.startsWith('>')) return false;
  if (trimmed.startsWith('|')) return false;
  if (/^([-*+]|\d+[.)])\s/.test(trimmed)) return false;
  if (/^!\[[^\]]*\]\([^)]*\)\s*$/.test(trimmed)) return false;
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) return false;
  if (/^<[^>]+>/.test(trimmed)) return false;
  if (/^\s{2,}/.test(text)) return false;
  return true;
};

/** Reports paragraphs of plain prose longer than MAX_PARAGRAPH_CHARS characters. */
function auditParagraphs(file, entries) {
  let start = 0;
  let buffer = [];
  const flush = () => {
    if (!buffer.length) return;
    const text = buffer.join('').replace(/\s+/g, '');
    if (text.length > MAX_PARAGRAPH_CHARS) {
      report(file, 'warning', start, `长段落 ${text.length} 字（超过 ${MAX_PARAGRAPH_CHARS} 字）`);
    }
    buffer = [];
  };
  for (const entry of entries) {
    if (entry.fenced || !isPlainText(entry.text)) {
      flush();
      continue;
    }
    if (!buffer.length) start = entry.line;
    buffer.push(entry.text.trim());
  }
  flush();
}

// Headings are indexed for every file before references are resolved.
const entriesByFile = new Map(files.map(file => [file, readLines(file)]));
for (const file of files) auditHeadings(file, entriesByFile.get(file));
for (const file of files) {
  const entries = entriesByFile.get(file);
  auditReferences(file, entries);
  auditParagraphs(file, entries);
}

const order = { error: 0, warning: 1 };
let errorCount = 0;
let warningCount = 0;

for (const file of files) {
  const found = [...(issues.get(file)?.values() ?? [])].sort(
    (a, b) => a.line - b.line || order[a.severity] - order[b.severity],
  );
  if (!found.length) continue;
  console.log(`\n${file}`);
  for (const issue of found) {
    const label = issue.severity === 'error' ? 'error' : 'warn ';
    const where = issue.line ? `L${issue.line}` : '--';
    const times = issue.count > 1 ? `（共 ${issue.count} 处）` : '';
    console.log(`  ${label} ${where.padStart(6)}  ${issue.message}${times}`);
    if (issue.severity === 'error') errorCount += issue.count;
    else warningCount += issue.count;
  }
}

console.log(`\n扫描 ${files.length} 篇文档：${errorCount} 个 error，${warningCount} 个 warning。`);
if (advisoryCount) {
  console.log(`docs/draft 的 ${advisoryCount} 项按参考级降为 warning，不影响退出码。`);
}
process.exit(errorCount > 0 ? 1 : 0);
