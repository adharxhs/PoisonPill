// Shared wire types. Field names mirror the Rust `ClauseFinding` struct exactly;
// changing one side without the other silently breaks the popup.

export type Modality = 'Obligation' | 'Permission' | 'Prohibition' | 'Waiver';

export interface ClauseFinding {
  category: string;
  raw_text: string;
  modality: Modality;
  severity: number;
  opt_out_available: boolean;
  opt_out_target?: string;
}

export interface DocumentReport {
  findings: ClauseFinding[];
  poison_index: number;
}

/** Persisted under `chrome.storage.local["last_scan"]`. */
export interface ScanRecord {
  url: string;
  scanned_at: string;
  poison_index: number;
  findings: ClauseFinding[];
}

export interface AnalyzeRequest {
  type: 'ANALYZE_TEXT';
  text: string;
}

export interface AnalysisResult {
  type: 'ANALYSIS_RESULT';
  report: DocumentReport;
}

export interface AnalysisError {
  type: 'ANALYSIS_ERROR';
  error: string;
}

export type WorkerResponse = AnalysisResult | AnalysisError;
