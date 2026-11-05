/** Arithmetic expression evaluator used by POM formulas. */

/** Operators the formula parser understands. */
type Operator = '+' | '-' | '*' | '/' | '(' | ')';

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'name'; name: string }
  | { kind: 'op'; op: Operator };

const OPERATORS = new Set<string>(['+', '-', '*', '/', '(', ')']);

/** Splits a formula into numbers, names and operators. Names stop at whitespace or an operator. */
function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expression.length) {
    const ch = expression[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    if (OPERATORS.has(ch)) {
      tokens.push({ kind: 'op', op: ch as Operator });
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let text = ch;
      i++;
      while (i < expression.length && /[0-9.]/.test(expression[i]!)) {
        text += expression[i]!;
        i++;
      }
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`公式里的数字「${text}」无法识别`);
      tokens.push({ kind: 'number', value });
      continue;
    }
    let name = ch;
    i++;
    while (i < expression.length) {
      const next = expression[i]!;
      if (/\s/.test(next) || OPERATORS.has(next)) break;
      name += next;
      i++;
    }
    tokens.push({ kind: 'name', name });
  }
  return tokens;
}

/** Recursive-descent parser over the token list; `resolve` maps a POM name to its value. */
class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly resolve: (name: string) => number) { }

  parse(): number {
    const value = this.expression();
    if (this.index < this.tokens.length) {
      throw new Error(`公式出现多余的「${this.describe(this.tokens[this.index]!)}」`);
    }
    return value;
  }

  private expression(): number {
    let value = this.term();
    while (this.peekOp('+') || this.peekOp('-')) {
      const op = this.takeOp();
      const right = this.term();
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  private term(): number {
    let value = this.unary();
    while (this.peekOp('*') || this.peekOp('/')) {
      const op = this.takeOp();
      const right = this.unary();
      if (op === '/') {
        if (Math.abs(right) < 1e-12) throw new Error('公式除数为零');
        value /= right;
      } else {
        value *= right;
      }
    }
    return value;
  }

  private unary(): number {
    if (this.peekOp('+')) { this.index++; return this.unary(); }
    if (this.peekOp('-')) { this.index++; return -this.unary(); }
    return this.primary();
  }

  private primary(): number {
    const token = this.tokens[this.index];
    if (!token) throw new Error('公式结尾缺少运算数');
    if (token.kind === 'number') { this.index++; return token.value; }
    if (token.kind === 'name') {
      this.index++;
      const value = this.resolve(token.name);
      if (!Number.isFinite(value)) throw new Error(`测量点「${token.name}」没有有效值`);
      return value;
    }
    if (token.op === '(') {
      this.index++;
      const value = this.expression();
      if (!this.peekOp(')')) throw new Error('公式缺少右括号');
      this.index++;
      return value;
    }
    throw new Error(`公式里出现无法解析的「${this.describe(token)}」`);
  }

  private peekOp(op: Operator): boolean {
    const token = this.tokens[this.index];
    return token?.kind === 'op' && token.op === op;
  }

  private takeOp(): Operator {
    const token = this.tokens[this.index];
    if (token?.kind !== 'op') throw new Error('公式缺少运算符');
    this.index++;
    return token.op;
  }

  private describe(token: Token): string {
    if (token.kind === 'number') return String(token.value);
    if (token.kind === 'name') return token.name;
    return token.op;
  }
}

/** Evaluates one POM formula; `resolve` returns the value of a referenced POM name. */
export function evaluatePomFormula(expression: string, resolve: (name: string) => number): number {
  const trimmed = expression.trim();
  if (!trimmed) throw new Error('公式为空');
  const parser = new Parser(tokenize(trimmed), resolve);
  return parser.parse();
}
