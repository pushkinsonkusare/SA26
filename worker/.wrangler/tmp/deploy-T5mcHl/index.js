var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var ALLOWED_PATHS = /* @__PURE__ */ new Set([
  "/v1/chat/completions",
  "/v1/audio/transcriptions"
]);
var FORWARDABLE_HEADERS = /* @__PURE__ */ new Set([
  "content-type",
  "accept",
  "openai-beta",
  "openai-organization"
]);
var JSON_BODY_LIMIT_BYTES = 1 * 1024 * 1024;
var AUDIO_BODY_LIMIT_BYTES = 26 * 1024 * 1024;
function parseOriginAllowlist(raw) {
  return new Set(
    raw.split(",").map((s) => s.trim()).filter(Boolean)
  );
}
__name(parseOriginAllowlist, "parseOriginAllowlist");
function buildCorsHeaders(origin, allowed) {
  const allowOrigin = allowed.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": [...FORWARDABLE_HEADERS].join(", "),
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
__name(buildCorsHeaders, "buildCorsHeaders");
function jsonError(status, message, corsHeaders) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: {
      "content-type": "application/json",
      ...corsHeaders
    }
  });
}
__name(jsonError, "jsonError");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigins = parseOriginAllowlist(env.ALLOWED_ORIGINS ?? "");
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (!allowedOrigins.has(origin)) {
      return jsonError(403, "Origin not allowed", corsHeaders);
    }
    if (request.method !== "POST") {
      return jsonError(405, "Method not allowed", corsHeaders);
    }
    if (!ALLOWED_PATHS.has(url.pathname)) {
      return jsonError(404, "Not found", corsHeaders);
    }
    if (!env.OPENAI_API_KEY) {
      return jsonError(500, "Proxy missing OPENAI_API_KEY secret", corsHeaders);
    }
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    const isAudio = url.pathname === "/v1/audio/transcriptions";
    const limit = isAudio ? AUDIO_BODY_LIMIT_BYTES : JSON_BODY_LIMIT_BYTES;
    if (contentLength > limit) {
      return jsonError(413, "Payload too large", corsHeaders);
    }
    const upstreamHeaders = new Headers();
    for (const [name, value] of request.headers) {
      if (FORWARDABLE_HEADERS.has(name.toLowerCase())) {
        upstreamHeaders.set(name, value);
      }
    }
    upstreamHeaders.set("Authorization", `Bearer ${env.OPENAI_API_KEY}`);
    const upstreamUrl = `https://api.openai.com${url.pathname}${url.search}`;
    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders,
        body: request.body,
        /* Workers fetch requires `duplex: "half"` whenever the body
         * is a stream (which it is for multipart Whisper uploads).
         * Harmless for JSON bodies. Cast through unknown because the
         * RequestInit type in the Workers types lib doesn't yet
         * expose `duplex`. */
        ...{ duplex: "half" }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upstream fetch failed";
      return jsonError(502, message, corsHeaders);
    }
    const respHeaders = new Headers(upstreamResponse.headers);
    for (const [k, v] of Object.entries(corsHeaders)) {
      respHeaders.set(k, v);
    }
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: respHeaders
    });
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
