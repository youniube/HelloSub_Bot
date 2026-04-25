export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    let botToken;
    try {
      botToken = env.BOT_TOKEN?.trim().replace(/;$/, "");
      if (!botToken) throw new Error("BOT_TOKEN 未设置！请在 Cloudflare Settings > Variables 添加 Secret: BOT_TOKEN");
    } catch (e) {
      return new Response("错误: " + e.message, { status: 500 });
    }

    const botOwnerId = env.BOT_USERID ? parseInt(env.BOT_USERID, 10) : null;

    if (url.pathname === "/hook") {
      const webhookUrl = `https://${url.host}`;
      const setWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
      try {
        const res = await fetch(setWebhookUrl);
        const data = await res.json();
        if (!data.ok) throw new Error(`Webhook 设置失败: ${JSON.stringify(data)} - 检查 Token 或 URL`);
        return new Response("Webhook 设置成功: " + JSON.stringify(data));
      } catch (e) {
        return new Response("Webhook 设置错误: " + e.message, { status: 500 });
      }
    }

    if (url.pathname === "/test") {
      const getMeUrl = `https://api.telegram.org/bot${botToken}/getMe`;
      try {
        const res = await fetch(getMeUrl);
        const data = await res.json();
        return new Response("Token 测试结果: " + JSON.stringify(data));
      } catch (e) {
        return new Response("Token 测试失败: " + e.message, { status: 500 });
      }
    }

    if (url.pathname === "/test-proxy") {
      const configured = !!env.SUB_FETCH_PROXY;
      return new Response(JSON.stringify({
        ok: true,
        subFetchProxyConfigured: configured,
        subFetchProxy: configured ? maskUrl(env.SUB_FETCH_PROXY) : "未配置"
      }, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    if (request.method !== "POST") {
      return new Response("仅支持 POST 方法", { status: 405 });
    }

    let update;
    try {
      update = await request.json();
      console.log("收到更新: " + JSON.stringify(update));
    } catch (e) {
      console.error("解析 JSON 失败: " + e.message);
      return new Response("OK");
    }

    try {
      if (update.message && update.message.text) {
        const userId = update.message.from.id;
        const chatId = update.message.chat.id;
        const messageText = update.message.text.trim();

        const isPublic = await isPublicMode(env);
        const isOwner = botOwnerId && userId === botOwnerId;

        if (botOwnerId && !isOwner && !isPublic) {
          await sendMessage(botToken, chatId, "❌ 此 Bot 目前仅限创建者使用。创建者可以使用 /open 命令开放给所有人使用。");
          return new Response("OK");
        }

        if (isOwner) {
          if (messageText === "/open") {
            await setPublicMode(env, true);
            await sendMessage(botToken, chatId, "✅ Bot 已开放，所有人都可以使用了！");
            return new Response("OK");
          }

          if (messageText === "/close") {
            await setPublicMode(env, false);
            await sendMessage(botToken, chatId, "🔒 Bot 已关闭，只有您可以使用。");
            return new Response("OK");
          }

          if (messageText === "/status") {
            const publicStatus = isPublic ? "开放模式" : "私有模式";
            const proxyStatus = env.SUB_FETCH_PROXY ? `\n中转拉取：已配置 ${maskUrl(env.SUB_FETCH_PROXY)}` : "\n中转拉取：未配置";
            const userIdInfo = botOwnerId ? `\n您的 ID：${userId}` : "";
            await sendMessage(botToken, chatId, `📌 当前状态：${publicStatus}${userIdInfo}${proxyStatus}`);
            return new Response("OK");
          }
        }

        if (messageText === "/start") {
          const welcomeMsg = isOwner
            ? "👋 欢迎回来，主人！\n\n管理命令：\n/open - 开放 Bot 给所有人使用\n/close - 限制只有您能使用\n/status - 查看 Bot 状态\n\n直接发送订阅链接即可查询流量。"
            : "👋 欢迎使用订阅查询 Bot！\n\n直接发送订阅链接即可查询流量信息。";
          await sendMessage(botToken, chatId, welcomeMsg);
          return new Response("OK");
        }

        const subUrls = extractUrlsFromText(messageText);
        if (subUrls.length === 0) {
          await sendMessage(botToken, chatId, "❌ 未识别到有效订阅链接，请直接发送链接或包含链接的文本！");
          return new Response("OK");
        }

        await sendMessage(botToken, chatId, `⏳ 已识别 ${subUrls.length} 条链接，正在汇总查询结果...`);
        ctx.waitUntil(processSubscriptionsCombined(botToken, chatId, subUrls, {
          env,
          concurrency: 2,
          hide403InMulti: false,
          fastMode: true
        }));
        return new Response("OK");
      }

      if (update.inline_query && update.inline_query.query) {
        const userId = update.inline_query.from.id;
        const subUrl = extractUrlFromText(update.inline_query.query.trim());

        const isPublic = await isPublicMode(env);
        const isOwner = botOwnerId && userId === botOwnerId;

        if (botOwnerId && !isOwner && !isPublic) {
          const results = [{
            type: "article",
            id: "1",
            title: "权限不足",
            input_message_content: { message_text: "❌ 此 Bot 目前仅限创建者使用。" }
          }];
          await answerInlineQuery(botToken, update.inline_query.id, results);
          return new Response("OK");
        }

        if (!subUrl) {
          await answerInlineQuery(botToken, update.inline_query.id, []);
          return new Response("OK");
        }

        const info = await querySubscription(subUrl, { env });
        const output = formatOutput(subUrl, info);
        const results = [{
          type: "article",
          id: "1",
          title: "订阅查询结果",
          input_message_content: { message_text: escapeMarkdown(output), parse_mode: "MarkdownV2" }
        }];
        await answerInlineQuery(botToken, update.inline_query.id, results);
        return new Response("OK");
      }

      if (update.message) {
        await sendMessage(botToken, update.message.chat.id, "❌ 不支持的消息类型！");
      }
      return new Response("OK");
    } catch (error) {
      console.error("处理错误: " + error.message);
      if (update.message && update.message.chat) {
        await sendMessage(botToken, update.message.chat.id, `错误发生: ${error.message}\n解决方案: 如果是 403，请配置 SUB_FETCH_PROXY 使用非 Cloudflare 中转拉取；如果是订阅本身问题，请检查 URL 有效性。`);
      } else if (update.inline_query) {
        await answerInlineQuery(botToken, update.inline_query.id, []);
      }
      return new Response("OK");
    }
  }
};

function escapeMarkdown(text) {
  return String(text || "").replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

function extractUrlsFromText(text) {
  if (!text) return [];
  const matches = String(text).match(/https?:\/\/[^\s"'<>，。；、）)]+/gi);
  if (!matches) return [];

  const urls = [];
  const seen = new Set();
  for (const raw of matches) {
    const candidate = raw.replace(/[),.，。；;!！]+$/g, "");
    if (isValidUrl(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      urls.push(candidate);
    }
  }
  return urls;
}

function extractUrlFromText(text) {
  const urls = extractUrlsFromText(text);
  return urls.length > 0 ? urls[0] : null;
}

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function maskUrl(value) {
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return "已配置";
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getSubscriptionUserAgents(fastMode) {
  const list = [
    "clash-meta",
    "sing-box/1.10.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  ];
  return fastMode ? list.slice(0, 2) : list;
}

function buildSubscriptionHeaders(ua) {
  return {
    "Accept": "text/plain, application/yaml, application/x-yaml, application/octet-stream, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "User-Agent": ua
  };
}

function isLikelyBlockedStatus(status) {
  return [401, 403, 406, 407, 418, 429, 451, 503].includes(Number(status));
}

async function fetchSubscriptionSmart(subUrl, ua, env, timeoutMs = 5000) {
  const headers = buildSubscriptionHeaders(ua);
  let directError = null;

  try {
    const res = await fetchWithTimeout(subUrl, {
      method: "GET",
      headers,
      redirect: "follow"
    }, timeoutMs);

    if (res.ok) {
      return { response: res, via: "direct" };
    }

    directError = new Error(`直连失败，状态码: ${res.status}`);
    if (!isLikelyBlockedStatus(res.status) && !env?.SUB_FETCH_PROXY) {
      return { response: res, via: "direct" };
    }
  } catch (e) {
    directError = e;
  }

  if (env?.SUB_FETCH_PROXY) {
    try {
      const proxyResponse = await fetchViaSubscriptionProxy(subUrl, headers, env, timeoutMs + 3000);
      if (proxyResponse.ok) {
        return { response: proxyResponse, via: "proxy" };
      }
      throw new Error(`中转失败，状态码: ${proxyResponse.status}`);
    } catch (e) {
      throw new Error(`${directError ? directError.message : "直连失败"}；中转也失败: ${e.message}`);
    }
  }

  throw directError || new Error("请求失败");
}

async function fetchViaSubscriptionProxy(subUrl, originalHeaders, env, timeoutMs = 12000) {
  const proxy = String(env.SUB_FETCH_PROXY || "").trim();
  if (!proxy) throw new Error("SUB_FETCH_PROXY 未配置");

  const token = String(env.SUB_FETCH_PROXY_TOKEN || "").trim();
  const proxyHeaders = {
    "Content-Type": "application/json",
    "Accept": "*/*"
  };
  if (token) {
    proxyHeaders["Authorization"] = `Bearer ${token}`;
    proxyHeaders["X-Sub-Fetch-Token"] = token;
  }

  if (proxy.includes("{url}")) {
    const target = proxy.replace("{url}", encodeURIComponent(subUrl));
    return fetchWithTimeout(target, {
      method: "GET",
      headers: proxyHeaders,
      redirect: "follow"
    }, timeoutMs);
  }

  return fetchWithTimeout(proxy, {
    method: "POST",
    headers: proxyHeaders,
    body: JSON.stringify({
      url: subUrl,
      method: "GET",
      headers: originalHeaders
    }),
    redirect: "follow"
  }, timeoutMs);
}

async function fetchBestSubscriptionResponse(urls, userAgents, env, options = {}) {
  const timeoutMs = options.timeoutMs || 9000;
  const preferUserInfo = options.preferUserInfo !== false;
  let fallback = null;
  let lastError = null;

  for (const candidate of urls) {
    for (const ua of userAgents) {
      try {
        const result = await fetchSubscriptionSmart(candidate, ua, env, timeoutMs);
        const res = result.response;

        if (!res.ok) {
          lastError = new Error(`请求失败，状态码: ${res.status}`);
          continue;
        }

        const hasUserInfo = !!res.headers.get("Subscription-Userinfo");
        const hasNameHints = !!res.headers.get("profile-title") || !!res.headers.get("content-disposition") || !!res.headers.get("profile-web-page-url");

        if (preferUserInfo && (hasUserInfo || hasNameHints)) {
          return { response: res, sourceUrl: candidate, via: result.via };
        }

        if (!fallback) fallback = { response: res, sourceUrl: candidate, via: result.via };
      } catch (e) {
        lastError = e;
      }
    }
  }

  if (fallback) return fallback;

  const suffix = env?.SUB_FETCH_PROXY
    ? ""
    : "；目标站可能屏蔽 Cloudflare Worker，如仍 403，请配置 SUB_FETCH_PROXY 使用非 Cloudflare 中转拉取";
  throw new Error(`${lastError ? lastError.message : "请求失败"}${suffix}`);
}

async function querySubscription(subUrl, options = {}) {
  const env = options.env || {};
  const fastMode = !!options.fastMode;
  const userAgents = getSubscriptionUserAgents(fastMode);

  try {
    const primary = await fetchBestSubscriptionResponse([subUrl], userAgents, env, { timeoutMs: 5000 });
    const response = primary.response;

    const userinfo = response.headers.get("Subscription-Userinfo");
    const updateInterval = response.headers.get("profile-update-interval");
    const webPageUrl = response.headers.get("profile-web-page-url");
    const profileTitle = response.headers.get("profile-title");
    const contentDisposition = response.headers.get("content-disposition");

    let configName = extractConfigName(profileTitle, contentDisposition, webPageUrl, subUrl);
    let resetDays = updateInterval ? parseInt(updateInterval, 10) : null;

    let bodyInfo = await parseSubscriptionBodyInfo(response.clone());
    if (!bodyInfo.nodeCount || bodyInfo.nodeCount <= 0) {
      bodyInfo = await enrichBodyInfoByVariants(subUrl, userAgents, bodyInfo, { fastMode, env });
    }

    if (bodyInfo && bodyInfo.configNameHint && bodyInfo.configNameHint !== "未知") {
      configName = bodyInfo.configNameHint;
    }

    if (!userinfo) {
      const bodyText = await response.text();
      const decodedBody = decodeSubscriptionText(bodyText);
      const statusInfo = parseStatusLineInfo(decodedBody);

      if (!statusInfo) {
        throw new Error("该订阅没有设置节点流量信息，且未返回 Subscription-Userinfo 头");
      }

      return {
        ...statusInfo,
        configName,
        resetDays: Number.isFinite(resetDays) ? resetDays : null,
        protocolTypes: bodyInfo.protocolTypes || [],
        nodeCount: bodyInfo.nodeCount || 0,
        regions: bodyInfo.regions || [],
        regionStats: bodyInfo.regionStats || {},
        fetchVia: primary.via
      };
    }

    const params = new Map();
    userinfo.split(";").forEach(pair => {
      const [key, value] = pair.trim().split("=");
      if (key && value) params.set(key.trim().toLowerCase(), parseInt(value.trim(), 10));
    });

    return {
      upload: params.get("upload") || 0,
      download: params.get("download") || 0,
      total: params.get("total") || 0,
      expire: params.get("expire") || 0,
      configName,
      resetDays: Number.isFinite(resetDays) ? resetDays : null,
      protocolTypes: bodyInfo.protocolTypes || [],
      nodeCount: bodyInfo.nodeCount || 0,
      regions: bodyInfo.regions || [],
      regionStats: bodyInfo.regionStats || {},
      fetchVia: primary.via
    };
  } catch (e) {
    throw new Error(`订阅查询失败: ${e.message}`);
  }
}

async function enrichBodyInfoByVariants(subUrl, userAgents, fallbackInfo, options = {}) {
  try {
    const env = options.env || {};
    const variants = buildSubscriptionVariants(subUrl, { fastMode: !!options.fastMode });
    let best = fallbackInfo || { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };

    const variantResponse = await fetchBestSubscriptionResponse(variants, userAgents, env, {
      timeoutMs: 3500,
      preferUserInfo: false
    });

    const info = await parseSubscriptionBodyInfo(variantResponse.response.clone());
    const candidateConfigName = extractConfigName(
      variantResponse.response.headers.get("profile-title"),
      variantResponse.response.headers.get("content-disposition"),
      variantResponse.response.headers.get("profile-web-page-url"),
      variantResponse.sourceUrl
    );

    const enrichedInfo = {
      ...info,
      sourceUrl: variantResponse.sourceUrl,
      configNameHint: candidateConfigName
    };

    if ((enrichedInfo.nodeCount || 0) > (best.nodeCount || 0)) {
      best = enrichedInfo;
    }

    return best;
  } catch {
    return fallbackInfo || { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };
  }
}

function buildSubscriptionVariants(subUrl, options = {}) {
  const fastMode = !!options.fastMode;
  const variants = new Set();
  variants.add(subUrl);

  try {
    const url = new URL(subUrl);
    const appendVariant = (mutator) => {
      const u = new URL(url.toString());
      mutator(u.searchParams);
      variants.add(u.toString());
    };

    appendVariant((p) => { p.set("clash", "3"); p.set("extend", "1"); });
    appendVariant((p) => p.set("target", "clash"));
    appendVariant((p) => { p.set("target", "clash"); p.set("list", "1"); });
    appendVariant((p) => { p.set("flag", "clash"); p.set("types", "all"); });

    if (!fastMode) {
      appendVariant((p) => p.set("clash", "1"));
      appendVariant((p) => p.set("target", "clash-meta"));
      appendVariant((p) => p.set("target", "sing-box"));
      appendVariant((p) => p.set("target", "v2ray"));
      appendVariant((p) => p.set("extend", "1"));
    }
  } catch {
    // ignore
  }

  return Array.from(variants);
}

function b64DecodeUtf8(input) {
  let s = String(input || "").trim().replace(/\s+/g, "");
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";

  const binary = atob(s);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));

  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return binary;
  }
}

function looksLikeSubscriptionText(text) {
  const raw = String(text || "");
  return raw.includes("://") ||
    raw.includes("proxies:") ||
    raw.includes("proxy-providers:") ||
    raw.toLowerCase().includes("status=") ||
    raw.toLowerCase().includes("subscription-userinfo");
}

function decodeSubscriptionText(bodyText) {
  const raw = String(bodyText || "").trim();
  if (!raw) return "";

  if (looksLikeSubscriptionText(raw)) return raw;

  try {
    const decoded = b64DecodeUtf8(raw);
    if (decoded && looksLikeSubscriptionText(decoded)) return decoded;
  } catch {
    // ignore
  }

  return raw;
}

function parseStatusLineInfo(text) {
  const lines = String(text || "").split(/\r?\n/);
  const statusLine = lines.find(line => line.toLowerCase().startsWith("status=") || line.toLowerCase().includes("status="));
  if (!statusLine) return null;

  const upload = pickStatusNumber(statusLine, ["upload", "uplink", "up", "已用上行", "↑"]);
  const download = pickStatusNumber(statusLine, ["download", "downlink", "down", "已用下行", "↓"]);
  const total = pickStatusNumber(statusLine, ["total", "tot", "流量", "总计"]);
  const expire = pickStatusExpire(statusLine);

  if (total === null) {
    const legacy = statusLine.match(/status=.*?(?:↑:)?([\d.]+)\s*GB.*?(?:↓:)?([\d.]+)\s*GB.*?(?:TOT:)?([\d.]+)\s*GB.*?(?:Expires?:)?(\d{4}-\d{2}-\d{2})/i);
    if (legacy) {
      return {
        upload: parseFloat(legacy[1]) * (1024 ** 3),
        download: parseFloat(legacy[2]) * (1024 ** 3),
        total: parseFloat(legacy[3]) * (1024 ** 3),
        expire: Math.floor(new Date(`${legacy[4]}T00:00:00Z`).getTime() / 1000)
      };
    }
    return null;
  }

  return {
    upload: upload || 0,
    download: download || 0,
    total: total || 0,
    expire: expire || 0
  };
}

function pickStatusNumber(line, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}\s*[:=]\s*([\d.]+)\s*(B|KB|MB|GB|TB)?`, "i");
    const m = String(line).match(re);
    if (m) return sizeToBytes(parseFloat(m[1]), m[2] || "GB");
  }
  return null;
}

function pickStatusExpire(line) {
  const unix = String(line).match(/(?:expire|expires|过期)\s*[:=]\s*(\d{10})/i);
  if (unix) return parseInt(unix[1], 10);

  const date = String(line).match(/(?:expire|expires|过期)\s*[:=]\s*(\d{4}-\d{2}-\d{2})/i);
  if (date) return Math.floor(new Date(`${date[1]}T00:00:00Z`).getTime() / 1000);

  return 0;
}

function sizeToBytes(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const u = String(unit || "GB").toUpperCase();
  const map = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return n * (map[u] || 1024 ** 3);
}

function decodeRFC5987(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function decodeMaybeUriComponent(text) {
  if (!text) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function extractConfigName(profileTitle, contentDisposition, webPageUrl, subUrl) {
  if (profileTitle) {
    try {
      if (profileTitle.toLowerCase().startsWith("base64:")) {
        const decoded = b64DecodeUtf8(profileTitle.slice(7));
        if (decoded && decoded.trim()) return decoded.trim();
      }
      const normalized = decodeMaybeUriComponent(profileTitle.trim());
      if (normalized) return normalized;
    } catch {
      // ignore
    }
  }

  if (contentDisposition) {
    try {
      const m1 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
      if (m1 && m1[1]) {
        const name = decodeRFC5987(m1[1]).trim();
        if (name) return stripConfigExt(name);
      }
      const m2 = contentDisposition.match(/filename="?([^";]+)"?/i);
      if (m2 && m2[1] && m2[1].trim()) {
        const name = decodeMaybeUriComponent(m2[1].trim());
        if (name) return stripConfigExt(name);
      }
    } catch {
      // ignore
    }
  }

  if (webPageUrl) {
    try {
      const domain = new URL(webPageUrl).hostname.split(".")[0];
      if (domain) return domain.charAt(0).toUpperCase() + domain.slice(1);
    } catch {
      // ignore
    }
  }

  try {
    const host = new URL(subUrl).hostname.split(".")[0];
    if (host) return host.charAt(0).toUpperCase() + host.slice(1);
  } catch {
    // ignore
  }

  return "未知";
}

function stripConfigExt(name) {
  return String(name || "").replace(/\.(ya?ml|txt|conf|json)$/i, "");
}

function detectProtocolType(url) {
  const lower = String(url || "").toLowerCase();
  if (lower.startsWith("ss://")) return "Shadowsocks";
  if (lower.startsWith("ssr://")) return "ShadowsocksR";
  if (lower.startsWith("vmess://")) return "VMess";
  if (lower.startsWith("vless://")) return "VLESS";
  if (lower.startsWith("trojan://")) return "Trojan";
  if (lower.startsWith("hysteria2://") || lower.startsWith("hy2://")) return "Hysteria2";
  if (lower.startsWith("hysteria://")) return "Hysteria";
  if (lower.startsWith("tuic://")) return "TUIC";
  if (lower.startsWith("wireguard://")) return "WireGuard";
  if (lower.startsWith("snell://")) return "Snell";
  if (lower.startsWith("anytls://")) return "AnyTLS";
  return null;
}

async function parseSubscriptionBodyInfo(response) {
  try {
    const bodyText = await response.text();
    if (!bodyText) return emptyBodyInfo();

    const decoded = decodeSubscriptionText(bodyText);
    const lines = decoded.split(/\r?\n/).map(v => v.trim()).filter(Boolean);

    const uriNodeLines = lines.filter(line =>
      /^[a-z][a-z0-9+.-]*:\/\//i.test(line) &&
      !line.toLowerCase().startsWith("status=") &&
      !!detectProtocolType(line)
    );

    const clashYamlNodes = parseClashYamlNodes(lines);
    const protocolSet = new Set();
    const regionSet = new Set();
    const regionStats = {};
    const seen = new Set();

    for (const line of uriNodeLines) {
      const protocol = detectProtocolType(line);
      if (!protocol) continue;
      const nodeName = extractNodeNameFromLine(line);
      const key = `${protocol}|${nodeName || line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      protocolSet.add(protocol);

      const region = detectRegionFromName(nodeName || line);
      if (region) {
        regionSet.add(region);
        regionStats[region] = (regionStats[region] || 0) + 1;
      }
    }

    for (const node of clashYamlNodes) {
      const normalizedType = normalizeClashType(node.type);
      if (!normalizedType) continue;
      const key = `${normalizedType}|${node.name || ""}|${node.server || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      protocolSet.add(normalizedType);

      const region = detectRegionFromName(node.name || "");
      if (region) {
        regionSet.add(region);
        regionStats[region] = (regionStats[region] || 0) + 1;
      }
    }

    return {
      protocolTypes: Array.from(protocolSet),
      nodeCount: seen.size,
      regions: sortRegions(Array.from(regionSet)),
      regionStats
    };
  } catch (e) {
    console.error("解析订阅正文失败:", e.message);
    return emptyBodyInfo();
  }
}

function emptyBodyInfo() {
  return { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };
}

function cleanYamlValue(value) {
  return String(value || "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+#.*$/g, "")
    .trim();
}

function pickYamlValue(line, key) {
  const re = new RegExp(`(?:^|[,{]\s*)${key}\s*:\s*(?:"([^"]*)"|'([^']*)'|([^,}]+))`, "i");
  const m = String(line || "").match(re);
  return cleanYamlValue(m?.[1] || m?.[2] || m?.[3] || "");
}

function parseClashYamlNodes(lines) {
  const nodes = [];
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const normalizedType = normalizeClashType(current.type);
    if (normalizedType) {
      nodes.push({
        name: current.name || "",
        type: current.type || "",
        server: current.server || ""
      });
    }
  };

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith("#")) continue;

    if (/^-\s*/.test(line)) {
      pushCurrent();
      current = {};

      const rest = line.replace(/^-\s*/, "");
      const name = pickYamlValue(rest, "name");
      const type = pickYamlValue(rest, "type");
      const server = pickYamlValue(rest, "server");

      if (name) current.name = name;
      if (type) current.type = type;
      if (server) current.server = server;
      continue;
    }

    if (current) {
      const name = pickYamlValue(line, "name");
      const type = pickYamlValue(line, "type");
      const server = pickYamlValue(line, "server");

      if (name) current.name = name;
      if (type) current.type = type;
      if (server) current.server = server;
    }
  }

  pushCurrent();
  return nodes;
}

