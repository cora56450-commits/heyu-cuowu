// 村里人：隐藏好感三档（NPC隐藏好感三档_初稿_1111）+ 村里人也知道（中期与吃醋 1111 §四）
import { LOCATIONS } from './config/world.js?v=1794428964';
import { NPC_TIERS, npcTier, pickBits } from './config/lore.js?v=1794428964';
import { knows } from './state.js?v=1794428964';

export const NPC_LIST = ['养母', '满', '芳', '石', '衡'];
const SPEAKER = { 石: '村民·男', 芳: '村民·女', 养母: '养母', 满: '满', 衡: '衡' };
const TIER_NAME = ['生', '熟', '亲'];
const DAY_CAP = 10;   // 每人每天最多 +10

// 好感加减（0–100，隐藏；调试面板能看）
export function favAdd(s, who, n) {
  if (!NPC_LIST.includes(who) || !n) return;
  const F = (s.c.npcFav ||= {});
  if (n > 0) {
    const D = s.c.favDay?.day === s.day ? s.c.favDay : (s.c.favDay = { day: s.day, add: {} });
    n = Math.min(n, DAY_CAP - (D.add[who] || 0)); if (n <= 0) return;
    D.add[who] = (D.add[who] || 0) + n;
  }
  F[who] = Math.max(0, Math.min(100, (F[who] || 0) + n));
}
export const favOf = (s, who) => s.c.npcFav?.[who] || 0;
export function favText(s) { return NPC_LIST.map(n => `${n}${favOf(s, n)}`).join(' '); }

// 行动里点名了这个人（单字名要有上下文，免得「石头」「满地」算进去）
const NAMED = {
  养母: /养母|婶/, 衡: /衡|村长/, 芳: /芳/,
  石: /石(?![头板阶子块桥凳缝墙碑灰磨榴])/, 满: /满(?![地了意足脸身月天山屋院头是])/,
};
const HELP = /帮|替|陪|给.{0,8}(干|搭|递|送|拿|收|晒|翻|洗|编|补|做)|搭把手/;

// 一轮 AI 写完之后：按这一轮的标签 / 玩家行动给在场的人加减好感，记下「上次和你做过什么」
export function npcAfterTurn(s, req, tags, present = []) {
  const here = (present || []).filter(n => NPC_LIST.includes(n));
  if (!here.length) return;
  const text = String(req.text || '');
  for (const n of here) {
    const named = NAMED[n].test(text);
    if (tags.includes('亲近') || tags.includes('参与村里的事')) favAdd(s, n, 3);
    if (named && HELP.test(text)) favAdd(s, n, 5);
    if ((tags.includes('冷淡') || tags.includes('拒绝')) && (named || here.length === 1)) favAdd(s, n, -5);
    if (req.kind === 'action' && text && (named || here.length === 1 || (here.length === 2 && here.includes('养母') && n !== '养母')))
      (s.c.npcLast ||= {})[n] = `第 ${s.day} 天在${LOCATIONS[s.loc]?.name || ''}，「你」${[...text.replace(/^[我你]/, '')].slice(0, 20).join('')}`;
  }
}

// 给 AI：在场的每个人的档位、这一轮的小行为（池子挑 2 条）、上次和「你」做过什么
export function npcBlock(s, present = []) {
  const here = (present || []).filter(n => NPC_LIST.includes(n));
  if (!here.length) return '';
  const L = here.map(n => {
    const t = npcTier(favOf(s, n)), T = NPC_TIERS[n][t];
    const last = s.c.npcLast?.[n];
    return `- ${n}（${TIER_NAME[t]}）：${T.tone.replace(/^[生熟亲]：/, '')}这一轮可以从这里挑一两样（不用全写）：${pickBits(s, 'npc_' + n, T.bits).join('；')}。${last ? `上次：${last}。` : ''}`;
  });
  const known = here.filter(n => knows(s, SPEAKER[n]));
  const greet = here.filter(n => npcTier(favOf(s, n)) >= 1);
  return `# 村里人对「你」（隐藏的好感，只体现在样子上，不要说出来）
${L.join('\n')}${known.length ? `\n- 「你」认识${known.join('、')}：旁白里写名字（${known.join('、')}），不要再写「一个女人」「小女孩」「一个男人」。` : ''}${greet.length ? `\n- ${greet.join('、')}跟「你」熟了：见到「你」先打招呼，叫「你」的名字或称呼。` : ''}`;
}

