export type AuditAdvisory = {
  source?: number;
  name?: string;
  dependency?: string;
  title?: string;
  url?: string;
  severity?: string;
  range?: string;
};

export type AuditVulnerability = {
  name?: string;
  severity?: string;
  via?: Array<AuditAdvisory | string>;
  effects?: string[];
  range?: string;
  nodes?: string[];
  fixAvailable?: boolean | Record<string, unknown>;
};

export type AuditReport = {
  vulnerabilities?: Record<string, AuditVulnerability>;
};

export function evaluateRuntimeAudit(report: AuditReport): {
  acceptedAdvisories: string[];
  blockingAdvisories: string[];
};
