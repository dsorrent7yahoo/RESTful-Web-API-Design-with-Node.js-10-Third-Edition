/**
 * InteractionMatrix.tsx — Modal showing FDA-sourced drug interaction table for all 20 drugs.
 *
 * Opens as a full-screen modal. Fires 20 parallel pharmacist API calls,
 * parses each answer for mentioned drug interactions, and renders a table.
 */
import { useState } from 'preact/hooks';
import { reviewMedication } from '../api/pharmacist';

const TOP_20_DRUGS = [
  'lisinopril 10 MG Oral Tablet',
  'insulin human isophane 70 UNT/ML / Regular Insulin Human 30 UNT/ML Injectable Suspension [Humulin]',
  'Hydrochlorothiazide 25 MG Oral Tablet',
  'amLODIPine 2.5 MG Oral Tablet',
  '24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet',
  '1 ML Epoetin Alfa 4000 UNT/ML Injection [Epogen]',
  'Simvastatin 10 MG Oral Tablet',
  'Nitroglycerin 0.4 MG/ACTUAT Mucosal Spray',
  'Warfarin Sodium 5 MG Oral Tablet',
  'Digoxin 0.125 MG Oral Tablet',
  'Verapamil Hydrochloride 40 MG',
  'Simvastatin 20 MG Oral Tablet',
  'Amlodipine 5 MG Oral Tablet',
  'Clopidogrel 75 MG Oral Tablet',
  'NDA020503 200 ACTUAT Albuterol 0.09 MG/ACTUAT Metered Dose Inhaler',
  '120 ACTUAT Fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler',
  'Cisplatin 50 MG Injection',
  'PACLitaxel 100 MG Injection',
  '60 ACTUAT Fluticasone propionate 0.25 MG/ACTUAT / salmeterol 0.05 MG/ACTUAT Dry Powder Inhaler',
  'Acetaminophen 325 MG Oral Tablet',
];

/** Shorten full drug name to a readable label. */
function shortName(n: string): string {
  return n
    .replace(/\d+(\.\d+)?\s*(MG|UNT|ACTUAT|ML)(\/[A-Z]+)?/gi, '')
    .replace(/\s*(Oral Tablet|Injectable Suspension|Mucosal Spray|Metered Dose Inhaler|Dry Powder Inhaler|Injection)\b.*/i, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^NDA\d+\s+/, '')
    .slice(0, 40);
}

interface DrugRow {
  drug: string;
  shortDrug: string;
  sources: number;
  severity: string;
  drugDrugIx: string[];     // named drug-drug interactions
  risks: string[];          // risks / side-effects
  fdaRefs: string[];
  status: 'loading' | 'done' | 'error';
  error?: string;
}

/**
 * Parse the LLM answer into:
 *  - drugDrugIx: specific named drugs this drug interacts with
 *  - risks: adverse outcomes / side effects
 *  - severity: highest severity keyword found
 *  - refs: FDA citation IDs
 */
