export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        let botToken;
        try {
            botToken = env.BOT_TOKEN.trim().replace(/;$/, '');
            if (!botToken) throw new Error('BOT_TOKEN 未设置！请在 Cloudflare Settings > Variables 添加 Secret: BOT_TOKEN');
        } catch (e) {
            return new Response('错误: ' + e.message, { status: 500 });
        }
        const botOwnerId = env.BOT_USERID ? parseInt(env.BOT_USERID) : null;

        if (url.pathname === '/hook') {
            const webhookUrl = `https://${url.host}`;
            const setWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
            try {
                const res = await fetch(setWebhookUrl);
                const data = await res.json();
                if (!data.ok) throw new Error(`Webhook 设置失败: ${JSON.stringify(data)} - 检查 Token 或 URL`);
                return new Response('Webhook 设置成功: ' + JSON.stringify(data));
            } catch (e) {
                return new Response('Webhook 设置错误: ' + e.message, { status: 500 });
            }
        }

        if (url.pathname === '/test') {
            const getMeUrl = `https://api.telegram.org/bot${botToken}/getMe`;
            try {
                const res = await fetch(getMeUrl);
                const data = await res.json();
                return new Response('Token 测试结果: ' + JSON.stringify(data));
            } catch (e) {
                return new Response('Token 测试失败: ' + e.message, { status: 500 });
            }
        }

        if (request.method !== 'POST') {
            return new Response('仅支持 POST 方法', { status: 405 });
        }

        let update;
        try {
            update = await request.json();
            console.log('收到更新: ' + JSON.stringify(update));
        } catch (e) {
            console.error('解析 JSON 失败: ' + e.message);
            return new Response('OK');
        }

        try {
            if (update.message && update.message.text) {
                const userId = update.message.from.id;
                const messageText = update.message.text.trim();
                
                // 检查权限
                const isPublic = await isPublicMode(env);
                const isOwner = botOwnerId && userId === botOwnerId;
                
                if (botOwnerId && !isOwner && !isPublic) {
                    await sendMessage(botToken, update.message.chat.id, "❌ 此Bot目前仅限创建者使用。创建者可以使用 /open 命令开放给所有人使用。");
                    return new Response('OK');
                }
                
                if (isOwner) {
                    if (messageText === '/open') {
                        await setPublicMode(env, true);
                        await sendMessage(botToken, update.message.chat.id, "✅ Bot已开放，所有人都可以使用了！");
                        return new Response('OK');
                    }
                    
                    if (messageText === '/close') {
                        await setPublicMode(env, false);
                        await sendMessage(botToken, update.message.chat.id, "🔒 Bot已关闭，只有您可以使用。");
                        return new Response('OK');
                    }
                    
                    if (messageText === '/status') {
                        const publicStatus = isPublic ? "开放模式" : "私有模式";
                        const userIdInfo = botOwnerId ? `\n👤 您的ID：${userId}` : "";
                        await sendMessage(botToken, update.message.chat.id, `📊 当前状态：${publicStatus}${userIdInfo}`);
                        return new Response('OK');
                    }
                }
                
                if (messageText === '/start') {
                    let welcomeMsg;
                    if (isOwner) {
                        welcomeMsg = "🎉 欢迎回来，主人！\n\n📋 管理命令：\n/open - 开放Bot给所有人使用\n/close - 限制只有您能使用\n/status - 查看Bot状态\n\n直接发送订阅链接即可查询流量！";
                    } else if (!botOwnerId) {
                        welcomeMsg = "🎉 欢迎使用订阅查询Bot！\n\n直接发送订阅链接即可查询流量信息。";
                    } else {
                        welcomeMsg = "🎉 欢迎使用订阅查询Bot！\n\n直接发送订阅链接即可查询流量信息。";
                    }
                    await sendMessage(botToken, update.message.chat.id, welcomeMsg);
                    return new Response('OK');
                }
                
                const subUrls = extractUrlsFromText(messageText);
                if (subUrls.length === 0) {
                    await sendMessage(botToken, update.message.chat.id, "❌ 未识别到有效订阅链接，请直接发送链接或包含链接的文本！");
                    return new Response('OK');
                }

                const outputs = [];
                for (const subUrl of subUrls) {
                    try {
                        const info = await querySubscription(subUrl);
                        outputs.push(formatOutput(subUrl, info));
                    } catch (e) {
                        outputs.push(`订阅链接: ${subUrl}\n查询失败: ${e.message}`);
                    }
                }

                const merged = outputs.join("\n\n────────────\n\n");
                await sendLongMessage(botToken, update.message.chat.id, merged);
                return new Response('OK');
            } else if (update.inline_query && update.inline_query.query) {
                const userId = update.inline_query.from.id;
                const subUrl = extractUrlFromText(update.inline_query.query.trim());
                
                // 检查权限（内联查询）
                const isPublic = await isPublicMode(env);
                const isOwner = botOwnerId && userId === botOwnerId;
                
                if (botOwnerId && !isOwner && !isPublic) {
                    const results = [{
                        type: "article",
                        id: "1",
                        title: "权限不足",
                        input_message_content: { message_text: "❌ 此Bot目前仅限创建者使用。" }
                    }];
                    await answerInlineQuery(botToken, update.inline_query.id, results);
                    return new Response('OK');
                }
                
                if (!subUrl) {
                    await answerInlineQuery(botToken, update.inline_query.id, []);
                    return new Response('OK');
                }
                const info = await querySubscription(subUrl);
                const output = formatOutput(subUrl, info);
                const results = [{
                    type: "article",
                    id: "1",
                    title: "订阅查询结果",
                    input_message_content: {
                        message_text: escapeMarkdown(output),
                        parse_mode: "MarkdownV2"
                    }
                }];
                await answerInlineQuery(botToken, update.inline_query.id, results);
                return new Response('OK');
            } else {
                if (update.message) {
                    await sendMessage(botToken, update.message.chat.id, "❌ 不支持的消息类型！");
                }
                return new Response('OK');
            }
        } catch (error) {
            console.error('处理错误: ' + error.message);
            if (update.message && update.message.chat) {
                await sendMessage(botToken, update.message.chat.id, `错误发生: ${error.message}\n解决方案: 如果是链接问题，请检查 URL 有效性并重试；如果是头信息缺失，请确认订阅地址支持 Subscription-Userinfo 头；网络问题，请稍后尝试。`);
            } else if (update.inline_query) {
                await answerInlineQuery(botToken, update.inline_query.id, []);
            }
            return new Response('OK');
        }

        return new Response('OK');
    },
};

