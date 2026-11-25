export const assistantToneLabels = {
  standard: "기본",
  friendly: "친근한",
  direct: "직접적인",
} as const;

export const assistantLengthLabels = {
  brief: "간결하게",
  balanced: "보통",
  detailed: "자세하게",
} as const;

export const assistantEmojiLabels = {
  off: "사용 안 함",
  occasional: "가끔 사용",
} as const;

export type AssistantPreferences = {
  tone: keyof typeof assistantToneLabels;
  length: keyof typeof assistantLengthLabels;
  emoji: keyof typeof assistantEmojiLabels;
  instructions: string;
  instructionsEnabled: boolean;
};

export const maxAssistantInstructionsLength = 800;
export const defaultAssistantPreferences: AssistantPreferences = {
  tone: "standard", length: "balanced", emoji: "off", instructions: "", instructionsEnabled: false,
};

function hasStyle(item: Record<string, unknown>): item is Record<string, unknown> & Pick<AssistantPreferences, "tone" | "length"> {
  return typeof item.tone === "string" && Object.hasOwn(assistantToneLabels, item.tone) &&
    typeof item.length === "string" && Object.hasOwn(assistantLengthLabels, item.length);
}

function hasInstructions(item: Record<string, unknown>): item is Record<string, unknown> & Pick<AssistantPreferences, "instructions" | "instructionsEnabled"> {
  return typeof item.instructions === "string" && item.instructions.length <= maxAssistantInstructionsLength &&
    !item.instructions.includes("\0") && typeof item.instructionsEnabled === "boolean";
}

export function isAssistantPreferences(value: unknown): value is AssistantPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 5 && hasStyle(item) && hasInstructions(item) &&
    typeof item.emoji === "string" && Object.hasOwn(assistantEmojiLabels, item.emoji);
}

export function normalizeStoredAssistantPreferences(value: unknown): AssistantPreferences {
  if (isAssistantPreferences(value)) return value;
  const item = value as Record<string, unknown> | null;
  if (item && typeof item === "object" && !Array.isArray(item) && hasStyle(item)) {
    const base = { ...defaultAssistantPreferences, tone: item.tone, length: item.length };
    const count = Object.keys(item).length;
    if (count === 2) return base;
    if (count === 4 && hasInstructions(item)) return { ...base, instructions: item.instructions, instructionsEnabled: item.instructionsEnabled };
  }
  return defaultAssistantPreferences;
}