function parseAnswer(answer: string, sources: number): {
  drugDrugIx: string[]; risks: string[]; severity: string; refs: string[]
} {
  // Severity
  let severity = 'Unknown';
  if (/category\s+i\b|fatal|death|life.?threaten/i.test(answer))             severity = '🔴 Critical';
  else if (/category\s+[gh]\b|serious|major|rhabdomyolysis|bleed/i.test(answer)) severity = '🟠 Major';
  else if (/category\s+[def]\b|monitor|caution|significant/i.test(answer))   severity = '🟡 Moderate';
  else if (/category\s+[abc]\b|minor|mild/i.test(answer))                    severity = '🟢 Minor';
  else if (sources === 0) severity = '⚪ No FDA data';

  // FDA citation refs
  const refs = [...answer.matchAll(/\[source: ([^\]]+)\]/g)].map(m => m[1]).slice(0, 3);

  // ── Named drug-drug interactions ────────────────────────────────────────────
  // These are specific drug names (or drug classes) that interact with this drug
  const DRUG_NAMES = [
    'Cyclosporine','Gemfibrozil','Ketoconazole','Itraconazole','Clarithromycin',
    'Erythromycin','Warfarin','Digoxin','Carvedilol','Aspirin','Nifedipine',
    'Amlodipine','Verapamil','Diltiazem','Lithium','Metformin','Furosemide',
    'Clopidogrel','Heparin','Colestipol','Cholestyramine','Carboplatin',
    'Cisplatin','Rifampin','Phenytoin','Omeprazole','Amiodarone',
    'Nefazodone','Danazol','Cobicistat','Elvitegravir',
  ];
  const DRUG_CLASSES = [
    ['Beta-Blocker','beta.blocker'],
    ['NSAIDs','nsaid'],
    ['Aminoglycosides','aminoglycoside'],
    ['ACE Inhibitor','ace inhibitor'],
    ['Anticoagulants','anticoagulant'],
    ['Antiplatelets','antiplatelet'],
    ['Calcium Channel Blockers','calcium channel'],
    ['SSRIs','ssri'],
    ['MAOIs','maoi'],
    ['Opioids','opioid'],
    ['CYP3A4 Inhibitors','cyp3a4 inhibitor'],
    ['CYP3A4 Inducers','cyp3a4 inducer'],
    ['HMG-CoA Inhibitors','hmg.coa'],
    ['HIV Protease Inhibitors','hiv protease'],
    ['Diuretics','diuretic'],
  ];

  const drugDrugIx: string[] = [];
  for (const name of DRUG_NAMES) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(answer)) drugDrugIx.push(name);
  }
  for (const [label, pattern] of DRUG_CLASSES) {
    if (new RegExp(pattern, 'i').test(answer)) drugDrugIx.push(label);
  }

  // ── Risks / adverse outcomes ────────────────────────────────────────────────
  const RISK_PATTERNS: [string, string][] = [
    ['Bleeding / Hemorrhage', 'bleed|hemorrhag'],
    ['Rhabdomyolysis', 'rhabdomyolysis'],
    ['Myopathy', '\\bmyopathy\\b'],
    ['Hepatotoxicity', 'hepatotox|liver damage|liver fail'],
    ['Nephrotoxicity', 'nephrotox|renal impair|renal fail|kidney'],
    ['Hypotension', 'hypotension|low blood pressure'],
    ['Hypokalemia', 'hypokalemia'],
    ['QT Prolongation', 'qt prolong|torsade'],
    ['Hypersensitivity / Anaphylaxis', 'hypersensitivity|anaphylax'],
    ['Neutropenia / Myelosuppression', 'neutropenia|myelosuppress|bone marrow'],
    ['Serotonin Syndrome', 'serotonin syndrome'],
    ['Bradycardia / AV Block', 'bradycardia|av block'],
    ['Hyperglycemia / Glycemic changes', 'hyperglycemia|glycem|blood sugar'],
    ['Electrolyte Imbalance', 'electrolyte|potassium loss|sodium'],
    ['Increased Drug Levels', 'increased.*level|elevated.*plasma|toxic.*level'],
  ];

  const risks: string[] = [];
  for (const [label, pattern] of RISK_PATTERNS) {
    if (new RegExp(pattern, 'i').test(answer)) risks.push(label);
  }

  return {
    drugDrugIx: [...new Set(drugDrugIx)].slice(0, 8),
    risks:      [...new Set(risks)].slice(0, 5),
    severity,
    refs,
  };
}

interface Props { onClose: () => void; }