function normalizeClashType(type) {
  if (!type) return null;
  const t = String(type).trim().toLowerCase();
  const mapping = {
    ss: "Shadowsocks",
    ssr: "ShadowsocksR",
    vmess: "VMess",
    vless: "VLESS",
    trojan: "Trojan",
    hysteria2: "Hysteria2",
    hy2: "Hysteria2",
    hysteria: "Hysteria",
    tuic: "TUIC",
    wireguard: "WireGuard",
    wg: "WireGuard",
    snell: "Snell",
    anytls: "AnyTLS",
    http: "HTTP",
    socks5: "SOCKS5"
  };

  const nonProxyTypes = new Set([
    "select", "url-test", "fallback", "load-balance", "relay", "direct", "reject", "reject-drop", "pass", "dns"
  ]);

  if (nonProxyTypes.has(t)) return null;
  return mapping[t] || t.toUpperCase();
}

function extractNodeNameFromLine(line) {
  try {
    const text = String(line || "").trim();
    const lower = text.toLowerCase();

    if (lower.startsWith("vmess://")) {
      const jsonText = b64DecodeUtf8(text.slice(8));
      const json = JSON.parse(jsonText);
      return json.ps || json.name || "";
    }

    if (lower.startsWith("ssr://")) {
      const decoded = b64DecodeUtf8(text.slice(6));
      const params = decoded.split("/?")[1] || "";
      const remarks = new URLSearchParams(params).get("remarks");
      return remarks ? b64DecodeUtf8(remarks) : "";
    }

    const hashIndex = text.indexOf("#");
    if (hashIndex >= 0) {
      return decodeURIComponent(text.slice(hashIndex + 1).replace(/\+/g, "%20")).trim();
    }

    return "";
  } catch {
    return "";
  }
}

