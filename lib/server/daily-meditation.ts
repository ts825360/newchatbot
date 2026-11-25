import { createHash } from "node:crypto";
import type { DailyMeditation } from "../devotions";

// 성경전서 개역한글판, 대한성서공회. Keep the text as published in the linked verse.
const passages = [
  ["PSA.23.1", "시편 23:1", "여호와는 나의 목자시니 내가 부족함이 없으리로다"],
  ["MAT.11.28", "마태복음 11:28", "수고하고 무거운 짐진 자들아 다 내게로 오라 내가 너희를 쉬게 하리라"],
  ["PHP.4.6", "빌립보서 4:6", "아무 것도 염려하지 말고 오직 모든 일에 기도와 간구로, 너희 구할 것을 감사함으로 하나님께 아뢰라"],
  ["PRO.3.5", "잠언 3:5", "너는 마음을 다하여 여호와를 의뢰하고 네 명철을 의지하지 말라"],
  ["ROM.12.12", "로마서 12:12", "소망 중에 즐거워하며 환난 중에 참으며 기도에 항상 힘쓰며"],
  ["ISA.41.10", "이사야 41:10", "두려워 말라 내가 너와 함께 함이니라 놀라지 말라 나는 네 하나님이 됨이니라 내가 너를 굳세게 하리라 참으로 너를 도와 주리라 참으로 나의 의로운 오른손으로 너를 붙들리라"],
  ["LAM.3.23", "예레미야애가 3:23", "이것이 아침마다 새로우니 주의 성실이 크도소이다"],
  ["1TH.5.18", "데살로니가전서 5:18", "범사에 감사하라 이는 그리스도 예수 안에서 너희를 향하신 하나님의 뜻이니라"],
  ["PSA.46.10", "시편 46:10", "이르시기를 너희는 가만히 있어 내가 하나님 됨을 알찌어다 내가 열방과 세계 중에서 높임을 받으리라 하시도다"],
  ["MAT.6.34", "마태복음 6:34", "그러므로 내일 일을 위하여 염려하지 말라 내일 일은 내일 염려할 것이요 한 날 괴로움은 그 날에 족하니라"],
] as const;

function shuffled(cycle: number) {
  return passages.map(passage => ({ passage, rank: createHash("sha256").update(`${cycle}:${passage[0]}`).digest("hex") }))
    .sort((a, b) => a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)
    .map(({ passage }) => passage);
}

export function dailyMeditation(date: string): DailyMeditation {
  const day = Date.parse(`${date}T00:00:00Z`) / 86_400_000;
  const cycle = Math.floor(day / passages.length);
  const offset = day - cycle * passages.length;
  const order = shuffled(cycle);
  // The cycle boundary cannot repeat yesterday's verse; swapping leaves the last verse unchanged.
  if (offset < 2 && order[0] === shuffled(cycle - 1).at(-1)) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  const [id, reference, verse] = order[offset];
  return { date, reference, verse, url: `https://www.bible.com/ko/bible/88/${id}.KRV` };
}
