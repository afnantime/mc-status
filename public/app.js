/* ─────────────────────────────────────────────
   MC Status — App Logic
   ───────────────────────────────────────────── */

// ── State ──
const state = {
  edition: 'java',
  lastHost: '',
  lastPort: '',
  lastData: null,
};

// ── DOM refs ──
const form           = document.getElementById('status-form');
const serverInput    = document.getElementById('server-input');
const checkBtn       = document.getElementById('check-btn');
const loadingSection = document.getElementById('loading-section');
const loadingHost    = document.getElementById('loading-host');
const errorSection   = document.getElementById('error-section');
const errorMsg       = document.getElementById('error-msg');
const retryBtn       = document.getElementById('retry-btn');
const resultsSection = document.getElementById('results-section');
const editionToggle  = document.querySelector('.edition-toggle');

// Grid items for animation
const statsCards = [
  document.getElementById('stat-players'),
  document.getElementById('stat-ping'),
  document.getElementById('stat-version')
];
document.querySelectorAll('.edition-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const ed = btn.dataset.edition;
    setEdition(ed);
  });
});

function setEdition(ed) {
  state.edition = ed;
  document.querySelectorAll('.edition-btn').forEach(b => {
    const active = b.dataset.edition === ed;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  editionToggle.dataset.active = ed;

  // Update placeholder hint
  const hint = document.getElementById('input-hint');
  if (ed === 'bedrock') {
    serverInput.placeholder = 'play.example.com:19132';
    hint.textContent = 'e.g. play.example.com:19132';
  } else {
    serverInput.placeholder = 'play.example.com:25565';
    hint.textContent = 'e.g. mc.hypixel.net or mc.server.com:25565';
  }
}

// ─────────────────────────────────────────────
// Quick-server buttons
// ─────────────────────────────────────────────
document.querySelectorAll('.quick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const host    = btn.dataset.host;
    const port    = btn.dataset.port || '';
    const edition = btn.dataset.edition || 'java';
    setEdition(edition);
    serverInput.value = port ? `${host}:${port}` : host;
    doCheck();
  });
});

// ─────────────────────────────────────────────
// Form submission
// ─────────────────────────────────────────────
form.addEventListener('submit', e => {
  e.preventDefault();
  doCheck();
});

async function doCheck() {
  const raw = serverInput.value.trim();
  if (!raw) {
    serverInput.focus();
    serverInput.classList.add('shake');
    setTimeout(() => serverInput.classList.remove('shake'), 400);
    return;
  }

  // Parse host:port
  const { host, port } = parseAddress(raw);
  state.lastHost = host;
  state.lastPort = port;

  showState('loading');
  loadingHost.textContent = raw;

  try {
    const params = new URLSearchParams({ host, type: state.edition });
    if (port) params.set('port', port);

    const res  = await fetch(`/api/status?${params}`);
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 429) {
        const retryAfter = data.retry_after || 60;
        startRateLimitCountdown(retryAfter);
        return;
      }
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    state.lastData = data;
    renderResults(data, { host, port, edition: state.edition });
    showState('results');

  } catch (err) {
    errorMsg.textContent = err.message || 'Could not reach the server. It may be offline.';
    showState('error');
  }
}

function parseAddress(raw) {
  // Handle IPv6 [::1]:25565
  if (raw.startsWith('[')) {
    const bracket = raw.indexOf(']');
    const host    = raw.slice(1, bracket);
    const port    = raw.slice(bracket + 2) || '';
    return { host, port };
  }

  const parts = raw.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { host: parts[0], port: parts[1] };
  }
  return { host: raw, port: '' };
}

// ─────────────────────────────────────────────
// Show a UI state
// ─────────────────────────────────────────────
function showState(s) {
  loadingSection.hidden = s !== 'loading';
  errorSection.hidden   = s !== 'error';
  resultsSection.hidden = s !== 'results';

  checkBtn.classList.toggle('loading', s === 'loading');
  checkBtn.disabled = s === 'loading';
}

retryBtn.addEventListener('click', doCheck);

// ─────────────────────────────────────────────
// Rate-limit countdown + auto retry
// ─────────────────────────────────────────────
let _countdownTimer = null;

