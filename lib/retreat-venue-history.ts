export const venueFeatureLabels = {
  worship: "예배·단체 모임 공간",
  groups: "단체·가족 객실",
  meals: "단체 식사",
  bbq: "바비큐",
  store: "편의점",
} as const;
export type VenueFeature = keyof typeof venueFeatureLabels;
export type RetreatVisit = { name: string; year: number; features: VenueFeature[] };
export type RetreatVenueCandidate = {
  name: string; address: string; website: string; features: VenueFeature[]; matched: VenueFeature[];
};
export type RetreatVenueReview = {
  history: RetreatVisit[]; candidates: RetreatVenueCandidate[];
};
export const venueHistoryQuery = "지난 수련회 장소와 비슷한 숙소 추천";
export const venueHistoryReplyAction = "retreat-venue-history";
export const needsVenueBarbecue = (query: string) => /바[비베]큐|BBQ|숯불/i.test(query);
export const venueGroupSize = (query: string) => {
  const requested = [...new Set([...query.matchAll(/(?:^|[^\d])([1-9]\d{0,3})\s*명\s*(?:이상|정도|분|숙박|이\s*묵)/g)].map(match => Number(match[1])))];
  return requested.length === 1 ? requested[0] : null;
};
export const isVenueHistoryChat = (value: string) =>
  /이전|과거|지난|전년도|작년|재작년|리포트|갔던|다녀온|비슷|이용\s*이력/.test(value)
  && /장소|숙소|수련원|리조트|연수원|갔던\s*곳|다녀온\s*곳|이용\s*이력/.test(value)
  && /추천|찾|비교|목록|리스트|어디|어땠|장점|이력|비슷|알려|보여/.test(value);

const normalized = (name: string) => name.normalize("NFKC").trim().replace(/\s+/g, " ");
export function reportPlaceName(value: string) {
  const name = normalized(value);
  return name.length >= 2 && name.length <= 120 && /^[\p{L}\p{N} ().·,&-]+$/u.test(name)
    && !/^(?:장소\s*)?(미정|미지정|협의\s*중|추후\s*공지|없음)$/.test(name) ? name : null;
}

const featuresFromReport: Record<VenueFeature, RegExp> = {
  worship: /예배실|성전|대강당/,
  groups: /단체실|가족실|다인실|[6-9]인실|\d{2}인실/,
  meals: /식사시간|식당|단체\s*식사/,
  bbq: /바[비베]큐|BBQ|그릴/i,
  store: /편의점|매점/,
};

export function extractReportVenue(report: string, name: string, year: number): VenueFeature[] | null {
  const lines = report.normalize("NFKC").split(/\r?\n/).map(line => line.trim().replace(/^[#>*\-]+\s*/, "").replaceAll("**", ""));
  const locations = [...new Set(lines.flatMap(line => {
    const place = /^(?:이용\s*장소|행사\s*장소|장소|숙소)\s*:\s*(.+)$/.exec(line)?.[1];
    return place ? [normalized(place)] : [];
  }))];
  const years = [...new Set(lines.flatMap(line => {
    const date = /^(?:이용일(?:시)?|행사일(?:시)?|일시|일정|기간)\s*:\s*((?:19|20)\d{2})(?:\s*년|[.\/-])/.exec(line)?.[1];
    return date ? [Number(date)] : [];
  }))];
  if (locations.length !== 1 || locations[0] !== reportPlaceName(name) || years.length !== 1 || years[0] !== year) return null;
  return (Object.keys(featuresFromReport) as VenueFeature[]).filter(key => lines.some(line =>
    !/불가|없(?:음|었)|안\s*됨|미정|예정|후보|확인\s*(?:필요|예정|중)|문의|여부|해야\s*함|하지\s*않/.test(line) && featuresFromReport[key].test(line)));
}

const catalog: Omit<RetreatVenueCandidate, "matched">[] = [
  { name: "서대산드림리조트", address: "충남 금산군 추부면 성당로 247", website: "https://sds-resort.co.kr/untitled-15", features: ["worship", "groups", "meals", "bbq"] },
  { name: "롯데리조트 부여", address: "충남 부여군 규암면 백제문로 400", website: "https://app.lottehotel.com/resort-buyeo/ko/dining/jung-gyung-ma-dang", features: ["worship", "groups", "meals", "bbq", "store"] },
  { name: "한화리조트 대천 파로스", address: "충남 보령시 해수욕장3길 11-10", website: "https://tour.chungnam.go.kr/prog/ldg/kor/sub02_04_02/view.do?ldgNo=99", features: ["groups", "bbq", "store"] },
];

export function compareRetreatVenues(history: readonly RetreatVisit[], query = ""): RetreatVenueCandidate[] {
  const latestYear = history.reduce((year, visit) => Math.max(year, visit.year), 0);
  const prior = new Set(history.filter(visit => visit.year === latestYear).flatMap(visit => visit.features));
  const identity = (name: string) => normalized(name).split("(")[0].replace(/\s/g, "");
  const bbqRequired = needsVenueBarbecue(query);
  return catalog.filter(place => (!bbqRequired || place.features.includes("bbq")) &&
      !history.some(visit => identity(visit.name) === identity(place.name)))
    .map(place => ({ ...place, matched: place.features.filter(feature => prior.has(feature)) }))
    .sort((left, right) => right.matched.length - left.matched.length);
}

export function isRetreatVenueReview(value: unknown): value is RetreatVenueReview {
  if (!value || typeof value !== "object") return false;
  const { history, candidates } = value as Record<string, unknown>;
  const features = (v: unknown): v is VenueFeature[] => Array.isArray(v) && v.length <= 5 && v.every(key => typeof key === "string" && Object.hasOwn(venueFeatureLabels, key));
  return Array.isArray(history) && history.length <= 100 && history.every(item => item && typeof item.name === "string"
    && reportPlaceName(item.name) === item.name && Number.isInteger(item.year) && item.year >= 1900 && item.year <= 2099 && features(item.features))
    && Array.isArray(candidates) && candidates.length <= catalog.length && candidates.every(item => item && features(item.matched) &&
      catalog.some(place => place.name === item.name && place.website === item.website && place.address === item.address
        && JSON.stringify(place.features) === JSON.stringify(item.features) && item.matched.every((feature: VenueFeature) => place.features.includes(feature))));
}
