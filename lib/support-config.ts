const email = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ?? "";

export const supportConfig = {
  email: /^[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+$/i.test(email) && !/[?&#%]/.test(email) ? email : "",
} as const;
