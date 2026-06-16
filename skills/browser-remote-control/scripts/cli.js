const net = require('net');
const fs = require('fs');
const path = require('path');

let SECRET_TOKEN = process.env.SEO_TOKEN || 'bridge-relay-secure-token-2026';
let PORT = parseInt(process.env.SEO_PORT || '9333', 10);

// 如果环境变量没设，尝试从配置文件读取
{
    try {
        const configPaths = [
            path.join(__dirname, '..', '..', '..', 'host', 'config.json'),
            path.join(__dirname, '..', '..', '..', 'native-host', 'config.json')
        ];
        const configPath = configPaths.find(p => fs.existsSync(p));
        if (configPath) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (SECRET_TOKEN === 'bridge-relay-secure-token-2026' && config.token) {
                SECRET_TOKEN = config.token;
            }
            if (!process.env.SEO_PORT && config.port) {
                PORT = parseInt(config.port, 10);
            }
        }
    } catch (e) {}
}

const rawArgs = process.argv.slice(2);

function printUsage() {
    console.log('Usage: node cli.js <method> [params_json|key=value...] [host] [port] [token]');
    console.log('   or: node cli.js <method> [params_json|key=value...] [host:port] [token]');
    console.log('   or: node cli.js --method <method> --params-file <file> [--host <host>] [--port <port>] [--token <token>]');
    console.log('   or: node cli.js <method> --stdin');
    console.log('   or: node cli.js <method> --params-base64 <base64-json>');
    console.log('   or: SEO_PARAMS=\'{"tabId":1}\' node cli.js <method>');
    console.log('Environment: SEO_TOKEN, SEO_PORT, SEO_PARAMS');
}

if (rawArgs.length < 1 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsage();
    process.exit(rawArgs.length < 1 ? 1 : 0);
}

function tryParseRelaxedJson(str) {
    const trimmed = str.trim();
    if (!trimmed) return {};

    // 1. 尝试标准 JSON 解析
    try {
        return JSON.parse(trimmed);
    } catch (e) {}

    // 2. 尝试 JavaScript 对象求值（处理单引号或未加引号的键）
    try {
        const fn = new Function(`return (${trimmed});`);
        const val = fn();
        if (val && typeof val === 'object') {
            return val;
        }
    } catch (e) {}

    // 3. 智能解析大括号或纯键值对格式（对 URL 查询参数有防误切设计）
    try {
        let content = trimmed;
        const isBraced = trimmed.startsWith('{') && trimmed.endsWith('}');
        if (isBraced) {
            content = trimmed.slice(1, -1).trim();
        }

        // 大括号内参数只能以逗号分隔；非大括号下支持逗号和 & 分隔，但有防 URL 查询参数误判机制
        const keyRegex = isBraced 
            ? /(?:^|,)\s*['"]?([a-zA-Z0-9_$]+)['"]?\s*[:=]/g 
            : /(?:^|[,&])\s*['"]?([a-zA-Z0-9_$]+)['"]?\s*[:=]/g;

        const matches = [];
        let match;
        while ((match = keyRegex.exec(content)) !== null) {
            const key = match[1].trim();
            const index = match.index;
            const length = match[0].length;

            // 避坑：如果不是大括号包裹，并且前一个键的值包含了 "?"（说明进入了 URL Query 区域），
            // 此时如果遇到以 & 开头的匹配（例如 &opt=1），则需要判定为 URL 参数，不当作主参数的键
            if (!isBraced && matches.length > 0) {
                const prev = matches[matches.length - 1];
                const prevValueStart = prev.index + prev.length;
                const betweenStr = content.slice(prevValueStart, index);
                if (betweenStr.includes('?') && match[0].trim().startsWith('&')) {
                    continue;
                }
            }

            matches.push({
                key,
                index,
                length: match[0].length
            });
        }

        if (matches.length > 0) {
            const params = {};
            for (let i = 0; i < matches.length; i++) {
                const current = matches[i];
                const next = matches[i + 1];
                const valueStart = current.index + current.length;
                const valueEnd = next ? next.index : content.length;
                
                let valStr = content.slice(valueStart, valueEnd).trim();
                valStr = valStr.replace(/^[,&]+|[,&]+$/g, '').trim();
                valStr = valStr.replace(/^['"]|['"]$/g, '').trim();
                
                let val = valStr;
                if (valStr === 'true') val = true;
                else if (valStr === 'false') val = false;
                else if (valStr === 'null') val = null;
                else if (valStr === 'undefined') val = undefined;
                else if (!isNaN(Number(valStr)) && valStr !== '') val = Number(valStr);
                
                params[current.key] = val;
            }
            return params;
        }
    } catch (e) {}

    // 4. 尝试修复未加引号的极简值（后备兜底）
    try {
        let cleaned = trimmed;
        if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
            cleaned = cleaned.replace(/'/g, '"');
            cleaned = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":');
            cleaned = cleaned.replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_\-$]*)\s*([,}])/g, ':"$1"$2');
            return JSON.parse(cleaned);
        }
    } catch (e) {}

    throw new Error("Could not parse parameters as JSON or Key-Value pairs.");
}

