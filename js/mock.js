// 离线测试模式：不调用 AI，用固定模板跑通流程（设置里打开）
const pick = a => a[Math.floor(Math.random() * a.length)];
const HE_LINES = ['嗯。', '又摔了？……坐好。', '你随时能走。', '药凉了。', '……没什么。', '线头。别动，我剪掉。', '胃很软的，比你想的软。……你少吃凉的。'];
const NARR = ['风从溪那边吹过来。', '远处有人在叫「小河」。', '他把你碰歪的碗摆正了。', '桃花落了一片，四瓣的。'];
const SUGG = ['帮他晒药草', '问他在缝什么', '去井边打水', '坐在门槛上发呆', '跟养母聊天', '看牠写字'];
const TAGS = ['亲近', '温柔回应', '冷淡', '提到外面', '参与村里的事', '', ''];

export async function mockChat(o) {
  const sys = o.messages[0]?.content || '';
  let out;
  if (sys.includes('"messages"')) out = { messages: [{ text: '你睡了。', hours_ago: 20 }, { text: '水我换过了', hours_ago: 9 }, { text: '。', hours_ago: 2 }] };
  else if (sys.includes('"replies"')) out = { replies: [pick(HE_LINES), '（测试模式）'] };
  else if (sys.includes('"summary"') && !sys.includes('"lines"')) out = { summary: '（测试模式摘要）你在村子里住了一段时间。' };
  else {
    const meta = sys.includes('本轮允许河说');
    const garble = sys.includes('<乱>');
    const lines = [{ speaker: 'narration', text: pick(NARR) }, { speaker: '河', expr: pick(['normal', 'smile', 'pout', 'aloof']), text: pick(HE_LINES) }];
    if (meta) lines.push({ speaker: '河', expr: 'blank', text: '你刚才睡了好久。' });
    if (garble) lines.push({ speaker: '河', expr: 'dazed', text: '……<乱>你睡着的时候我数过你的心跳</乱>' });
    lines.push({ speaker: 'narration', text: '（测试模式：没有调用 AI）' });
    const lastUser = [...o.messages].reverse().find(m => m.role === 'user')?.content || '';
    var appointment = /约/.test(lastUser) ? { who: '河', day: '明天', slot: '上午', place: '溪边' } : null;
    const t = pick(TAGS);
    const free = lastUser.match(/（玩家自己输入的）(.*)/);   // 测试模式：自己写的行动按空格数件数，规模固定 small，方便看扣点
    out = { lines, tags: t ? [t] : [], action_size: free ? 'small' : pick(['small', 'medium', 'large']), action_count: free ? free[1].trim().split(/\s+/).length : 1, suggestions: [0, 1, 2].map(() => ({ text: pick(SUGG), cost: 1 + Math.floor(Math.random() * 3) })), he_flags: [], appointment, cg: null };
  }
  if (globalThis.__mockNext) { out = globalThis.__mockNext; globalThis.__mockNext = null; }   // 测试用：指定下一次 AI 返回什么
  const s = typeof out === 'string' ? out : JSON.stringify(out);   // 字符串原样返回（测坏格式用）
  let full = '';
  for (let i = 0; i < s.length; i += 12) { full += s.slice(i, i + 12); o.onDelta?.(s.slice(i, i + 12), full); await new Promise(r => setTimeout(r, 15)); }
  return s;
}
