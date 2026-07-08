import { useState, useEffect } from 'preact/hooks';
import { reviewMedication, checkInteraction, DRPResponse } from '../api/pharmacist';
import { fetchDrugConditions } from '../api/drugConditions';
import { InteractionMatrix } from './InteractionMatrix';

type Mode = 'single' | 'interaction';

/** Top 20 most frequently prescribed drugs in the Coherent dataset (371 K rows). */
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

/** Hardcoded fallback — only used if the Config API is unreachable. */
const DRUG_CONDITIONS_FALLBACK: Record<string, string> = {
  'lisinopril 10 MG Oral Tablet':                                                                                              'hypertension\nheart failure',
  'insulin human isophane 70 UNT/ML / Regular Insulin Human 30 UNT/ML Injectable Suspension [Humulin]':                       'type 2 diabetes mellitus\nhyperglycemia',
  'Hydrochlorothiazide 25 MG Oral Tablet':                                                                                     'hypertension\nedema',
  'amLODIPine 2.5 MG Oral Tablet':                                                                                             'hypertension\ncoronary artery disease',
  '24 HR Metformin hydrochloride 500 MG Extended Release Oral Tablet':                                                         'type 2 diabetes mellitus\nobesity',
  '1 ML Epoetin Alfa 4000 UNT/ML Injection [Epogen]':                                                                          'chronic kidney disease\nanemia',
  'Simvastatin 10 MG Oral Tablet':                                                                                             'hypercholesterolemia\ncardiovascular disease',
  'Nitroglycerin 0.4 MG/ACTUAT Mucosal Spray':                                                                                 'angina pectoris\ncoronary artery disease',
  'Warfarin Sodium 5 MG Oral Tablet':                                                                                          'hypertension\natrial fibrillation',
  'Digoxin 0.125 MG Oral Tablet':                                                                                              'atrial fibrillation\nheart failure',
  'Verapamil Hydrochloride 40 MG':                                                                                             'hypertension\natrial fibrillation\nangina',
  'Simvastatin 20 MG Oral Tablet':                                                                                             'hypercholesterolemia\ncardiovascular disease',
  'Amlodipine 5 MG Oral Tablet':                                                                                               'hypertension\ncoronary artery disease',
  'Clopidogrel 75 MG Oral Tablet':                                                                                             'acute coronary syndrome\nrecent stroke',
  'NDA020503 200 ACTUAT Albuterol 0.09 MG/ACTUAT Metered Dose Inhaler':                                                        'asthma\nCOPD',
  '120 ACTUAT Fluticasone propionate 0.044 MG/ACTUAT Metered Dose Inhaler':                                                    'asthma\nallergic rhinitis',
  'Cisplatin 50 MG Injection':                                                                                                  'ovarian cancer\ntesticular cancer',
  'PACLitaxel 100 MG Injection':                                                                                               'breast cancer\nlung cancer\novarian cancer',
  '60 ACTUAT Fluticasone propionate 0.25 MG/ACTUAT / salmeterol 0.05 MG/ACTUAT Dry Powder Inhaler':                           'asthma\nCOPD',
  'Acetaminophen 325 MG Oral Tablet':                                                                                          'pain\nfever\nosteoarthritis',
};

const CONDS_DEFAULT = DRUG_CONDITIONS_FALLBACK['Warfarin Sodium 5 MG Oral Tablet'];

