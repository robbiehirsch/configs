/* ---------------------------------------------------------------- tiny ui kit
 * Extracted verbatim from the prototype's server.js/client.js, which each
 * carried their own copy. Single source now; the terminal UI is the only
 * consumer. Pure string helpers — no I/O, no state, trivially testable.
 */
const C = {
  rst: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  gray: '\x1b[38;5;244m', dark: '\x1b[38;5;238m', white: '\x1b[38;5;253m',
  cyan: '\x1b[38;5;80m', blue: '\x1b[38;5;75m', green: '\x1b[38;5;114m',
  yellow: '\x1b[38;5;179m', red: '\x1b[38;5;203m', mag: '\x1b[38;5;176m',
  alt: '\x1b[?1049h', unalt: '\x1b[?1049l', hide: '\x1b[?25l', show: '\x1b[?25h',
  home: '\x1b[H', clrLine: '\x1b[K', clrDown: '\x1b[J',
};
const BADGE = {
  message:   '\x1b[48;5;24m\x1b[38;5;153m',
  delta:     '\x1b[48;5;23m\x1b[38;5;115m',
  snapshot:  '\x1b[48;5;53m\x1b[38;5;183m',
  heartbeat: '\x1b[48;5;236m\x1b[38;5;245m',
  error:     '\x1b[48;5;52m\x1b[38;5;210m',
  reconnect: '\x1b[48;5;58m\x1b[38;5;222m',
};
const PROTO_BG = '\x1b[48;5;54m\x1b[38;5;189m';   // violet — protocol, not payload
const C_PROTO = '\x1b[38;5;141m';
const ITAL = '\x1b[3m';
const SPARK = '▁▂▃▄▅▆▇█';
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const vw = (s) => strip(s).length;
const padE = (s, w) => s + ' '.repeat(Math.max(0, w - vw(s)));
const padS = (s, w) => ' '.repeat(Math.max(0, w - vw(s))) + s;
const cut = (s, n) => (s.length <= n ? s : s.slice(0, Math.max(0, n - 1)) + '…');
const num = (n) => (n == null ? '-' : Math.round(n).toLocaleString('en-US').replace(/,/g, ' '));
const badge = (t) => `${BADGE[t] || BADGE.message} ${t} ${C.rst}`;
const heat = (v, warn, bad) => (v >= bad ? C.red : v >= warn ? C.yellow : C.green);
const spark = (d, w) => {
  const a = d.slice(-w);
  if (!a.length) return '';
  const mx = Math.max(...a, 1);
  return a.map((v) => SPARK[Math.min(7, Math.floor((v / mx) * 7.99))]).join('');
};
/** Panel with an inset title: ┌ TITLE ─────┐ */
function box(title, width, lines) {
  const inner = width - 2;
  const head = title
    ? `${C.dark}┌${C.rst} ${C.gray}${title}${C.rst} ${C.dark}${'─'.repeat(Math.max(0, inner - vw(title) - 3))}┐${C.rst}`
    : `${C.dark}┌${'─'.repeat(inner)}┐${C.rst}`;
  const out = [head];
  for (const l of lines) out.push(`${C.dark}│${C.rst}${padE(l, inner)}${C.dark}│${C.rst}`);
  out.push(`${C.dark}└${'─'.repeat(inner)}┘${C.rst}`);
  return out;
}
/** Place panels side by side, padding each to its declared width. */
function hstack(panels, widths, gap = 1) {
  const h = Math.max(...panels.map((p) => p.length));
  const out = [];
  for (let i = 0; i < h; i++) {
    out.push(panels.map((p, j) => padE(p[i] ?? '', widths[j])).join(' '.repeat(gap)));
  }
  return out;
}


/** stdin arrives in chunks — fast typing or a paste delivers several keys at
 *  once ("R3\r"). Split into individual keys, keeping escape sequences whole. */
function splitKeys(chunk) {
  const out = [];
  for (let i = 0; i < chunk.length; i++) {
    if (chunk[i] === '\x1b') {
      let j = i + 1;
      if (chunk[j] === '[' || chunk[j] === 'O') {
        j++;
        while (j < chunk.length && !/[A-Za-z~]/.test(chunk[j])) j++;
      }
      out.push(chunk.slice(i, j + 1));
      i = j;
    } else out.push(chunk[i]);
  }
  return out;
}

export {
  C, BADGE, PROTO_BG, C_PROTO, ITAL, SPARK,
  strip, vw, padE, padS, cut, num, badge, heat, spark,
  box, hstack, splitKeys,
};
