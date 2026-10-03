/**
 * Admin dashboard — one HTML document, vanilla JS, served by the health
 * server. No framework, no build step, nothing extra in the container.
 *
 * Auth: the page asks for ADMIN_TOKEN once, keeps it in sessionStorage, and
 * sends it as a Bearer header on every /admin/api call. The HTML itself is
 * public but holds nothing sensitive; every data call is gated server-side.
 *
 * Design notes: one hero slot (the wheel, or the QR when pairing is needed)
 * carries the state; everything below is quiet tables. Mono is used only for
 * machine identifiers (JIDs, keys). Motion is limited to the wheel turning
 * while connecting, and is disabled under prefers-reduced-motion.
 */
export function renderAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MAHORAGA — Control Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-canvas:#050811;
    --bg-surface:rgba(12, 18, 34, 0.78);
    --bg-card:rgba(16, 25, 46, 0.7);
    --bg-input:rgba(6, 10, 20, 0.88);
    --border-glass:rgba(56, 189, 248, 0.16);
    --border-glass-gold:rgba(251, 191, 36, 0.35);
    --border-glass-hover:rgba(56, 189, 248, 0.38);
    --gold:#fbbf24;
    --gold-soft:rgba(251, 191, 36, 0.12);
    --gold-glow:rgba(251, 191, 36, 0.35);
    --cyan:#38bdf8;
    --cyan-soft:rgba(56, 189, 248, 0.14);
    --cyan-glow:rgba(56, 189, 248, 0.35);
    --emerald:#10b981;
    --emerald-soft:rgba(16, 185, 129, 0.14);
    --amber:#f59e0b;
    --amber-soft:rgba(245, 158, 11, 0.14);
    --crimson:#f43f5e;
    --crimson-soft:rgba(244, 63, 94, 0.15);
    --text-pure:#ffffff;
    --text-body:#e2e8f0;
    --text-muted:#94a3b8;
    --text-sub:#64748b;
    --sans:"Space Grotesk", system-ui, -apple-system, sans-serif;
    --serif:"Cinzel", Georgia, serif;
    --mono:"JetBrains Mono", ui-monospace, Consolas, monospace;
  }
  * { box-sizing:border-box; }
  html { background:var(--bg-canvas); color:var(--text-body); min-height:100%; }
  body {
    margin:0;
    color:var(--text-body);
    font:14px/1.55 var(--sans);
    font-feature-settings:"tnum" 1;
    -webkit-font-smoothing:antialiased;
    background:radial-gradient(circle at 85% 15%, rgba(56, 189, 248, 0.08) 0%, transparent 45%),
               radial-gradient(circle at 15% 75%, rgba(251, 191, 36, 0.05) 0%, transparent 40%),
               linear-gradient(180deg, #070a14 0%, #04060b 100%);
    position:relative;
    overflow-x:hidden;
    min-height:100vh;
  }
  a { color:var(--cyan); text-decoration:none; }
  a:hover { text-decoration:underline; }
  button, input, select { font:inherit; color:inherit; }
  button {
    cursor:pointer;
    background:rgba(18, 27, 47, 0.7);
    border:1px solid var(--border-glass);
    border-radius:6px;
    padding:7px 14px;
    line-height:1.3;
    font-weight:500;
    color:var(--text-body);
    backdrop-filter:blur(8px);
    transition:all .2s ease;
  }
  button:hover {
    border-color:var(--cyan);
    color:var(--text-pure);
    background:rgba(28, 42, 70, 0.85);
    box-shadow:0 0 14px var(--cyan-glow);
  }
  button:focus-visible, input:focus-visible, select:focus-visible, a:focus-visible {
    outline:2px solid var(--cyan);
    outline-offset:2px;
  }
  button.primary {
    background:linear-gradient(135deg, #d97706, #fbbf24);
    color:#03060c;
    border:none;
    font-weight:700;
    letter-spacing:.02em;
    box-shadow:0 0 18px var(--gold-glow);
  }
  button.primary:hover {
    background:linear-gradient(135deg, #fbbf24, #f59e0b);
    box-shadow:0 0 25px rgba(251, 191, 36, 0.65);
    transform:translateY(-1px);
  }
  button.quiet {
    border-color:transparent;
    background:transparent;
    padding:6px 10px;
    color:var(--text-muted);
  }
  button.quiet:hover {
    color:var(--cyan);
    background:transparent;
    border-color:transparent;
    text-shadow:0 0 8px var(--cyan-glow);
    text-decoration:none;
  }
  button.danger {
    color:#fda4af;
    border-color:rgba(244, 63, 94, 0.35);
    background:rgba(244, 63, 94, 0.08);
  }
  button.danger:hover {
    border-color:var(--crimson);
    color:#fff;
    background:rgba(244, 63, 94, 0.2);
    box-shadow:0 0 14px rgba(244, 63, 94, 0.4);
  }
  td.actions button.quiet.danger { color:var(--text-sub); }
  td.actions button.quiet.danger:hover { color:#fda4af; text-shadow:0 0 8px rgba(244, 63, 94, 0.5); }
  button:disabled { opacity:.4; cursor:default; pointer-events:none; }
  input, select {
    background:var(--bg-input);
    border:1px solid var(--border-glass);
    border-radius:6px;
    padding:8px 12px;
    color:var(--text-pure);
    transition:border-color .2s, box-shadow .2s;
  }
  input:focus, select:focus {
    outline:none;
    border-color:var(--cyan);
    box-shadow:0 0 0 2px var(--cyan-glow);
  }
  select {
    padding-right:30px;
    appearance:none;
    background-image:url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2338bdf8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
    background-repeat:no-repeat;
    background-position:right 9px center;
    background-size:14px;
  }
  select option { background:#0a0f1e; color:#e2e8f0; }
  .mono { font-family:var(--mono); font-size:.88em; }
  .muted { color:var(--text-muted); }
  .hidden { display:none !important; }

  /* Ambient atmosphere */
  .bg-atmosphere {
    position:fixed;
    inset:0;
    pointer-events:none;
    z-index:0;
    overflow:hidden;
  }
  .bg-wheel-art {
    position:absolute;
    top:-60px;
    right:-80px;
    width:700px;
    height:700px;
    background:url('/admin/asset/mahoraga_wheel.jpg') center/cover no-repeat;
    opacity:0.18;
    border-radius:50%;
    filter:drop-shadow(0 0 60px rgba(56, 189, 248, 0.4));
    mask-image:radial-gradient(circle at center, black 38%, transparent 74%);
    -webkit-mask-image:radial-gradient(circle at center, black 38%, transparent 74%);
    animation:slowWheel 140s linear infinite;
  }
  .bg-character-art {
    position:absolute;
    bottom:-100px;
    left:-60px;
    width:420px;
    height:640px;
    background:url('/admin/asset/mahoraga_character.png') center/contain no-repeat;
    opacity:0.06;
    pointer-events:none;
    filter:grayscale(100%) contrast(150%);
    mask-image:linear-gradient(to top, black 50%, transparent 95%);
    -webkit-mask-image:linear-gradient(to top, black 50%, transparent 95%);
  }
  .bg-watermark-kanji {
    position:absolute;
    bottom:20px;
    right:40px;
    font-family:var(--serif);
    font-size:130px;
    font-weight:900;
    letter-spacing:0.15em;
    color:rgba(255, 255, 255, 0.02);
    user-select:none;
    line-height:1;
    pointer-events:none;
  }
  @keyframes slowWheel {
    from { transform:rotate(0deg); }
    to { transform:rotate(360deg); }
  }

  .wrap { max-width:1120px; margin:0 auto; padding:0 24px 80px; position:relative; z-index:1; }
  header.top { display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:24px 0 16px; flex-wrap:wrap; border-bottom:1px solid var(--border-glass); }
  header.top .brand { display:flex; align-items:center; gap:12px; }
  header.top h1 { margin:0; font-family:var(--serif); font-size:20px; font-weight:800; letter-spacing:.08em; color:var(--text-pure); display:flex; align-items:center; gap:10px; }
  header.top h1 .wheel-emblem { color:var(--gold); font-size:18px; filter:drop-shadow(0 0 8px var(--gold-glow)); }
  header.top h1 span.build { font-family:var(--mono); font-weight:400; color:var(--cyan); font-size:12px; letter-spacing:0; background:var(--cyan-soft); padding:2px 8px; border-radius:4px; border:1px solid var(--border-glass); }
  header.top .tools { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }

  /* Login */
  #login {
    max-width:440px;
    margin:14vh auto 0;
    background:var(--bg-surface);
    backdrop-filter:blur(24px);
    -webkit-backdrop-filter:blur(24px);
    border:1px solid var(--border-glass-gold);
    border-radius:12px;
    padding:32px 28px;
    box-shadow:0 0 50px rgba(0, 0, 0, 0.8), 0 0 25px rgba(251, 191, 36, 0.12);
    text-align:center;
  }
  #login .wheel-icon { font-size:36px; color:var(--gold); margin-bottom:8px; display:inline-block; filter:drop-shadow(0 0 14px var(--gold-glow)); animation:slowWheel 40s linear infinite; }
  #login h2 { margin:0 0 4px; font-family:var(--serif); font-size:22px; font-weight:800; letter-spacing:.08em; color:var(--gold); }
  #login .summon-quote { font-style:italic; color:var(--cyan); font-size:13px; margin:0 0 16px; opacity:.9; }
  #login p { margin:0 0 18px; color:var(--text-muted); font-size:14px; }
  #login input { width:100%; margin-bottom:14px; text-align:center; letter-spacing:.05em; }
  #login button { width:100%; padding:10px; }

  /* Hero */
  .hero {
    background:var(--bg-surface);
    backdrop-filter:blur(20px);
    -webkit-backdrop-filter:blur(20px);
    border:1px solid var(--border-glass);
    border-radius:10px;
    padding:28px 32px;
    display:grid;
    grid-template-columns:210px 1fr;
    gap:32px;
    align-items:center;
    box-shadow:0 12px 40px rgba(0, 0, 0, 0.5);
    margin-top:20px;
    position:relative;
    overflow:hidden;
  }
  .hero::after {
    content:"";
    position:absolute;
    top:0; right:0; width:220px; height:100%;
    background:radial-gradient(circle at 100% 50%, rgba(56, 189, 248, 0.08) 0%, transparent 70%);
    pointer-events:none;
  }
  @media (max-width:640px) {
    .hero { grid-template-columns:1fr; justify-items:center; text-align:center; padding:22px 18px; }
  }
  .gauge { width:200px; height:200px; position:relative; }
  .gauge svg { width:100%; height:100%; display:block; filter:drop-shadow(0 0 10px rgba(0,0,0,0.6)); }
  .gauge .aura { fill:none; stroke-width:1; stroke:rgba(251, 191, 36, 0.2); stroke-dasharray:3 5; }
  .gauge .ring { fill:none; stroke-width:8; stroke:rgba(255, 255, 255, 0.06); }
  .gauge .arc { fill:none; stroke-width:9; stroke-linecap:round; stroke:var(--text-sub); transition:stroke .3s, stroke-dashoffset .5s ease; }
  .gauge .spokes line { stroke:var(--border-glass-gold); stroke-width:2.2; stroke-linecap:round; }
  .gauge .spokes circle.handle { fill:var(--gold); stroke:#050811; stroke-width:1.5; filter:drop-shadow(0 0 4px var(--gold-glow)); }
  .gauge .spokes { stroke-width:2; transform-origin:100px 100px; }
  .gauge .hub { fill:#080d1a; stroke:var(--border-glass); stroke-width:2; }
  .gauge .hub-inner { fill:none; stroke:rgba(56, 189, 248, 0.3); stroke-width:1.2; stroke-dasharray:4 4; }
  .gauge.open .arc { stroke:var(--emerald); filter:drop-shadow(0 0 8px rgba(16, 185, 129, 0.7)); }
  .gauge.open .hub-inner { stroke:rgba(16, 185, 129, 0.5); }
  .gauge.connecting .arc, .gauge.starting .arc { stroke:var(--gold); filter:drop-shadow(0 0 10px var(--gold-glow)); }
  .gauge.closed .arc, .gauge.logged_out .arc { stroke:var(--crimson); filter:drop-shadow(0 0 8px rgba(244, 63, 94, 0.7)); }
  .gauge.connecting .spokes, .gauge.starting .spokes { animation:turn 8s linear infinite; }
  @keyframes turn { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion:reduce) {
    .gauge .spokes, .bg-wheel-art, #login .wheel-icon { animation:none !important; }
  }
  .gauge .centre { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; }
  .gauge .big { font-size:38px; font-weight:700; color:var(--text-pure); line-height:1; letter-spacing:-.02em; text-shadow:0 0 20px rgba(255,255,255,0.2); }
  .gauge .small { font-size:11px; color:var(--text-muted); margin-top:6px; max-width:120px; line-height:1.3; text-transform:uppercase; letter-spacing:0.08em; }
  .facts .divine-epithet { font-size:11px; font-weight:700; letter-spacing:0.18em; color:var(--gold); text-transform:uppercase; margin-bottom:4px; text-shadow:0 0 10px rgba(251, 191, 36, 0.3); }
  .facts h2 { margin:0 0 8px; font-family:var(--serif); font-size:24px; font-weight:700; letter-spacing:.02em; color:var(--text-pure); display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .facts h2 .state { display:inline-block; font-family:var(--sans); font-size:12px; font-weight:600; padding:3px 10px; border-radius:999px; vertical-align:middle; text-transform:uppercase; letter-spacing:.08em; }
  .state.open { background:var(--emerald-soft); color:var(--emerald); border:1px solid rgba(16, 185, 129, 0.4); box-shadow:0 0 12px rgba(16, 185, 129, 0.25); }
  .state.connecting, .state.starting { background:var(--amber-soft); color:var(--gold); border:1px solid rgba(251, 191, 36, 0.4); box-shadow:0 0 12px var(--gold-glow); }
  .state.closed, .state.logged_out { background:var(--crimson-soft); color:#fda4af; border:1px solid rgba(244, 63, 94, 0.4); box-shadow:0 0 12px rgba(244, 63, 94, 0.3); }
  .facts p { margin:0 0 5px; color:var(--text-muted); font-size:14px; }
  .facts p b { color:var(--text-pure); font-weight:600; }
  .facts .warn { color:#fda4af; font-weight:500; }
  .qr { width:200px; height:200px; background:#fff; border:1px solid var(--border-glass-gold); border-radius:8px; display:flex; align-items:center; justify-content:center; box-shadow:0 0 20px rgba(251, 191, 36, 0.2); }
  .qr img { width:188px; height:188px; image-rendering:pixelated; }

  /* Sections */
  section.list { margin-top:36px; }
  .sechead { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
  .sechead h2 { margin:0; font-family:var(--serif); font-size:18px; font-weight:700; letter-spacing:.04em; color:var(--text-pure); }
  .sechead h2 small { font-family:var(--mono); color:var(--cyan); font-weight:500; margin-left:8px; font-size:13px; }
  .sechead .hint { color:var(--text-muted); font-size:13px; flex-basis:100%; margin-top:2px; }
  table {
    width:100%;
    border-collapse:collapse;
    background:var(--bg-surface);
    backdrop-filter:blur(16px);
    -webkit-backdrop-filter:blur(16px);
    border:1px solid var(--border-glass);
    border-radius:8px;
    overflow:hidden;
    box-shadow:0 8px 30px rgba(0, 0, 0, 0.35);
  }
  th, td { text-align:left; padding:12px 14px; border-top:1px solid rgba(255, 255, 255, 0.05); vertical-align:middle; }
  thead th { border-top:0; background:rgba(8, 13, 26, 0.85); color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:.08em; border-bottom:1px solid var(--border-glass); }
  td .sub { display:block; color:var(--text-sub); font-size:12px; margin-top:2px; }
  td.num { width:1%; white-space:nowrap; }
  td.actions { text-align:right; white-space:nowrap; width:1%; }
  tr.off td:first-child { color:var(--text-sub); }
  tbody tr:hover td { background:rgba(56, 189, 248, 0.035); }
  td select { padding:5px 28px 5px 10px; font-size:13px; }
  .toggle { display:inline-flex; align-items:center; gap:6px; cursor:pointer; }
  .toggle input { accent-color:var(--cyan); width:16px; height:16px; margin:0; }
  .empty td { color:var(--text-muted); padding:22px 14px; text-align:center; font-style:italic; }

  /* Inline panels */
  .panel {
    background:var(--bg-card);
    backdrop-filter:blur(16px);
    -webkit-backdrop-filter:blur(16px);
    border:1px solid var(--border-glass-gold);
    border-radius:8px;
    padding:16px 18px;
    margin-bottom:12px;
    box-shadow:0 8px 24px rgba(0, 0, 0, 0.4);
  }
  .panel .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .panel .row input { flex:1 1 200px; }
  .panel p { margin:0 0 12px; color:var(--text-muted); font-size:14px; }
  .panel table { border:0; border-top:1px solid var(--border-glass); border-radius:0; margin-top:12px; }
  .keyreveal { margin-top:12px; padding:12px 14px; border:1px dashed var(--gold); border-radius:6px; background:var(--gold-soft); }
  .keyreveal code { display:block; margin-top:6px; word-break:break-all; user-select:all; color:var(--gold); }
  .flash { font-size:13px; color:var(--text-muted); min-height:18px; margin-top:8px; }
  .flash.err { color:#fda4af; }
  .flash.ok { color:var(--emerald); }
  .badge { display:inline-block; font-size:11px; font-weight:700; padding:2px 8px; border-radius:4px; vertical-align:middle; text-transform:uppercase; letter-spacing:.05em; }
  .badge.ok { background:var(--emerald-soft); color:var(--emerald); border:1px solid rgba(16, 185, 129, 0.35); }
  .badge.warn { background:var(--gold-soft); color:var(--gold); border:1px solid rgba(251, 191, 36, 0.35); }
  .badge.err { background:var(--crimson-soft); color:#fda4af; border:1px solid rgba(244, 63, 94, 0.35); }
  .badge.neutral { background:rgba(255, 255, 255, 0.06); color:var(--text-muted); border:1px solid rgba(255, 255, 255, 0.1); }
  
  .services-bar { display:flex; gap:10px; margin-top:18px; padding-top:16px; border-top:1px solid var(--border-glass); flex-wrap:wrap; font-size:13px; align-items:center; }
  .service-item { display:inline-flex; align-items:center; gap:7px; background:rgba(8, 13, 26, 0.65); border:1px solid var(--border-glass); border-radius:999px; padding:4px 12px; color:var(--text-body); }
  .dot { width:7px; height:7px; border-radius:50%; display:inline-block; }
  .dot.ok { background:var(--emerald); box-shadow:0 0 8px rgba(16, 185, 129, 0.8); }
  .dot.warn { background:var(--amber); box-shadow:0 0 8px rgba(245, 158, 11, 0.8); }
  .dot.err { background:var(--crimson); box-shadow:0 0 8px rgba(244, 63, 94, 0.8); }
  .dot.off { background:var(--text-sub); }
  .activity-chip { display:inline-block; font-size:11px; padding:2px 7px; border-radius:4px; background:rgba(255, 255, 255, 0.06); color:var(--text-muted); margin-left:6px; font-weight:normal; border:1px solid rgba(255, 255, 255, 0.08); }
  .activity-chip.live { background:var(--cyan-soft); color:var(--cyan); border-color:rgba(56, 189, 248, 0.3); font-weight:600; text-shadow:0 0 8px var(--cyan-glow); }
  .restore-btn { font-size:12px; padding:3px 9px; border-radius:4px; }
  @media (max-width:640px) { th.hide-sm, td.hide-sm { display:none; } td, th { padding:10px 8px; } section.list, .panel { overflow-x:auto; } table { min-width:480px; } }
</style>
</head>
<body>
<div class="bg-atmosphere" aria-hidden="true">
  <div class="bg-wheel-art"></div>
  <div class="bg-character-art"></div>
  <div class="bg-watermark-kanji">魔虚羅</div>
</div>

<div class="wrap">

<section id="login" class="hidden">
  <div class="wheel-icon">☸</div>
  <h2>MAHORAGA</h2>
  <div class="summon-quote">“With this treasure, I summon…”</div>
  <p>Enter the admin token to awaken the control console.</p>
  <input id="tok" type="password" placeholder="Admin token" autocomplete="current-password" aria-label="Admin token">
  <button id="loginBtn" class="primary">Open console</button>
  <div class="flash" id="loginMsg"></div>
</section>

<div id="app" class="hidden">
  <header class="top">
    <div class="brand">
      <h1><span class="wheel-emblem">☸</span> MAHORAGA <span id="buildTag" class="build"></span></h1>
    </div>
    <div class="tools">
      <button id="refreshBtn" class="quiet">Refresh</button>
      <button id="restartBtn">Restart bot</button>
      <button id="relinkBtn" class="danger">Unlink and pair again</button>
      <button id="logoutBtn" class="quiet">Forget token</button>
    </div>
  </header>

  <section class="hero" aria-live="polite">
    <div id="heroSlot">
      <div class="gauge" id="gauge">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="aura" cx="100" cy="100" r="95"/>
          <circle class="ring" cx="100" cy="100" r="88"/>
          <circle class="arc" id="arc" cx="100" cy="100" r="88" stroke-dasharray="553" stroke-dashoffset="553" transform="rotate(-90 100 100)"/>
          <g class="spokes" id="spokes"></g>
          <circle class="hub" cx="100" cy="100" r="62"/>
          <circle class="hub-inner" cx="100" cy="100" r="54"/>
        </svg>
        <div class="centre"><div class="big" id="bigNum">—</div><div class="small" id="bigLabel">waiting for status</div></div>
      </div>
    </div>
    <div class="facts">
      <div class="divine-epithet">Eight-Handled Sword Divergent Sila Divine General</div>
      <h2 id="headline">MAHORAGA<span class="state" id="statePill"></span></h2>
      <p id="factMsgs"></p>
      <p id="factUp"></p>
      <p id="factModels"></p>
      <div class="services-bar" id="servicesBar">
        <span class="service-item"><span class="dot off" id="dotNeon"></span> <span id="lblNeon">Neon DB</span></span>
        <span class="service-item"><span class="dot off" id="dotRedis"></span> <span id="lblRedis">Redis</span></span>
        <span class="service-item"><span class="dot off" id="dotGroq"></span> <span id="lblGroq">Groq AI</span></span>
        <span class="service-item" id="searchProviders"></span>
      </div>
      <div class="flash" id="actionMsg"></div>
    </div>
  </section>

  <section class="list" id="secGroups">
    <div class="sechead">
      <h2>Groups <small id="grpCount"></small></h2>
      <button id="addGroupBtn">Add a group</button>
      <div class="hint">Groups the bot answers in. The bot column decides persona; Level sets capabilities (Lvl 2 = Live Search).</div>
    </div>
    <div class="panel hidden" id="addGroupPanel">
      <p>Groups this number is a member of but the bot ignores. Pick a bot, select level, and add.</p>
      <div class="row">
        <input id="grpManual" placeholder="or paste a group JID (…@g.us)">
        <select id="grpManualBot"></select>
        <select id="grpManualLvl">
          <option value="1">Lvl 1 (Community)</option>
          <option value="2">Lvl 2 (Live Search)</option>
        </select>
        <button id="grpManualAdd">Add</button>
        <button id="addGroupClose" class="quiet">Close</button>
      </div>
      <table><thead><tr><th>Group</th><th class="hide-sm">Members</th><th>Bot</th><th>Level</th><th></th></tr></thead><tbody id="discRows"><tr class="empty"><td colspan="5">Loading groups from WhatsApp…</td></tr></tbody></table>
      <div class="flash" id="grpAddMsg"></div>
    </div>
    <table>
      <thead><tr><th>Group</th><th class="hide-sm">Activity</th><th>Bot</th><th>Level</th><th>Active</th><th></th></tr></thead>
      <tbody id="grpRows"><tr class="empty"><td colspan="6">Loading…</td></tr></tbody>
    </table>
    <div class="flash" id="grpMsg"></div>
  </section>

  <section class="list" id="secChats">
    <div class="sechead">
      <h2>Direct chats <small id="chatCount"></small></h2>
      <button id="addChatBtn">Add a number</button>
      <div class="hint">People the bot replies to in private. Admins are always allowed and don't need to be here.</div>
    </div>
    <div class="panel hidden" id="addChatPanel">
      <div class="row">
        <input id="chatNum" placeholder="Phone with country code, e.g. 919902849280" inputmode="numeric">
        <select id="chatBot"></select>
        <select id="chatLvl">
          <option value="1">Lvl 1 (Community)</option>
          <option value="2">Lvl 2 (Live Search)</option>
        </select>
        <button id="chatAdd">Add</button>
        <button id="addChatClose" class="quiet">Close</button>
      </div>
      <div class="flash" id="chatAddMsg"></div>
    </div>
    <table>
      <thead><tr><th>Number</th><th>Bot</th><th>Level</th><th>Active</th><th></th></tr></thead>
      <tbody id="chatRows"><tr class="empty"><td colspan="5">Loading…</td></tr></tbody>
    </table>
    <div class="flash" id="chatMsg"></div>
  </section>

  <section class="list" id="secKeys">
    <div class="sechead">
      <h2>API keys <small id="keyCount"></small></h2>
      <button id="addKeyBtn">Create key</button>
      <div class="hint">For scripts that send through the bot at <span class="mono">POST /api/v1/messages</span>. Operator keys can send; viewer keys can only read.</div>
    </div>
    <div class="panel hidden" id="addKeyPanel">
      <div class="row"><input id="kName" placeholder="Name, e.g. n8n standup reminder"><select id="kRole"><option value="operator">Operator: can send</option><option value="viewer">Viewer: read only</option></select><select id="kBot"></select><button id="kCreate">Create</button><button id="addKeyClose" class="quiet">Close</button></div>
      <div class="keyreveal hidden" id="kNew">Copy this key now. It won't be shown again.<code class="mono" id="kNewVal"></code></div>
      <div class="flash" id="kAddMsg"></div>
    </div>
    <table>
      <thead><tr><th>Name</th><th>Role</th><th>Bot</th><th class="hide-sm">Last used</th><th></th></tr></thead>
      <tbody id="kRows"><tr class="empty"><td colspan="5">Loading…</td></tr></tbody>
    </table>
    <div class="flash" id="kMsg"></div>
  </section>

  <section class="list" id="secAudit">
    <div class="sechead">
      <h2>Recent Activity & Audit Logs <small id="auditCount"></small></h2>
      <button id="refreshAuditBtn" class="quiet">Refresh logs</button>
      <div class="hint">History of allowlist modifications and administrative actions with quick restore.</div>
    </div>
    <table>
      <thead><tr><th>Action</th><th>Target</th><th>Details</th><th class="hide-sm">Time</th><th></th></tr></thead>
      <tbody id="auditRows"><tr class="empty"><td colspan="5">Loading logs…</td></tr></tbody>
    </table>
    <div class="flash" id="auditMsg"></div>
  </section>
</div>
</div>

<script>
(function () {
  var KEY = "mahoraga_admin_token";
  var $ = function (id) { return document.getElementById(id); };
  var token = sessionStorage.getItem(KEY) || "";
  var timer = null;
  var bots = { 0: "Generic" };
  var groupNames = {}; // jid -> subject, filled from discovery

  // ── utilities ─────────────────────────────────────────────────────
  function esc(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
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
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    if (h >= 48) return Math.floor(h / 24) + " days";
    if (h) return h + "h " + m + "m";
    return m + "m";
  }
  function phone(jid) { return String(jid || "").replace(/@.*$/, "").replace(/:.*$/, ""); }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Authorization": "Bearer " + token }, opts.headers || {});
    if (opts.body && typeof opts.body !== "string") { opts.body = JSON.stringify(opts.body); opts.headers["Content-Type"] = "application/json"; }
    opts.cache = "no-store";
    return fetch("/admin/api/" + path, opts).then(function (r) {
      if (r.status === 401) { sessionStorage.removeItem(KEY); token = ""; showLogin("That token was refused."); throw new Error("unauthorized"); }
      return r;
    });
  }
  function apiJson(path, opts) {
    return api(path, opts).then(function (r) { return r.json().then(function (j) { if (!r.ok) { var e = new Error(j.detail || j.error || ("HTTP " + r.status)); e.code = j.error; throw e; } return j; }); });
  }
  function flash(id, text, kind) { var el = $(id); el.textContent = text || ""; el.className = "flash" + (kind ? " " + kind : ""); }
  function botOptions(selected, allowAny) {
    var out = allowAny ? '<option value="">Any bot</option>' : "";
    Object.keys(bots).sort(function (a, b) { return a - b; }).forEach(function (n) {
      out += '<option value="' + n + '"' + (String(selected) === String(n) ? " selected" : "") + ">" + esc(bots[n]) + " (" + n + ")</option>";
    });
    return out;
  }
  function botName(n) { return bots[n] ? bots[n] : "Bot " + n; }

  // ── views ─────────────────────────────────────────────────────────
  function showLogin(msg) {
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
    flash("loginMsg", msg, msg ? "err" : ""); $("tok").focus();
    if (timer) { clearInterval(timer); timer = null; }
  }
  function showApp() {
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    refresh(); primeGroupNames(); loadChats(); loadKeys(); loadAudit();
    if (!timer) timer = setInterval(refresh, 5000);
  }

  // eight spokes with circular handle knobs (The Eight-Handled Wheel)
  (function drawSpokes() {
    var g = $("spokes"), out = "";
    for (var i = 0; i < 8; i++) {
      var a = (i * Math.PI) / 4;
      var x1 = 100 + Math.cos(a) * 62, y1 = 100 + Math.sin(a) * 62;
      var x2 = 100 + Math.cos(a) * 88, y2 = 100 + Math.sin(a) * 88;
      var hx = 100 + Math.cos(a) * 94, hy = 100 + Math.sin(a) * 94;
      out += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
      out += '<circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="3.5" class="handle"/>';
    }
    g.innerHTML = out;
  })();

  var lastStatus = null;
  function refresh() {
    apiJson("status").then(function (s) {
      lastStatus = s;
      if (s.bots) bots = s.bots;
      $("buildTag").textContent = s.version ? "build " + s.version : "";
      var pill = $("statePill"); pill.textContent = s.state.replace("_", " "); pill.className = "state " + s.state;
      $("gauge").className = "gauge " + s.state;

      // arc: fill = freshness of last inbound (full at 0s, empty at 1h); when down, full red
      var fill = 0;
      if (s.state === "open") { var age = s.lastInboundAt ? (Date.now() - s.lastInboundAt) / 3600000 : 1; fill = Math.max(0.04, 1 - Math.min(1, age)); }
      else if (s.state === "closed" || s.state === "logged_out") fill = 1;
      else fill = 0.25;
      $("arc").setAttribute("stroke-dashoffset", String(Math.round(553 * (1 - fill))));

      if (s.qrAvailable) {
        if (!$("qrImg")) $("heroSlot").innerHTML = '<div class="qr"><img id="qrImg" alt="WhatsApp pairing QR code"></div>';
        api("qr.svg").then(function (r) { return r.ok ? r.blob() : null; }).then(function (b) {
          if (!b) return; var img = $("qrImg"); if (!img) return;
          var old = img.src; img.src = URL.createObjectURL(b); if (old && old.indexOf("blob:") === 0) URL.revokeObjectURL(old);
        });
        $("headline").firstChild.nodeValue = "Scan to link a phone";
        $("factMsgs").textContent = "WhatsApp → Linked devices → Link a device. The code is " + s.qrAgeSec + "s old and refreshes about every 20 seconds.";
      } else {
        if ($("qrImg")) location.reload(); // back from pairing: simplest way to restore the gauge markup
        $("bigNum").textContent = s.lastInboundAt ? agoShort(s.lastInboundAt) : "—";
        $("bigLabel").textContent = s.lastInboundAt ? "since last message" : "no messages yet";
        var who = s.selfJid ? "Linked as " + phone(s.selfJid) : (s.state === "logged_out" ? "Logged out" : "Not linked");
        $("headline").firstChild.nodeValue = who;
        var parts = [];
        if (s.lastInboundAt) parts.push("Last message " + ago(s.lastInboundAt) + " ago.");
        if (s.lastOutboundAt) parts.push("Replied " + ago(s.lastOutboundAt) + " ago.");
        if (!parts.length) parts.push(s.state === "open" ? "Waiting for the first message." : "Not receiving messages.");
        $("factMsgs").textContent = parts.join(" ");
      }
      var up = "Up " + dur(s.uptimeSec) + ". ";
      up += s.reconnectAttempts ? s.reconnectAttempts + " reconnect" + (s.reconnectAttempts === 1 ? "" : "s") + " this run." : "No reconnects.";
      if (s.lastCloseAt && s.state !== "open") up += " Last drop " + ago(s.lastCloseAt) + " ago" + (s.lastCloseCode ? " (code " + s.lastCloseCode + ")" : "") + ".";
      $("factUp").textContent = up;
      var fm = $("factModels"); fm.className = "";
      if (!s.models) fm.textContent = "";
      else if (s.models.error) fm.textContent = "Couldn't verify models: " + s.models.error;
      else { var bad = s.models.models.filter(function (m) { return !m.ok; }); if (bad.length) { fm.className = "warn"; fm.textContent = "Groq no longer serves " + bad.map(function (m) { return m.id; }).join(", ") + ". Change GROQ_MODEL." } else fm.textContent = "Models OK."; }

      // Services & API Health Bar
      if (s.services) {
        var nDot = $("dotNeon"), nLbl = $("lblNeon");
        if (s.services.neon) {
          nDot.className = "dot " + (s.services.neon.ok ? "ok" : "err");
          nLbl.textContent = "Neon (" + (s.services.neon.latencyMs != null ? s.services.neon.latencyMs + "ms" : (s.services.neon.ok ? "ok" : "err")) + ")";
        }
        var rDot = $("dotRedis"), rLbl = $("lblRedis");
        if (s.services.redis) {
          rDot.className = "dot " + (s.services.redis.ok ? "ok" : "err");
          rLbl.textContent = "Redis (" + (s.services.redis.latencyMs != null ? s.services.redis.latencyMs + "ms" : (s.services.redis.ok ? "ok" : "err")) + ")";
        }
        var gDot = $("dotGroq"), gLbl = $("lblGroq");
        if (s.models) {
          var anyBad = s.models.error || (s.models.models && s.models.models.some(function (m) { return !m.ok; }));
          gDot.className = "dot " + (s.models.error ? "err" : (anyBad ? "warn" : "ok"));
          gLbl.textContent = anyBad ? "Groq (warn)" : "Groq AI";
        }
        var sp = $("searchProviders");
        if (sp && s.services.search) {
          var activeSearches = Object.keys(s.services.search).filter(function (k) { return s.services.search[k]; });
          sp.innerHTML = activeSearches.length ?
            ('<span class="dot ok"></span> <span>Search (' + esc(activeSearches.join(", ")) + ')</span>') :
            ('<span class="dot off"></span> <span class="muted">Search (none)</span>');
        }
      }
    }).catch(function (e) { if (e.message !== "unauthorized") flash("actionMsg", "Couldn't reach the bot: " + e.message, "err"); });
  }

  function act(path, confirmText) {
    if (confirmText && !confirm(confirmText)) return;
    apiJson(path, { method: "POST" }).then(function (j) { flash("actionMsg", j.message || "Done.", "ok"); })
      .catch(function (e) { flash("actionMsg", e.message, "err"); });
  }

  // ── allowlists ────────────────────────────────────────────────────
  // ── allowlists ────────────────────────────────────────────────────
  function rowFor(kind, e) {
    var label = kind === "groups" ? (e.name || groupNames[e.jid] || "Group") : (e.name || phone(e.jid));
    var sub = e.jid;
    var isDkb = e.botNumber === 2;
    var lvlOpt;
    if (isDkb) {
      lvlOpt = '<select data-act="lvl" aria-label="Level for ' + esc(label) + '">' +
        '<option value="1"' + (e.level === 2 ? "" : " selected") + '>Lvl 1 (Community)</option>' +
        '<option value="2"' + (e.level === 2 ? " selected" : "") + '>Lvl 2 (Live Search)</option>' +
        '</select>';
    } else {
      var botTag = e.botNumber === 3 ? "Mahoraga" : (e.botNumber === 1 ? "ECB" : "Generic");
      lvlOpt = '<select data-act="lvl" disabled title="Level 2 is only available for DKB at the moment" aria-label="Level for ' + esc(label) + '">' +
        '<option value="1" selected>Lvl 1 (' + botTag + ')</option>' +
        '</select>';
    }

    if (kind === "groups") {
      var actHtml = e.lastActive ?
        ('<span class="activity-chip' + ((Date.now() - e.lastActive < 3600000) ? ' live' : '') + '">' + esc(ago(e.lastActive)) + ' ago</span>') :
        '<span class="muted">—</span>';
      var memberHtml = e.size != null ? (' <span class="badge">' + e.size + ' members</span>') : "";
      return '<tr data-id="' + e.id + '" class="' + (e.enabled ? "" : "off") + '">' +
        '<td>' + esc(label) + memberHtml + '<span class="sub mono">' + esc(sub) + '</span></td>' +
        '<td class="hide-sm">' + actHtml + '</td>' +
        '<td class="num"><select data-act="bot" aria-label="Bot for ' + esc(label) + '">' + botOptions(e.botNumber, false) + '</select></td>' +
        '<td class="num">' + lvlOpt + '</td>' +
        '<td class="num"><label class="toggle"><input type="checkbox" data-act="on"' + (e.enabled ? " checked" : "") + ' aria-label="Active"><span class="muted">' + (e.enabled ? "on" : "off") + '</span></label></td>' +
        '<td class="actions"><button class="quiet danger" data-act="rm">Remove</button></td></tr>';
    }

    return '<tr data-id="' + e.id + '" class="' + (e.enabled ? "" : "off") + '">' +
      '<td>' + esc(label) + '<span class="sub mono">' + esc(sub) + '</span></td>' +
      '<td class="num"><select data-act="bot" aria-label="Bot for ' + esc(label) + '">' + botOptions(e.botNumber, false) + '</select></td>' +
      '<td class="num">' + lvlOpt + '</td>' +
      '<td class="num"><label class="toggle"><input type="checkbox" data-act="on"' + (e.enabled ? " checked" : "") + ' aria-label="Active"><span class="muted">' + (e.enabled ? "on" : "off") + '</span></label></td>' +
      '<td class="actions"><button class="quiet danger" data-act="rm">Remove</button></td></tr>';
  }
  function loadList(kind, rowsId, countId, msgId) {
    var cols = kind === "groups" ? 6 : 5;
    apiJson(kind).then(function (j) {
      var rows = j[kind];
      $(countId).textContent = rows.length ? rows.length : "";
      $(rowsId).innerHTML = rows.length ? rows.map(function (e) { return rowFor(kind, e); }).join("") :
        '<tr class="empty"><td colspan="' + cols + '">' + (kind === "groups" ? "The bot isn't answering in any group yet. Add one above." : "No private chats allowed yet.") + '</td></tr>';
    }).catch(function (e) { $(rowsId).innerHTML = '<tr class="empty"><td colspan="' + cols + '">Could not load this list.</td></tr>'; flash(msgId, e.message, "err"); });
  }
  function loadGroups() { loadList("groups", "grpRows", "grpCount", "grpMsg"); }
  // Fetch group subjects from WhatsApp once so the table shows names, not just JIDs.
  function primeGroupNames() {
    apiJson("discover/groups").then(function (j) { j.groups.forEach(function (g) { groupNames[g.jid] = g.subject; }); })
      .catch(function () { /* socket down: JIDs only */ })
      .then(loadGroups);
  }
  function loadChats() { loadList("chats", "chatRows", "chatCount", "chatMsg"); }

  function bindList(kind, rowsId, msgId, reload) {
    $(rowsId).addEventListener("change", function (ev) {
      var t = ev.target, tr = t.closest("tr"); if (!tr) return; var id = tr.getAttribute("data-id");
      if (t.getAttribute("data-act") === "bot") {
        var newBot = Number(t.value);
        var patchBody = { botNumber: newBot };
        if (newBot !== 2) patchBody.level = 1;
        apiJson(kind + "/" + id, { method: "PATCH", body: patchBody }).then(function () { flash(msgId, "Bot changed.", "ok"); reload(); }).catch(function (e) { flash(msgId, e.message, "err"); reload(); });
      }
      if (t.getAttribute("data-act") === "lvl") {
        apiJson(kind + "/" + id, { method: "PATCH", body: { level: Number(t.value) } }).then(function () { flash(msgId, "Level changed.", "ok"); reload(); }).catch(function (e) { flash(msgId, e.message, "err"); reload(); });
      }
      if (t.getAttribute("data-act") === "on") {
        apiJson(kind + "/" + id, { method: "PATCH", body: { enabled: t.checked } }).then(function () { flash(msgId, t.checked ? "Turned on." : "Turned off.", "ok"); reload(); }).catch(function (e) { flash(msgId, e.message, "err"); reload(); });
      }
    });
    $(rowsId).addEventListener("click", function (ev) {
      var t = ev.target; if (t.getAttribute("data-act") !== "rm") return;
      var tr = t.closest("tr"), id = tr.getAttribute("data-id"), name = tr.querySelector("td").firstChild.nodeValue;
      if (!confirm("Remove " + name + "? The bot will stop answering there.")) return;
      apiJson(kind + "/" + id, { method: "DELETE" }).then(function () { flash(msgId, "Removed.", "ok"); reload(); loadAudit(); }).catch(function (e) { flash(msgId, e.message, "err"); });
    });
  }
  bindList("groups", "grpRows", "grpMsg", loadGroups);
  bindList("chats", "chatRows", "chatMsg", loadChats);

  // group discovery panel
  function loadDiscovery() {
    $("grpManualBot").innerHTML = botOptions(0, false);
    var isManDkb = Number($("grpManualBot").value) === 2;
    $("grpManualLvl").disabled = !isManDkb;
    if (!isManDkb) $("grpManualLvl").value = "1";

    $("discRows").innerHTML = '<tr class="empty"><td colspan="5">Loading groups from WhatsApp…</td></tr>';
    apiJson("discover/groups").then(function (j) {
      j.groups.forEach(function (g) { groupNames[g.jid] = g.subject; });
      loadGroups(); // now we have names
      var un = j.groups.filter(function (g) { return !g.allowlisted; });
      $("discRows").innerHTML = un.length ? un.map(function (g) {
        return '<tr data-jid="' + esc(g.jid) + '"><td>' + esc(g.subject || "Untitled group") + '<span class="sub mono">' + esc(g.jid) + '</span></td><td class="num hide-sm">' + g.size + '</td><td class="num"><select data-role="bot">' + botOptions(0, false) + '</select></td><td class="num"><select data-role="lvl" disabled><option value="1">Lvl 1</option></select></td><td class="actions"><button data-role="add">Add</button></td></tr>';
      }).join("") : '<tr class="empty"><td colspan="5">Every group this number is in is already listed.</td></tr>';
    }).catch(function (e) {
      $("discRows").innerHTML = '<tr class="empty"><td colspan="5">' + (e.code === "socket_not_open" ? "WhatsApp isn't connected, so groups can't be listed. Paste a JID above instead." : "Couldn't list groups: " + esc(e.message)) + '</td></tr>';
    });
  }
  $("discRows").addEventListener("change", function (ev) {
    var t = ev.target; if (t.getAttribute("data-role") !== "bot") return;
    var tr = t.closest("tr"); if (!tr) return;
    var lvlSel = tr.querySelector('select[data-role="lvl"]');
    if (lvlSel) {
      var isDkb = Number(t.value) === 2;
      lvlSel.disabled = !isDkb;
      lvlSel.innerHTML = isDkb ? '<option value="1">Lvl 1</option><option value="2">Lvl 2</option>' : '<option value="1">Lvl 1</option>';
      lvlSel.value = "1";
    }
  });
  $("discRows").addEventListener("click", function (ev) {
    var t = ev.target; if (t.getAttribute("data-role") !== "add") return;
    var tr = t.closest("tr"), jid = tr.getAttribute("data-jid");
    var bot = Number(tr.querySelector('select[data-role="bot"]').value);
    var lvl = bot === 2 ? Number(tr.querySelector('select[data-role="lvl"]').value) : 1;
    t.disabled = true;
    apiJson("groups", { method: "POST", body: { jid: jid, botNumber: bot, level: lvl } }).then(function () { flash("grpAddMsg", "Added.", "ok"); tr.remove(); loadGroups(); loadAudit(); }).catch(function (e) { flash("grpAddMsg", e.message, "err"); t.disabled = false; });
  });
  $("grpManualBot").onchange = function () {
    var isDkb = Number(this.value) === 2;
    $("grpManualLvl").disabled = !isDkb;
    if (!isDkb) $("grpManualLvl").value = "1";
  };
  $("grpManualAdd").onclick = function () {
    var jid = $("grpManual").value.trim(); if (!jid) return;
    var bot = Number($("grpManualBot").value);
    var lvl = bot === 2 ? Number($("grpManualLvl").value) : 1;
    apiJson("groups", { method: "POST", body: { jid: jid, botNumber: bot, level: lvl } }).then(function () { flash("grpAddMsg", "Added.", "ok"); $("grpManual").value = ""; loadGroups(); loadAudit(); }).catch(function (e) { flash("grpAddMsg", e.message, "err"); });
  };
  $("addGroupBtn").onclick = function () { $("addGroupPanel").classList.toggle("hidden"); if (!$("addGroupPanel").classList.contains("hidden")) loadDiscovery(); };
  $("addGroupClose").onclick = function () { $("addGroupPanel").classList.add("hidden"); };

  // chats panel
  $("addChatBtn").onclick = function () {
    $("chatBot").innerHTML = botOptions(0, false);
    var isDkb = Number($("chatBot").value) === 2;
    $("chatLvl").disabled = !isDkb;
    if (!isDkb) $("chatLvl").value = "1";
    $("addChatPanel").classList.toggle("hidden");
    $("chatNum").focus();
  };
  $("chatBot").onchange = function () {
    var isDkb = Number(this.value) === 2;
    $("chatLvl").disabled = !isDkb;
    if (!isDkb) $("chatLvl").value = "1";
  };
  $("addChatClose").onclick = function () { $("addChatPanel").classList.add("hidden"); };
  $("chatAdd").onclick = function () {
    var n = $("chatNum").value.trim(); if (!n) return;
    var bot = Number($("chatBot").value);
    var lvl = bot === 2 ? Number($("chatLvl").value) : 1;
    apiJson("chats", { method: "POST", body: { jid: n, botNumber: bot, level: lvl } }).then(function (j) { flash("chatAddMsg", "Added " + phone(j.jid) + ".", "ok"); $("chatNum").value = ""; loadChats(); loadAudit(); }).catch(function (e) { flash("chatAddMsg", e.message, "err"); });
  };
  $("chatNum").onkeydown = function (e) { if (e.key === "Enter") $("chatAdd").click(); };

  // ── keys ──────────────────────────────────────────────────────────
  function loadKeys() {
    apiJson("keys").then(function (j) {
      var live = j.keys.filter(function (k) { return !k.revokedAt; });
      $("keyCount").textContent = live.length ? live.length : "";
      $("kRows").innerHTML = j.keys.length ? j.keys.map(function (k) {
        var dead = !!k.revokedAt;
        return '<tr' + (dead ? ' class="off"' : "") + '><td>' + esc(k.name) + '<span class="sub mono">' + esc(k.prefix) + '…</span></td><td>' + esc(k.role) + '</td><td>' + (k.botNumber == null ? "Any" : esc(botName(k.botNumber))) + '</td><td class="hide-sm muted">' + (k.lastUsedAt ? ago(new Date(k.lastUsedAt).getTime()) + " ago" : "Never") + '</td><td class="actions">' + (dead ? '<span class="muted">Revoked</span>' : '<button class="quiet danger" data-revoke="' + k.id + '">Revoke</button>') + '</td></tr>';
      }).join("") : '<tr class="empty"><td colspan="5">No keys yet. Create one to let a script send through the bot.</td></tr>';
    }).catch(function (e) { $("kRows").innerHTML = "<tr class='empty'><td colspan='5'>Couldn't load keys.</td></tr>"; flash("kMsg", e.message, "err"); });
  }
  $("addKeyBtn").onclick = function () { $("kBot").innerHTML = botOptions("", true); $("addKeyPanel").classList.toggle("hidden"); $("kName").focus(); };
  $("addKeyClose").onclick = function () { $("addKeyPanel").classList.add("hidden"); $("kNew").classList.add("hidden"); };
  $("kCreate").onclick = function () {
    var name = $("kName").value.trim(); if (!name) { flash("kAddMsg", "Give the key a name.", "err"); return; }
    var bot = $("kBot").value;
    apiJson("keys", { method: "POST", body: { name: name, role: $("kRole").value, botNumber: bot === "" ? null : Number(bot) } })
      .then(function (j) { $("kNew").classList.remove("hidden"); $("kNewVal").textContent = j.key; $("kName").value = ""; flash("kAddMsg", ""); loadKeys(); })
      .catch(function (e) { flash("kAddMsg", e.message, "err"); });
  };
  $("kRows").addEventListener("click", function (ev) {
    var id = ev.target.getAttribute && ev.target.getAttribute("data-revoke"); if (!id) return;
    if (!confirm("Revoke this key? Anything using it will start getting 401.")) return;
    apiJson("keys/" + id, { method: "DELETE" }).then(function () { flash("kMsg", "Revoked.", "ok"); loadKeys(); }).catch(function (e) { flash("kMsg", e.message, "err"); });
  });

  // ── audit logs & restore ─────────────────────────────────────────
  function loadAudit() {
    apiJson("audit").then(function (j) {
      var logs = j.logs || [];
      $("auditCount").textContent = logs.length ? logs.length : "";
      $("auditRows").innerHTML = logs.length ? logs.map(function (l) {
        var canRestore = (l.action === "delete_group" || l.action === "delete_chat") && l.details && l.details.jid;
        var detailsStr = "";
        if (l.details) {
          var parts = [];
          if (l.details.jid) parts.push("JID: " + phone(l.details.jid));
          if (l.details.botNumber != null) parts.push("Bot: " + l.details.botNumber);
          if (l.details.level != null) parts.push("Lvl: " + l.details.level);
          if (l.details.updated) parts.push("Changed: " + l.details.updated.join(", "));
          detailsStr = parts.join(" | ") || JSON.stringify(l.details);
        }
        var restoreBtn = canRestore ? ('<button class="restore-btn" data-act="restore" data-action="' + esc(l.action) + '" data-jid="' + esc(l.details.jid) + '" data-bot="' + (l.details.botNumber || 0) + '" data-lvl="' + (l.details.level || 1) + '">Restore</button>') : "";
        return '<tr><td><span class="badge">' + esc(l.action) + '</span></td><td>' + esc(l.target ? phone(l.target) : "—") + '</td><td class="mono muted" style="font-size:11px;">' + esc(detailsStr) + '</td><td class="hide-sm muted">' + (l.timestamp ? ago(new Date(l.timestamp).getTime()) + " ago" : "—") + '</td><td class="actions">' + restoreBtn + '</td></tr>';
      }).join("") : '<tr class="empty"><td colspan="5">No audit logs recorded yet.</td></tr>';
    }).catch(function (e) {
      $("auditRows").innerHTML = '<tr class="empty"><td colspan="5">Could not load audit logs.</td></tr>';
      flash("auditMsg", e.message, "err");
    });
  }

  $("auditRows").addEventListener("click", function (ev) {
    var t = ev.target; if (t.getAttribute("data-act") !== "restore") return;
    var actType = t.getAttribute("data-action");
    var jid = t.getAttribute("data-jid");
    var bot = Number(t.getAttribute("data-bot") || 0);
    var lvl = Number(t.getAttribute("data-lvl") || 1);
    var kind = actType === "delete_group" ? "group" : "chat";
    if (!confirm("Restore " + kind + " " + phone(jid) + " with Bot " + bot + " at Level " + lvl + "?")) return;
    t.disabled = true;
    apiJson("audit/restore", { method: "POST", body: { jid: jid, botNumber: bot, level: lvl, kind: kind } })
      .then(function (j) {
        flash("auditMsg", j.message || "Restored successfully.", "ok");
        loadAudit();
        if (kind === "group") loadGroups(); else loadChats();
      })
      .catch(function (e) { flash("auditMsg", e.message, "err"); t.disabled = false; });
  });
  $("refreshAuditBtn").onclick = loadAudit;

  // ── top bar ───────────────────────────────────────────────────────
  $("loginBtn").onclick = function () { token = $("tok").value.trim(); if (!token) return; sessionStorage.setItem(KEY, token); showApp(); };
  $("tok").addEventListener("keydown", function (e) { if (e.key === "Enter") $("loginBtn").click(); });
  $("refreshBtn").onclick = function () { refresh(); loadGroups(); loadChats(); loadKeys(); loadAudit(); };
  $("restartBtn").onclick = function () { act("restart", "Restart the bot? WhatsApp reconnects in about 20 seconds."); };
  $("relinkBtn").onclick = function () { act("relink", "Unlink this phone and wipe the session? You'll scan a new QR code here afterwards."); };
  $("logoutBtn").onclick = function () { sessionStorage.removeItem(KEY); token = ""; showLogin(); };

  if (token) showApp(); else showLogin();
})();
</script>
</body>
</html>`;
}