function escapeMarkdown(text) {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

function extractUrlsFromText(text) {
    if (!text) return [];
    const matches = text.match(/https?:\/\/[^\s"'<>，。；、））]+/gi);
    if (!matches) return [];

    const urls = [];
    const seen = new Set();
    for (const raw of matches) {
        const candidate = raw.replace(/[),.，。；;!！]+$/g, '');
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
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

async function querySubscription(subUrl) {
    const userAgents = [
        "clash-meta",
        "Clash",
        "Clash Verge/1.7",
        "Stash/1.0",
        "sing-box 1.9",
        "Shadowrocket/2701 CFNetwork/3857.100.1 Darwin/25.0.0 iPhone14,4",
        "Quantumult X"
    ];

    try {
        let response = null;
        let lastError = null;

        // 逐个 UA 尝试，优先拿到带订阅头信息的响应
        for (const ua of userAgents) {
            try {
                const res = await fetch(subUrl, {
                    method: "GET",
                    headers: {
                        "Accept": "*/*",
                        "User-Agent": ua
                    },
                    redirect: "manual"
                });

                if (!res.ok) {
                    lastError = new Error(`请求失败，状态码: ${res.status}`);
                    continue;
                }

                const hasUserInfo = !!res.headers.get("Subscription-Userinfo");
                const hasNameHints = !!res.headers.get("profile-title") || !!res.headers.get("content-disposition") || !!res.headers.get("profile-web-page-url");

                // 命中关键头信息就立即使用
                if (hasUserInfo || hasNameHints) {
                    response = res;
                    break;
                }

                // 暂存一个可用响应兜底
                if (!response) response = res;
            } catch (e) {
                lastError = e;
            }
        }

        if (!response) {
            throw new Error(`请求失败。${lastError ? `原因: ${lastError.message}` : ""}`);
        }

        let userinfo = response.headers.get("Subscription-Userinfo");
        let updateInterval = response.headers.get("profile-update-interval");
        let webPageUrl = response.headers.get("profile-web-page-url");
        let profileTitle = response.headers.get("profile-title");
        let contentDisposition = response.headers.get("content-disposition");

        let configName = extractConfigName(profileTitle, contentDisposition, webPageUrl, subUrl);
        let resetDays = null;
        let bodyInfo = await parseSubscriptionBodyInfo(response.clone());

        // 某些面板默认链接只返回流量头，不返回节点；尝试常见参数变体补全节点信息
        if (!bodyInfo.nodeCount || bodyInfo.nodeCount <= 0) {
            bodyInfo = await enrichBodyInfoByVariants(subUrl, userAgents, bodyInfo);
        }

        // 若节点信息来自变体链接，且变体有更准确的配置名，则覆盖默认名称
        if (bodyInfo && bodyInfo.configNameHint && bodyInfo.configNameHint !== '未知') {
            configName = bodyInfo.configNameHint;
        }

        if (!userinfo) {
            const bodyText = await response.text();
            let decodedBody = bodyText;
            try {
                decodedBody = atob(bodyText);  // base64 解码
            } catch {

            }

            // 搜索包含 status 的行
            const lines = decodedBody.split(/\r?\n/);
            const statusLine = lines.find(line => line.toLowerCase().startsWith('status=') || line.toLowerCase().includes('status='));

            if (statusLine) {
                const statusMatch = statusLine.match(/status=.*?(?:🚀)?(?:↑:)?([\d.]+)GB.*?(?:↓:)?([\d.]+)GB.*?(?:TOT:)?([\d.]+)GB.*?(?:💡)?(?:Expires:)?(\d{4}-\d{2}-\d{2})/i);
                if (statusMatch) {
                    const uploadGB = parseFloat(statusMatch[1] || 0);
                    const downloadGB = parseFloat(statusMatch[2] || 0);
                    const totalGB = parseFloat(statusMatch[3] || 0);
                    const expireDateStr = statusMatch[4];
                    const expireDate = new Date(expireDateStr + 'T00:00:00Z');
                    const expire = Math.floor(expireDate.getTime() / 1000);

                    return {
                        upload: uploadGB * (1024 ** 3),
                        download: downloadGB * (1024 ** 3),
                        total: totalGB * (1024 ** 3),
                        expire,
                        configName,
                        resetDays: Number.isFinite(resetDays) ? resetDays : null,
                        protocolTypes: bodyInfo.protocolTypes || [],
                        nodeCount: bodyInfo.nodeCount || 0,
                        regions: bodyInfo.regions || [],
                        regionStats: bodyInfo.regionStats || {}
                    };
                } else {
                    throw new Error("该订阅没有设置流量信息");
                }
            } else {
                throw new Error("该订阅没有设置节点流量信息");
            }
        }

        const params = new Map();
        userinfo.split(";").forEach(pair => {
            const [key, value] = pair.trim().split("=");
            if (key && value) params.set(key.trim(), parseInt(value.trim(), 10));
        });

        const upload = params.get("upload") || 0;
        const download = params.get("download") || 0;
        const total = params.get("total") || 0;
        const expire = params.get("expire") || 0;
        resetDays = updateInterval ? parseInt(updateInterval, 10) : null;

        return {
            upload,
            download,
            total,
            expire,
            configName,
            resetDays: Number.isFinite(resetDays) ? resetDays : null,
            protocolTypes: bodyInfo.protocolTypes || [],
            nodeCount: bodyInfo.nodeCount || 0,
            regions: bodyInfo.regions || [],
            regionStats: bodyInfo.regionStats || {}
        };
    } catch (e) {
        throw new Error(`订阅查询失败: ${e.message}`);
    }
}

async function enrichBodyInfoByVariants(subUrl, userAgents, fallbackInfo) {
    try {
        const variants = buildSubscriptionVariants(subUrl);
        let best = fallbackInfo || { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };

        for (const candidate of variants) {
            for (const ua of userAgents) {
                try {
                    const res = await fetch(candidate, {
                        method: "GET",
                        headers: {
                            "Accept": "*/*",
                            "User-Agent": ua
                        },
                        redirect: "manual"
                    });

                    if (!res.ok) continue;
                    const info = await parseSubscriptionBodyInfo(res.clone());
                    const candidateConfigName = extractConfigName(
                        res.headers.get("profile-title"),
                        res.headers.get("content-disposition"),
                        res.headers.get("profile-web-page-url"),
                        candidate
                    );
                    const enrichedInfo = {
                        ...info,
                        sourceUrl: candidate,
                        configNameHint: candidateConfigName
                    };

                    if ((enrichedInfo.nodeCount || 0) > (best.nodeCount || 0)) {
                        best = enrichedInfo;
                    }

                    if ((best.nodeCount || 0) >= 3 && (best.protocolTypes || []).length > 0) {
                        return best;
                    }
                } catch {

                }
            }
        }

        return best;
    } catch {
        return fallbackInfo || { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };
    }
}

function buildSubscriptionVariants(subUrl) {
    const variants = new Set();
    variants.add(subUrl);

    try {
        const url = new URL(subUrl);
        const appendVariant = (mutator) => {
            const u = new URL(url.toString());
            mutator(u.searchParams);
            variants.add(u.toString());
        };

        appendVariant((p) => p.set('clash', '3'));
        appendVariant((p) => p.set('clash', '1'));
        appendVariant((p) => p.set('target', 'clash'));
        appendVariant((p) => p.set('target', 'clash-meta'));
        appendVariant((p) => p.set('target', 'singbox'));
        appendVariant((p) => p.set('target', 'v2ray'));
        appendVariant((p) => p.set('extend', '1'));
        appendVariant((p) => {
            p.set('clash', '3');
            p.set('extend', '1');
        });
        appendVariant((p) => {
            p.set('target', 'clash');
            p.set('list', '1');
        });
    } catch {

    }

    return Array.from(variants);
}

function decodeRFC5987(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function extractConfigName(profileTitle, contentDisposition, webPageUrl, subUrl) {
    // 1) profile-title: base64:xxxx
    if (profileTitle) {
        try {
            if (profileTitle.toLowerCase().startsWith('base64:')) {
                const b64 = profileTitle.slice(7);
                const decoded = atob(b64);
                if (decoded && decoded.trim()) return decoded.trim();
            }
            if (profileTitle.trim()) return profileTitle.trim();
        } catch {

        }
    }

    // 2) content-disposition: attachment;filename*=UTF-8''...
    if (contentDisposition) {
        try {
            const m1 = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
            if (m1 && m1[1]) {
                const name = decodeRFC5987(m1[1]).trim();
                if (name) return name;
            }

            const m2 = contentDisposition.match(/filename="?([^";]+)"?/i);
            if (m2 && m2[1] && m2[1].trim()) return m2[1].trim();
        } catch {

        }
    }

    // 3) profile-web-page-url 的二级域名
    if (webPageUrl) {
        try {
            const domain = new URL(webPageUrl).hostname.split('.')[0];
            if (domain) return domain.charAt(0).toUpperCase() + domain.slice(1);
        } catch {

        }
    }

    // 4) 订阅链接主域名兜底
    try {
        const host = new URL(subUrl).hostname.split('.')[0];
        if (host) return host.charAt(0).toUpperCase() + host.slice(1);
    } catch {

    }

    return '未知';
}

function detectProtocolType(url) {
    if (url.startsWith('ss://')) return 'Shadowsocks';
    if (url.startsWith('vmess://')) return 'VMess';
    if (url.startsWith('vless://')) return 'VLESS';
    if (url.startsWith('trojan://')) return 'Trojan';
    if (url.startsWith('hysteria2://') || url.startsWith('hy2://')) return 'Hysteria2';
    if (url.startsWith('hysteria://')) return 'Hysteria';
    if (url.startsWith('tuic://')) return 'TUIC';
    if (url.startsWith('wireguard://')) return 'WireGuard';
    if (url.startsWith('snell://')) return 'Snell';
    return null;
}

async function parseSubscriptionBodyInfo(response) {
    try {
        const bodyText = await response.text();
        if (!bodyText) return { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };

        let decoded = bodyText;
        try {
            decoded = atob(bodyText);
        } catch {

        }

        const lines = decoded.split(/\r?\n/).map(v => v.trim()).filter(Boolean);

        // 同时支持两类订阅：
        // 1) URI 行：ss:// / trojan:// / vless:// ...
        // 2) Clash YAML 行：- {name: "xx", type: ss, ...}
        const uriNodeLines = lines.filter(line => /^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !line.toLowerCase().startsWith('status='));
        const clashNodeLines = lines.filter(line => /^-\s*\{.*\bname\s*:\s*.+\btype\s*:\s*.+\}$/i.test(line));
        const nodeCount = uriNodeLines.length + clashNodeLines.length;

        if (nodeCount === 0) return { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };

        const protocolSet = new Set();
        const regionSet = new Set();
        const regionStats = {};

        for (const line of uriNodeLines) {
            const protocol = detectProtocolType(line);
            if (protocol) protocolSet.add(protocol);

            const nodeName = extractNodeNameFromLine(line);
            const region = detectRegionFromName(nodeName || line);
            if (region) {
                regionSet.add(region);
                regionStats[region] = (regionStats[region] || 0) + 1;
            }
        }

        for (const line of clashNodeLines) {
            const parsed = parseClashProxyLine(line);
            if (parsed.type) protocolSet.add(normalizeClashType(parsed.type));

            const region = detectRegionFromName(parsed.name || line);
            if (region) {
                regionSet.add(region);
                regionStats[region] = (regionStats[region] || 0) + 1;
            }
        }

        return {
            protocolTypes: Array.from(protocolSet),
            nodeCount,
            regions: sortRegions(Array.from(regionSet)),
            regionStats
        };
    } catch {
        return { protocolTypes: [], nodeCount: 0, regions: [], regionStats: {} };
    }
}

function parseClashProxyLine(line) {
    try {
        const nameMatch = line.match(/\bname\s*:\s*(?:"([^"]+)"|'([^']+)'|([^,}]+))/i);
        const typeMatch = line.match(/\btype\s*:\s*(?:"([^"]+)"|'([^']+)'|([^,}]+))/i);

        const rawName = (nameMatch?.[1] || nameMatch?.[2] || nameMatch?.[3] || '').trim();
        const rawType = (typeMatch?.[1] || typeMatch?.[2] || typeMatch?.[3] || '').trim();

        return {
            name: rawName,
            type: rawType.toLowerCase()
        };
    } catch {
        return { name: '', type: '' };
    }
}

function normalizeClashType(type) {
    if (!type) return '其他';

    const mapping = {
        ss: 'Shadowsocks',
        ssr: 'ShadowsocksR',
        vmess: 'VMess',
        vless: 'VLESS',
        trojan: 'Trojan',
        hysteria2: 'Hysteria2',
        hy2: 'Hysteria2',
        hysteria: 'Hysteria',
        tuic: 'TUIC',
        wireguard: 'WireGuard',
        snell: 'Snell',
        http: 'HTTP',
        socks5: 'SOCKS5',
        anytls: 'AnyTLS'
    };

    return mapping[type] || type.toUpperCase();
}

const REGION_RULES = [
    { region: '香港', keywords: ['香港', 'hk', 'hongkong'] },
    { region: '日本', keywords: ['日本', 'jp', 'japan', '东京', '大阪'] },
    { region: '美国', keywords: ['美国', 'us', 'usa', 'united states', '洛杉矶', '硅谷', '西雅图'] },
    { region: '新加坡', keywords: ['新加坡', 'sg', 'singapore'] },
    { region: '台湾', keywords: ['台湾', 'tw', 'taiwan', '台北'] },
    { region: '韩国', keywords: ['韩国', 'kr', 'korea', '首尔'] },
    { region: '英国', keywords: ['英国', 'uk', 'britain', 'london'] },
    { region: '德国', keywords: ['德国', 'de', 'germany', 'frankfurt'] },
    { region: '法国', keywords: ['法国', 'fr', 'france', 'paris'] },
    { region: '加拿大', keywords: ['加拿大', 'ca', 'canada', 'toronto', 'vancouver'] },
    { region: '澳大利亚', keywords: ['澳大利亚', 'au', 'australia', 'sydney', 'melbourne'] }
];

function detectRegionFromName(name) {
    if (!name) return null;
    const lower = name.toLowerCase();
    for (const rule of REGION_RULES) {
        if (rule.keywords.some(keyword => lower.includes(keyword))) {
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
        return a.localeCompare(b, 'zh-CN');
    });
}

function formatOutput(subUrl, info) {
    const used = info.upload + info.download;
    const remaining = Math.max(info.total - used, 0);
    const progress = info.total > 0 ? (used / info.total) * 100 : 0;
    const progressBar = generateProgressBar(progress);

    const usedGB = (used / (1024 ** 3)).toFixed(2);
    const totalGB = (info.total / (1024 ** 3)).toFixed(2);
    const remainingGB = (remaining / (1024 ** 3)).toFixed(2);

    const expireDateObj = new Date(info.expire * 1000);
    const expireDate = info.expire > 0
        ? expireDateObj.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
        : "未提供";

    const now = Date.now();
    const diffMs = info.expire * 1000 - now;
    const safeDiff = Math.max(diffMs, 0);
    const days = Math.floor(safeDiff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((safeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((safeDiff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((safeDiff % (1000 * 60)) / 1000);
    const remainingTime = info.expire > 0 ? `${days}天${hours}时${minutes}分${seconds}秒` : "未知";

    const protocolText = info.protocolTypes && info.protocolTypes.length > 0
        ? info.protocolTypes.join(', ')
        : '未知';

    const sortedRegions = info.regions && info.regions.length > 0 ? sortRegions(info.regions) : [];
    const regionCount = sortedRegions.length;
    const nodeLine = Number.isFinite(info.nodeCount) && info.nodeCount > 0
        ? `节点总数: ${info.nodeCount} | 国家/地区: ${regionCount}\n`
        : '';

    const coverageLine = regionCount > 0
        ? `覆盖范围: ${sortedRegions.join('、')}\n`
        : '';

    const regionStats = info.regionStats || {};
    const regionDistribution = sortedRegions
        .map(region => `${region} ${regionStats[region] || 0}`)
        .join('｜');
    const regionDistributionLine = regionDistribution
        ? `地区分布: ${regionDistribution}\n`
        : '';

    return `配置名称: ${info.configName}\n订阅链接: ${subUrl}\n流量详情: ${usedGB} GB / ${totalGB} GB\n使用进度: ${progressBar} ${progress.toFixed(1)}%\n剩余可用: ${remainingGB} GB\n协议类型: ${protocolText}\n${nodeLine}${coverageLine}${regionDistributionLine}过期时间: ${expireDate}${info.expire > 0 ? ` (剩余${days}天)` : ''}\n剩余时间: ${remainingTime}`;
}

function generateProgressBar(percentage) {
    const normalized = Math.min(Math.max(percentage, 0), 100);
    const totalBlocks = 11;
    const filled = Math.round((normalized / 100) * totalBlocks);
    return "[" + "■".repeat(filled) + "□".repeat(totalBlocks - filled) + "]";
}

async function sendLongMessage(token, chatId, text) {
    const maxLen = 3500; // 给 Telegram 留安全余量
    if (!text || text.length <= maxLen) {
        await sendMessage(token, chatId, escapeMarkdown(text || ''), 'MarkdownV2');
        return;
    }

    let start = 0;
    while (start < text.length) {
        let end = Math.min(start + maxLen, text.length);
        if (end < text.length) {
            const lastBreak = text.lastIndexOf('\n', end);
            if (lastBreak > start + 200) end = lastBreak;
        }
        const chunk = text.slice(start, end);
        await sendMessage(token, chatId, escapeMarkdown(chunk), 'MarkdownV2');
        start = end;
    }
}

async function sendMessage(token, chatId, text, parseMode = null) {
    if (!text) {
        console.error('发送文本为空');
        return;
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const body = { chat_id: chatId, text };
    if (parseMode) body.parse_mode = parseMode;
    try {
        const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) {
            const errData = await res.json();
            console.error('发送失败: ' + JSON.stringify(errData));
        }
    } catch (e) {
        console.error('发送异常: ' + e.message);
    }
}

async function answerInlineQuery(token, queryId, results) {
    const url = `https://api.telegram.org/bot${token}/answerInlineQuery`;
    const body = { inline_query_id: queryId, results };
    try {
        const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
        if (!res.ok) {
            console.error('内联响应失败: ' + res.status);
        }
    } catch (e) {
        console.error('内联异常: ' + e.message);
    }
}

let publicMode = false;

async function isPublicMode(env) {
    if (!env.BOT_USERID) {
        return true;
    }
    
    return publicMode;
}

async function setPublicMode(env, isPublic) {
    publicMode = isPublic;
}
