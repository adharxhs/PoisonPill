// Wire contract v1. Field names and values mirror `engine/src/model.rs`
// exactly; see docs/CONTRACT.md. snake_case is deliberate.

export type Modality = 'obligation' | 'permission' | 'prohibition' | 'waiver';

export type InversionShape =
  | 'none'
  | 'inverted'
  | 'canceled'
  | 'compliance_then_carve_out';

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

/** Persisted under `chrome.storage.local["last_scan"]` for the popup. */
export interface ScanRecord {
  url: string;
  scanned_at: string;
  report: DocumentReport;
}

export interface AnalyzeRequest {
  type: 'ANALYZE_TEXT';
  text: string;
}

/** Returns a bundled report so UI work needs no Wasm build. */
export interface PlaybackRequest {
  type: 'PLAYBACK_FIXTURE';
}

export type WorkerRequest = AnalyzeRequest | PlaybackRequest;

export interface AnalysisResult {
  type: 'ANALYSIS_RESULT';
  report: DocumentReport;
}

export interface AnalysisError {
  type: 'ANALYSIS_ERROR';
  error: EngineError;
}

export type WorkerResponse = AnalysisResult | AnalysisError;
