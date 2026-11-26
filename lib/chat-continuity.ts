import { validDate } from "./room-timing";

export type ContinuationAction = "new" | "revise" | "supplement" | "reference" | "cancel";
export type EventWindow = { start: string; end: string };
export type VisitBasis = { date: string | null; origin: "explicit" | "now" | "event" | "undecided"; eventDay?: number };

export function requestOnlyConditions(message: string) {
  return /이번\s*만|(?:이번|이)\s*(?:요청|질문|검색|비교|계산|답변)(?:에서|에)?\s*만/.test(message);
}

export function applyConditionPatch<T extends object>(previous: T, patch: Partial<T>): T {
  return { ...previous, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) };
}

export function classifyContinuation(input: string): ContinuationAction {
  const text = input.normalize("NFKC").trim();
  if (/^(?:(?:이(?:전)?|그|지금|방금|아까|진행\s*중인)\s*)?(?:(?:요청|작업|검색|추천|계획|건)(?:은|는|을|를)?\s*)?(?:취소(?:해(?:줘|주세요)?|할래|하자)?|그만(?:해(?:줘|주세요)?|할래|하자)?|중단(?:해(?:줘|주세요)?|하자)?|됐어)[.!?\s]*$/.test(text)) return "cancel";
  if (/^(?:새(?:로운)?\s*(?:질문|요청|주제)|다른\s*(?:질문|주제)|이제\s+[^\n]{1,36}부터)/.test(text)) return "new";
  if (/(?:나머지|다른\s*조건)은?\s*그대로|다시\s*(?:계산|추천|찾|비교|짜|검토|해)|(?:으?로|만)\s*(?:바꿔|바꾸|수정|변경)|(?:만|는|은|를|을)\s*(?:빼고|제외|추가)|(?:기준|조건)(?:을|을\s*)?\s*(?:바꿔|수정|변경)/.test(text)) return "revise";
  if (/(?:그중|그\s*중|그것|그걸|이걸|그거|그\s*(?:안|곳|일정|후보)(?:을|를|은|는|에|만|도|이\s|\s|$)|앞(?:서|의)|이전\s*(?:추천|답변|후보)|아까|방금(?:\s+(?:말|추천|제안|답변))|(?:\d+\s*번|첫\s*번|두\s*번|세\s*번)\s*(?:째|안|후보|항목|만|을|이|으로|부터|의))/.test(text)) return "reference";
  if (/^(?:(?:좀|더|조금)\s*)*(?:구체화해|이어\s*가|계속해|자세히\s*(?:알려|설명))/.test(text)) return "reference";
  if (/^(?:(?:참고로|추가로)\s*)?(?:인원|예산|비용|장소|주소|숙소|날짜|일정|시간|출발|귀가|제외\s*조건)(?:은|는|이|가|:)(?:\s*[^\n]{1,100})$/.test(text)) return "supplement";
  if (/^\s*(?:\d{1,3}\s*명|\d{1,3}\s*만\s*원|내일\s*(?:아침|점심|저녁)|도보|차량)(?:\s*(?:기준|으로|이야|입니다|요))*[.!?\s]*$/.test(text)) return "supplement";
  return "new";
}

export function contextOrdinal(message: string) {
  const number = message.match(/(\d{1,2})\s*번(?!\s*차량)/)?.[1];
  if (number) return Number(number);
  const named = message.match(/(첫|두|세|네)\s*번째/)?.[1];
  return named ? ["첫", "두", "세", "네"].indexOf(named) + 1 : undefined;
}

export const addCalendarDays = (date: string, offset: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

export function resolveVisitBasis(message: string, event: EventWindow | undefined, today: string, previous?: VisitBasis): VisitBasis | null {
  const undecided = /(?:날짜|일정|방문일)(?:은|는|이|가)?\s*(?:아직\s*)?(?:미정|정하지\s*않|안\s*정)/.test(message);
  if (undecided) return { date: null, origin: "undecided" };
  const absolute = message.match(/\b(\d{4})[.-](\d{1,2})[.-](\d{1,2})\b/) ?? message.match(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  const relative = message.match(/모레|내일|오늘/)?.[0];
  if (absolute) {
    const date = `${absolute[1] ?? today.slice(0, 4)}-${absolute[2].padStart(2, "0")}-${absolute[3].padStart(2, "0")}`;
    return validDate(date) && date >= today ? { date, origin: "explicit" } : null;
  }
  if (relative) return { date: addCalendarDays(today, relative === "모레" ? 2 : relative === "내일" ? 1 : 0), origin: "explicit" };
  if (/(?:지금|당장|바로)\s*(?:(?:당장|바로)\s*)?(?:갈|먹|출발|방문|문\s*연|열린|영업)|(?:지금|현재)\s*(?:영업|열려|문\s*열)/.test(message)) return { date: today, origin: "now" };
  const weekday = message.match(/(이번\s*주|다음\s*주|내주)?\s*([월화수목금토일])요일/);
  if (weekday) {
    const current = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const difference = "월화수목금토일".indexOf(weekday[2]) - current;
    const offset = !weekday[1] ? (difference + 7) % 7 : difference + (/다음|내주/.test(weekday[1]) ? 7 : 0);
    return offset < 0 ? null : { date: addCalendarDays(today, offset), origin: "explicit" };
  }
  const ordinal = message.match(/(\d{1,2})\s*일\s*차/)?.[1];
  const requestedDay = /마지막\s*날/.test(message) ? -1 : /첫\s*(?:날|째\s*날)/.test(message) ? 1 : ordinal ? Number(ordinal) : undefined;
  if (requestedDay === undefined && /(?:주말|다음\s*주|내주|이번\s*주)/.test(message)) return { date: null, origin: "undecided" };
  const useSingleDayEvent = /(?:행사|수련회)\s*(?:당일|일정(?:을)?\s*기준)/.test(message) && event?.start === event?.end;
  const eventDay = requestedDay ?? (useSingleDayEvent ? 1 : previous?.eventDay);
  if (eventDay !== undefined) {
    const date = event && (eventDay === -1 ? event.end : eventDay >= 1 ? addCalendarDays(event.start, eventDay - 1) : null);
    return { date: date && event && date >= today && date <= event.end ? date : null, origin: "event", eventDay };
  }
  if (previous?.origin === "explicit") return previous.date && previous.date >= today ? previous : { date: null, origin: "undecided" };
  if (previous?.origin === "now") return { date: today, origin: "now" };
  if (previous?.origin === "undecided") return previous;
  return { date: null, origin: "undecided" };
}