// ———— 村里人也知道（§四）————
// 知情表：村子小，大事大家都知道，但不当着河的面说
export function villageKnowRule(s, present = [], heHere = false) {
  const here = (present || []).filter(n => NPC_LIST.includes(n));
  if (!here.length) return null;
  const done = id => (s.done || []).includes(id);
  const inj = done('d18_injury'), hurt = (s.c.taHurt || 0) > 0, night = done('he_first') || done('ta_first');
  const facts = n => {
    const F = [];
    if (n === '养母' || n === '芳') { if (inj) F.push('「你」第 18 天受过伤，是小河缝的'); if (hurt) F.push('「你」被牠伤过'); if (night) F.push(done('he_first') ? '「你」和小河过了夜' : '「你」在牠那里过了夜'); }
    else if (n === '满') { if (inj || hurt) F.push('「你」受过伤'); }
    else if (n === '石') { if (inj) F.push('「你」第 18 天受过伤'); }
    return F;
  };
  const L = here.map(n => [n, facts(n)]).filter(([, F]) => F.length).map(([n, F]) => `${n}知道：${F.join('、')}`);
  if (!L.length) return null;
  return `村子小，大事大家都知道。${L.join('；')}。知道的人会用自己的方式提一句（养母管饭、芳嘴碎、满关心），不追问细节${heHere ? '；但河在这里，谁都不提这些' : ''}。`;
}

// 下一次碰见时代码先播的几句（被牠伤到 / 两段第一次之后）
const FANG = l => ({ speaker: '村民·女', name: '芳', text: l });
const KNOW_LINES = {
  o5_mother: [{ speaker: 'narration', text: '养母看见你的手，什么都没问，去屋里拿了药膏。' }, { speaker: '养母', text: '牠那儿……少去。' }],
  o6_mother: [{ speaker: 'narration', text: '养母拿了剪子，把你另一边的头发也剪短了一点。' }, { speaker: '养母', text: '剪齐了，就看不出来。' }],
  o5_fang: [FANG('你那手……是牠吧。我奶奶说，牠犯病的时候，连自己都缝。')],
  hurt_man: [{ speaker: '满', text: '你疼不疼？……我吹吹。' }],
  he_first_mother: [{ speaker: 'narration', text: '养母给你多盛了一碗饭，上面卧了个鸡蛋。她没看你。' }, { speaker: '养母', text: '……他从小就闷。你多担待。' }],
  ta_first_mother: [{ speaker: '养母', text: '昨晚没回来。' }, { speaker: 'narration', text: '她往牠屋子那边看了一眼。' }, { speaker: '养母', text: '那地方的东西，别往身上带。' }],
};
export function queueKnow(s, key, who, from, until) { (s.c.knowQ ||= []).push({ key, who, from, until }); }
// O5 / O6 被牠伤到之后排队
export function queueHurt(s, evId) {
  const d = s.day;
  if (evId === 'o5_needle') { queueKnow(s, 'o5_mother', '养母', d, d + 1); queueKnow(s, 'o5_fang', '芳', d, d + 5); }
  if (evId === 'o6_scissors') queueKnow(s, 'o6_mother', '养母', d, d + 1);
  if (evId === 'o5_needle' || evId === 'o6_scissors') queueKnow(s, 'hurt_man', '满', d, d + 5);
}
// 到达时：在场、河不在这里，就把排着的那几句拿出来（一次只播一个人的）
export function takeKnow(s, present, heHere) {
  const Q = (s.c.knowQ || []).filter(q => s.day <= q.until);
  s.c.knowQ = Q;
  if (heHere) return null;
  const q = Q.find(x => s.day >= x.from && present.includes(x.who));
  if (!q) return null;
  s.c.knowQ = Q.filter(x => x !== q);
  return { who: q.who, lines: KNOW_LINES[q.key] || [] };
}