const REGION_RULES = [
  { region: "中国", keywords: ["🇨🇳", "中国", "cn", "china", "上海", "广州", "深圳", "北京", "china mainland"] },
  { region: "香港", keywords: ["🇭🇰", "香港", "港", "hk", "hongkong", "hong kong"] },
  { region: "台湾", keywords: ["🇹🇼", "台湾", "台灣", "tw", "taiwan", "台北"] },
  { region: "日本", keywords: ["🇯🇵", "日本", "日", "jp", "japan", "东京", "東京", "大阪"] },
  { region: "新加坡", keywords: ["🇸🇬", "新加坡", "狮城", "sg", "singapore"] },
  { region: "美国", keywords: ["🇺🇸", "美国", "美國", "美", "us", "usa", "united states", "america", "洛杉矶", "硅谷", "西雅图"] },
  { region: "韩国", keywords: ["🇰🇷", "韩国", "韓國", "kr", "korea", "首尔", "首爾"] },
  { region: "印度", keywords: ["🇮🇳", "印度", "in", "india"] },
  { region: "印度尼西亚", keywords: ["🇮🇩", "印度尼西亚", "印尼", "id", "indonesia", "jakarta"] },
  { region: "马来西亚", keywords: ["🇲🇾", "马来西亚", "馬來西亞", "my", "malaysia", "kuala lumpur"] },
  { region: "泰国", keywords: ["🇹🇭", "泰国", "泰國", "th", "thailand", "bangkok"] },
  { region: "越南", keywords: ["🇻🇳", "越南", "vn", "vietnam"] },
  { region: "菲律宾", keywords: ["🇵🇭", "菲律宾", "菲律賓", "ph", "philippines", "manila"] },
  { region: "英国", keywords: ["🇬🇧", "英国", "英國", "uk", "gb", "britain", "london"] },
  { region: "德国", keywords: ["🇩🇪", "德国", "德國", "de", "germany", "frankfurt"] },
  { region: "法国", keywords: ["🇫🇷", "法国", "法國", "fr", "france", "paris"] },
  { region: "荷兰", keywords: ["🇳🇱", "荷兰", "荷蘭", "nl", "netherlands", "amsterdam"] },
  { region: "加拿大", keywords: ["🇨🇦", "加拿大", "ca", "canada", "toronto", "vancouver"] },
  { region: "澳大利亚", keywords: ["🇦🇺", "澳大利亚", "澳洲", "au", "australia", "sydney", "melbourne"] },
  { region: "俄罗斯", keywords: ["🇷🇺", "俄罗斯", "俄羅斯", "ru", "russia", "moscow"] },
  { region: "土耳其", keywords: ["🇹🇷", "土耳其", "tr", "turkey", "istanbul"] }
];

