/**
 * Admin dashboard — one HTML document, vanilla JS, served by the health
 * server. No framework, no build step, nothing extra in the container.
 *
 * Auth: the page asks for ADMIN_TOKEN once, keeps it in sessionStorage, and
 * sends it as a Bearer header on every /admin/api call. The HTML itself is
 * public but holds nothing sensitive; every data call is gated server-side.
 *
 * Layout: the Dharmachakra wheel is the status instrument. Each of its eight
 * handles is one live reading (socket, inbound, outbound, uptime, Neon,
 * Redis, Groq, search) and the list beside it states the same readings in
 * words, so the wheel is never the only carrier of state. Below it, one
 * routing ledger holds every group and chat as a single editable row.
 *
 * Authoring rule: this whole page is a TypeScript template literal. Inside
 * it, never use a backtick or a dollar-brace, and write every backslash
 * twice. The unit test parses the inline script to catch slips.
 */
export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#050811">
<title>MAHORAGA — Control Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --void:#050811;
    --surface:#0a1020;
    --surface-2:#0e1628;
    --surface-3:#131d33;
    --line:rgba(148, 163, 184, 0.13);
    --line-strong:rgba(148, 163, 184, 0.24);
    --gold:#fbbf24;
    --gold-ink:#6b3f02;
    --gold-line:rgba(251, 191, 36, 0.55);
    --gold-faint:rgba(251, 191, 36, 0.10);
    --cyan:#38bdf8;
    --cyan-faint:rgba(56, 189, 248, 0.08);
    --cyan-line:rgba(56, 189, 248, 0.35);
    --emerald:#10b981;
    --emerald-text:#34d399;
    --amber:#f59e0b;
    --amber-text:#fbbf24;
    --crimson:#f43f5e;
    --crimson-text:#fb7185;
    --text:#e2e8f0;
    --text-strong:#f8fafc;
    --muted:#94a3b8;
    --faint:#7d8ba3;
    --sans:"Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif;
    --display:"Cinzel", Georgia, serif;
    --mono:"JetBrains Mono", ui-monospace, Consolas, monospace;
    --radius:12px;
    --radius-sm:8px;
  }
  * { box-sizing:border-box; }
  html { background:var(--void); color-scheme:dark; scrollbar-color:#24304a var(--void); }
  body {
    margin:0; min-height:100vh; color:var(--text); background:var(--void);
    font:14px/1.5 var(--sans); font-variant-numeric:tabular-nums;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  }
  ::selection { background:rgba(251, 191, 36, 0.32); color:#fff; }
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-track { background:var(--void); }
  ::-webkit-scrollbar-thumb { background:#24304a; border-radius:10px; border:2px solid var(--void); }
  ::-webkit-scrollbar-thumb:hover { background:#33415f; }
  h1, h2, h3, p { margin:0; }
  a { color:var(--cyan); text-underline-offset:3px; }
  button, input, select { font:inherit; color:inherit; }
  input, select, textarea { caret-color:var(--cyan); }
  :focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
  .hidden { display:none !important; }
  .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  .mono { font-family:var(--mono); font-size:12px; letter-spacing:0; }
  .ico { width:16px; height:16px; flex:none; fill:none; stroke:currentColor; stroke-width:1.75; stroke-linecap:round; stroke-linejoin:round; }

  /* ── controls ─────────────────────────────────────────────── */
  .btn {
    display:inline-flex; align-items:center; justify-content:center; gap:7px;
    height:34px; padding:0 13px; border-radius:var(--radius-sm);
    border:1px solid var(--line-strong); background:var(--surface-2); color:var(--text);
    font-weight:500; line-height:1; white-space:nowrap; cursor:pointer;
    transition:background .15s ease, border-color .15s ease, color .15s ease;
  }
  .btn:hover { background:var(--surface-3); border-color:rgba(148, 163, 184, 0.4); color:var(--text-strong); }
  .btn:active { background:#0b1222; }
  .btn:disabled { opacity:.45; cursor:default; }
  .btn-primary { background:var(--gold); border-color:var(--gold); color:#1a1206; font-weight:600; }
  .btn-primary:hover { background:#fcd34d; border-color:#fcd34d; color:#1a1206; }
  .btn-primary:active { background:#f59e0b; }
  .btn-danger { color:var(--crimson-text); border-color:rgba(244, 63, 94, 0.35); background:rgba(244, 63, 94, 0.06); }
  .btn-danger:hover { color:#fff; border-color:var(--crimson); background:rgba(244, 63, 94, 0.18); }
  .btn-ghost { background:transparent; border-color:transparent; color:var(--muted); }
  .btn-ghost:hover { background:var(--surface-2); border-color:var(--line); color:var(--text-strong); }
  .btn-icon { width:34px; padding:0; }
  .btn-sm { height:28px; padding:0 10px; font-size:13px; }
  .btn-sm.btn-icon { width:28px; padding:0; }
  .btn-quiet-danger { background:transparent; border-color:transparent; color:var(--faint); }
  .btn-quiet-danger:hover { color:var(--crimson-text); background:rgba(244, 63, 94, 0.1); border-color:rgba(244, 63, 94, 0.3); }

  input[type=text], input[type=password], input[type=search], select {
    height:34px; padding:0 11px; border-radius:var(--radius-sm);
    border:1px solid var(--line-strong); background:#070c18; color:var(--text-strong);
    transition:border-color .15s ease;
  }
  input::placeholder { color:var(--faint); }
  input:hover, select:hover { border-color:rgba(148, 163, 184, 0.38); }
  input:focus-visible, select:focus-visible { outline:2px solid var(--cyan); outline-offset:0; border-color:transparent; }
  select {
    appearance:none; -webkit-appearance:none; padding-right:30px; cursor:pointer;
    background-image:url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpath d='M6 9l6 6 6-6'/%3e%3c/svg%3e");
    background-repeat:no-repeat; background-position:right 9px center; background-size:14px;
  }
  select:disabled { opacity:.5; cursor:default; }
  select option { background:#0a1020; color:var(--text); }
  td select { height:30px; font-size:13px; }

  .sw {
    appearance:none; -webkit-appearance:none; margin:0; flex:none; cursor:pointer;
    width:34px; height:20px; border-radius:999px; position:relative;
    background:#1c2740; border:1px solid var(--line-strong);
    transition:background .18s ease, border-color .18s ease;
  }
  .sw::after {
    content:""; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%;
    background:var(--muted); transition:transform .18s cubic-bezier(.2, .8, .2, 1), background .18s ease;
  }
  .sw:checked { background:var(--cyan); border-color:var(--cyan); }
  .sw:checked::after { transform:translateX(14px); background:var(--void); }
  .sw:hover { border-color:rgba(148, 163, 184, 0.5); }
  .sw:focus-visible { outline:2px solid var(--cyan); outline-offset:2px; }
  .sw:disabled { opacity:.45; cursor:default; }

  .chip {
    display:inline-flex; align-items:center; gap:7px; height:24px; padding:0 10px;
    border-radius:999px; font-size:12px; font-weight:600; letter-spacing:.02em;
    border:1px solid var(--line-strong); color:var(--muted); background:var(--surface-2); white-space:nowrap;
  }
  .chip::before { content:""; width:7px; height:7px; border-radius:50%; background:currentColor; }
  .chip.st-open { color:var(--emerald-text); border-color:rgba(16, 185, 129, 0.4); background:rgba(16, 185, 129, 0.08); }
  .chip.st-connecting, .chip.st-starting, .chip.st-pairing { color:var(--amber-text); border-color:rgba(245, 158, 11, 0.4); background:rgba(245, 158, 11, 0.08); }
  .chip.st-closed, .chip.st-logged_out, .chip.st-unreachable { color:var(--crimson-text); border-color:rgba(244, 63, 94, 0.4); background:rgba(244, 63, 94, 0.08); }
  .chip.st-connecting::before, .chip.st-starting::before, .chip.st-pairing::before { animation:blink 1.4s ease-in-out infinite; }
  @keyframes blink { 50% { opacity:.25; } }

  .flash { min-height:20px; margin-top:10px; font-size:13px; color:var(--muted); }
  .flash.ok { color:var(--emerald-text); }
  .flash.err { color:var(--crimson-text); }
  .hint { color:var(--muted); font-size:13px; max-width:68ch; }

  /* ── login ────────────────────────────────────────────────── */
  #login { min-height:100vh; display:grid; grid-template-columns:minmax(0, 1fr) minmax(360px, 460px); }
  .login-art { position:relative; overflow:hidden; background:#02040a; border-right:1px solid var(--line); }
  .login-art img {
    position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center 20%;
    opacity:.55; filter:grayscale(1) contrast(1.1);
    -webkit-mask-image:linear-gradient(90deg, #000 55%, transparent);
    mask-image:linear-gradient(90deg, #000 55%, transparent);
  }
  .login-art .seal { right:28px; top:auto; bottom:32px; color:rgba(251, 191, 36, 0.4); }
  .login-form { display:flex; flex-direction:column; justify-content:center; padding:48px 44px; gap:18px; }
  .login-form .emblem { width:48px; height:48px; color:var(--gold); }
  .login-form h1 { font-family:var(--display); font-weight:700; font-size:30px; letter-spacing:.08em; color:var(--text-strong); }
  .login-form .quote { font-style:italic; color:var(--muted); margin-top:-10px; }
  .login-form form { display:flex; flex-direction:column; gap:10px; margin-top:6px; }
  .login-form label { font-size:13px; color:var(--muted); }
  .login-form input { height:40px; font-family:var(--mono); }
  .login-form .btn { height:40px; }
  @media (max-width:760px) {
    #login { grid-template-columns:1fr; grid-template-rows:200px auto; }
    .login-art { border-right:0; border-bottom:1px solid var(--line); }
    .login-art img { -webkit-mask-image:linear-gradient(180deg, #000 50%, transparent); mask-image:linear-gradient(180deg, #000 50%, transparent); }
    .login-art .seal { display:none; }
    .login-form { padding:28px 20px 40px; justify-content:flex-start; }
  }

  /* ── top bar ──────────────────────────────────────────────── */
  .topbar { position:sticky; top:0; z-index:5; background:rgba(5, 8, 17, 0.94); border-bottom:1px solid var(--line); }
  .topbar-in { max-width:1240px; margin:0 auto; padding:0 28px; height:58px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .brand { display:flex; align-items:center; gap:11px; min-width:0; }
  .brand .emblem { width:26px; height:26px; color:var(--gold); flex:none; }
  .brand .word { font-family:var(--display); font-weight:700; font-size:17px; letter-spacing:.12em; color:var(--text-strong); }
  .brand .build { font-family:var(--mono); font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:6px; padding:2px 7px; }
  .actions { display:flex; align-items:center; gap:6px; }

  /* ── page ─────────────────────────────────────────────────── */
  .wrap { max-width:1240px; margin:0 auto; padding:0 28px 96px; }

  /* hero: the wheel is the instrument */
  .hero {
    position:relative; display:grid; grid-template-columns:320px minmax(0, 1fr); gap:56px; align-items:center;
    padding:44px 48px 48px 0; border-bottom:1px solid var(--line);
  }
  .hero-visual { position:relative; width:320px; height:320px; }
  .hero-visual::before {
    content:""; position:absolute; inset:-40px; border-radius:50%; pointer-events:none;
    background:radial-gradient(closest-side, rgba(251, 191, 36, 0.07), rgba(56, 189, 248, 0.03) 60%, transparent);
  }
  .wheel-box { position:relative; width:320px; height:320px; }
  .wheel { width:100%; height:100%; display:block; overflow:visible; }
  .wheel .aura { fill:none; stroke:rgba(251, 191, 36, 0.14); stroke-width:1; stroke-dasharray:2 6; }
  .wheel .track { fill:none; stroke:rgba(148, 163, 184, 0.10); stroke-width:3; }
  .wheel .arc { fill:none; stroke:var(--faint); stroke-width:3; stroke-linecap:round; transition:stroke-dashoffset .6s cubic-bezier(.2, .8, .2, 1), stroke .3s ease; }
  .wheel .rim-band { fill:none; stroke:var(--gold-faint); stroke-width:12; }
  .wheel .rim { fill:none; stroke:var(--gold-line); }
  .wheel .ticks line { stroke:rgba(251, 191, 36, 0.38); stroke-width:1; }
  .wheel .spoke { stroke:var(--gold-line); stroke-width:3; stroke-linecap:round; }
  .wheel .inlay { stroke:rgba(56, 189, 248, 0.55); stroke-width:2.5; stroke-linecap:round; }
  .wheel .stem { stroke:var(--gold-line); stroke-width:4; stroke-linecap:round; }
  .wheel .hub { fill:#070b16; stroke:var(--cyan-line); stroke-width:1.5; }
  .wheel .hub-ring { fill:none; stroke:rgba(56, 189, 248, 0.18); stroke-width:1; stroke-dasharray:3 4; }
  .wheel .spokes { transform-origin:160px 160px; }
  .wheel.st-open .arc { stroke:var(--emerald); }
  .wheel.st-connecting .arc, .wheel.st-starting .arc { stroke:var(--amber); }
  .wheel.st-closed .arc, .wheel.st-logged_out .arc, .wheel.st-unreachable .arc { stroke:var(--crimson); }
  .wheel.st-connecting .spokes, .wheel.st-starting .spokes { animation:turn 14s linear infinite; }
  @keyframes turn { to { transform:rotate(360deg); } }
  .hub-face { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; pointer-events:none; }
  .hub-num { font-size:30px; font-weight:600; letter-spacing:-.02em; color:var(--text-strong); line-height:1; }
  .hub-label { margin-top:5px; font-size:11px; color:var(--muted); max-width:92px; text-align:center; line-height:1.25; }
  .qr-box { width:300px; height:300px; margin:10px; padding:14px; background:#fff; border-radius:var(--radius); box-shadow:0 0 0 1px var(--gold-line), 0 18px 40px rgba(0, 0, 0, 0.45); }
  .qr-box img { width:100%; height:100%; display:block; image-rendering:pixelated; }

  /* handle and reading marks share one state vocabulary: solid gold = healthy,
     amber ring = degraded, crimson ring with a slash = down, dashed = no data */
  .knob { transition:fill .2s ease, stroke .2s ease; }
  .dot, .slash { opacity:0; transition:opacity .2s ease; }
  .slash { stroke-linecap:round; }
  .s-ok .knob { fill:var(--gold); stroke:#a16207; }
  .s-ok .dot { fill:var(--gold-ink); opacity:1; }
  .s-warn .knob { fill:var(--void); stroke:var(--amber); }
  .s-warn .dot { fill:var(--amber); opacity:1; }
  .s-err .knob { fill:var(--void); stroke:var(--crimson); }
  .s-err .slash { stroke:var(--crimson); opacity:1; }
  .s-off .knob { fill:var(--void); stroke:var(--faint); }
  .wheel .knob { stroke-width:2.5; }
  .wheel .slash { stroke-width:2.5; }
  .wheel .s-off .knob { stroke-dasharray:4 3.2; }
  .wheel .h { cursor:default; }
  .wheel .h.hl .knob { stroke:var(--cyan); stroke-width:3; }
  .mark { width:18px; height:18px; flex:none; overflow:visible; }
  .mark .knob { stroke-width:1.8; }
  .mark .slash { stroke-width:1.8; }
  .s-off .mark .knob { stroke-dasharray:2.4 2; }

  .hero-body { min-width:0; }
  .hero-head { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  .hero-head h1 { font-size:28px; font-weight:600; letter-spacing:-.015em; color:var(--text-strong); line-height:1.2; text-wrap:balance; }
  .summary { margin-top:8px; color:var(--muted); font-size:15px; max-width:62ch; }
  .readings { list-style:none; margin:26px 0 0; padding:0; display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); column-gap:28px; }
  .reading {
    display:grid; grid-template-columns:18px minmax(0, 1fr) auto; align-items:center; gap:12px;
    padding:11px 10px; margin:0 -10px; border-top:1px solid var(--line); border-radius:var(--radius-sm);
    transition:background .15s ease;
  }
  .reading.hl { background:var(--cyan-faint); }
  .r-label { display:block; font-weight:500; color:var(--text-strong); }
  .r-note { display:block; font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .r-val { font-family:var(--mono); font-size:13px; color:var(--text); text-align:right; white-space:nowrap; }
  .reading.s-err .r-val { color:var(--crimson-text); }
  .reading.s-warn .r-val { color:var(--amber-text); }
  .reading.s-off .r-val { color:var(--faint); }
  .seal {
    position:absolute; right:0; top:44px; writing-mode:vertical-rl; letter-spacing:.42em;
    font-family:"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif; font-size:13px;
    color:rgba(251, 191, 36, 0.22); user-select:none; pointer-events:none;
  }

  /* sections */
  .block { padding-top:44px; }
  .block-head { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; }
  .block-head h2 { font-size:19px; font-weight:600; color:var(--text-strong); letter-spacing:-.005em; display:flex; align-items:baseline; gap:10px; }
  .block-head .hint { margin-top:5px; }
  .count { font-family:var(--mono); font-size:12px; font-weight:400; color:var(--muted); }
  .block-tools { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .search { position:relative; display:inline-flex; align-items:center; }
  .search .ico { position:absolute; left:10px; color:var(--faint); pointer-events:none; }
  .search input { padding-left:32px; width:240px; }

  .chips { display:flex; flex-wrap:wrap; gap:6px; margin:18px 0 12px; }
  .fchip {
    height:30px; padding:0 12px; display:inline-flex; align-items:center; gap:8px; cursor:pointer;
    border-radius:999px; border:1px solid var(--line); background:transparent; color:var(--muted); font-size:13px;
    transition:background .15s ease, color .15s ease, border-color .15s ease;
  }
  .fchip:hover { color:var(--text-strong); border-color:var(--line-strong); }
  .fchip b { font-family:var(--mono); font-weight:400; font-size:11px; color:var(--faint); }
  .fchip[aria-pressed=true] { background:var(--gold-faint); border-color:rgba(251, 191, 36, 0.45); color:var(--gold); }
  .fchip[aria-pressed=true] b { color:var(--gold); }

  .table-wrap { border:1px solid var(--line); border-radius:var(--radius); background:var(--surface); overflow-x:auto; }
  .ledger { width:100%; border-collapse:collapse; }
  .ledger th {
    text-align:left; padding:10px 14px; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
    color:var(--faint); background:#080d1a; border-bottom:1px solid var(--line); white-space:nowrap;
  }
  .ledger td { padding:10px 14px; border-top:1px solid var(--line); vertical-align:middle; }
  .ledger tbody tr:first-child td { border-top:0; }
  .ledger tbody tr:hover td { background:rgba(56, 189, 248, 0.03); }
  .ledger .c-fit { width:1%; white-space:nowrap; }
  .ledger .c-end { width:1%; text-align:right; white-space:nowrap; }
  .nm { display:flex; align-items:center; gap:10px; min-width:0; }
  .nm .ico { color:var(--faint); }
  .nm-text { min-width:0; }
  .nm-title { display:block; color:var(--text-strong); font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:42ch; }
  .nm-sub { display:block; font-family:var(--mono); font-size:11.5px; color:var(--faint); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:46ch; }
  .nm-meta { font-family:var(--sans); color:var(--muted); }
  tr.off .nm-title { color:var(--muted); }
  tr.busy { opacity:.55; pointer-events:none; }
  .na { color:#46536b; }
  .lvl-fixed { display:inline-block; min-width:30px; color:var(--faint); font-family:var(--mono); font-size:12px; }
  .ago { font-family:var(--mono); font-size:12px; color:var(--muted); }
  .ago.live { color:var(--cyan); }
  .ago.live::before { content:""; display:inline-block; width:6px; height:6px; border-radius:50%; background:var(--cyan); margin-right:7px; vertical-align:1px; }
  .tag { display:inline-block; font-size:12px; font-weight:500; padding:2px 8px; border-radius:6px; background:var(--surface-3); color:var(--text); white-space:nowrap; }
  .tag.ok { color:var(--emerald-text); background:rgba(16, 185, 129, 0.10); }
  .tag.err { color:var(--crimson-text); background:rgba(244, 63, 94, 0.10); }
  .tag.edit { color:var(--cyan); background:var(--cyan-faint); }
  .empty td { padding:30px 16px; text-align:center; color:var(--muted); }
  .empty td b { display:block; color:var(--text-strong); font-weight:500; margin-bottom:4px; }
  .skel td { padding:15px 14px; }
  .skel span { display:block; height:10px; border-radius:6px; background:linear-gradient(90deg, #111a2e 0%, #18233c 50%, #111a2e 100%); background-size:200% 100%; animation:shimmer 1.3s linear infinite; }
  @keyframes shimmer { to { background-position:-200% 0; } }

  .panel { margin:4px 0 16px; padding:18px 18px 8px; border:1px solid rgba(251, 191, 36, 0.28); border-radius:var(--radius); background:var(--surface-2); }
  .panel-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:4px; }
  .panel-head h3 { font-size:15px; font-weight:600; color:var(--text-strong); }
  .panel .row { display:flex; flex-wrap:wrap; gap:8px; margin-top:14px; }
  .panel .grow { flex:1 1 240px; min-width:0; }
  .panel .table-wrap { margin-top:14px; background:var(--surface); }
  .keyreveal { margin-top:14px; padding:14px; border-radius:var(--radius-sm); border:1px dashed rgba(251, 191, 36, 0.55); background:var(--gold-faint); }
  .keyreveal p { color:var(--text); font-size:13px; }
  .keyreveal .row { margin-top:10px; align-items:center; }
  .keyreveal code { flex:1 1 280px; min-width:0; font-family:var(--mono); font-size:12.5px; color:var(--gold); word-break:break-all; user-select:all; }


  @media (prefers-reduced-motion:reduce) {
    *, *::before, *::after { animation:none !important; transition:none !important; }
  }

  /* ── narrow screens ───────────────────────────────────────── */
  @media (max-width:980px) {
    .hero { grid-template-columns:1fr; justify-items:center; gap:32px; padding:32px 0 40px; }
    .hero-body { width:100%; }
    .hero-head { justify-content:center; text-align:center; }
    .summary { text-align:center; margin-left:auto; margin-right:auto; }
    .seal { display:none; }
  }
  @media (max-width:760px) {
    .topbar-in, .wrap { padding-left:16px; padding-right:16px; }
    .btn-text { display:none; }
    .actions .btn { width:34px; padding:0; }
    .brand .build { display:none; }
    .hero-visual, .wheel-box { width:260px; height:260px; }
    .qr-box { width:240px; height:240px; margin:10px; }
    .hub-num { font-size:26px; }
    .hero-head h1 { font-size:22px; }
    .readings { grid-template-columns:1fr; }
    .block-tools { width:100%; }
    .search { flex:1 1 100%; }
    .search input { width:100%; }
    .block-tools .btn { flex:1 1 0; }
  }
  /* The ledger needs ~1000px as a table; below that each row becomes a card. */
  @media (max-width:1000px) {
    .table-wrap { border:0; background:transparent; overflow:visible; }
    .ledger thead { display:none; }
    .ledger, .ledger tbody { display:block; }
    .ledger tr {
      display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px 14px; align-items:center;
      padding:14px; margin-bottom:10px; border:1px solid var(--line); border-radius:var(--radius); background:var(--surface);
    }
    .ledger td { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0; border:0; width:auto; white-space:normal; }
    .ledger tbody tr:hover td { background:transparent; }
    .ledger td[data-label]::before { content:attr(data-label); font-size:12px; color:var(--faint); }
    .ledger td.c-main { grid-column:1 / -1; }
    .ledger td.c-main::before { display:none; }
    .ledger td.c-na { display:none; }
    .ledger td.c-end { grid-column:1 / -1; width:auto; justify-content:flex-end; border-top:1px solid var(--line); padding-top:10px; }
    .ledger td.c-fit, .ledger td.c-end { width:auto; white-space:normal; }
    .ledger td.c-sel { grid-column:1 / -1; }
    .ledger td select { flex:0 1 220px; min-width:140px; }
    .nm-title, .nm-sub { max-width:none; }
    .empty, .skel { display:block !important; border:0 !important; background:transparent !important; padding:0 !important; }
    .empty td, .skel td { display:block; }
  }
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <symbol id="i-wheel" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="24" cy="24" r="13" stroke-width="2.4"/><circle cx="24" cy="24" r="4.5" stroke-width="2.2"/><path stroke-width="2" d="M24 19.5V11M24 28.5V37M19.5 24H11M28.5 24H37M20.8 20.8l-6-6M27.2 27.2l6 6M27.2 20.8l6-6M20.8 27.2l-6 6"/><path stroke-width="2.6" d="M24 11V6.5M24 37v4.5M11 24H6.5M37 24h4.5M14.8 14.8l-3.2-3.2M33.2 33.2l3.2 3.2M33.2 14.8l3.2-3.2M14.8 33.2l-3.2 3.2"/></g><g fill="currentColor"><circle cx="24" cy="4.5" r="2.6"/><circle cx="24" cy="43.5" r="2.6"/><circle cx="4.5" cy="24" r="2.6"/><circle cx="43.5" cy="24" r="2.6"/><circle cx="10.2" cy="10.2" r="2.6"/><circle cx="37.8" cy="37.8" r="2.6"/><circle cx="37.8" cy="10.2" r="2.6"/><circle cx="10.2" cy="37.8" r="2.6"/></g></symbol>
  <symbol id="i-refresh" viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 1 0-2.4 5.8"/><path d="M20 4.5v7h-7"/></symbol>
  <symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3.5v8"/><path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0"/></symbol>
  <symbol id="i-unlink" viewBox="0 0 24 24"><path d="M9.5 14.5a3.8 3.8 0 0 1 0-5.4l2.6-2.6a3.8 3.8 0 0 1 5.4 5.4l-1.3 1.3"/><path d="M14.5 9.5a3.8 3.8 0 0 1 0 5.4l-2.6 2.6a3.8 3.8 0 0 1-5.4-5.4l1.3-1.3"/><path d="M4 4l16 16"/></symbol>
  <symbol id="i-logout" viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></symbol>
  <symbol id="i-group" viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.8 14.3A4.5 4.5 0 0 1 21 18.6"/></symbol>
  <symbol id="i-person" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/></symbol>
  <symbol id="i-restore" viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v5h5"/></symbol>
  <symbol id="i-copy" viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15.5" r="4"/><path d="M11 12.5l8.5-8.5M16 7l2.5 2.5"/></symbol>
</svg>

<section id="login" class="hidden" aria-labelledby="loginTitle">
  <div class="login-art" aria-hidden="true">
    <img src="/admin/asset/mahoraga_stare.jpg" alt="">
    <div class="seal">八握剣異戒神将魔虚羅</div>
  </div>
  <div class="login-form">
    <svg class="emblem" aria-hidden="true"><use href="#i-wheel"/></svg>
    <h1 id="loginTitle">MAHORAGA</h1>
    <p class="quote">“With this treasure, I summon…”</p>
    <form id="loginForm" autocomplete="on">
      <label for="tok">Admin token</label>
      <input id="tok" type="password" autocomplete="current-password" spellcheck="false" required>
      <button class="btn btn-primary" type="submit">Open console</button>
      <p class="flash" id="loginMsg" role="status"></p>
    </form>
  </div>
</section>

<div id="app" class="hidden">
  <header class="topbar">
    <div class="topbar-in">
      <div class="brand">
        <svg class="emblem" aria-hidden="true"><use href="#i-wheel"/></svg>
        <span class="word">MAHORAGA</span>
        <span class="build hidden" id="buildTag"></span>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" id="refreshBtn" title="Reload everything" aria-label="Refresh"><svg class="ico" aria-hidden="true"><use href="#i-refresh"/></svg><span class="btn-text" aria-hidden="true">Refresh</span></button>
        <button class="btn" id="restartBtn" title="Restart the bot process" aria-label="Restart bot"><svg class="ico" aria-hidden="true"><use href="#i-power"/></svg><span class="btn-text" aria-hidden="true">Restart</span></button>
        <button class="btn btn-danger" id="relinkBtn" title="Wipe the session and pair a phone again" aria-label="Unlink and pair again"><svg class="ico" aria-hidden="true"><use href="#i-unlink"/></svg><span class="btn-text" aria-hidden="true">Unlink</span></button>
        <button class="btn btn-ghost" id="logoutBtn" title="Forget the token on this device" aria-label="Forget token"><svg class="ico" aria-hidden="true"><use href="#i-logout"/></svg></button>
      </div>
    </div>
  </header>

  <main class="wrap">
    <section class="hero" aria-labelledby="headline">
      <div class="hero-visual">
        <div class="wheel-box" id="wheelBox">
          <svg class="wheel st-starting" id="wheel" viewBox="0 0 320 320" aria-hidden="true">
            <circle class="aura" cx="160" cy="160" r="157"/>
            <circle class="track" cx="160" cy="160" r="154"/>
            <circle class="arc" id="arc" cx="160" cy="160" r="154" stroke-dasharray="968" stroke-dashoffset="968" transform="rotate(-90 160 160)"/>
            <g id="stems"></g>
            <circle class="rim-band" cx="160" cy="160" r="106"/>
            <circle class="rim" cx="160" cy="160" r="112" stroke-width="2"/>
            <circle class="rim" cx="160" cy="160" r="100" stroke-width="1.5"/>
            <g class="ticks" id="ticks"></g>
            <g class="spokes" id="spokes"></g>
            <circle class="hub" cx="160" cy="160" r="54"/>
            <circle class="hub-ring" cx="160" cy="160" r="46"/>
            <g id="handles"></g>
          </svg>
          <div class="hub-face"><span class="hub-num" id="hubNum">—</span><span class="hub-label" id="hubLabel">reading the wheel</span></div>
        </div>
        <div class="qr-box hidden" id="qrBox"><img id="qrImg" alt="WhatsApp pairing QR code"></div>
      </div>
      <div class="hero-body">
        <div class="hero-head"><h1 id="headline">Reading status…</h1><span class="chip" id="statePill">Waiting</span></div>
        <p class="summary" id="summary"></p>
        <ol class="readings" id="readings"></ol>
        <p class="flash" id="actionMsg" role="status"></p>
      </div>
      <div class="seal" aria-hidden="true">八握剣異戒神将魔虚羅</div>
    </section>

    <section class="block" aria-labelledby="routingTitle">
      <div class="block-head">
        <div>
          <h2 id="routingTitle">Routing <span class="count" id="routeCount"></span></h2>
          <p class="hint">Where the bot answers and which persona replies. Level 2 adds live search and exists only on DKB. Read listens for event announcements; Ask sends events there for review. Both apply to DKB groups.</p>
        </div>
        <div class="block-tools">
          <label class="search"><svg class="ico" aria-hidden="true"><use href="#i-search"/></svg><input id="routeSearch" type="search" placeholder="Filter by name or number" aria-label="Filter routes by name or number"></label>
          <button class="btn" id="addGroupBtn"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg>Add group</button>
          <button class="btn" id="addChatBtn"><svg class="ico" aria-hidden="true"><use href="#i-plus"/></svg>Add number</button>
        </div>
      </div>

      <div class="panel hidden" id="addGroupPanel">
        <div class="panel-head"><h3>Add a group</h3><button class="btn btn-ghost btn-icon btn-sm" id="addGroupClose" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></div>
        <p class="hint">Groups this number is in that the bot ignores. Pick the persona, then add.</p>
        <div class="row" data-pair>
          <input type="text" id="grpManual" class="grow" placeholder="Or paste a group JID ending in @g.us" spellcheck="false" aria-label="Group JID">
          <select id="grpManualBot" data-role="bot" aria-label="Persona"></select>
          <select id="grpManualLvl" data-role="lvl" aria-label="Level" disabled><option value="1">Level 1</option><option value="2">Level 2 · live search</option></select>
          <button class="btn btn-primary" id="grpManualAdd">Add</button>
        </div>
        <div class="table-wrap">
          <table class="ledger">
            <thead><tr><th>Group</th><th class="c-fit">Members</th><th class="c-fit">Bot</th><th class="c-fit">Level</th><th class="c-end"><span class="sr">Add</span></th></tr></thead>
            <tbody id="discRows"></tbody>
          </table>
        </div>
        <p class="flash" id="grpAddMsg" role="status"></p>
      </div>

      <div class="panel hidden" id="addChatPanel">
        <div class="panel-head"><h3>Add a number</h3><button class="btn btn-ghost btn-icon btn-sm" id="addChatClose" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></div>
        <p class="hint">The bot replies to this person in private. Admins are always allowed and don't need adding.</p>
        <div class="row" data-pair>
          <input type="text" id="chatNum" class="grow" placeholder="Phone with country code, e.g. 919902849280" inputmode="numeric" aria-label="Phone number">
          <select id="chatBot" data-role="bot" aria-label="Persona"></select>
          <select id="chatLvl" data-role="lvl" aria-label="Level" disabled><option value="1">Level 1</option><option value="2">Level 2 · live search</option></select>
          <button class="btn btn-primary" id="chatAdd">Add</button>
        </div>
        <p class="flash" id="chatAddMsg" role="status"></p>
      </div>

      <div class="chips" id="botChips" role="group" aria-label="Filter by persona"></div>
      <div class="table-wrap">
        <table class="ledger" id="ledger">
          <thead><tr>
            <th>Chat</th><th class="c-fit">Last active</th><th class="c-fit">Bot</th><th class="c-fit">Level</th>
            <th class="c-fit" title="DKB listens here for event announcements">Read</th>
            <th class="c-fit" title="DKB sends new events here for review">Ask</th>
            <th class="c-fit">Active</th><th class="c-end"><span class="sr">Remove</span></th>
          </tr></thead>
          <tbody id="routeRows">
            <tr class="skel"><td colspan="8"><span style="width:38%"></span></td></tr>
            <tr class="skel"><td colspan="8"><span style="width:52%"></span></td></tr>
            <tr class="skel"><td colspan="8"><span style="width:30%"></span></td></tr>
          </tbody>
        </table>
      </div>
      <p class="flash" id="routeMsg" role="status"></p>
    </section>

    <div>
      <section class="block" aria-labelledby="keysTitle">
        <div class="block-head">
          <div>
            <h2 id="keysTitle">API keys <span class="count" id="keyCount"></span></h2>
            <p class="hint">For scripts that send through the bot at <span class="mono">POST /api/v1/messages</span>. Operator keys can send; viewer keys only read.</p>
          </div>
          <div class="block-tools"><button class="btn" id="addKeyBtn"><svg class="ico" aria-hidden="true"><use href="#i-key"/></svg>Create key</button></div>
        </div>
        <div class="panel hidden" id="addKeyPanel" style="margin-top:16px">
          <div class="panel-head"><h3>Create a key</h3><button class="btn btn-ghost btn-icon btn-sm" id="addKeyClose" aria-label="Close"><svg class="ico" aria-hidden="true"><use href="#i-close"/></svg></button></div>
          <div class="row">
            <input type="text" id="kName" class="grow" placeholder="Name, e.g. n8n standup reminder" aria-label="Key name">
            <select id="kRole" aria-label="Role"><option value="operator">Operator · can send</option><option value="viewer">Viewer · read only</option></select>
            <select id="kBot" aria-label="Bot scope"></select>
            <button class="btn btn-primary" id="kCreate">Create</button>
          </div>
          <div class="keyreveal hidden" id="kNew">
            <p>Copy this key now. It won't be shown again.</p>
            <div class="row"><code id="kNewVal"></code><button class="btn btn-sm" id="kCopy"><svg class="ico" aria-hidden="true"><use href="#i-copy"/></svg>Copy</button></div>
          </div>
          <p class="flash" id="kAddMsg" role="status"></p>
        </div>
        <div class="table-wrap" style="margin-top:16px">
          <table class="ledger">
            <thead><tr><th>Name</th><th class="c-fit">Role</th><th class="c-fit">Bot</th><th class="c-fit">Last used</th><th class="c-end"><span class="sr">Revoke</span></th></tr></thead>
            <tbody id="kRows"><tr class="skel"><td colspan="5"><span style="width:44%"></span></td></tr></tbody>
          </table>
        </div>
        <p class="flash" id="kMsg" role="status"></p>
      </section>

      <section class="block" aria-labelledby="auditTitle">
        <div class="block-head">
          <div>
            <h2 id="auditTitle">Activity <span class="count" id="auditCount"></span></h2>
            <p class="hint">Recent allowlist and admin changes. Removed groups and chats can be put back with their old persona and level.</p>
          </div>
          <div class="block-tools"><button class="btn btn-ghost" id="refreshAuditBtn"><svg class="ico" aria-hidden="true"><use href="#i-refresh"/></svg>Reload</button></div>
        </div>
        <div class="table-wrap" style="margin-top:16px">
          <table class="ledger">
            <thead><tr><th class="c-fit">Change</th><th>Target</th><th class="c-fit">By</th><th class="c-fit">When</th><th class="c-end"><span class="sr">Restore</span></th></tr></thead>
            <tbody id="auditRows"><tr class="skel"><td colspan="5"><span style="width:48%"></span></td></tr></tbody>
          </table>
        </div>
        <p class="flash" id="auditMsg" role="status"></p>
      </section>
    </div>
  </main>
</div>

<script>
(function () {
  var KEY = "mahoraga_admin_token";
  var $ = function (id) { return document.getElementById(id); };
  var token = "";
  try { token = sessionStorage.getItem(KEY) || ""; } catch (e) { token = ""; }
  var timer = null;
  var bots = { 0: "Generic" };
  var botsSig = "";
  var routes = { groups: [], chats: [] };
  var routesLoaded = false;
  var filterBot = "all";
  var query = "";
  var qrUrl = null;
  var ARC = 968;
  var READINGS = ["Socket", "Inbound", "Outbound", "Uptime", "Neon", "Redis", "Groq", "Search"];
  var STATES = ["s-ok", "s-warn", "s-err", "s-off"];

  // ── utilities ─────────────────────────────────────────────────────
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function ago(ts) {
    if (!ts) return null;
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + " second" + (s === 1 ? "" : "s");
    var m = Math.round(s / 60); if (m < 60) return m + " minute" + (m === 1 ? "" : "s");
    var h = Math.round(m / 60); if (h < 48) return h + " hour" + (h === 1 ? "" : "s");
    return Math.round(h / 24) + " days";
  }
  function agoShort(ts) {
    if (!ts) return "—";
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + "s"; var m = Math.round(s / 60); if (m < 60) return m + "m";
    var h = Math.round(m / 60); if (h < 48) return h + "h"; return Math.round(h / 24) + "d";
  }
  function dur(sec) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h >= 48) return Math.floor(h / 24) + "d " + (h % 24) + "h";
    if (h) return h + "h " + m + "m";
    return m + "m";
  }
  function toMs(v) { if (!v) return null; var n = typeof v === "number" ? v : new Date(v).getTime(); return isNaN(n) ? null : n; }
  function phone(jid) {
    var s = String(jid || "");
    var n = s.replace(/@.*$/, "").replace(/:.*$/, "");
    if (s.indexOf("@s.whatsapp.net") > 0) return "+" + n;
    if (s.indexOf("@lid") > 0) return n + " (LID)";
    return n || s;
  }
  function ico(name) { return '<svg class="ico" aria-hidden="true"><use href="#i-' + name + '"/></svg>'; }
  function setState(el, st) {
    for (var i = 0; i < STATES.length; i++) el.classList.remove(STATES[i]);
    el.classList.add("s-" + st);
  }
  function flash(id, text, kind) { var el = $(id); el.textContent = text || ""; el.className = "flash" + (kind ? " " + kind : ""); }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Authorization": "Bearer " + token }, opts.headers || {});
    if (opts.body && typeof opts.body !== "string") { opts.body = JSON.stringify(opts.body); opts.headers["Content-Type"] = "application/json"; }
    opts.cache = "no-store";
    return fetch("/admin/api/" + path, opts).then(function (r) {
      if (r.status === 401) { forget(); showLogin("That token was refused."); throw new Error("unauthorized"); }
      return r;
    });
  }
  function apiJson(path, opts) {
    return api(path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.detail || j.error || ("HTTP " + r.status)); e.code = j.error; throw e; }
        return j;
      });
    });
  }
  function forget() { token = ""; try { sessionStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }
  function botName(n) { return bots[n] != null ? bots[n] : "Bot " + n; }
  function botNumbers() { return Object.keys(bots).map(Number).sort(function (a, b) { return a - b; }); }
  function botOptions(selected, allowAny) {
    var out = allowAny ? '<option value="">Any bot</option>' : "";
    botNumbers().forEach(function (n) {
      out += '<option value="' + n + '"' + (String(selected) === String(n) ? " selected" : "") + ">" + esc(botName(n)) + "</option>";
    });
    return out;
  }
  function levelSelect(level, attr) {
    return '<select ' + attr + ' aria-label="Level"><option value="1"' + (level === 2 ? "" : " selected") + '>Level 1</option><option value="2"' + (level === 2 ? " selected" : "") + ">Level 2 · live search</option></select>";
  }
  // Keeps a pair's level select honest: only DKB (bot 2) has a second level.
  function syncLevel(scope) {
    var b = scope.querySelector('[data-role="bot"]'), l = scope.querySelector('[data-role="lvl"]');
    if (!b || !l) return;
    var dkb = Number(b.value) === 2;
    l.disabled = !dkb;
    if (!dkb) l.value = "1";
  }

  // ── views ─────────────────────────────────────────────────────────
  function showLogin(msg) {
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
    flash("loginMsg", msg, msg ? "err" : "");
    $("tok").value = ""; $("tok").focus();
    if (timer) { clearInterval(timer); timer = null; }
  }
  function showApp() {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    refresh(); loadRoutes(); loadKeys(); loadAudit();
    if (!timer) timer = setInterval(refresh, 5000);
  }

  // ── the wheel ─────────────────────────────────────────────────────
  (function drawWheel() {
    var c = 160, ticks = "", spokes = "", stems = "", handles = "";
    function p(r, a) { return [(c + Math.cos(a) * r).toFixed(1), (c + Math.sin(a) * r).toFixed(1)]; }
    for (var t = 0; t < 64; t++) {
      var ta = (t * Math.PI * 2) / 64;
      if (t % 8 === 0) continue;
      var t1 = p(102.5, ta), t2 = p(t % 4 === 0 ? 109.5 : 107, ta);
      ticks += '<line x1="' + t1[0] + '" y1="' + t1[1] + '" x2="' + t2[0] + '" y2="' + t2[1] + '"/>';
    }
    for (var i = 0; i < 8; i++) {
      var a = -Math.PI / 2 + (i * Math.PI) / 4;
      var s1 = p(54, a), s2 = p(100, a), n1 = p(64, a), n2 = p(90, a);
      spokes += '<line class="spoke" x1="' + s1[0] + '" y1="' + s1[1] + '" x2="' + s2[0] + '" y2="' + s2[1] + '"/>';
      spokes += '<line class="inlay" x1="' + n1[0] + '" y1="' + n1[1] + '" x2="' + n2[0] + '" y2="' + n2[1] + '"/>';
      var e1 = p(112, a), e2 = p(126, a);
      stems += '<line class="stem" x1="' + e1[0] + '" y1="' + e1[1] + '" x2="' + e2[0] + '" y2="' + e2[1] + '"/>';
      var k = p(137, a), d = 6;
      handles += '<g class="h s-off" id="h' + i + '" data-i="' + i + '">' +
        '<circle class="knob" cx="' + k[0] + '" cy="' + k[1] + '" r="12"/>' +
        '<circle class="dot" cx="' + k[0] + '" cy="' + k[1] + '" r="4.2"/>' +
        '<line class="slash" x1="' + (Number(k[0]) - d).toFixed(1) + '" y1="' + (Number(k[1]) + d).toFixed(1) + '" x2="' + (Number(k[0]) + d).toFixed(1) + '" y2="' + (Number(k[1]) - d).toFixed(1) + '"/>' +
        "<title>" + READINGS[i] + "</title></g>";
    }
    $("ticks").innerHTML = ticks;
    $("spokes").innerHTML = spokes;
    $("stems").innerHTML = stems;
    $("handles").innerHTML = handles;

    var list = "";
    for (var j = 0; j < 8; j++) {
      list += '<li class="reading s-off" id="r' + j + '" data-i="' + j + '">' +
        '<svg class="mark" viewBox="0 0 20 20" aria-hidden="true"><circle class="knob" cx="10" cy="10" r="7.5"/><circle class="dot" cx="10" cy="10" r="2.7"/><line class="slash" x1="6" y1="14" x2="14" y2="6"/></svg>' +
        '<span><span class="r-label">' + READINGS[j] + '</span><span class="r-note" id="rn' + j + '">No data yet</span></span>' +
        '<span class="r-val" id="rv' + j + '">—</span></li>';
    }
    $("readings").innerHTML = list;
  })();

  // Hovering a handle lights its reading, and the reverse.
  function highlight(i, on) {
    var h = $("h" + i), r = $("r" + i);
    if (h) h.classList.toggle("hl", on);
    if (r) r.classList.toggle("hl", on);
  }
  function bindHighlight(container, selector) {
    container.addEventListener("mouseover", function (ev) {
      var el = ev.target.closest(selector); if (!el) return;
      highlight(el.getAttribute("data-i"), true);
    });
    container.addEventListener("mouseout", function (ev) {
      var el = ev.target.closest(selector); if (!el) return;
      if (ev.relatedTarget && el.contains(ev.relatedTarget)) return;
      highlight(el.getAttribute("data-i"), false);
    });
  }
  bindHighlight($("handles"), ".h");
  bindHighlight($("readings"), ".reading");

  function setReading(i, st, value, note) {
    setState($("h" + i), st);
    setState($("r" + i), st);
    $("rv" + i).textContent = value;
    $("rn" + i).textContent = note;
    $("rn" + i).title = note;
  }

  var STATE_LABEL = { open: "Open", connecting: "Connecting", starting: "Starting", closed: "Closed", logged_out: "Logged out", pairing: "Pairing", unreachable: "Unreachable" };

  function renderStatus(s) {
    var sig = JSON.stringify(s.bots || {});
    if (s.bots && sig !== botsSig) {
      botsSig = sig; bots = s.bots;
      fillBotSelects();
      if (routesLoaded) renderLedger();
    }
    var build = $("buildTag");
    build.textContent = s.version ? "build " + s.version : "";
    build.classList.toggle("hidden", !s.version);

    var st = s.qrAvailable ? "pairing" : s.state;
    var pill = $("statePill");
    pill.textContent = STATE_LABEL[st] || st;
    pill.className = "chip st-" + st;
    $("wheel").setAttribute("class", "wheel st-" + s.state);

    // Rim arc: freshness of the last inbound message (full now, empty after an hour).
    var fill = 0;
    if (s.state === "open") { var age = s.lastInboundAt ? (Date.now() - s.lastInboundAt) / 3600000 : 1; fill = Math.max(0.04, 1 - Math.min(1, age)); }
    else if (s.state === "closed" || s.state === "logged_out") fill = 1;
    else fill = 0.25;
    $("arc").setAttribute("stroke-dashoffset", String(Math.round(ARC * (1 - fill))));

    // Pairing swaps the wheel for the QR in the same slot.
    var pairing = !!s.qrAvailable;
    $("wheelBox").classList.toggle("hidden", pairing);
    $("qrBox").classList.toggle("hidden", !pairing);
    if (pairing) {
      api("qr.svg").then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
        if (!b) return;
        var old = qrUrl; qrUrl = URL.createObjectURL(b); $("qrImg").src = qrUrl;
        if (old) URL.revokeObjectURL(old);
      }).catch(function () { /* next poll retries */ });
      $("headline").textContent = "Scan to link a phone";
      $("summary").textContent = "On the phone: WhatsApp, Linked devices, Link a device. This code is " + (s.qrAgeSec || 0) + "s old and refreshes about every 20 seconds.";
    } else {
      if (qrUrl) { URL.revokeObjectURL(qrUrl); qrUrl = null; $("qrImg").removeAttribute("src"); }
      $("headline").textContent = s.selfJid ? "Linked as " + phone(s.selfJid) : (s.state === "logged_out" ? "Logged out" : "Not linked");
      var parts = [];
      if (s.lastInboundAt) parts.push("Last message " + ago(s.lastInboundAt) + " ago");
      if (s.lastOutboundAt) parts.push("replied " + ago(s.lastOutboundAt) + " ago");
      var line = parts.length ? parts.join(", ") + "." : (s.state === "open" ? "Connected. Waiting for the first message." : "Not receiving messages.");
      if (s.state === "logged_out") line = "The session was revoked. Use Unlink to pair this phone again.";
      $("summary").textContent = line;
    }

    $("hubNum").textContent = s.lastInboundAt ? agoShort(s.lastInboundAt) : "—";
    $("hubLabel").textContent = s.lastInboundAt ? "since last message" : (s.state === "open" ? "no messages yet" : "offline");

    // 0 Socket
    var drop = s.lastCloseAt ? "Last drop " + ago(s.lastCloseAt) + " ago" + (s.lastCloseCode ? " (code " + s.lastCloseCode + ")" : "") : "";
    if (s.state === "open") setReading(0, "ok", "open", s.reconnectAttempts ? s.reconnectAttempts + " reconnect" + (s.reconnectAttempts === 1 ? "" : "s") + " this run" : "Stable this run");
    else if (s.state === "connecting" || s.state === "starting") setReading(0, "warn", pairing ? "pairing" : s.state, pairing ? "Waiting for a QR scan" : (s.reconnectAttempts ? "Attempt " + s.reconnectAttempts + ". " + drop : drop || "Opening the socket"));
    else setReading(0, "err", s.state === "logged_out" ? "logged out" : "closed", drop || "Socket is down");

    // 1 Inbound, 2 Outbound
    function freshness(i, ts, what) {
      if (!ts) { setReading(i, "off", "—", s.state === "open" ? "No " + what + " yet" : "Nothing this run"); return; }
      var h = (Date.now() - ts) / 3600000;
      setReading(i, h < 6 ? "ok" : "warn", agoShort(ts), (i === 1 ? "Last message " : "Last reply ") + ago(ts) + " ago");
    }
    freshness(1, s.lastInboundAt, "messages");
    freshness(2, s.lastOutboundAt, "replies");

    // 3 Uptime
    setReading(3, "ok", dur(s.uptimeSec), "Since the process started");

    // 4 Neon, 5 Redis
    var sv = s.services || {};
    function latency(i, svc, extra) {
      if (!svc) { setReading(i, "off", "—", "Not reported"); return; }
      if (!svc.ok) { setReading(i, "err", "down", "Health query failed"); return; }
      var ms = svc.latencyMs;
      setReading(i, ms > 800 ? "warn" : "ok", ms + " ms", extra || (ms > 800 ? "Slow round trip" : "Round trip"));
    }
    latency(4, sv.neon);
    latency(5, sv.redis, sv.redis && sv.redis.ok && sv.redis.keyCount != null ? Number(sv.redis.keyCount).toLocaleString() + " keys" : null);

    // 6 Groq
    var m = s.models;
    if (!m) setReading(6, "off", "—", "Models not checked yet");
    else if (m.error) setReading(6, "err", "error", "Couldn't verify: " + m.error);
    else {
      var bad = (m.models || []).filter(function (x) { return !x.ok; });
      if (bad.length) setReading(6, "warn", bad.length + " retired", "Groq no longer serves " + bad.map(function (x) { return x.id; }).join(", ") + ". Change GROQ_MODEL.");
      else setReading(6, "ok", (m.models || []).length + " ok", "All configured models served");
    }

    // 7 Search
    if (!sv.search) setReading(7, "off", "—", "Not reported");
    else {
      var names = Object.keys(sv.search), on = names.filter(function (k) { return sv.search[k]; });
      if (on.length) setReading(7, "ok", on.length + " of " + names.length, on.join(", "));
      else setReading(7, "off", "0 of " + names.length, "No search keys set; answers from model knowledge");
    }
  }

  function refresh() {
    apiJson("status").then(function (s) {
      renderStatus(s);
      if ($("actionMsg").className.indexOf("err") >= 0 && $("actionMsg").textContent.indexOf("reach") >= 0) flash("actionMsg", "");
    }).catch(function (e) {
      if (e.message === "unauthorized") return;
      flash("actionMsg", "Can't reach the bot: " + e.message, "err");
      var pill = $("statePill"); pill.textContent = "Unreachable"; pill.className = "chip st-unreachable";
      $("wheel").setAttribute("class", "wheel st-unreachable");
      setReading(0, "err", "no reply", "The console can't reach the bot process");
    });
  }

  function act(path, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    apiJson(path, { method: "POST" }).then(function (j) { flash("actionMsg", j.message || "Done.", "ok"); })
      .catch(function (e) { if (e.message !== "unauthorized") flash("actionMsg", e.message, "err"); });
  }

  // ── routing ledger ────────────────────────────────────────────────
  function fillBotSelects() {
    ["grpManualBot", "chatBot"].forEach(function (id) { var el = $(id); var v = el.value || "0"; el.innerHTML = botOptions(v, false); syncLevel(el.parentNode); });
    var kb = $("kBot"); var kv = kb.value; kb.innerHTML = botOptions(kv, true);
  }

  function loadRoutes() {
    return Promise.all([apiJson("groups"), apiJson("chats")]).then(function (r) {
      routes.groups = r[0].groups || [];
      routes.chats = r[1].chats || [];
      routesLoaded = true;
      renderLedger();
    }).catch(function (e) {
      if (e.message === "unauthorized") return;
      $("routeRows").innerHTML = '<tr class="empty"><td colspan="8"><b>Couldn\\u2019t load routing.</b>' + esc(e.message) + "</td></tr>";
    });
  }

  function allRoutes() {
    return routes.groups.map(function (g) { return Object.assign({ kind: "groups" }, g); })
      .concat(routes.chats.map(function (c) { return Object.assign({ kind: "chats" }, c); }));
  }

  function renderChips(items) {
    var counts = {};
    items.forEach(function (e) { counts[e.botNumber] = (counts[e.botNumber] || 0) + 1; });
    var out = '<button class="fchip" data-bot="all" aria-pressed="' + (filterBot === "all") + '">All <b>' + items.length + "</b></button>";
    botNumbers().forEach(function (n) {
      out += '<button class="fchip" data-bot="' + n + '" aria-pressed="' + (String(filterBot) === String(n)) + '">' + esc(botName(n)) + " <b>" + (counts[n] || 0) + "</b></button>";
    });
    $("botChips").innerHTML = out;
  }

  function switchHtml(act, on, label) {
    return '<input type="checkbox" class="sw" role="switch" data-act="' + act + '"' + (on ? " checked" : "") + ' aria-label="' + esc(label) + '">';
  }

  function rowHtml(e) {
    var isG = e.kind === "groups";
    var dkb = e.botNumber === 2;
    var title = e.name || (isG ? "Unnamed group" : phone(e.jid));
    var sub = isG ? e.jid : (e.name ? phone(e.jid) : e.jid);
    var meta = isG && e.size != null ? ' <span class="nm-meta">· ' + e.size + " members</span>" : "";
    var last = "";
    if (isG && e.lastActive) {
      var live = Date.now() - e.lastActive < 3600000;
      last = '<span class="ago' + (live ? " live" : "") + '">' + esc(agoShort(e.lastActive)) + " ago</span>";
    } else last = '<span class="na" title="' + (isG ? "No activity recorded in the last day" : "Not tracked for direct chats") + '">—</span>';
    var lvl = dkb ? levelSelect(e.level === 2 ? 2 : 1, 'data-act="lvl"') : '<span class="lvl-fixed" title="Only DKB has a second level">1</span>';
    var dkbGroup = isG && dkb;
    var na = '<span class="na" aria-label="Not used for this chat">—</span>';
    return '<tr data-kind="' + e.kind + '" data-id="' + esc(e.id) + '" data-name="' + esc(title) + '" class="' + (e.enabled ? "" : "off") + '">' +
      '<td class="c-main"><div class="nm">' + ico(isG ? "group" : "person") + '<div class="nm-text"><span class="nm-title" title="' + esc(title) + '">' + esc(title) + "</span>" +
      '<span class="nm-sub" title="' + esc(sub) + '">' + esc(sub) + meta + "</span></div></div></td>" +
      '<td class="c-fit' + (isG ? "" : " c-na") + '" data-label="Last active">' + last + "</td>" +
      '<td class="c-fit c-sel" data-label="Bot"><select data-act="bot" aria-label="Persona for ' + esc(title) + '">' + botOptions(e.botNumber, false) + "</select></td>" +
      '<td class="c-fit c-sel' + (dkb ? "" : " c-na") + '" data-label="Level">' + lvl + "</td>" +
      '<td class="c-fit' + (dkbGroup ? "" : " c-na") + '" data-label="Read">' + (dkbGroup ? switchHtml("read", e.read, "Read announcements in " + title) : na) + "</td>" +
      '<td class="c-fit' + (dkbGroup ? "" : " c-na") + '" data-label="Ask">' + (dkbGroup ? switchHtml("ask", e.ask, "Send reviews to " + title) : na) + "</td>" +
      '<td class="c-fit" data-label="Active">' + switchHtml("on", e.enabled, "Bot active in " + title) + "</td>" +
      '<td class="c-end"><button class="btn btn-sm btn-icon btn-quiet-danger" data-act="rm" aria-label="Remove ' + esc(title) + '" title="Remove">' + ico("trash") + "</button></td></tr>";
  }

  function renderLedger() {
    var items = allRoutes();
    renderChips(items);
    $("routeCount").textContent = items.length ? String(items.length) : "";
    var q = query.trim().toLowerCase();
    var shown = items.filter(function (e) {
      if (filterBot !== "all" && String(e.botNumber) !== String(filterBot)) return false;
      if (!q) return true;
      return (String(e.name || "") + " " + e.jid + " " + phone(e.jid)).toLowerCase().indexOf(q) >= 0;
    });
    var body = $("routeRows");
    if (!items.length) {
      body.innerHTML = '<tr class="empty"><td colspan="8"><b>The bot answers nowhere yet.</b>Add a group it\\u2019s in, or a number, and choose which persona replies.</td></tr>';
    } else if (!shown.length) {
      body.innerHTML = '<tr class="empty"><td colspan="8">' + (q ? "<b>No chat matches \\u201c" + esc(query.trim()) + "\\u201d.</b>Try part of a name or number." : "<b>Nothing routed to " + esc(botName(filterBot)) + ".</b>Change a row\\u2019s bot to move it here.") + "</td></tr>";
    } else {
      body.innerHTML = shown.map(rowHtml).join("");
    }
  }

  // A PATCH returns the updated entry, so merge it in place instead of
  // reloading: reloading groups makes the server ask WhatsApp for every group
  // the number is in, and one toggle should not cost an account-level call.
  // name / size / lastActive come from that discovery, so keep the current ones.
  function patchRoute(tr, body, okText) {
    var kind = tr.getAttribute("data-kind"), id = tr.getAttribute("data-id");
    tr.classList.add("busy");
    return apiJson(kind + "/" + id, { method: "PATCH", body: body })
      .then(function (j) {
        var list = routes[kind], merged = false;
        for (var i = 0; j && j.entry && i < list.length; i++) {
          if (String(list[i].id) === String(id)) {
            list[i] = Object.assign({}, list[i], j.entry, { name: list[i].name, size: list[i].size, lastActive: list[i].lastActive });
            merged = true;
          }
        }
        flash("routeMsg", okText, "ok");
        if (merged) renderLedger(); else return loadRoutes();
      })
      .catch(function (e) { if (e.message !== "unauthorized") flash("routeMsg", e.message, "err"); return loadRoutes(); });
  }

  $("routeRows").addEventListener("change", function (ev) {
    var t = ev.target, tr = t.closest("tr"); if (!tr || !tr.getAttribute("data-id")) return;
    var a = t.getAttribute("data-act"), name = tr.getAttribute("data-name");
    if (a === "bot") {
      var nb = Number(t.value), body = { botNumber: nb };
      if (nb !== 2) {
        body.level = 1;
        // Read and Ask only mean something on DKB, and the ledger hides them
        // elsewhere. Clear them so a group moved off DKB doesn't keep feeding
        // event ingestion with a flag nobody can see.
        if (tr.getAttribute("data-kind") === "groups") { body.read = false; body.ask = false; }
      }
      patchRoute(tr, body, name + " now uses " + botName(nb) + ".");
    } else if (a === "lvl") patchRoute(tr, { level: Number(t.value) }, name + " set to level " + t.value + ".");
    else if (a === "read") patchRoute(tr, { read: t.checked }, "Read " + (t.checked ? "on" : "off") + " for " + name + ".");
    else if (a === "ask") patchRoute(tr, { ask: t.checked }, "Ask " + (t.checked ? "on" : "off") + " for " + name + ".");
    else if (a === "on") patchRoute(tr, { enabled: t.checked }, name + (t.checked ? " turned on." : " turned off."));
  });
  $("routeRows").addEventListener("click", function (ev) {
    var b = ev.target.closest('[data-act="rm"]'); if (!b) return;
    var tr = b.closest("tr"), name = tr.getAttribute("data-name");
    if (!confirm("Remove " + name + "? The bot stops answering there.")) return;
    tr.classList.add("busy");
    apiJson(tr.getAttribute("data-kind") + "/" + tr.getAttribute("data-id"), { method: "DELETE" })
      .then(function () { flash("routeMsg", "Removed " + name + ".", "ok"); loadRoutes(); loadAudit(); })
      .catch(function (e) { tr.classList.remove("busy"); if (e.message !== "unauthorized") flash("routeMsg", e.message, "err"); });
  });
  $("botChips").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-bot]"); if (!b) return;
    filterBot = b.getAttribute("data-bot"); renderLedger();
  });
  $("routeSearch").addEventListener("input", function () { query = this.value; renderLedger(); });

  // pair selects inside the add panels
  document.addEventListener("change", function (ev) {
    if (ev.target.getAttribute && ev.target.getAttribute("data-role") === "bot") {
      var scope = ev.target.closest("[data-pair]"); if (scope) syncLevel(scope);
    }
  });

  // ── add a group ───────────────────────────────────────────────────
  function loadDiscovery() {
    $("discRows").innerHTML = '<tr class="empty"><td colspan="5">Asking WhatsApp which groups this number is in…</td></tr>';
    apiJson("discover/groups").then(function (j) {
      var un = (j.groups || []).filter(function (g) { return !g.allowlisted; });
      $("discRows").innerHTML = un.length ? un.map(function (g) {
        var name = g.subject || "Untitled group";
        return '<tr data-jid="' + esc(g.jid) + '" data-name="' + esc(name) + '" data-pair>' +
          '<td class="c-main"><div class="nm">' + ico("group") + '<div class="nm-text"><span class="nm-title">' + esc(name) + '</span><span class="nm-sub">' + esc(g.jid) + "</span></div></div></td>" +
          '<td class="c-fit" data-label="Members"><span class="ago">' + esc(g.size) + "</span></td>" +
          '<td class="c-fit c-sel" data-label="Bot"><select data-role="bot" aria-label="Persona for ' + esc(name) + '">' + botOptions(0, false) + "</select></td>" +
          '<td class="c-fit c-sel" data-label="Level"><select data-role="lvl" aria-label="Level" disabled><option value="1">Level 1</option><option value="2">Level 2 · live search</option></select></td>' +
          '<td class="c-end"><button class="btn btn-sm" data-role="add">' + ico("plus") + "Add</button></td></tr>";
      }).join("") : '<tr class="empty"><td colspan="5"><b>Every group this number is in is already routed.</b>Paste a JID above to add one by hand.</td></tr>';
    }).catch(function (e) {
      if (e.message === "unauthorized") return;
      $("discRows").innerHTML = '<tr class="empty"><td colspan="5">' + (e.code === "socket_not_open" ? "<b>WhatsApp isn\\u2019t connected,</b>so groups can\\u2019t be listed. Paste a JID above instead." : "<b>Couldn\\u2019t list groups.</b>" + esc(e.message)) + "</td></tr>";
    });
  }
  function addRoute(kind, jid, bot, lvl, msgId, done) {
    return apiJson(kind, { method: "POST", body: { jid: jid, botNumber: bot, level: bot === 2 ? lvl : 1 } })
      .then(function (j) { flash(msgId, "Added " + (kind === "chats" ? phone(j.jid) : (j.jid || jid)) + " to " + botName(bot) + ".", "ok"); loadRoutes(); loadAudit(); if (done) done(); })
      .catch(function (e) { if (e.message !== "unauthorized") flash(msgId, e.code === "already_allowlisted" ? "That one is already routed." : e.message, "err"); });
  }
  $("discRows").addEventListener("click", function (ev) {
    var b = ev.target.closest('[data-role="add"]'); if (!b) return;
    var tr = b.closest("tr");
    b.disabled = true;
    addRoute("groups", tr.getAttribute("data-jid"), Number(tr.querySelector('[data-role="bot"]').value), Number(tr.querySelector('[data-role="lvl"]').value), "grpAddMsg", function () { tr.remove(); })
      .then(function () { b.disabled = false; });
  });
  $("grpManualAdd").onclick = function () {
    var jid = $("grpManual").value.trim();
    if (!jid) { flash("grpAddMsg", "Paste a group JID first.", "err"); $("grpManual").focus(); return; }
    addRoute("groups", jid, Number($("grpManualBot").value), Number($("grpManualLvl").value), "grpAddMsg", function () { $("grpManual").value = ""; });
  };
  $("addGroupBtn").onclick = function () {
    var p = $("addGroupPanel"), open = p.classList.toggle("hidden") === false;
    $("addChatPanel").classList.add("hidden");
    if (open) { flash("grpAddMsg", ""); loadDiscovery(); }
  };
  $("addGroupClose").onclick = function () { $("addGroupPanel").classList.add("hidden"); };

  // ── add a number ──────────────────────────────────────────────────
  $("addChatBtn").onclick = function () {
    var open = $("addChatPanel").classList.toggle("hidden") === false;
    $("addGroupPanel").classList.add("hidden");
    if (open) { flash("chatAddMsg", ""); $("chatNum").focus(); }
  };
  $("addChatClose").onclick = function () { $("addChatPanel").classList.add("hidden"); };
  $("chatAdd").onclick = function () {
    var n = $("chatNum").value.trim();
    if (!n) { flash("chatAddMsg", "Enter a phone number with its country code.", "err"); $("chatNum").focus(); return; }
    addRoute("chats", n, Number($("chatBot").value), Number($("chatLvl").value), "chatAddMsg", function () { $("chatNum").value = ""; });
  };
  $("chatNum").addEventListener("keydown", function (e) { if (e.key === "Enter") $("chatAdd").click(); });
  $("grpManual").addEventListener("keydown", function (e) { if (e.key === "Enter") $("grpManualAdd").click(); });

  // ── keys ──────────────────────────────────────────────────────────
  function loadKeys() {
    apiJson("keys").then(function (j) {
      var keys = j.keys || [];
      var live = keys.filter(function (k) { return !k.revokedAt; });
      $("keyCount").textContent = live.length ? String(live.length) : "";
      $("kRows").innerHTML = keys.length ? keys.map(function (k) {
        var dead = !!k.revokedAt, used = toMs(k.lastUsedAt);
        return "<tr" + (dead ? ' class="off"' : "") + '><td class="c-main"><div class="nm">' + ico("key") + '<div class="nm-text"><span class="nm-title">' + esc(k.name) + '</span><span class="nm-sub">' + esc(k.prefix) + "…</span></div></div></td>" +
          '<td class="c-fit" data-label="Role"><span class="tag' + (k.role === "operator" ? " edit" : "") + '">' + esc(k.role) + "</span></td>" +
          '<td class="c-fit" data-label="Bot">' + (k.botNumber == null ? "Any" : esc(botName(k.botNumber))) + "</td>" +
          '<td class="c-fit" data-label="Last used"><span class="ago">' + (used ? esc(agoShort(used)) + " ago" : "never") + "</span></td>" +
          '<td class="c-end">' + (dead ? '<span class="tag">revoked</span>' : '<button class="btn btn-sm btn-quiet-danger" data-revoke="' + esc(k.id) + '" data-name="' + esc(k.name) + '">Revoke</button>') + "</td></tr>";
      }).join("") : '<tr class="empty"><td colspan="5"><b>No keys yet.</b>Create one to let a script send through the bot.</td></tr>';
    }).catch(function (e) {
      if (e.message === "unauthorized") return;
      $("kRows").innerHTML = '<tr class="empty"><td colspan="5"><b>Couldn\\u2019t load keys.</b>' + esc(e.message) + "</td></tr>";
    });
  }
  $("addKeyBtn").onclick = function () {
    var open = $("addKeyPanel").classList.toggle("hidden") === false;
    if (open) { $("kBot").innerHTML = botOptions("", true); $("kNew").classList.add("hidden"); flash("kAddMsg", ""); $("kName").focus(); }
  };
  $("addKeyClose").onclick = function () { $("addKeyPanel").classList.add("hidden"); $("kNew").classList.add("hidden"); $("kNewVal").textContent = ""; };
  $("kCreate").onclick = function () {
    var name = $("kName").value.trim();
    if (!name) { flash("kAddMsg", "Give the key a name.", "err"); $("kName").focus(); return; }
    var bot = $("kBot").value;
    $("kCreate").disabled = true;
    apiJson("keys", { method: "POST", body: { name: name, role: $("kRole").value, botNumber: bot === "" ? null : Number(bot) } })
      .then(function (j) { $("kNew").classList.remove("hidden"); $("kNewVal").textContent = j.key; $("kName").value = ""; flash("kAddMsg", ""); loadKeys(); })
      .catch(function (e) { if (e.message !== "unauthorized") flash("kAddMsg", e.message, "err"); })
      .then(function () { $("kCreate").disabled = false; });
  };
  $("kCopy").onclick = function () {
    var v = $("kNewVal").textContent;
    if (!v) return;
    var done = function () { flash("kAddMsg", "Copied.", "ok"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () { flash("kAddMsg", "Copy blocked by the browser; select the key and copy it.", "err"); });
    else { var r = document.createRange(); r.selectNodeContents($("kNewVal")); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); flash("kAddMsg", "Selected. Press Ctrl+C to copy."); }
  };
  $("kRows").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-revoke]"); if (!b) return;
    if (!confirm("Revoke \\u201c" + b.getAttribute("data-name") + "\\u201d? Anything using it will start getting 401.")) return;
    b.disabled = true;
    apiJson("keys/" + b.getAttribute("data-revoke"), { method: "DELETE" })
      .then(function () { flash("kMsg", "Revoked.", "ok"); loadKeys(); })
      .catch(function (e) { b.disabled = false; if (e.message !== "unauthorized") flash("kMsg", e.message, "err"); });
  });

  // ── activity ──────────────────────────────────────────────────────
  // Rows come from dk24_action_logs: { id, actorJid, actionType, targetId,
  // targetName, details (JSON text), createdAt }.
  var VERBS = { add: "Added", remove: "Removed", "delete": "Removed", edit: "Edited", enable: "Turned on", disable: "Turned off", restore: "Restored" };
  function describe(action) {
    var p = String(action || "").split("_");
    if (p.length === 2 && VERBS[p[0]] && (p[1] === "group" || p[1] === "chat")) return VERBS[p[0]] + " " + p[1];
    if (action === "screenshot") return "Took screenshot";
    if (action === "addssr") return "Granted screenshots";
    if (action === "rmssr") return "Revoked screenshots";
    var s = String(action || "change").replace(/_/g, " ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function tone(action) {
    var v = String(action || "").split("_")[0];
    if (v === "add" || v === "restore" || v === "enable" || action === "addssr") return "ok";
    if (v === "remove" || v === "delete" || v === "disable" || action === "rmssr") return "err";
    if (v === "edit") return "edit";
    return "";
  }
  function groupName(jid) {
    for (var i = 0; i < routes.groups.length; i++) if (routes.groups[i].jid === jid && routes.groups[i].name) return routes.groups[i].name;
    return null;
  }
  function loadAudit() {
    apiJson("audit").then(function (j) {
      var logs = j.logs || [];
      $("auditCount").textContent = logs.length ? String(logs.length) : "";
      $("auditRows").innerHTML = logs.length ? logs.map(function (l) {
        var action = l.actionType || l.action || "";
        var d = l.details;
        if (typeof d === "string") { try { d = JSON.parse(d); } catch (err) { d = null; } }
        var jid = (d && d.jid) || l.targetName || l.target || "";
        var target = jid ? (jid.indexOf("@g.us") > 0 ? (groupName(jid) || jid) : phone(jid)) : "—";
        var extra = [];
        if (d && d.botNumber != null) extra.push(botName(d.botNumber));
        if (d && d.level != null) extra.push("level " + d.level);
        if (d && d.enabled != null) extra.push(d.enabled ? "on" : "off");
        var actor = l.actorJid === "admin_web" ? "Console" : (l.actorJid ? phone(l.actorJid) : "—");
        var when = toMs(l.createdAt || l.timestamp);
        // Restore needs the JID in details; older chat-command rows carry it but
        // no level, so those come back at level 1.
        var canRestore = /^(remove|delete)_(group|chat)$/.test(action) && !!jid;
        return '<tr><td class="c-fit" data-label="Change"><span class="tag ' + tone(action) + '">' + esc(describe(action)) + "</span></td>" +
          '<td class="c-main"><div class="nm-text"><span class="nm-title">' + esc(target) + '</span><span class="nm-sub">' + esc(extra.join(" · ") || (jid && target !== jid ? jid : "")) + "</span></div></td>" +
          '<td class="c-fit" data-label="By"><span class="ago">' + esc(actor) + "</span></td>" +
          '<td class="c-fit" data-label="When"><span class="ago">' + (when ? esc(agoShort(when)) + " ago" : "—") + "</span></td>" +
          '<td class="c-end">' + (canRestore ? '<button class="btn btn-sm" data-restore="' + esc(l.id) + '" data-name="' + esc(target) + '">' + ico("restore") + "Restore</button>" : "") + "</td></tr>";
      }).join("") : '<tr class="empty"><td colspan="5"><b>No changes recorded yet.</b>Adds, edits and removals show up here.</td></tr>';
    }).catch(function (e) {
      if (e.message === "unauthorized") return;
      $("auditRows").innerHTML = '<tr class="empty"><td colspan="5"><b>Couldn\\u2019t load activity.</b>' + esc(e.message) + "</td></tr>";
    });
  }
  $("auditRows").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-restore]"); if (!b) return;
    if (!confirm("Put " + b.getAttribute("data-name") + " back with the persona it had? Level comes back as recorded, or 1 if none was.")) return;
    b.disabled = true;
    apiJson("audit/restore", { method: "POST", body: { logId: Number(b.getAttribute("data-restore")) } })
      .then(function () { flash("auditMsg", "Restored " + b.getAttribute("data-name") + ".", "ok"); loadAudit(); loadRoutes(); })
      .catch(function (e) { b.disabled = false; if (e.message !== "unauthorized") flash("auditMsg", e.message, "err"); });
  });
  $("refreshAuditBtn").onclick = loadAudit;

  // ── top bar + login ───────────────────────────────────────────────
  $("loginForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = $("tok").value.trim(); if (!v) return;
    token = v;
    try { sessionStorage.setItem(KEY, v); } catch (e) { /* storage blocked: keep it for this tab only */ }
    showApp();
  });
  $("refreshBtn").onclick = function () { refresh(); loadRoutes(); loadKeys(); loadAudit(); };
  $("restartBtn").onclick = function () { act("restart", "Restart the bot? WhatsApp reconnects in about 20 seconds."); };
  $("relinkBtn").onclick = function () { act("relink", "Unlink this phone and wipe the session? You'll scan a new QR code here afterwards."); };
  $("logoutBtn").onclick = function () { forget(); showLogin(); };

  fillBotSelects();
  if (token) showApp(); else showLogin();
})();
</script>
</body>
</html>`;
}
