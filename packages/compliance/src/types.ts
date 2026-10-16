/** One country-specific setting a merchant must (or may) provide at setup, taken from the legal research. */
export interface SettingDef {
  key: string;
  label: string;
  type: 'text' | 'select' | 'boolean';
  required: boolean;
  help: string;
  /** full-string regex, only when the research gave one */
  pattern?: string;
  options?: string[];
  /** free-text validation note when there is no regex */
  hint?: string;
}

export interface IdFormat {
  label: string;
  pattern?: string;
  example?: string;
}

export interface CountryRules {
  code: string;
  name: string;
  currency: string;
  /** indicative standard VAT rate in percent, informational only */
  vatStandard: number;
  /** indicative minimum retention in years, informational only: confirm with a tax adviser */
  retentionYearsIndicative: number;
  companyId: IdFormat;
  vatId: IdFormat;
  /** plain-language findings of the legal research, one block per topic (see docs/legal-research) */
  summary: {
    receiptObligation: string;
    digitalReceipt: string;
    mandatoryFields: string;
    fiscalSystem: string;
    realTimeReporting: string;
    receiptIdentifiers: string;
    retention: string;
    vat: string;
    other: string;
  };
  settings: SettingDef[];
  sources: string[];
  confidence: 'high' | 'medium' | 'low';
  adviserMustVerify: string;
  lastChecked: string;
}

/** What the setup screen stores per organisation (organizations.compliance). */
export interface ComplianceSettings {
  country: string;
  /** values for CountryRules.settings, by key */
  values: Record<string, string | boolean>;
  /** the owner confirmed the legal summary of this country (ISO time) */
  confirmedAt: string | null;
}
