const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');

// 代理队列：存储域名到代理实例的映射 { 域名: 代理实例 }
const proxyQueue = new Map();

// 创建新代理实例的工厂函数
function createProxyInstance(target) {
    const proxy = httpProxy.createProxyServer({
        target,
        changeOrigin: true,
        secure: false,
        timeout: 15000
    });

    // 单个代理实例的错误处理（修正模板字符串语法）
    proxy.on('error', (err) => {
        console.error(`[${target}] 代理错误:`, err.message); // 用反引号包裹字符串
    });

    return proxy;
}

// 从URL中提取域名（用于作为代理队列的key）
function getDomainFromUrl(urlStr) {
    try {
        const urlObj = new URL(urlStr);
        return `${urlObj.protocol}//${urlObj.host}`; // 包含协议和域名（如https://xxx.com）
    } catch (e) {
        console.error('解析域名失败:', e);
        return null;
    }
}

// 创建HTTP服务器
const server = http.createServer((req, res) => {
    // 添加CORS头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type');

    // 处理OPTIONS预检请求
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // 解析请求URL中的目标地址
    const parsedReq = url.parse(req.url, true);
    const targetUrl = parsedReq.query.url;

    if (!targetUrl) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('请通过 ?url= 参数指定目标URL（如 http://localhost:3000/?url=https://xxx.com/image.jpg）');
        return;
    }

    // 提取目标域名作为代理队列的key
    const targetDomain = getDomainFromUrl(targetUrl);
    if (!targetDomain) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('无效的目标URL格式');
        return;
    }

    // 检查代理队列中是否已有该域名的代理实例
    if (!proxyQueue.has(targetDomain)) {
        // 新域名：创建代理实例并加入队列
        const newProxy = createProxyInstance(targetDomain);
        proxyQueue.set(targetDomain, newProxy);
        console.log(`[代理队列] 新增域名代理: ${targetDomain}（当前队列长度: ${proxyQueue.size}）`);
    }

    // 获取对应域名的代理实例并转发请求
    const proxy = proxyQueue.get(targetDomain);
    
    // 修正请求路径（只保留目标URL的路径部分，去掉域名）
    const targetPath = new URL(targetUrl).pathname + new URL(targetUrl).search;
    req.url = targetPath; // 重写请求路径为目标的路径部分

    // 转发请求
    proxy.web(req, res, (err) => {
        // 转发失败时的处理（修正模板字符串语法）
        console.error(`[${targetDomain}] 转发失败:`, err.message); // 用反引号包裹字符串
        if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('代理转发失败，请检查目标URL是否有效');
        }
    });
});

// 启动服务器
const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`动态代理服务器启动成功，监听 http://0.0.0.0:${PORT}`);
    console.log('支持自动为新域名创建代理，当前代理队列初始为空');
});

// 监听服务器关闭事件，清理代理实例
server.on('close', () => {
    proxyQueue.forEach((proxy, domain) => {
        proxy.close();
        console.log(`[代理队列] 关闭域名代理: ${domain}`);
    });
    proxyQueue.clear();
});