function isScriptMethod(name) {
    return ['evaluatescript', 'evaluate_script', 'evaluate', 'eval', 'evaluate_code'].includes(String(name || '').toLowerCase());
}

function decodeBase64Text(value) {
    let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    return Buffer.from(normalized, 'base64').toString('utf8');
}

function looksLikeKeyValue(value) {
    return /^[a-zA-Z0-9_$]+\s*[:=]/.test(String(value || '').trim());
}

function looksLikePort(value) {
    return /^\d+$/.test(String(value || '').trim());
}

function applyHostPort(value) {
    const raw = String(value || '').trim();
    if (!raw) return;

    const hostPort = raw.match(/^(.+):(\d+)$/);
    if (hostPort) {
        targetHost = hostPort[1] || '127.0.0.1';
        PORT = parseInt(hostPort[2], 10);
        return;
    }

    targetHost = raw;
}

function parseParamsFromText(text, sourceType, methodName) {
    const content = String(text || '');
    if (!content.trim()) return {};

    try {
        return tryParseRelaxedJson(content);
    } catch (e) {
        if (isScriptMethod(methodName) && sourceType !== 'literal-json') {
            return { script: content };
        }
        throw e;
    }
}

function resolveFileRefs(value) {
    if (Array.isArray(value)) {
        return value.map(resolveFileRefs);
    }

    if (value && typeof value === 'object') {
        for (const key of Object.keys(value)) {
            value[key] = resolveFileRefs(value[key]);
        }
        return value;
    }

    if (typeof value === 'string' && value.startsWith('@')) {
        const refPath = path.resolve(value.substring(1));
        if (fs.existsSync(refPath)) {
            return fs.readFileSync(refPath, 'utf8');
        }
    }

    return value;
}

function readParamsSource(source, methodName) {
    if (!source) return {};

    if (source.type === 'file') {
        const filePath = path.resolve(source.value);
        if (!fs.existsSync(filePath)) {
            console.error(`Error: Parameter file does not exist: ${filePath}`);
            process.exit(1);
        }
        return parseParamsFromText(fs.readFileSync(filePath, 'utf8'), 'file', methodName);
    }

    if (source.type === 'stdin') {
        return parseParamsFromText(fs.readFileSync(0, 'utf8'), 'stdin', methodName);
    }

    if (source.type === 'base64') {
        return parseParamsFromText(decodeBase64Text(source.value), 'base64', methodName);
    }

    if (source.type === 'env') {
        const envValue = process.env[source.value];
        if (envValue === undefined) {
            console.error(`Error: Environment variable ${source.value} is not set`);
            process.exit(1);
        }
        return parseParamsFromText(envValue, 'env', methodName);
    }

    return parseParamsFromText(source.value, source.type || 'literal-json', methodName);
}

let method = null;
let paramsSource = null;
let targetHost = '127.0.0.1';
let explicitHost = false;
let explicitPort = false;
let explicitToken = false;
const positional = [];

for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];

    const readNext = (optionName) => {
        if (i + 1 >= rawArgs.length) {
            console.error(`Missing value for ${optionName}`);
            process.exit(1);
        }
        return rawArgs[++i];
    };

    if (arg === '--') {
        positional.push(...rawArgs.slice(i + 1));
        break;
    } else if (arg === '--method' || arg === '-m') {
        method = readNext(arg);
    } else if (arg === '--params' || arg === '-p') {
        paramsSource = { type: 'literal-json', value: readNext(arg) };
    } else if (arg === '--params-file' || arg === '--file' || arg === '-f') {
        paramsSource = { type: 'file', value: readNext(arg) };
    } else if (arg === '--stdin' || arg === '--params-stdin') {
        paramsSource = { type: 'stdin' };
    } else if (arg === '--params-base64' || arg === '--base64') {
        paramsSource = { type: 'base64', value: readNext(arg) };
    } else if (arg === '--params-env' || arg === '--env') {
        paramsSource = { type: 'env', value: readNext(arg) };
    } else if (arg === '--host') {
        applyHostPort(readNext(arg));
        explicitHost = true;
    } else if (arg === '--port') {
        PORT = parseInt(readNext(arg), 10);
        explicitPort = true;
    } else if (arg === '--token') {
        SECRET_TOKEN = readNext(arg);
        explicitToken = true;
    } else if (!method) {
        method = arg;
    } else {
        positional.push(arg);
    }
}

