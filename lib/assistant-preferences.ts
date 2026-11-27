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
  frequency: "사용 빈도 조절",
} as const;

type AssistantStyle = {
  tone: keyof typeof assistantToneLabels;
  length: keyof typeof assistantLengthLabels;
  instructions: string;
  instructionsEnabled: boolean;
};

export type AssistantPreferences = AssistantStyle & (
  | { emoji: "off"; emojiFrequency?: never }
  | { emoji: "frequency"; emojiFrequency: number }
);

export const defaultAssistantEmojiFrequency = 50;
export function assistantEmojiIntensity(frequency: number): "minimal" | "occasional" | "frequent" {
  return frequency < 25 ? "minimal" : frequency < 75 ? "occasional" : "frequent";
}

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
  const count = Object.keys(item).length;
  return hasStyle(item) && hasInstructions(item) && (
    item.emoji === "off" && count === 5 && !Object.hasOwn(item, "emojiFrequency") ||
    item.emoji === "frequency" && count === 6 && typeof item.emojiFrequency === "number" &&
      Number.isInteger(item.emojiFrequency) && item.emojiFrequency >= 0 && item.emojiFrequency <= 100
  );
}

export function parseAssistantPreferences(value: unknown): AssistantPreferences | null {
  if (isAssistantPreferences(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (item.emoji !== "occasional" || Object.keys(item).length !== 5 || !hasStyle(item) || !hasInstructions(item)) return null;
  return { tone: item.tone, length: item.length, instructions: item.instructions, instructionsEnabled: item.instructionsEnabled,
    emoji: "frequency", emojiFrequency: defaultAssistantEmojiFrequency };
}

export function normalizeStoredAssistantPreferences(value: unknown): AssistantPreferences {
  const preferences = parseAssistantPreferences(value);
  if (preferences) return preferences;
  const item = value as Record<string, unknown> | null;
  if (item && typeof item === "object" && !Array.isArray(item) && hasStyle(item)) {
    const base = { ...defaultAssistantPreferences, tone: item.tone, length: item.length };
    const count = Object.keys(item).length;
    if (count === 2) return base;
    if (count === 4 && hasInstructions(item)) return { ...base, instructions: item.instructions, instructionsEnabled: item.instructionsEnabled };
  }
  return defaultAssistantPreferences;
}
