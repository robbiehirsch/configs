// KeymapBar content enhancer — injected into EVERY page the app loads.
// Lives at ~/configs/keymapbar/enhance.js; edit + Reload in app, no rebuild.
//
// Adds, to any HTML with <h2> sections and <table> rows:
//   • sticky top bar: fuzzy search + one jump-chip per section
//   • click a section header (or its chip twice) to collapse/expand
//   • "/" focuses search from anywhere; Esc clears and restores
//   • #q=... in the URL prefills the search (used by chips deep-links/tests)
(function () {
  if (window.__kbEnhanced) return;
  window.__kbEnhanced = true;

  const h2s = Array.from(document.querySelectorAll("h2"));
  if (h2s.length === 0) return;

  // ── wrap each h2 + its following siblings into a .kb-sec ───────────────
  h2s.forEach((h2, i) => {
    const sec = document.createElement("div");
    sec.className = "kb-sec";
    sec.id = "kb-sec-" + i;
    h2.parentNode.insertBefore(sec, h2);
    let node = h2;
    while (node && !(node.tagName === "H2" && node !== h2)) {
      const next = node.nextSibling;
      sec.appendChild(node);
      node = next;
      if (node && node.tagName === "H2") break;
    }
  });
  const secs = Array.from(document.querySelectorAll(".kb-sec"));

  // ── styles ──────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    .kb-bar { position: sticky; top: 0; z-index: 99; margin: 0 -16px 10px;
      padding: 5px 16px; background: var(--kb-bg, rgba(40,42,60,.92));
      backdrop-filter: blur(10px); border-bottom: 1px solid rgba(128,128,160,.25);
      display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; }
    .kb-search { box-sizing: border-box; font: inherit;
      font-size: 11.5px; padding: 4px 9px; border-radius: 7px;
      border: 1px solid rgba(128,128,160,.4); background: rgba(128,128,160,.12);
      color: inherit; outline: none; flex: 0 1 190px; min-width: 120px; }
    .kb-search:focus { border-color: #7aa2f7; }
    .kb-chips { display: flex; flex-wrap: nowrap; gap: 4px; flex: 1;
      overflow: hidden; }
    /* expanded: input takes its own row, every chip visible and wrapping */
    .kb-bar.kb-open { flex-wrap: wrap; }
    .kb-bar.kb-open .kb-search { flex: 1 0 100%; }
    .kb-bar.kb-open .kb-chips { flex-wrap: wrap; overflow: visible; }
    .kb-bar.kb-open .kb-chip.kb-extra { display: inline-block; }
    .kb-bar.kb-open .kb-more { display: none; }
    .kb-chip.kb-extra { display: none; }
    .kb-more { opacity: .6; flex: 0 0 auto; }
    .kb-chip { font-size: 9.5px; padding: 2px 8px; border-radius: 99px;
      border: 1px solid rgba(128,128,160,.35); background: rgba(128,128,160,.10);
      color: inherit; cursor: pointer; user-select: none; white-space: nowrap; }
    .kb-chip:hover { border-color: #7aa2f7; color: #7aa2f7; }
    .kb-chip.kb-off { opacity: .38; }
    .kb-sec > h2 { cursor: pointer; }
    .kb-sec > h2::before { content: "▾ "; font-size: 9px; opacity: .55; }
    .kb-sec.kb-collapsed > h2::before { content: "▸ "; }
    .kb-sec.kb-collapsed > :not(h2) { display: none; }
    .kb-hide { display: none !important; }
    mark.kb { background: rgba(122,162,247,.35); color: inherit; border-radius: 2px; }
  `;
  document.head.appendChild(style);

  // bar background = the page's own background at ~92% opacity, so the
  // enhancer adapts to whatever theme the content uses (dark or light)
  for (const el of [document.body, document.documentElement]) {
    const bg = getComputedStyle(el).backgroundColor;
    const mm = bg && bg.match(/rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/);
    if (mm && bg !== "rgba(0, 0, 0, 0)") {
      document.documentElement.style.setProperty(
        "--kb-bg", `rgba(${mm[1]},${mm[2]},${mm[3]},0.92)`);
      break;
    }
  }

  // ── top bar ─────────────────────────────────────────────────────────────
  const bar = document.createElement("div");
  bar.className = "kb-bar";
  const input = document.createElement("input");
  input.className = "kb-search";
  input.type = "search";
  input.placeholder = "fuzzy search…  ( / )";
  const chips = document.createElement("div");
  chips.className = "kb-chips";

  // usage-ranked suggestions: the 4 sections you actually jump to float into
  // the collapsed bar; everything else lives behind the "⋯ +n" pill / hover
  const SUGGEST = 4;
  let usage = {};
  try { usage = JSON.parse(localStorage.getItem("kb-usage") || "{}"); } catch (e) {}
  const title = (sec) => sec.querySelector("h2").textContent.trim();
  const suggested = new Set(
    secs.slice()
      .sort((a, b) => (usage[title(b)] || 0) - (usage[title(a)] || 0))
      .slice(0, SUGGEST)
  );

  secs.forEach((sec) => {
    const chip = document.createElement("span");
    chip.className = "kb-chip" + (suggested.has(sec) ? "" : " kb-extra");
    chip.textContent = title(sec);
    chip.onclick = () => {
      usage[title(sec)] = (usage[title(sec)] || 0) + 1;
      try { localStorage.setItem("kb-usage", JSON.stringify(usage)); } catch (e) {}
      if (sec.classList.contains("kb-collapsed")) sec.classList.remove("kb-collapsed");
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    chips.appendChild(chip);
    sec.__chip = chip;
  });

  if (secs.length > SUGGEST) {
    const more = document.createElement("span");
    more.className = "kb-chip kb-more";
    more.textContent = `⋯ +${secs.length - SUGGEST}`;
    more.onclick = () => bar.classList.add("kb-open");
    bar.__more = more;
  }

  bar.appendChild(input);
  bar.appendChild(chips);
  if (bar.__more) bar.appendChild(bar.__more); // outside the clipped strip
  document.body.insertBefore(bar, document.body.firstChild);

  // expand on hover or search focus; collapse when both end and no query
  const maybeClose = () => {
    if (!bar.matches(":hover") && document.activeElement !== input && !input.value.trim()) {
      bar.classList.remove("kb-open");
    }
  };
  bar.addEventListener("mouseenter", () => bar.classList.add("kb-open"));
  bar.addEventListener("mouseleave", maybeClose);
  input.addEventListener("focus", () => bar.classList.add("kb-open"));
  input.addEventListener("blur", () => setTimeout(maybeClose, 120));

  // ── collapse on header click ────────────────────────────────────────────
  secs.forEach((sec) => {
    sec.querySelector("h2").addEventListener("click", () => {
      sec.classList.toggle("kb-collapsed");
    });
  });

  // ── fuzzy search ────────────────────────────────────────────────────────
  function fuzzy(q, text) {
    // subsequence match, case-insensitive; all space-separated terms must hit
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((term) => {
      let i = 0;
      const t = text.toLowerCase();
      for (const ch of term) {
        i = t.indexOf(ch, i);
        if (i === -1) return false;
        i++;
      }
      return true;
    });
  }

  let collapsedBeforeSearch = null;
  function applyFilter() {
    const q = input.value.trim();
    if (q && collapsedBeforeSearch === null) {
      collapsedBeforeSearch = secs.map((s) => s.classList.contains("kb-collapsed"));
      secs.forEach((s) => s.classList.remove("kb-collapsed"));
    }
    if (!q) {
      if (collapsedBeforeSearch) {
        secs.forEach((s, i) => s.classList.toggle("kb-collapsed", collapsedBeforeSearch[i]));
        collapsedBeforeSearch = null;
      }
      document.querySelectorAll(".kb-hide").forEach((el) => el.classList.remove("kb-hide"));
      secs.forEach((s) => s.__chip.classList.remove("kb-off"));
      return;
    }
    secs.forEach((sec) => {
      let secHit = false;
      sec.querySelectorAll("tr").forEach((tr) => {
        const hit = fuzzy(q, tr.textContent);
        tr.classList.toggle("kb-hide", !hit);
        if (hit) secHit = true;
      });
      // non-table content (paragraphs/lists) counts toward the section too
      if (!secHit) secHit = fuzzy(q, sec.textContent);
      sec.classList.toggle("kb-hide", !secHit);
      sec.__chip.classList.toggle("kb-off", !secHit);
    });
  }
  input.addEventListener("input", applyFilter);

  // ── keys: "/" focus, Esc clear ──────────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input) {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (e.key === "Escape") {
      input.value = "";
      applyFilter();
      input.blur();
    }
  });

  // external entry point: the app calls this for Spotlight deep-links
  window.__kbSearch = (q) => {
    input.value = q;
    bar.classList.add("kb-open");
    applyFilter();
  };

  // ── #q= prefill (deep links + testability) ─────────────────────────────
  const m = location.hash.match(/^#q=(.+)$/);
  if (m) {
    window.__kbSearch(decodeURIComponent(m[1]));
  }
})();
