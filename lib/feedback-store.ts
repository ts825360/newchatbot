export type FeedbackContext = { screenName: string; roomName?: string; width: number; height: number };
export const feedbackCategories = { answer: "답변 문제", screen: "화면 오류", other: "기타" } as const;
export type FeedbackCategory = keyof typeof feedbackCategories;
