// Browser-safe constants shared by server and web. No runtime server imports here.
export const TITLE_TYPES = ['movie', 'series'] as const;
export type TitleType = (typeof TITLE_TYPES)[number];

export const TITLE_STATUSES = ['to_watch', 'watched'] as const;
export type TitleStatus = (typeof TITLE_STATUSES)[number];
