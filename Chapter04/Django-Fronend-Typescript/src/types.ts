// Shared TypeScript types for the Django Frontend

export interface ApiOption {
  id: string;
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  needsBody: boolean;
  needsId: boolean;
  needsPatient: boolean;
  needsCode: boolean;
  needsMedicationPathId: boolean;
  needsDatabase: boolean;
  needsTopN: boolean;
  supportsQueryFilters: boolean;
  needsFileUpload: boolean;
}

export interface MedicationOption {
  value: string;
  label: string;
}

export interface PatientDetail {
  id: string;
  first: string;
  last: string;
}

export interface MedicationDetail {
  id: string;
  description: string;
}

export interface BucketObject {
  key: string;
  size: number;
  lastModified: string | null;
}

export interface PipelineEvent {
  event: string;
  message?: string;
  [key: string]: unknown;
}

export interface SrcTreeNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: SrcTreeNode[];
}

export interface SourceFile {
  path: string;
  label: string;
}

export interface ServiceUrls {
  glueCatalog: string;
  claimsGenerator: string;
  claimsCleaner: string;
  sqsMonitor: string;
  athenaClient: string;
  patientsEncounters: string;
}

export interface Toast {
  ok: boolean;
  msg: string;
}