function startRateLimitCountdown(seconds) {
  // Clear any existing countdown
  if (_countdownTimer) clearInterval(_countdownTimer);

  let remaining = seconds;
  showState('error');
  retryBtn.disabled = true;
  retryBtn.style.opacity = '0.5';

  const update = () => {
    errorMsg.textContent =
      `Both status APIs are rate-limited. Auto-retrying in ${remaining}s…`;
    retryBtn.textContent = `Wait ${remaining}s`;
  };
  update();

  _countdownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_countdownTimer);
      _countdownTimer = null;
      retryBtn.disabled = false;
      retryBtn.style.opacity = '';
      retryBtn.textContent = 'Try Again';
      doCheck(); // auto-retry
    } else {
      update();
    }
  }, 1000);
}

// ─────────────────────────────────────────────
// Render Results
// ─────────────────────────────────────────────
function renderResults(data, { host, port, edition }) {
  const isOnline = !!data.online;

  /* ── Status Banner ── */
  document.getElementById('server-hostname').textContent = data.hostname || host;
  document.getElementById('status-text').textContent = isOnline ? 'Online' : 'Offline';
  document.getElementById('status-pill').className = `status-pill ${isOnline ? 'online' : 'offline'}`;
  document.getElementById('edition-chip').textContent =
    edition === 'bedrock' ? '💎 Bedrock Edition' : '☕ Java Edition';

  // Favicon
  const favicon    = document.getElementById('server-favicon');
  const placeholder = document.getElementById('favicon-placeholder');
  if (data.icon) {
    favicon.src = data.icon;
    favicon.onload  = () => { favicon.classList.add('loaded'); placeholder.style.display = 'none'; };
    favicon.onerror = () => { favicon.classList.remove('loaded'); placeholder.style.display = ''; };
  } else {
    favicon.classList.remove('loaded');
    placeholder.style.display = '';
  }

  /* ── MOTD ── */
  renderMotd(data);

  /* ── Players ── */
  const online  = data.players?.online ?? 0;
  const max     = data.players?.max ?? 0;
  const pct     = max > 0 ? Math.min(100, (online / max) * 100) : 0;
  document.getElementById('players-value').textContent = isOnline ? online.toLocaleString() : '—';
  document.getElementById('players-sub').textContent   = isOnline ? `${online} / ${max}` : '—';
  document.getElementById('players-bar').style.width   = isOnline ? `${pct}%` : '0%';

  /* ── Ping ── */
  // ping_ms = direct TCP connection from Cloudflare edge to MC server
  // response_time_ms = full API round-trip (fallback if ping unavailable)
  const ping = data._meta?.ping_ms ?? data._meta?.response_time_ms ?? null;
  // Only show "from [colo]" when we have a real TCP ping — not an API fallback
  const colo = data._meta?.ping_ms != null ? (data._meta?.cf_colo || null) : null;
  renderPing(ping, colo);

  /* ── Version ── */
  const ver = data.version || '—';
  // protocol may be a number (v3 API) or an object {version, name}
  let protoStr = '';
  if (data.protocol != null) {
    const p = data.protocol;
    protoStr = `Protocol: ${typeof p === 'object' ? (p.version ?? JSON.stringify(p)) : p}`;
  }
  document.getElementById('version-value').textContent  = ver;
  document.getElementById('protocol-value').textContent = protoStr;


  /* ── Players list ── */
  renderPlayersList(data.players?.list || []);

  /* ── Debug ── */
  renderDebug(data, { host, port, edition });

  /* ── Last checked ── */
  document.getElementById('last-checked').textContent =
    `Last checked: ${new Date().toLocaleTimeString()}`;

  /* ── Refresh & Copy buttons ── */
  document.getElementById('refresh-btn').onclick = async () => {
    const btn = document.getElementById('refresh-btn');
    btn.classList.add('spinning');
    await doCheck();
    btn.classList.remove('spinning');
  };
  document.getElementById('copy-btn').onclick = () => {
    const addr = port ? `${host}:${port}` : host;
    navigator.clipboard.writeText(addr).then(() => {
      document.getElementById('copy-btn').textContent = '✅';
      setTimeout(() => document.getElementById('copy-btn').textContent = '📋', 1500);
    });
  };

  // Animate in
  resultsSection.querySelectorAll('.glass, .status-banner').forEach((el, i) => {
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = `fadeIn 0.4s ease ${i * 0.05}s both`;
  });
}

