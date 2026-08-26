export interface ExactRealSdarEvidenceResult {
  readonly status: "PASSED";
  readonly candidateSha: string;
  readonly sdarSourceSha: string;
  readonly smppSourceSha: string;
  readonly activeTasksCreated: 2;
  readonly requiredSkips: 0;
  readonly [key: string]: unknown;
}

export function assertExactRealSdarEvidence(options?: {
  readonly headSha?: string;
}): Promise<ExactRealSdarEvidenceResult>;
