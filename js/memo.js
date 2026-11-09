// 手机备忘录（给ClaudeCode_备忘录_1109）：代码自动记玩家在剧情里已经听到的事，AI 不写。
// s.memo = [{ id, day, text, until?, at?, done? }]
//   until：过了这一天（s.day > until）就划掉；at：过了这个时段（day * 4 + slot）就划掉
// 划掉的变灰不删；超过 30 条只留最近 30 条。新条目不弹提示、不加红点。
export const MEMO_MAX = 30;

export function memoAdd(s, e) {
  s.memo ||= [];
  if (s.memo.some(x => x.id === e.id)) return false;
  s.memo.push({ day: s.day, ...e });
  if (s.memo.length > MEMO_MAX) s.memo = s.memo.slice(-MEMO_MAX);
  return true;
}
export function memoDone(s, id) {
  const m = (s.memo || []).find(x => x.id === id); if (m) m.done = true;
}
// 到期的划掉（每个时段开始、打开手机时跑一次）
export function memoTick(s) {
  const now = s.day * 4 + s.slot;
  for (const m of s.memo || []) if (!m.done && ((m.until != null && s.day > m.until) || (m.at != null && now > m.at))) m.done = true;
}
// 约定的条目 id（约定确认、兑现、被顶掉时用同一个）
export const apptMemoId = a => `appt_${a.day}_${a.slot}_${a.who}`;
