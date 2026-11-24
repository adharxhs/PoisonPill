// Wire contract v1. Field names and values mirror `engine/src/model.rs`
// exactly; see docs/CONTRACT.md. snake_case is deliberate.

export type Modality = 'obligation' | 'permission' | 'prohibition' | 'waiver';

export type InversionShape =
  | 'none'
  | 'inverted'
  | 'canceled'
  | 'compliance_then_carve_out';

export interface SourceExcerpt {
  start_offset: number;
  end_offset: number;
  text: string;
}

export interface ReviewCandidate {
  category: string;
  source: SourceExcerpt;
}

export interface ClauseFinding {
  category: string;
  label: string;
  rule_id: string;
  raw_text: string;
  modality: Modality;
  severity: number;
  start_offset: number;
  end_offset: number;
  opt_out_available: boolean;
  /** Omitted by the engine when no valid address was found. */
  opt_out_target?: string;
  inversion: InversionShape;
  reason: string;
  evidence?: SourceExcerpt[];
  opt_out_source?: SourceExcerpt;
}

export interface DocumentReport {
  schema_version: string;
  findings: ClauseFinding[];
  poison_index: number;
  truncated: boolean;
}

export type ErrorCode = 'internal_serialization' | 'invalid_input';

export interface EngineError {
  code: ErrorCode;
  message: string;
}

/** Canonical wasm return value: a report or a typed error, never an exception. */
export type AnalyzeResponse =
  | { status: 'ok'; report: DocumentReport }
  | { status: 'error'; error: EngineError };

export interface ScanComparison {
  previous_scanned_at: string;
  visible_text_changed: boolean;
  findings_added: number;
  findings_removed: number;
}

/** Persisted under `chrome.storage.local["last_scan"]` for the popup. */
export interface ScanRecord {
  url: string;
  scanned_at: string;
  comparison?: ScanComparison;
  review_candidates?: ReviewCandidate[];
  report: DocumentReport;
}

export interface AnalyzeRequest {
  type: 'ANALYZE_TEXT';
  text: string;
  input_truncated?: boolean;
  review?: boolean;
}

/** Returns a bundled report so UI work needs no Wasm build. */
export interface PlaybackRequest {
  type: 'PLAYBACK_FIXTURE';
}

export type WorkerRequest = AnalyzeRequest | PlaybackRequest;

export interface AnalysisResult {
  type: 'ANALYSIS_RESULT';
  report: DocumentReport;
  comparison?: ScanComparison;
  review_candidates?: ReviewCandidate[];
}

export interface AnalysisError {
  type: 'ANALYSIS_ERROR';
  error: EngineError;
}

export type WorkerResponse = AnalysisResult | AnalysisError;

export type PageScanResponse =
  | { status: 'ok'; record: ScanRecord }
  | { status: 'error'; message: string };

export interface JumpToClauseRequest {
  type: 'JUMP_TO_CLAUSE';
  url: string;
  text: string;
}

export type JumpToClauseResponse =
  | { status: 'ok' }
  | { status: 'error'; message: string };

export function isJumpToClauseRequest(value: unknown): value is JumpToClauseRequest {
  return typeof value === 'object' && value !== null &&
    'type' in value && value.type === 'JUMP_TO_CLAUSE' &&
    'url' in value && typeof value.url === 'string' &&
    'text' in value && typeof value.text === 'string';
}
