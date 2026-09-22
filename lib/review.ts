export type Retention = "1d" | "1w" | "1m" | "never";

/** Offsets use JavaScript UTF-16 indices in the unchanged source / rendered block. */
export type SentenceAnchor = {
  blockStart: number;
  blockEnd: number;
  sentenceIndex: number;
  textStart: number;
  textEnd: number;
  exact: string;
  prefix: string;
  suffix: string;
};
export type Annotation = {
  id: string;
  blockId: string;
  sectionId?: string;
  anchor?: SentenceAnchor;
  quote: string;
  comment: string;
  createdAt: string;
};

export type ReviewRecord = {
  version: 1;
  id: string;
  filename: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  sourcePath: string;
  sourceExpiresAt: string | null;
  retention: Retention;
  /** v1 b-N ids are read compatibly; new saves use heading-based s-offset ids. */
  reviewedBlockIds: string[];
  annotations: Annotation[];
  editTokenHash: string;
};

export type PublicReview = Omit<ReviewRecord, "editTokenHash" | "sourcePath"> & {
  source: string | null;
  sourceAvailable: boolean;
};

export function expiryFor(retention: Retention, now = new Date()): string | null {
  if (retention === "never") return null;
  const ms = retention === "1d" ? 86_400_000 : retention === "1w" ? 604_800_000 : 2_592_000_000;
  return new Date(now.getTime() + ms).toISOString();
}
export function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now();
}
