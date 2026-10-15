import { parseDateCell } from './timelineImport.js';

// ── Payment Milestones — CRM "PO Report with Milestones" parser ─────────────
// Pure (no DB, no xlsx import) so it can be unit-tested; the route feeds it
// xlsx.utils.sheet_to_json(..., { defval: null, raw: true }). One row = one
// invoicing milestone of a PO; PO-level columns repeat on every row.
//
// Amounts (Amount, Amount Yet to be Invoiced, Percentage) are deliberately
// never read — they stay in the CRM. Dates come from raw Excel serials (never
// JS Dates), truncated to UTC midnight like every other date-only field here.

export interface ParsedMilestone {
  crmRecordId: string;
  poNumber: string;
  poName: string;
  name: string;
  baselineDate: Date | null;   // "As per PIP"
  targetDate: Date | null;     // "Revised Delivery Date"
  actualDate: Date | null;     // "Delivery Completed on"
  evidenceDate: Date | null;   // "Documentary Evidence Date"
  isCompleted: boolean;        // "Delivery Completed?"
  invoiceRaised: boolean;      // "Invoice Raised?"
  crmComments: string | null;  // Sales + Project Manager comments, merged
  projectManager: string | null;
}

export interface ParsedMilestoneSheet {
  rows: ParsedMilestone[];
  /** Every distinct Project Manager in the file (blank → "" ) with its row count, before any PM filter. */
  projectManagers: { name: string; count: number }[];
  skippedOtherPm: number;
  skippedEmpty: number;
  warnings: string[];
  /** Required columns missing from the header row — the file can't be imported while this is non-empty. */
  missingColumns: string[];
}

const ALIASES: Record<string, string[]> = {
  recordId:   ['recordidinvoicingmilestones', 'recordid', 'crmrecordid', 'milestoneid'],
  poNumber:   ['ponumber', 'pono', 'ponum'],
  poName:     ['poname'],
  milestone:  ['milestone', 'milestonename'],
  pip:        ['asperpip', 'pip', 'baselinedate'],
  revised:    ['reviseddeliverydate', 'reviseddate', 'targetdate'],
  completedOn: ['deliverycompletedon', 'deliveredon', 'actualdate'],
  completed:  ['deliverycompleted', 'delivered', 'iscompleted'],
  evidence:   ['documentaryevidencedate', 'ded', 'evidencedate'],
  invoiced:   ['invoiceraised', 'invoiced'],
  salesNotes: ['salescomments'],
  pmNotes:    ['projmngrcomments', 'projectmanagercomments', 'pmcomments', 'projmgrcomments'],
  pm:         ['projectmanager', 'pm'],
};
const REQUIRED: Array<[string, string]> = [
  ['recordId', 'Record Id (Invoicing Milestones)'],
  ['poNumber', 'P.O Number'],
  ['poName', 'P.O Name'],
  ['milestone', 'Milestone'],
];

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** The CRM exports booleans as the text "true"/"false"; tolerate real booleans, yes/no and 1/0 too. */
export function parseBoolCell(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return ['true', 'yes', 'y', '1'].includes(str(v).toLowerCase());
}

/** Date-only: the CRM's "Delivery Completed on" carries a time of day, but only the calendar day matters. */
function dateOnly(raw: unknown): Date | null {
  const d = parseDateCell(typeof raw === 'number' ? Math.floor(raw) : raw);
  return d ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) : null;
}

function mergeComments(sales: string, pm: string): string | null {
  const parts = [pm && `PM: ${pm}`, sales && `Sales: ${sales}`].filter(Boolean) as string[];
  return parts.length ? parts.join('\n') : null;
}

export function parseMilestoneRows(
  rows: Record<string, unknown>[],
  opts: { projectManager?: string } = {},
): ParsedMilestoneSheet {
  const result: ParsedMilestoneSheet = { rows: [], projectManagers: [], skippedOtherPm: 0, skippedEmpty: 0, warnings: [], missingColumns: [] };

  const byNorm = new Map<string, string>();
  for (const row of rows) for (const k of Object.keys(row)) if (!byNorm.has(normHeader(k))) byNorm.set(normHeader(k), k);
  const col: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(ALIASES)) {
    for (const a of aliases) {
      const real = byNorm.get(a);
      if (real !== undefined) { col[field] = real; break; }
    }
  }
  result.missingColumns = REQUIRED.filter(([f]) => !col[f]).map(([, label]) => label);
  if (result.missingColumns.length > 0) return result;

  const wantPm = (opts.projectManager ?? '').trim().toLowerCase();
  const pmCounts = new Map<string, number>();
  const seen = new Set<string>();

  rows.forEach((row, i) => {
    const rowNo = i + 2; // header is row 1
    const get = (f: string) => (col[f] ? row[col[f]] : null);
    const recordId = str(get('recordId'));
    const poNumber = str(get('poNumber'));
    const poName = str(get('poName'));
    const name = str(get('milestone'));
    if (!recordId && !poNumber && !poName && !name) { result.skippedEmpty++; return; }

    const pm = str(get('pm'));
    pmCounts.set(pm, (pmCounts.get(pm) ?? 0) + 1);
    if (wantPm && pm.toLowerCase() !== wantPm) { result.skippedOtherPm++; return; }

    if (!recordId) { result.warnings.push(`Row ${rowNo} ("${name || poName}"): no Record Id — skipped.`); return; }
    if (!name) { result.warnings.push(`Row ${rowNo} (${recordId}): no Milestone name — skipped.`); return; }
    if (seen.has(recordId)) { result.warnings.push(`Row ${rowNo} ("${name}"): duplicate Record Id ${recordId} — skipped.`); return; }
    seen.add(recordId);

    const isCompleted = parseBoolCell(get('completed'));
    result.rows.push({
      crmRecordId: recordId,
      poNumber,
      poName: poName || `PO ${poNumber}`,
      name: name.slice(0, 200),
      baselineDate: dateOnly(get('pip')),
      targetDate: dateOnly(get('revised')),
      actualDate: isCompleted ? dateOnly(get('completedOn')) : null,
      evidenceDate: dateOnly(get('evidence')),
      isCompleted,
      invoiceRaised: parseBoolCell(get('invoiced')),
      crmComments: mergeComments(str(get('salesNotes')), str(get('pmNotes')))?.slice(0, 4000) ?? null,
      projectManager: pm || null,
    });
  });

  result.projectManagers = [...pmCounts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return result;
}
