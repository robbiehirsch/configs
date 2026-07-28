#!/usr/bin/env python3
"""KeymapBar generator: JSON keymap dump + tmux.conf -> tabbed HTML content.

Stdlib only, so it runs on the macOS system python3 with no pip installs.

Usage: render.py <nvim_dump.json> <tmux.conf> <output_dir>
"""
import html
import json
import pathlib
import re
import sys

# ── nvim grouping ─────────────────────────────────────────────────────────
# Ordered: first match wins. Edit freely — this only affects grouping and
# labels, never the bindings themselves (those come from the live dump).
SECTIONS = [
    (r"^<leader>f", "Find (Telescope)"),
    (r"^<leader>s", "Search"),
    (r"^<leader>g", "Git"),
    (r"^<leader>l", "LSP"),
    (r"^<leader>m", "Pinboard"),
    (r"^<leader>r", "Curlman"),
    (r"^<leader>u$", "Curlman"),
    (r"^<leader>x", "Diagnostics / Quickfix"),
    (r"^<leader>t", "Terminal / Test"),
    (r"^<leader>d", "Debug"),
    (r"^<leader>w", "Windows / Write"),
    (r"^<leader>o", "Tasks (Overseer)"),
    (r"^<leader>p", "Plugins"),
    (r"^<leader>G", "Go"),
    (r"^<leader>n", "Node swap"),
    (r"^<leader>T", "Treesitter"),
    (r"^<leader>a", "AWS / AI"),
    (r"^<leader>b", "Buffers / Tree"),
    (r"^<leader><tab>", "Tabs"),
    (r"^<leader>", "Leader (misc)"),
    (r"^g", "Goto / LSP / Comment"),
    (r"^[\[\]]", "Jumps"),
    (r"^<[cCaA]-", "Ctrl / Alt"),
    (r"", "Other"),
]

MODE_BADGE = {"n": "", "v": "v", "x": "v", "o": "o", "i": "i", "t": "t"}


def norm_lhs(lhs: str, leader: str) -> str:
    disp = lhs
    if leader and leader != "\\":
        if disp.startswith(leader):
            disp = "<leader>" + disp[len(leader):]
    return disp


def load_nvim(path: pathlib.Path):
    data = json.loads(path.read_text())
    leader = data.get("leader", " ")
    rows = {}  # (lhs, desc) -> set of badges
    for m in data["maps"]:
        lhs = norm_lhs(m["lhs"], leader)
        desc = (m.get("desc") or "").strip()
        if not desc:
            rhs = (m.get("rhs") or "").strip()
            if not rhs or rhs == "<lua fn>" or len(rhs) > 40 or "<Plug>" in rhs:
                continue  # unnameable internals: skip rather than mislead
            desc = html.escape(rhs)
        key = (lhs, desc)
        rows.setdefault(key, set()).add(MODE_BADGE.get(m["mode"], m["mode"]))
    return rows


def group_nvim(rows):
    grouped = {}
    for (lhs, desc), badges in sorted(rows.items(), key=lambda kv: kv[0][0].lower()):
        for pat, title in SECTIONS:
            if re.search(pat, lhs):
                grouped.setdefault(title, []).append((lhs, desc, badges))
                break
    # preserve SECTIONS order
    order = []
    for _, title in SECTIONS:
        if title in grouped and title not in order:
            order.append(title)
    return [(t, grouped[t]) for t in order]


# ── tmux.conf parsing ─────────────────────────────────────────────────────
def parse_tmux(path: pathlib.Path):
    sections, current, comment = [], ("Bindings", []), []
    header_re = re.compile(r"^#\s*─+\s*(.+?)\s*─+")
    # -n and -r are bare flags; only -T takes a value (the key table)
    bind_re = re.compile(r"^bind(?:-key)?\s+((?:-n\s+|-r\s+|-T\s+\S+\s+)*)(\S+)\s+(.+)$")
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line:
            comment = []
            continue
        h = header_re.match(line)
        if h:
            if current[1]:
                sections.append(current)
            current = (h.group(1).title(), [])
            comment = []
            continue
        if line.startswith("#"):
            text = line.lstrip("# ").strip()
            if text:
                comment.append(text)
            continue
        b = bind_re.match(line)
        if b:
            flags, key, cmd = b.groups()
            flags = flags or ""
            if "-T copy-mode" in flags:
                keylabel = f"{key} (copy mode)"
            elif "-n" in flags.split():
                keylabel = key
            else:
                keylabel = f"prefix {key}"
            # full comment block, tidied: joined lines, arrow prefix like
            # "prefix+g —" stripped (the key column already says that)
            desc = " ".join(comment) if comment else cmd
            desc = re.sub(r"^\S+\s*(→|—)\s*", "", desc)
            if len(desc) > 110:
                desc = desc[:107].rstrip() + "…"
            current[1].append((keylabel, desc))
            # keep the comment: one comment often labels a run of related
            # binds (e.g. the four pane-navigation keys)
            continue
        comment = []
    if current[1]:
        sections.append(current)
    return sections