export function PharmacistReview() {
  const [mode, setMode]       = useState<Mode>('single');
  const [drugName, setDrug]   = useState('Warfarin Sodium 5 MG Oral Tablet');
  const [conditions, setConds]= useState(CONDS_DEFAULT);
  // Interaction mode — single drug, no remembered state
  const [ixDrug, setIxDrug]   = useState('');
  const [result, setResult]       = useState<DRPResponse | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [drugMap, setDrugMap]     = useState<Record<string, string>>(DRUG_CONDITIONS_FALLBACK);
  const [showMatrix, setShowMatrix] = useState(false);

  // Reset result whenever the user switches mode
  function switchMode(m: Mode) { setMode(m); setResult(null); setError(''); }

  useEffect(() => {
    fetchDrugConditions().then(map => {
      if (Object.keys(map).length > 0) setDrugMap(map);
    });
  }, []);

  function addDrug() {}   // kept for API compat
  function removeDrug(_drug: string) {}

  async function onSubmit(e: Event) {
    e.preventDefault(); setLoading(true); setError(''); setResult(null);
    try {
      if (mode === 'single') {
        const conds = conditions.split('\n').map(s => s.trim()).filter(Boolean);
        setResult(await reviewMedication({ drug_name: drugName, patient_conditions: conds, top_k: 4 }));
      } else {
        if (!ixDrug) { setError('Please select a drug first.'); setLoading(false); return; }
        // Single-drug interaction check: review the drug focusing on known interactions
        setResult(await reviewMedication({ drug_name: ixDrug, top_k: 5 }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally { setLoading(false); }
  }

  return (
    <div class="use-case pharmacist">
      {/* Shared datalist — available to all inputs on this page */}
      <datalist id="drug-datalist">
        {TOP_20_DRUGS.map(d => <option key={d} value={d} />)}
      </datalist>

      <div class="uc-header red">
        <span class="icon">💊</span>
        <div><h2>Pharmacist Review</h2><p>Drug-Related Problem identification using FDA drug label data</p></div>
        <div style="display:'flex',gap:'0.5rem',alignItems:'center'">
          <button
            type="button"
            class="matrix-btn"
            onClick={() => setShowMatrix(true)}
            title="View FDA Interaction Matrix for all 20 drugs"
          >
            📊 Matrix
          </button>
          <span class="api-badge">RAG :4006</span>
        </div>
      </div>

      {showMatrix && <InteractionMatrix onClose={() => setShowMatrix(false)} />}

      <form onSubmit={onSubmit} class="uc-form">
        <div class="mode-toggle">
          <button type="button" class={mode==='single'?'active':''} onClick={()=>switchMode('single')}>Single Medication</button>
          <button type="button" class={mode==='interaction'?'active':''} onClick={()=>switchMode('interaction')}>Interaction Check</button>
        </div>

        {mode === 'single' ? (<>
          <label>
            Drug name
            <select value={drugName} onChange={e => {
              const d = (e.target as HTMLSelectElement).value;
              setDrug(d);
              setConds(drugMap[d] ?? '');
            }}>
              {TOP_20_DRUGS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label>
            Patient conditions (one per line, optional)
            <textarea rows={3} value={conditions} onInput={e => setConds((e.target as HTMLTextAreaElement).value)} placeholder="hypertension" />
          </label>
        </>) : (<>
          <label>
            Select a drug to check interactions
            <select
              value={ixDrug}
              onChange={e => {
                setIxDrug((e.target as HTMLSelectElement).value);
                setResult(null); setError('');
              }}
            >
              <option value="">— choose a drug —</option>
              {TOP_20_DRUGS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          <button
            type="submit"
            class="submit-btn red-btn"
            disabled={loading || !ixDrug}
          >
            {loading ? '⏳ Checking…' : '🔍 Check Interactions'}
          </button>

          {error && <div class="error-box">⚠ {error}</div>}
          {result && (
            <div class="result-box">
              <div class="result-meta">
                <span class="badge">{result.sources_count} FDA passages</span>
                <span class="badge">{result.latency_ms} ms</span>
                <span class="badge">{result.tokens_total} tokens</span>
              </div>
              <div class="result-content">
                {result.answer.split('\n').map((l, i) => l.trim() ? <p key={i}>{l}</p> : <br key={i} />)}
              </div>
            </div>
          )}
        </>)}

        {mode === 'single' && (
          <button type="submit" class="submit-btn red-btn" disabled={loading}>
            {loading ? '⏳ Analysing…' : '🔍 Run DRP Review'}
          </button>
        )}
      </form>

      {error && mode === 'single' && <div class="error-box">⚠ {error}</div>}
      {result && mode === 'single' && (
        <div class="result-box">
          <div class="result-meta">
            <span class="badge">{result.sources_count} FDA passages</span>
            <span class="badge">{result.latency_ms} ms</span>
            <span class="badge">{result.tokens_total} tokens</span>
          </div>
          <div class="result-content">
            {result.answer.split('\n').map((l, i) => l.trim() ? <p key={i}>{l}</p> : <br key={i} />)}
          </div>
        </div>
      )}
    </div>
  );
}