if (!method) {
    printUsage();
    process.exit(1);
}

let params = {};

let consumedPositionals = 0;
if (!paramsSource && positional.length > 0) {
    if (positional[0] === '{}') {
        consumedPositionals = 1;
    } else if (positional[0].startsWith('@')) {
        paramsSource = { type: 'file', value: positional[0].substring(1) };
        consumedPositionals = 1;
    } else if (looksLikeKeyValue(positional[0])) {
        const parts = [];
        while (consumedPositionals < positional.length && looksLikeKeyValue(positional[consumedPositionals])) {
            parts.push(positional[consumedPositionals]);
            consumedPositionals++;
        }
        paramsSource = { type: 'literal-json', value: parts.join(',') };
    } else {
        paramsSource = { type: 'literal-json', value: positional[0] };
        consumedPositionals = 1;
    }
}

if (!paramsSource && process.env.SEO_PARAMS) {
    paramsSource = { type: 'env', value: 'SEO_PARAMS' };
}

try {
    params = resolveFileRefs(readParamsSource(paramsSource, method));
} catch (e) {
    console.error('Invalid params:', e.message);
    process.exit(1);
}

const legacyTail = positional.slice(consumedPositionals);
if (legacyTail[0] && !explicitHost) {
    applyHostPort(legacyTail[0]);
    const hostHadPort = /^(.+):(\d+)$/.test(String(legacyTail[0]).trim());

    if (hostHadPort) {
        if (legacyTail[1] && !explicitToken) {
            SECRET_TOKEN = legacyTail[1];
        }
    } else {
        if (legacyTail[1] && looksLikePort(legacyTail[1]) && !explicitPort) {
            PORT = parseInt(legacyTail[1], 10);
            if (legacyTail[2] && !explicitToken) {
                SECRET_TOKEN = legacyTail[2];
            }
        } else if (legacyTail[1] && !explicitToken) {
            SECRET_TOKEN = legacyTail[1];
        }
    }
} else if (legacyTail[0] && !explicitPort && looksLikePort(legacyTail[0])) {
    PORT = parseInt(legacyTail[0], 10);
    if (legacyTail[1] && !explicitToken) {
        SECRET_TOKEN = legacyTail[1];
    }
}

if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
    console.error(`Invalid port: ${PORT}`);
    process.exit(1);
}

const client = new net.Socket();
let authenticated = false;
let responseBuffer = ''; // 用于处理分包数据

client.connect(PORT, targetHost, () => {
    client.write(SECRET_TOKEN);
});

client.on('data', (data) => {
    const raw = data.toString();
    
    if (!authenticated) {
        try {
            const res = JSON.parse(raw);
            if (res.status === 'authenticated') {
                authenticated = true;
                const request = {
                    jsonrpc: "2.0",
                    id: Date.now(),
                    method: method,
                    params: params
                };
                client.write(JSON.stringify(request) + '\n');
            }
        } catch (e) {
            console.error('Auth response error:', raw);
            client.destroy();
        }
        return;
    }

    // 将收到的数据追加到缓冲区
    responseBuffer += raw;

    // 处理缓冲区中所有完整的 JSON 行
    let boundary;
    while ((boundary = responseBuffer.indexOf('\n')) !== -1) {
        const line = responseBuffer.slice(0, boundary).trim();
        responseBuffer = responseBuffer.slice(boundary + 1);

        if (!line) continue;

        try {
            const res = JSON.parse(line);
            // 只有当收到对应请求 ID 的结果时才关闭
            if (res.id || res.error) {
                console.log(JSON.stringify(res, null, 2));
                // 清除超时定时器，防止 Node.js 事件循环挂起
                clearTimeout(timeoutId);
                // 延迟一小会儿再关闭，给 TCP 缓冲区留出呼吸时间并正常退出进程
                setTimeout(() => {
                    client.destroy();
                    process.exit(0);
                }, 100);
            } else {
                console.log('--- Event ---');
                console.log(JSON.stringify(res, null, 2));
            }
        } catch (e) {
            // 如果解析失败，可能是数据还没接收完（虽然有换行符了），先保留
            console.error('JSON Parse Error on line:', line.substring(0, 100));
        }
    }
});

client.on('error', (err) => {
    // 忽略主动断开导致的重置
    if (err.code !== 'ECONNRESET') {
        console.error('Connection Error:', err.message);
    }
});

// 设置 120 秒超时并保存 ID 供清理 (部分复杂发布脚本耗时较长)
const timeoutId = setTimeout(() => {
    if (!client.destroyed) {
        console.error('Request timed out after 120s');
        client.destroy();
        process.exit(1);
    }
}, 120000);
