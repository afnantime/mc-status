/**
 * Cloudflare Pages Function — Minecraft Server Status Proxy
 * Route: /api/status
 *
 * Primary API  : mcstatus.io  (higher rate limits, richer data)
 * Fallback API : mcsrvstat.us (if primary returns 429 / 5xx)
 *
 * Query params:
 *   host — server hostname or IP
 *   port — server port (optional)
 *   type — "java" | "bedrock" (default: "java")
 */

import { connect } from "cloudflare:sockets";

const MCSTATUS_BASE  = "https://api.mcstatus.io/v2/status";
const MCSRVSTAT_BASE = "https://api.mcsrvstat.us";

// Cache TTL in seconds — shared across all edge nodes
const CACHE_TTL = 60;

export async function onRequestGet(context) {
  const { request } = context;
  const url  = new URL(request.url);

  const host = (url.searchParams.get("host") || "").trim();
  const port = (url.searchParams.get("port") || "").trim();
  const type = (url.searchParams.get("type") || "java").toLowerCase();

  // ── Validation ──────────────────────────────────────────────────────────────
  if (!host) {
    return jsonResponse({ error: "Missing required parameter: host" }, 400);
  }
  if (!/^[a-zA-Z0-9.\-_\[\]:]+$/.test(host)) {  // allow IPv6 brackets
    return jsonResponse({ error: "Invalid host format" }, 400);
  }
  if (type !== "java" && type !== "bedrock") {
    return jsonResponse({ error: "type must be 'java' or 'bedrock'" }, 400);
  }

  const defaultPort = type === "bedrock" ? 19132 : 25565;
  const tcpPort     = parseInt(port || defaultPort, 10);
  const target      = port ? `${host}:${port}` : host;

  // ── Run TCP ping, geo lookup, and API fetch ALL IN PARALLEL ─────────────────
  const [pingMs, geoData, apiResult] = await Promise.all([
    tcpPing(host, tcpPort),
    geoLookup(host),
    fetchStatus(target, type),
  ]);

  if (apiResult.error) {
    return jsonResponse({ error: apiResult.error, retry_after: apiResult.retry_after }, apiResult.status);
  }

  const { data, apiSource, elapsed } = apiResult;

  // ── Enrich ──────────────────────────────────────────────────────────────────
  data._meta = {
    queried_at:       new Date().toISOString(),
    response_time_ms: elapsed,          // time for API to respond
    ping_ms:          pingMs,           // direct TCP ping: Cloudflare → MC server
    cf_colo:          context.request.cf?.colo || null,  // e.g. "SIN", "BKK", "LAX"
    geo:              geoData,         // { country, country_code, city, isp, ... }
    api_source:       apiSource,
    edition:          type,
    queried_host:     host,
    queried_port:     port ? parseInt(port, 10) : null,
  };

  return jsonResponse(data, 200, {
    "Cache-Control": `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
  });
}

// ── TCP Ping: Cloudflare → Minecraft server ───────────────────────────────────
// Uses cloudflare:sockets to measure actual TCP connection latency from the
// Cloudflare edge node closest to the user, directly to the MC server.
async function tcpPing(hostname, port) {
  try {
    const start  = Date.now();
    const socket = connect({ hostname, port }, { secureTransport: "off", allowHalfOpen: false });

    // Wait for the socket to be writable (TCP handshake complete)
    const writer = socket.writable.getWriter();

    // Send a minimal Minecraft legacy ping byte (0xFE) — most servers respond
    // Bedrock servers handle the TCP connect itself, we just need the SYN-ACK
    await writer.write(new Uint8Array([0xFE]));
    const elapsed = Date.now() - start;

    // Clean up
    writer.releaseLock();
    await socket.close().catch(() => {});

    return elapsed;
  } catch (_) {
    // If socket fails (server offline, UDP-only Bedrock, etc.) return null
    return null;
  }
}

// ── IP Geolocation: resolve server's country via ip-api.com ─────────────────
// ip-api.com supports both IPs and hostnames, free & no key needed.
async function geoLookup(hostname) {
  try {
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(hostname)}?fields=status,country,countryCode,regionName,city,isp,org`,
      { headers: { "User-Agent": "MC-Status-Dashboard/2.0" } }
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (json.status !== "success") return null;
    return {
      country:      json.country      || null,
      country_code: json.countryCode  || null,
      region:       json.regionName   || null,
      city:         json.city         || null,
      isp:          json.isp          || null,
      org:          json.org          || null,
    };
  } catch (_) {
    return null;
  }
}

// ── Fetch status from primary / fallback APIs ────────────────────────────────
async function fetchStatus(target, type) {
  const startTime = Date.now();
  let data, apiSource;

  // Try mcstatus.io first
  try {
    const primaryUrl = `${MCSTATUS_BASE}/${type}/${encodeURIComponent(target)}`;
    const primary = await cfFetch(primaryUrl);

    if (primary.ok) {
      const raw = await primary.json();
      data      = normalizeMcstatusIo(raw, type);
      apiSource = "mcstatus.io/v2";
    } else if (primary.status === 429 || primary.status >= 500) {
      data = null; // fall through to backup
    } else {
      return { error: `Server lookup failed (${primary.status})`, status: primary.status === 400 ? 400 : 502 };
    }
  } catch (_) {
    data = null;
  }

  // Fallback: mcsrvstat.us
  if (!data) {
    try {
      const fallbackUrl = type === "bedrock"
        ? `${MCSRVSTAT_BASE}/bedrock/3/${encodeURIComponent(target)}`
        : `${MCSRVSTAT_BASE}/3/${encodeURIComponent(target)}`;

      const fallback = await cfFetch(fallbackUrl);

      if (fallback.ok) {
        const raw = await fallback.json();
        data      = normalizeMcsrvstat(raw, type);
        apiSource = "mcsrvstat.us/3 (fallback)";
      } else if (fallback.status === 429) {
        return {
          error: "Both status APIs are rate-limited. Please wait 60 seconds and try again.",
          retry_after: 60,
          status: 429,
        };
      } else {
        return { error: `All upstream APIs failed (mcsrvstat: ${fallback.status})`, status: 502 };
      }
    } catch (err) {
      return { error: `All upstream APIs unreachable: ${err.message}`, status: 502 };
    }
  }

  return { data, apiSource, elapsed: Date.now() - startTime };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** fetch() with Cloudflare edge cache */
function cfFetch(url) {
  return fetch(url, {
    headers: {
      "User-Agent": "MC-Status-Dashboard/2.0 (Cloudflare Pages)",
      Accept: "application/json",
    },
    cf: {
      cacheTtl:      CACHE_TTL,
      cacheEverything: true,
    },
  });
}

/**
 * Normalize mcstatus.io v2 response → our unified schema.
 *
 * mcstatus.io shape (Java):
 * {
 *   online, host, port, ip_address, eula_blocked,
 *   retrieved_at, expires_at,
 *   version: { name_raw, name_clean, name_html, protocol },
 *   players: { online, max, list: [{uuid, name_raw, name_clean}] },
 *   motd: { raw, clean, html },
 *   icon,  favicon (base64),
 *   mods: [...], software, plugins: [...],
 *   srv_record: { host, port }
 * }
 */
function normalizeMcstatusIo(raw, type) {
  const players_list = (raw.players?.list || []).map(p =>
    typeof p === "string" ? p : { name: p.name_clean || p.name_raw, uuid: p.uuid }
  );

  return {
    online:    !!raw.online,
    host:      raw.host,
    ip:        raw.ip_address,
    port:      raw.port,
    hostname:  raw.host,
    version:   raw.version?.name_clean || raw.version?.name_raw || "—",
    protocol:  raw.version?.protocol ?? null,
    software:  raw.software || (type === "bedrock" ? "Bedrock" : null),
    gamemode:  raw.gamemode || null,
    map:       raw.map || null,
    serverid:  raw.server_id || null,
    eula_blocked: raw.eula_blocked || false,

    // MOTD in both formats
    motd: raw.motd
      ? {
          raw:   Array.isArray(raw.motd.raw) ? raw.motd.raw : [raw.motd.raw || ""],
          clean: Array.isArray(raw.motd.clean) ? raw.motd.clean : [raw.motd.clean || ""],
          html:  Array.isArray(raw.motd.html) ? raw.motd.html : [raw.motd.html || ""],
        }
      : null,

    players: {
      online: raw.players?.online ?? 0,
      max:    raw.players?.max ?? 0,
      list:   players_list,
    },

    // Favicon — mcstatus.io sometimes provides `icon` as base64 data-url
    icon: raw.icon || raw.favicon || null,

    plugins: raw.plugins || [],
    mods:    raw.mods    || [],

    // Debug mirror
    debug: {
      ping:          raw.online || false,
      query:         raw.online || false,
      srv:           !!raw.srv_record,
      animatedmotd:  false,
      cachetime:     raw.retrieved_at ? Math.floor(new Date(raw.retrieved_at).getTime() / 1000) : null,
      cacheexpire:   raw.expires_at   ? Math.floor(new Date(raw.expires_at).getTime()   / 1000) : null,
      apiversion:    2,
    },
  };
}

/**
 * Normalize mcsrvstat.us v3 response → our unified schema.
 * mcsrvstat already uses a schema very close to ours, just pass it through
 * with minor fixes.
 */
function normalizeMcsrvstat(raw, type) {
  // protocol from mcsrvstat can itself be an object sometimes
  let protocol = raw.protocol ?? null;
  if (protocol !== null && typeof protocol === "object") {
    protocol = protocol.version ?? null;
  }

  return {
    ...raw,
    protocol,
    software: raw.software || (type === "bedrock" ? "Bedrock" : null),
  };
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      ...extraHeaders,
    },
  });
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