export function InteractionMatrix({ onClose }: Props) {
  const [rows, setRows]       = useState<DrugRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [progress, setProgress] = useState(0);

  async function loadData() {
    setLoading(true);
    setDone(false);
    setProgress(0);

    const initial: DrugRow[] = TOP_20_DRUGS.map(d => ({
      drug: d, shortDrug: shortName(d),
      sources: 0, severity: '', drugDrugIx: [], risks: [], fdaRefs: [],
      status: 'loading',
    }));
    setRows(initial);

    // Fire all 20 in parallel
    const promises = TOP_20_DRUGS.map(async (drug, i) => {
      try {
        const result = await reviewMedication({ drug_name: drug, top_k: 5 });
        const { drugDrugIx, risks, severity, refs } = parseAnswer(result.answer, result.sources_count);
        setRows(prev => {
          const next = [...prev];
          next[i] = { ...next[i], sources: result.sources_count, drugDrugIx, risks, severity, fdaRefs: refs, status: 'done' };
          return next;
        });
      } catch (e) {
        setRows(prev => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'error', error: String(e), severity: '⚠ Error' };
          return next;
        });
      }
      setProgress(p => p + 1);
    });

    await Promise.all(promises);
    setLoading(false);
    setDone(true);
  }

  const severityOrder: Record<string, number> = {
    '🔴 Critical': 0, '🟠 Major': 1, '🟡 Moderate': 2,
    '🟢 Minor': 3, '⚪ No FDA data': 4, '⚠ Error': 5, 'Unknown': 6,
  };

  const sorted = done
    ? [...rows].sort((a, b) => (severityOrder[a.severity] ?? 6) - (severityOrder[b.severity] ?? 6))
    : rows;

  return (
    <div class="modal-overlay" onClick={e => { if ((e.target as Element).classList.contains('modal-overlay')) onClose(); }}>
      <div class="modal-box">
        <div class="modal-header">
          <div>
            <h2>📋 FDA Drug Interaction Matrix</h2>
            <p>20 drugs · 595 indexed FDA label sections · Bedrock Claude Sonnet 4.6</p>
          </div>
          <button class="modal-close" onClick={onClose}>✕</button>
        </div>

        {!loading && !done && (
          <div class="modal-start">
            <p>Click below to query all 20 drugs in parallel against the indexed FDA labels.</p>
            <button class="submit-btn red-btn" onClick={loadData}>
              🔬 Load Interaction Data
            </button>
          </div>
        )}

        {(loading || done) && (
          <>
            {loading && (
              <div class="matrix-progress">
                <div class="progress-bar">
                  <div class="progress-fill" style={{ width: `${(progress / 20) * 100}%` }} />
                </div>
                <span>{progress} / 20 drugs queried</span>
              </div>
            )}

            <div class="matrix-table-wrapper">
              <table class="matrix-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Drug</th>
                    <th>Severity</th>
                    <th>FDA<br/>Passages</th>
                    <th>💊 Drug-Drug Interactions</th>
                    <th>⚠ Risks / Side Effects</th>
                    <th>FDA Citations</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, i) => (
                    <tr key={row.drug} class={row.status === 'loading' ? 'row-loading' : ''}>
                      <td class="col-num">{i + 1}</td>
                      <td class="col-drug">
                        <span class="drug-full" title={row.drug}>{row.shortDrug}</span>
                      </td>
                      <td class="col-severity">
                        {row.status === 'loading'
                          ? <span class="spinner">⏳</span>
                          : <span class={`sev-badge sev-${row.severity.split(' ')[0]}`}>{row.severity}</span>
                        }
                      </td>
                      <td class="col-sources">
                        {row.status === 'loading' ? '…' : (
                          <span class={row.sources > 0 ? 'badge-green' : 'badge-gray'}>
                            {row.sources}
                          </span>
                        )}
                      </td>
                      <td class="col-interactions">
                        {row.status === 'loading' ? '…' : (
                          row.drugDrugIx.length > 0
                            ? <div class="ix-chips">
                                {row.drugDrugIx.map(ix => <span key={ix} class="ix-chip ix-drug">{ix}</span>)}
                              </div>
                            : <span class="none-text">—</span>
                        )}
                      </td>
                      <td class="col-risks">
                        {row.status === 'loading' ? '…' : (
                          row.risks.length > 0
                            ? <div class="ix-chips">
                                {row.risks.map(r => <span key={r} class="ix-chip ix-risk">{r}</span>)}
                              </div>
                            : <span class="none-text">—</span>
                        )}
                      </td>
                      <td class="col-refs">
                        {row.status === 'loading' ? '…' : (
                          row.fdaRefs.length > 0
                            ? <div class="ref-list">
                                {row.fdaRefs.map(r => <code key={r} class="ref-tag">{r}</code>)}
                              </div>
                            : <span class="none-text">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {done && (
              <div class="modal-footer">
                <span>✅ {rows.filter(r => r.sources > 0).length} / 20 drugs have FDA label data</span>
                <span>🔗 {rows.reduce((a, r) => a + r.fdaRefs.length, 0)} total FDA citations</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
