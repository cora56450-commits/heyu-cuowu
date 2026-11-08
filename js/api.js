// OpenAI 兼容 /chat/completions 调用：流式 + 错误分类 + JSON 模式自动降级
import { getSettings, saveSettings } from './store.js?v=1794171497';
import { mockChat } from './mock.js?v=1794171497';

export class ApiError extends Error {
  constructor(kind, msg, detail) { super(msg); this.kind = kind; this.detail = detail; }
}
const MSG = {
  nokey: '还没有填 API Key。去「设置」里填一下。',
  auth: 'API Key 不对，或者没有权限（401/403）。检查一下设置。',
  balance: '余额不足（402）。去服务商那里充值后再试。',
  rate: '请求太频繁了（429），等一下再试。',
  server: '服务商那边出错了，稍后重试。',
  timeout: '等太久没有回应，超时了。',
  network: '连不上服务商。可能是网络问题，也可能是服务商不允许浏览器直接调用（跨域 / CORS）。可以在设置里换成你自己的代理地址。',
  format: '返回的内容格式不对。',
  bad: '请求被拒绝了（400）。可能是模型名写错了。',
};

function endpoint(base) {
  base = (base || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  return base + '/chat/completions';
}

/**
 * @param {object} o { messages, json=true, stream, onDelta(text, full), maxTokens, temperature, signal }
 * @returns {Promise<string>} 完整文本
 */
export async function chat(o) {
  const st = getSettings();
  if (st.mock) return mockChat(o);
  if (!st.apiKey) throw new ApiError('nokey', MSG.nokey);
  const stream = o.stream ?? st.stream;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), (st.timeout || 90) * 1000);
  const body = { model: st.model, messages: o.messages, temperature: o.temperature ?? 1.0, max_tokens: o.maxTokens || 1200, stream };
  const useJson = (o.json ?? true) && st.jsonMode;
  if (useJson) body.response_format = { type: 'json_object' };
  let res;
  try {
    res = await fetch(endpoint(st.baseUrl), {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + st.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.aborted) throw new ApiError('timeout', MSG.timeout);
    throw new ApiError('network', MSG.network, String(e));
  }
  if (!res.ok) {
    clearTimeout(timer);
    let detail = ''; try { detail = await res.text(); } catch {}
    // 有的服务商不支持 response_format：自动关掉 JSON 模式重试一次
    if (res.status === 400 && useJson && /response_format|json/i.test(detail)) {
      saveSettings({ ...st, jsonMode: false });
      return chat(o);
    }
    const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 402 ? 'balance' : res.status === 429 ? 'rate'
      : res.status >= 500 ? 'server' : res.status === 400 ? 'bad' : 'server';
    if (/insufficient|balance|余额/i.test(detail)) throw new ApiError('balance', MSG.balance, detail);
    throw new ApiError(kind, MSG[kind] + `（${res.status}）`, detail.slice(0, 300));
  }
  try {
    const ct = res.headers.get('content-type') || '';
    if (!stream || !res.body || ct.includes('application/json')) {
      const j = await res.json();
      const t = j?.choices?.[0]?.message?.content;
      if (typeof t !== 'string') throw new ApiError('format', MSG.format, JSON.stringify(j).slice(0, 300));
      o.onDelta?.(t, t);
      return t;
    }
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j?.choices?.[0]?.delta?.content || '';
          if (d) { full += d; o.onDelta?.(d, full); }
        } catch {}
      }
    }
    if (!full) throw new ApiError('format', MSG.format + '（空回复）');
    return full;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (ctrl.signal.aborted) throw new ApiError('timeout', MSG.timeout);
    throw new ApiError('network', MSG.network, String(e));
  } finally { clearTimeout(timer); }
}

// 测试连接
export async function testConnection() {
  const t = await chat({ messages: [{ role: 'system', content: '只输出 JSON。' }, { role: 'user', content: '输出 {"ok":true}' }], stream: false, maxTokens: 20 });
  return t;
}