// ─────────────────────────────────────────────
// MOTD Renderer — supports §-codes
// ─────────────────────────────────────────────
const MC_COLOR_MAP = {
  '0': 'mc-black', '1': 'mc-dark-blue', '2': 'mc-dark-green',
  '3': 'mc-dark-aqua', '4': 'mc-dark-red', '5': 'mc-dark-purple',
  '6': 'mc-gold', '7': 'mc-gray', '8': 'mc-dark-gray',
  '9': 'mc-blue', 'a': 'mc-green', 'b': 'mc-aqua',
  'c': 'mc-red', 'd': 'mc-light-purple', 'e': 'mc-yellow',
  'f': 'mc-white',
};
const MC_FORMAT_MAP = {
  'l': 'mc-bold', 'o': 'mc-italic',
  'm': 'mc-strikethrough', 'n': 'mc-underline',
  'k': 'mc-magic', 'r': null,
};

function parseMcText(raw) {
  if (!raw) return '';
  const frag = document.createDocumentFragment();
  let current = document.createElement('span');
  let classes = [];

  const flush = () => {
    if (current.textContent) {
      classes.forEach(c => { if (c) current.classList.add(c); });
      frag.appendChild(current);
    }
    current = document.createElement('span');
    classes = [];
  };

  const chars = [...raw];
  for (let i = 0; i < chars.length; i++) {
    if ((chars[i] === '§' || chars[i] === '\u00A7') && i + 1 < chars.length) {
      flush();
      const code = chars[++i].toLowerCase();
      if (MC_COLOR_MAP[code]) {
        classes = [MC_COLOR_MAP[code]];
      } else if (code in MC_FORMAT_MAP) {
        if (MC_FORMAT_MAP[code] === null) classes = []; // reset
        else classes.push(MC_FORMAT_MAP[code]);
      }
    } else {
      current.textContent += chars[i];
    }
  }
  flush();

  const wrapper = document.createElement('span');
  wrapper.appendChild(frag);
  return wrapper;
}

function renderMotd(data) {
  const line1El = document.getElementById('motd-line1');
  const line2El = document.getElementById('motd-line2');
  const rawEl   = document.getElementById('motd-raw');
  const rawBtn  = document.getElementById('motd-raw-btn');

  line1El.innerHTML = '';
  line2El.innerHTML = '';

  let rawStr = '';

  if (data.motd) {
    // Prefer the clean array
    const clean = data.motd.clean || [];
    const html  = data.motd.html || [];
    const raw   = data.motd.raw || [];

    rawStr = raw.join('\n');

    if (html[0]) {
      line1El.innerHTML = html[0];
    } else if (clean[0]) {
      line1El.appendChild(parseMcText(raw[0] || clean[0]));
    }
    if (html[1]) {
      line2El.innerHTML = html[1];
    } else if (clean[1]) {
      line2El.appendChild(parseMcText(raw[1] || clean[1]));
    }
  } else if (data.description) {
    // Old-style or Bedrock
    const desc = typeof data.description === 'string'
      ? data.description
      : data.description?.text || JSON.stringify(data.description);
    rawStr = desc;
    line1El.appendChild(parseMcText(desc));
  }

  rawEl.textContent = rawStr || '(no MOTD)';

  rawBtn.onclick = () => {
    const hidden = rawEl.hidden;
    rawEl.hidden = !hidden;
    rawBtn.textContent = hidden ? 'Hide raw MOTD' : 'Show raw MOTD';
  };
}

