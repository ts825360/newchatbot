import { validDate } from "./room-timing";

export type ContinuationAction = "new" | "revise" | "supplement" | "reference" | "cancel" | "unknown";
export type EventWindow = { start: string; end: string };
type Interval = { start: string; end: string };
export type VisitBasis = { date: string | null; origin: "explicit" | "now" | "event" | "undecided"; eventDay?: number;
  range?: Interval; alternatives?: string[]; excluded?: string[] };

const dateMentions = /\b(\d{4})[.-](\d{1,2})[.-](\d{1,2})\b|(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일|모레|내일|오늘|(이번\s*주|다음\s*주|내주)?\s*([월화수목금토일])요일/g;
const excludedSuffix = /^\s*(?:(?:조식|아침|점심|석식|저녁|야식|오전|오후|밤)?\s*(?:\d{1,2}(?::\d{2}|\s*시(?:\s*(?:반|\d{1,2}\s*분))?))?\s*)?(?:(?:은|는|을|를|이|가)\s*)?(?:말고|아닌|제외(?:하고)?|빼고)/;

export function withoutExcludedDateContext(message: string) {
  const dates = [...message.matchAll(dateMentions)];
  return dates.reduceRight((copy, match, i) => {
    const end = match.index + match[0].length;
    const excluded = excludedSuffix.exec(message.slice(end, dates[i + 1]?.index));
    return excluded ? copy.slice(0, match.index) + " " + copy.slice(end + excluded[0].length) : copy;
  }, message);
}

export function resolveTemporalValues(message: string, mentions: { value: string; start: number; end: number }[]) {
  const excluded: string[] = [], included: typeof mentions = [];
  for (const [i, mention] of mentions.entries()) {
    const tail = message.slice(mention.end, mentions[i + 1]?.start);
    if (excludedSuffix.test(tail)) excluded.push(mention.value);
    else included.push(mention);
  }
  const values = [...new Set(included.map(item => item.value))].filter(value => !excluded.includes(value));
  if (values.length === 2 && /(?:부터|[~～–—]|\s-\s)/.test(message.slice(included[0].end, included[1].start))) {
    return { value: null, range: { start: values[0], end: values[1] }, excluded };
  }
  return { value: values.length === 1 ? values[0] : null, alternatives: values.length > 1 ? values : undefined, excluded };
}

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
  return "unknown";
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
  const explicit = [...message.matchAll(dateMentions)];
  if (explicit.length) {
    const mentions = explicit.slice(0, 8).map(match => {
      const word = match[0];
      const current = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
      const delta = match[8] ? "월화수목금토일".indexOf(match[8]) - current : 0;
      const value = match[8] ? addCalendarDays(today, !match[7] ? (delta + 7) % 7 : delta + (/다음|내주/.test(match[7]) ? 7 : 0))
        : match[2] || match[5] ? `${match[1] ?? match[4] ?? today.slice(0, 4)}-${(match[2] ?? match[5]).padStart(2, "0")}-${(match[3] ?? match[6]).padStart(2, "0")}`
          : addCalendarDays(today, word === "모레" ? 2 : word === "내일" ? 1 : 0);
      return { value, start: match.index, end: match.index + word.length };
    });
    if (explicit.length > 8 || mentions.some(({ value }) => !validDate(value))) return null;
    const { value, alternatives, range, excluded } = resolveTemporalValues(message, mentions);
    if (value && value < today || range && (range.start < today || range.end < range.start) || alternatives?.some(date => date < today)) return null;
    return { date: value, origin: "explicit", ...(alternatives && { alternatives }), ...(range && { range }), ...(excluded.length > 0 && { excluded }) };
  }
  if (/(?:지금|당장|바로)\s*(?:(?:당장|바로)\s*)?(?:갈|가서|먹|출발|방문|문\s*연|열린|영업)|(?:지금|현재)\s*(?:영업|열려|문\s*열)/.test(message)) return { date: today, origin: "now" };
  const ordinal = message.match(/(\d{1,2})\s*일\s*차/)?.[1];
  const requestedDay = /마지막\s*날/.test(message) ? -1 : /첫\s*(?:날|째\s*날)/.test(message) ? 1 : ordinal ? Number(ordinal) : undefined;
  if (requestedDay === undefined && /(?:주말|다음\s*주|내주|이번\s*주)/.test(message)) return { date: null, origin: "undecided" };
  const useSingleDayEvent = /(?:행사|수련회)\s*(?:당일|일정(?:을)?\s*기준)/.test(message) && event?.start === event?.end;
  const eventDay = requestedDay ?? (useSingleDayEvent ? 1 : previous?.eventDay);
  if (eventDay !== undefined) {
    const date = event && (eventDay === -1 ? event.end : eventDay >= 1 ? addCalendarDays(event.start, eventDay - 1) : null);
    return { date: date && event && date >= today && date <= event.end ? date : null, origin: "event", eventDay };
  }
  if (previous?.origin === "explicit") return (previous.date === null || previous.date >= today) && (!previous.range || previous.range.start >= today)
    && !previous.alternatives?.some(date => date < today) ? previous : { date: null, origin: "undecided" };
  if (previous?.origin === "now") return { date: today, origin: "now" };
  if (previous?.origin === "undecided") return previous;
  return { date: null, origin: "undecided" };
}