function detectRegionFromName(name) {
  if (!name) return null;
  const lower = String(name).toLowerCase();
  for (const rule of REGION_RULES) {
    if (rule.keywords.some(keyword => lower.includes(String(keyword).toLowerCase()))) {
      return rule.region;
    }
  }
  return null;
}

function sortRegions(regions) {
  const order = REGION_RULES.map(rule => rule.region);
  const orderMap = new Map(order.map((name, idx) => [name, idx]));
  return [...regions].sort((a, b) => {
    const ia = orderMap.has(a) ? orderMap.get(a) : Number.MAX_SAFE_INTEGER;
    const ib = orderMap.has(b) ? orderMap.get(b) : Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, "zh-CN");
  });
}

function formatOutput(subUrl, info) {
  const used = Number(info.upload || 0) + Number(info.download || 0);
  const total = Number(info.total || 0);
  const remaining = Math.max(total - used, 0);
  const progress = total > 0 ? (used / total) * 100 : 0;
  const progressBar = generateProgressBar(progress);

  const usedGB = (used / (1024 ** 3)).toFixed(2);
  const totalGB = (total / (1024 ** 3)).toFixed(2);
  const remainingGB = (remaining / (1024 ** 3)).toFixed(2);

  const expireDateObj = new Date(Number(info.expire || 0) * 1000);
  const expireDate = info.expire > 0
    ? expireDateObj.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
    : "未提供";

  const now = Date.now();
  const diffMs = Number(info.expire || 0) * 1000 - now;
  const safeDiff = Math.max(diffMs, 0);
  const days = Math.floor(safeDiff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((safeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((safeDiff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((safeDiff % (1000 * 60)) / 1000);
  const remainingTime = info.expire > 0 ? `${days}天${hours}时${minutes}分${seconds}秒` : "未知";

  const protocolText = info.protocolTypes && info.protocolTypes.length > 0 ? info.protocolTypes.join(", ") : "未知";
  const sortedRegions = info.regions && info.regions.length > 0 ? sortRegions(info.regions) : [];
  const regionCount = sortedRegions.length;
  const nodeLine = Number.isFinite(info.nodeCount) && info.nodeCount > 0 ? `节点总数: ${info.nodeCount} | 国家/地区: ${regionCount}\n` : "";
  const coverageLine = regionCount > 0 ? `覆盖范围: ${sortedRegions.join("、")}\n` : "";
  const regionStats = info.regionStats || {};
  const regionDistribution = sortedRegions.map(region => `${region} ${regionStats[region] || 0}`).join("｜");
  const regionDistributionLine = regionDistribution ? `地区分布: ${regionDistribution}\n` : "";
  const viaLine = info.fetchVia === "proxy" ? "拉取方式: 非 Cloudflare 中转\n" : "";

  return `配置名称: ${info.configName}\n订阅链接: ${subUrl}\n流量详情: ${usedGB} GB / ${totalGB} GB\n使用进度: ${progressBar} ${progress.toFixed(1)}%\n剩余可用: ${remainingGB} GB\n协议类型: ${protocolText}\n${nodeLine}${coverageLine}${regionDistributionLine}${viaLine}过期时间: ${expireDate}${info.expire > 0 ? ` (剩余${days}天)` : ""}\n剩余时间: ${remainingTime}`;
}

function generateProgressBar(percentage) {
  const normalized = Math.min(Math.max(Number(percentage) || 0, 0), 100);
  const totalBlocks = 11;
  const filled = Math.round((normalized / 100) * totalBlocks);
  return "[" + "■".repeat(filled) + "□".repeat(totalBlocks - filled) + "]";
}

async function processSubscriptionsWithLimit(subUrls, options = {}) {
  const concurrency = Math.max(1, Math.min(options.concurrency || 2, 6));
  const hide403InMulti = !!options.hide403InMulti;
  const results = new Array(subUrls.length);
  let index = 0;

  async function worker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= subUrls.length) break;

      const subUrl = subUrls[current];
      try {
        const info = await querySubscription(subUrl, { fastMode: !!options.fastMode, env: options.env || {} });
        const status = evaluateSubscriptionStatus(info);
        results[current] = { text: formatOutput(subUrl, info), status, hidden: false };
      } catch (e) {
        const errMsg = String(e && e.message ? e.message : e);
        const is403 = /\b403\b/.test(errMsg);
        const shouldHide = hide403InMulti && is403;
        results[current] = {
          text: shouldHide ? "" : `订阅链接: ${subUrl}\n查询失败: ${errMsg}`,
          status: "failed",
          hidden: shouldHide
        };
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function processSubscriptionsCombined(token, chatId, subUrls, options = {}) {
  const concurrency = Math.max(1, Math.min(options.concurrency || 4, 6));
  const total = subUrls.length;
  const summary = { valid: 0, exhausted: 0, expired: 0, failed: 0 };

  const outputs = await processSubscriptionsWithLimit(subUrls, {
    concurrency,
    hide403InMulti: !!options.hide403InMulti,
    fastMode: !!options.fastMode,
    env: options.env || {}
  });

  for (const item of outputs) {
    if (!item) continue;
    if (item.status === "valid") summary.valid += 1;
    else if (item.status === "exhausted") summary.exhausted += 1;
    else if (item.status === "expired") summary.expired += 1;
    else summary.failed += 1;
  }

  const visibleTexts = outputs.filter(v => v && !v.hidden && v.text).map(v => v.text);
  if (visibleTexts.length > 0) {
    const merged = visibleTexts.join("\n\n────────────\n\n");
    await sendLongMessage(token, chatId, merged);
  }

  await sendMessage(token, chatId, `📊 有效: ${summary.valid} | 耗尽: ${summary.exhausted} | 过期: ${summary.expired} | 失败: ${summary.failed}`);
  await sendMessage(token, chatId, `✅ 查询完成，共 ${total} 条。`);
}

function evaluateSubscriptionStatus(info) {
  const nowSec = Math.floor(Date.now() / 1000);
  if (!info || !Number.isFinite(Number(info.total))) return "failed";
  if (info.expire > 0 && info.expire <= nowSec) return "expired";
  const used = Number(info.upload || 0) + Number(info.download || 0);
  const remaining = Number(info.total || 0) - used;
  if (remaining <= 0) return "exhausted";
  return "valid";
}

async function sendLongMessage(token, chatId, text) {
  const maxLen = 3500;
  if (!text || text.length <= maxLen) {
    await sendMessage(token, chatId, escapeMarkdown(text || ""), "MarkdownV2");
    return;
  }

  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxLen, text.length);
    if (end < text.length) {
      const lastBreak = text.lastIndexOf("\n", end);
      if (lastBreak > start + 200) end = lastBreak;
    }
    const chunk = text.slice(start, end);
    await sendMessage(token, chatId, escapeMarkdown(chunk), "MarkdownV2");
    start = end;
  }
}

async function sendMessage(token, chatId, text, parseMode = null) {
  if (!text) {
    console.error("发送文本为空");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) {
      let errData = null;
      try { errData = await res.json(); } catch { errData = { status: res.status }; }
      console.error("发送失败: " + JSON.stringify(errData));
    }
  } catch (e) {
    console.error("发送异常: " + e.message);
  }
}

async function answerInlineQuery(token, queryId, results) {
  const url = `https://api.telegram.org/bot${token}/answerInlineQuery`;
  const body = { inline_query_id: queryId, results };

  try {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) {
      console.error("内联响应失败: " + res.status);
    }
  } catch (e) {
    console.error("内联异常: " + e.message);
  }
}

let publicMode = false;

async function isPublicMode(env) {
  if (!env.BOT_USERID) return true;
  return publicMode;
}

async function setPublicMode(env, isPublic) {
  publicMode = isPublic;
}