# ── HTML ──────────────────────────────────────────────────────────────────
CSS = """
* { box-sizing: border-box; }
html { background: #1a1b26; }
body { font-family: -apple-system, "Helvetica Neue", sans-serif; font-size: 12px;
  line-height: 1.5; color: #c0caf5; margin: 0; padding: 14px 16px 24px; }
h1 { font-size: 17px; color: #7aa2f7; margin: 0 0 2px; }
.sub { color: #565f89; font-size: 10.5px; margin: 0 0 12px; }
.cols { columns: 330px 2; column-gap: 22px; }
h2 { font-size: 12.5px; color: #7aa2f7; margin: 14px 0 4px; padding-bottom: 3px;
  border-bottom: 1px solid #3b4261; break-after: avoid; }
h2:first-of-type { margin-top: 0; }
table { width: 100%; border-collapse: collapse; margin: 2px 0 10px; break-inside: avoid; }
td { padding: 3.5px 8px 3.5px 2px; border-bottom: 1px solid #24283b;
  vertical-align: top; color: #a9b1d6; }
td:first-child { white-space: nowrap; width: 38%; }
code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px;
  background: #2f3450; border: 1px solid #414868; border-radius: 4px;
  padding: 1px 5px; color: #7dcfff; font-weight: 600; }
.badge { font-size: 9px; color: #e0af68; margin-left: 4px; }
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-thumb { background: #3b4261; border-radius: 4px; }
"""


def page(title, sub, body):
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style>'
            f'</head><body><h1>{title}</h1><p class="sub">{sub}</p>'
            f'<div class="cols">{body}</div></body></html>')


def render_nvim(rows, out):
    parts = []
    for title, items in group_nvim(rows):
        parts.append(f"<h2>{html.escape(title)}</h2><table>")
        for lhs, desc, badges in items:
            badge = "".join(f'<span class="badge">{b}</span>' for b in sorted(badges) if b)
            parts.append(
                f"<tr><td><code>{html.escape(lhs)}</code>{badge}</td>"
                f"<td>{desc}</td></tr>")
        parts.append("</table>")
    out.write_text(page("Neovim", "generated from the live config — cannot drift",
                        "".join(parts)))
    print(f"wrote {out}")


def render_tmux(sections, out):
    parts = []
    for title, items in sections:
        parts.append(f"<h2>{html.escape(title)}</h2><table>")
        for key, desc in items:
            parts.append(
                f"<tr><td><code>{html.escape(key)}</code></td>"
                f"<td>{html.escape(desc)}</td></tr>")
        parts.append("</table>")
    out.write_text(page("tmux", "generated from tmux.conf — cannot drift",
                        "".join(parts)))
    print(f"wrote {out}")


def write_spotlight(nvim_rows, tmux_sections, out):
    """spotlight.json — consumed by the app to index every binding in macOS
    Spotlight. Clicking a result opens KeymapBar pre-searched for that key."""
    # NOTE: keys are NOT tag-stripped — "<C-d>" and "<leader>lf" only LOOK
    # like HTML. Descriptions are ours (plain text, possibly entity-escaped).
    items = []
    for (lhs, desc), _badges in sorted(nvim_rows.items()):
        items.append({"tab": "10-nvim", "key": lhs, "desc": html.unescape(desc)})
    for _title, rows in tmux_sections:
        for key, desc in rows:
            items.append({"tab": "20-tmux", "key": key, "desc": desc})
    out.write_text(json.dumps(items, indent=0))
    print(f"wrote {out} ({len(items)} items)")


if __name__ == "__main__":
    dump, tmux_conf, outdir = map(pathlib.Path, sys.argv[1:4])
    outdir.mkdir(parents=True, exist_ok=True)
    nvim_rows = load_nvim(dump)
    tmux_sections = parse_tmux(tmux_conf)
    render_nvim(nvim_rows, outdir / "10-nvim.html")
    render_tmux(tmux_sections, outdir / "20-tmux.html")
    write_spotlight(nvim_rows, tmux_sections, outdir / "spotlight.json")