// ─────────────────────────────────────────────
// Ping bars
// ─────────────────────────────────────────────
function renderPing(ms, colo) {
  const el = document.getElementById('ping-value');
  const bars = document.querySelectorAll('.ping-bar');
  // Update sublabel to show CF edge location
  const statPing = document.getElementById('stat-ping');
  let subEl = statPing?.querySelector('.stat-sublabel');
  if (!subEl && statPing) {
    subEl = document.createElement('div');
    subEl.className = 'stat-sublabel';
    statPing.querySelector('.stat-body')?.appendChild(subEl);
  }
  if (subEl) subEl.textContent = colo ? `from ${colo}` : '';

  if (ms === null || ms === undefined) {
    el.textContent = '—';
    bars.forEach(b => { b.classList.remove('active','warn','poor','bad'); });
    return;
  }

  el.textContent = `${ms}ms`;

  let colorClass = 'active';
  let activeCount = 5;
  if (ms > 300)      { colorClass = 'bad';  activeCount = 1; }
  else if (ms > 150) { colorClass = 'poor'; activeCount = 2; }
  else if (ms > 80)  { colorClass = 'warn'; activeCount = 3; }
  else if (ms > 40)  { activeCount = 4; }

  bars.forEach((b, i) => {
    b.classList.remove('active','warn','poor','bad');
    if (i < activeCount) b.classList.add(colorClass);
  });
}

// ─────────────────────────────────────────────
// Players list
// ─────────────────────────────────────────────
function renderPlayersList(list) {
  const grid    = document.getElementById('players-grid');
  const countEl = document.getElementById('players-list-count');
  grid.innerHTML = '';
  countEl.textContent = list.length || '0';

  if (!list.length) {
    grid.innerHTML = '<p class="empty-state">Player list is not available or server is empty</p>';
    return;
  }

  list.forEach((player, idx) => {
    const name = typeof player === 'string' ? player : player.name || 'Unknown';
    const uuid = typeof player === 'object' ? player.uuid : null;

    const chip = document.createElement('a'); // Change to <a>
    chip.className = 'player-chip';
    chip.style.animationDelay = `${idx * 0.04}s`;
    
    // NameMC Link
    chip.href = `https://namemc.com/profile/${name}`;
    chip.target = '_blank';
    chip.rel = 'noopener noreferrer';
    chip.title = `View ${name} on NameMC`;

    if (uuid) {
      const img = document.createElement('img');
      img.className = 'player-avatar';
      img.src = `https://crafthead.net/avatar/${uuid}/18`;
      img.alt = name;
      img.onerror = () => img.remove();
      chip.appendChild(img);
    }

    const nameSpan = document.createElement('span');
    nameSpan.textContent = name;
    chip.appendChild(nameSpan);
    grid.appendChild(chip);
  });
}

