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
                const messageText = update.message.text.trim();
                if (messageText === '/start') {
                    await sendMessage(botToken, update.message.chat.id, "欢迎使用订阅查询 Bot！请发送订阅链接 URL 以查询流量信息");
                    return new Response('OK');
                }
                if (!isValidUrl(messageText)) {
                    await sendMessage(botToken, update.message.chat.id, "无效的订阅链接！");
                    return new Response('OK');
                }
                const info = await querySubscription(messageText);
                const output = formatOutput(messageText, info);
                await sendMessage(botToken, update.message.chat.id, escapeMarkdown(output), 'MarkdownV2');
                return new Response('OK');
            } else if (update.inline_query && update.inline_query.query) {
                const subUrl = update.inline_query.query.trim();
                if (!isValidUrl(subUrl)) {
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
                    await sendMessage(botToken, update.message.chat.id, "不支持的消息类型！");
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

function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

async function querySubscription(subUrl) {
    try {
        const response = await fetch(subUrl, {
            method: "GET",
            headers: {
                "Accept": "*/*",
                "User-Agent": "Shadowrocket/2701 CFNetwork/3857.100.1 Darwin/25.0.0 iPhone14,4"
            },
            redirect: "manual"
        });

        if (!response.ok) {
            throw new Error(`请求失败，状态码: ${response.status}。解决方案: 确认链接可访问，无重定向问题。`);
        }

        let userinfo = response.headers.get("Subscription-Userinfo");
        let updateInterval = response.headers.get("profile-update-interval");
        let webPageUrl = response.headers.get("profile-web-page-url");

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
                        configName: "未知",
                        resetDays: 0
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

        let configName = "未知";
        if (webPageUrl) {
            try {
                const domain = new URL(webPageUrl).hostname.split(".")[0];
                configName = domain.charAt(0).toUpperCase() + domain.slice(1);
            } catch {
                configName = "未知 (网页 URL 解析失败)";
            }
        }

        const resetDays = updateInterval ? parseInt(updateInterval, 10) : 0;

        return { upload, download, total, expire, configName, resetDays };
    } catch (e) {
        throw new Error(`订阅查询失败: ${e.message}`);
    }
}

function formatOutput(subUrl, info) {
    const used = info.upload + info.download;
    const remaining = info.total - used;
    const progress = (used / info.total) * 100 || 0;
    const progressBar = generateProgressBar(progress);

    const usedGB = (used / (1024 ** 3)).toFixed(2);
    const totalGB = (info.total / (1024 ** 3)).toFixed(2);
    const remainingGB = (remaining / (1024 ** 3)).toFixed(2);

    const expireDate = new Date(info.expire * 1000).toISOString().replace("T", " ").replace(/\..+/, "");

    const now = Date.now();
    const diffMs = info.expire * 1000 - now;
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    const remainingTime = `${days}天${hours}时${minutes}分${seconds}秒`;

    return `配置名称: ${info.configName}\n订阅链接: ${subUrl}\n流量详情: ${usedGB} GB / ${totalGB} GB\n使用进度: ${progressBar} ${progress.toFixed(1)}%\n剩余可用: ${remainingGB} GB\n流量重置: ${info.resetDays}日\n过期时间: ${expireDate}\n剩余时间: ${remainingTime}`;
}

function generateProgressBar(percentage) {
    const filled = Math.round(percentage / 10);
    return "[" + "■".repeat(filled) + "□".repeat(11 - filled) + "]";
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