// ─────────────────────────────────────────────
// Debug Info
// ─────────────────────────────────────────────
function renderDebug(data, { host, port, edition }) {
  const grid = document.getElementById('debug-grid');
  const toggleBtn = document.getElementById('debug-toggle-btn');
  const body = document.getElementById('debug-body');

  toggleBtn.onclick = () => {
    const hidden = body.hidden;
    body.hidden = !hidden;
    toggleBtn.textContent = hidden ? 'Collapse' : 'Expand';
  };

  const rows = [
    ['Queried Host',    data._meta?.queried_host || host, 'mono'],
    ['Queried Port',    port || (edition === 'bedrock' ? '19132' : '25565'), 'mono'],
    ['Edition',         edition === 'bedrock' ? 'Bedrock' : 'Java', edition === 'bedrock' ? 'blue' : 'yellow'],
    ['Online',          data.online ? 'Yes' : 'No', data.online ? 'green' : 'red'],
    ['API Source',      data._meta?.api_source || 'mcsrvstat.us', null],
    ['CF Edge',         data._meta?.cf_colo ? `${data._meta.cf_colo}` : '—', null],
    ['Ping (CF→Server)',data._meta?.ping_ms != null ? `${data._meta.ping_ms}ms` : '—', null],
    ['API Response',    data._meta?.response_time_ms != null ? `${data._meta.response_time_ms}ms` : '—', null],
    ['Queried At',      data._meta?.queried_at ? new Date(data._meta.queried_at).toLocaleString() : '—', null],
    ['Version',         data.version || '—', null],
    ['Protocol',        data.protocol != null ? String(data.protocol) : '—', null],
    ['Software',        data.software || '—', null],
    ['Hostname',        data.hostname || '—', null],
    ['IP',              data.ip || '—', 'mono'],
    ['Port',            data.port != null ? String(data.port) : '—', null],
    ['Players Online',  data.players?.online != null ? String(data.players.online) : '—', null],
    ['Players Max',     data.players?.max != null ? String(data.players.max) : '—', null],
    ['Plugins',         data.plugins?.length ? `${data.plugins.length}` : '—', null],
    ['Mods',            data.mods?.length ? `${data.mods.length}` : '—', null],
    ['GameMode',        data.gamemode || '—', null],
    ['Map',             data.map || '—', null],
    ['ServerID',        data.serverid || '—', 'mono'],
    ['EULA Blocked',    data.eula_blocked != null ? String(data.eula_blocked) : '—', data.eula_blocked ? 'red' : null],
    ['Debug IP',        data.debug?.ip || '—', 'mono'],
    ['Debug Port',      data.debug?.port != null ? String(data.debug.port) : '—', null],
    ['Debug Ping',      data.debug?.ping != null ? String(data.debug.ping) : '—', data.debug?.ping ? 'green' : 'red'],
    ['Debug Query',     data.debug?.query != null ? String(data.debug.query) : '—', data.debug?.query ? 'green' : 'red'],
    ['Debug Srv',       data.debug?.srv != null ? String(data.debug.srv) : '—', null],
    ['Debug AnimatedMOTD', data.debug?.animatedmotd != null ? String(data.debug.animatedmotd) : '—', null],
    ['Cache Time',      data.debug?.cachetime != null ? new Date(data.debug.cachetime * 1000).toLocaleString() : '—', null],
    ['Cache Expire',    data.debug?.cacheexpire != null ? new Date(data.debug.cacheexpire * 1000).toLocaleString() : '—', null],
    ['API Version',     data.debug?.apiversion != null ? String(data.debug.apiversion) : '—', null],
  ];

  grid.innerHTML = '';
  rows.forEach(([key, val, style]) => {
    if (val === '—' && !['Online', 'Debug Ping', 'Debug Query'].includes(key)) return;
    const row   = document.createElement('div');
    row.className = 'debug-row';
    const kEl   = document.createElement('span');
    kEl.className = 'debug-key';
    kEl.textContent = key;
    const vEl   = document.createElement('span');
    vEl.className = `debug-val ${style || ''}`;
    vEl.textContent = val;
    row.appendChild(kEl);
    row.appendChild(vEl);
    grid.appendChild(row);
  });

  // Raw JSON
  const rawEl = document.getElementById('raw-json');
  rawEl.textContent = JSON.stringify(data, null, 2);

  document.getElementById('copy-json-btn').onclick = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      document.getElementById('copy-json-btn').textContent = '✅ Copied!';
      setTimeout(() => document.getElementById('copy-json-btn').textContent = 'Copy JSON', 1500);
    });
  };
}

// ─────────────────────────────────────────────
// Particle Background
// ─────────────────────────────────────────────
(function initParticles() {
  const canvas = document.getElementById('bg-canvas');
  const ctx    = canvas.getContext('2d');
  let W, H, particles;

  const PARTICLE_COLOR = 'rgba(74,222,128,';
  const COUNT = 60;

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function createParticles() {
    particles = Array.from({ length: COUNT }, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      r:  Math.random() * 2 + 0.5,
      dx: (Math.random() - 0.5) * 0.3,
      dy: (Math.random() - 0.5) * 0.3,
      a:  Math.random() * 0.5 + 0.1,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = PARTICLE_COLOR + p.a + ')';
      ctx.fill();

      p.x += p.dx;
      p.y += p.dy;
      if (p.x < 0 || p.x > W) p.dx *= -1;
      if (p.y < 0 || p.y > H) p.dy *= -1;
    });

    // Draw connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx   = particles[i].x - particles[j].x;
        const dy   = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = PARTICLE_COLOR + (0.06 * (1 - dist / 120)) + ')';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('resize', () => { resize(); createParticles(); });
  resize();
  createParticles();
  draw();
})();

// ─────────────────────────────────────────────
// Shake animation (CSS injection)
// ─────────────────────────────────────────────
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `
  @keyframes shake {
    0%,100%{ transform:translateX(0) }
    20%{ transform:translateX(-6px) }
    40%{ transform:translateX(6px) }
    60%{ transform:translateX(-4px) }
    80%{ transform:translateX(4px) }
  }
  .shake { animation: shake 0.35s ease !important; }
`;
document.head.appendChild(shakeStyle);
