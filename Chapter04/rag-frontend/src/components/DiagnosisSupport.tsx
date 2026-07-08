import { useState } from 'preact/hooks';
import { evaluatePatient, interpretLab, DiagnosisResponse, LabResponse } from '../api/diagnosis';

type Mode = 'full' | 'lab';
const LAB_EXAMPLES = [
  { name: 'HbA1c',       code: '4548-4', value: '8.1%'      },
  { name: 'Systolic BP', code: '8480-6', value: '148 mm[Hg]'},
  { name: 'Hemoglobin',  code: '718-7',  value: '9.2 g/dL'  },
  { name: 'Cholesterol', code: '2093-3', value: '245 mg/dL' },
];
const LABS_DEF = 'HbA1c: 7.8%\nFasting glucose: 9.2 mmol/L\nBMI: 31';
const MEDS_DEF = 'Metformin 500 MG\nLisinopril 10 MG';
const SYMP_DEF = 'excessive thirst\nfatigue\nblurred vision';

export function DiagnosisSupport() {
  const [mode, setMode]         = useState<Mode>('full');
  const [labs, setLabs]         = useState(LABS_DEF);
  const [meds, setMeds]         = useState(MEDS_DEF);
  const [symptoms, setSym]      = useState(SYMP_DEF);
  const [age, setAge]           = useState('58');
  const [sex, setSex]           = useState('F');
  const [labName, setLabName]   = useState('HbA1c');
  const [labCode, setLabCode]   = useState('4548-4');
  const [labVal, setLabVal]     = useState('8.1%');
  const [labConds, setLabConds] = useState('type 2 diabetes');
  const [fullRes, setFullRes]   = useState<DiagnosisResponse | null>(null);
  const [labRes, setLabRes]     = useState<LabResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  function parseLabs(t: string): Record<string, string> {
    return Object.fromEntries(t.split('\n').filter(Boolean).map(l => {
      const [k, ...r] = l.split(':');
      return [k.trim(), r.join(':').trim()];
    }));
  }

  async function onSubmit(e: Event) {
    e.preventDefault(); setLoading(true); setError(''); setFullRes(null); setLabRes(null);
    try {
      if (mode === 'full') {
        setFullRes(await evaluatePatient({
          lab_values: parseLabs(labs),
          current_medications: meds.split('\n').map(s => s.trim()).filter(Boolean),
          symptoms: symptoms.split('\n').map(s => s.trim()).filter(Boolean),
          age: age ? parseInt(age) : undefined, sex: sex || undefined, top_k: 5,
        }));
      } else {
        setLabRes(await interpretLab({
          lab_name: labName, value: labVal, loinc_code: labCode || undefined,
          patient_conditions: labConds.split('\n').map(s => s.trim()).filter(Boolean),
        }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally { setLoading(false); }
  }

  return (
    <div class="use-case diagnosis">
      <div class="uc-header green">
        <span class="icon">🩺</span>
        <div><h2>Diagnosis Support</h2><p>GARMLE-G evidence-based differential diagnosis with ICD-10/SNOMED codes</p></div>
        <span class="api-badge">RAG :4008</span>
      </div>
      <form onSubmit={onSubmit} class="uc-form">
        <div class="mode-toggle">
          <button type="button" class={mode==='full'?'active':''} onClick={()=>setMode('full')}>Full Diagnosis</button>
          <button type="button" class={mode==='lab'?'active':''} onClick={()=>setMode('lab')}>Lab Interpretation</button>
        </div>
        {mode==='full' ? (
          <div class="two-col">
            <label>Lab values (name: value, one per line)<textarea rows={4} value={labs} onInput={e=>setLabs((e.target as HTMLTextAreaElement).value)} /></label>
            <label>Medications (one per line)<textarea rows={4} value={meds} onInput={e=>setMeds((e.target as HTMLTextAreaElement).value)} /></label>
            <label>Symptoms (one per line)<textarea rows={3} value={symptoms} onInput={e=>setSym((e.target as HTMLTextAreaElement).value)} /></label>
            <div class="inline-fields">
              <label>Age<input type="number" value={age} onInput={e=>setAge((e.target as HTMLInputElement).value)} style="width:80px" /></label>
              <label>Sex<select value={sex} onChange={e=>setSex((e.target as HTMLSelectElement).value)}><option value="">-</option><option>F</option><option>M</option></select></label>
            </div>
          </div>
        ) : (
          <>
            <div class="examples">{LAB_EXAMPLES.map(ex=>(
              <button type="button" key={ex.code} class="example-chip"
                onClick={()=>{setLabName(ex.name);setLabCode(ex.code);setLabVal(ex.value);}}>
                {ex.name} {ex.value}
              </button>
            ))}</div>
            <div class="two-col">
              <label>Lab test name<input value={labName} onInput={e=>setLabName((e.target as HTMLInputElement).value)} /></label>
              <label>LOINC code<input value={labCode} onInput={e=>setLabCode((e.target as HTMLInputElement).value)} /></label>
              <label>Measured value<input value={labVal} onInput={e=>setLabVal((e.target as HTMLInputElement).value)} /></label>
              <label>Patient conditions<textarea rows={2} value={labConds} onInput={e=>setLabConds((e.target as HTMLTextAreaElement).value)} /></label>
            </div>
          </>
        )}
        <button type="submit" class="submit-btn green-btn" disabled={loading}>
          {loading ? '⏳ Diagnosing…' : (mode==='full' ? '🧬 Generate Diagnosis' : '🔬 Interpret Lab')}
        </button>
      </form>
      {error && <div class="error-box">⚠ {error}</div>}
      {fullRes && (
        <div class="result-box">
          <div class="result-meta"><span class="badge">{fullRes.sources_count} sources</span><span class="badge">{fullRes.latency_ms} ms</span></div>
          <div class="result-content">{fullRes.full_report.split('\n').map((l,i)=>l.trim()?<p key={i}>{l}</p>:<br key={i} />)}</div>
        </div>
      )}
      {labRes && (
        <div class="result-box">
          <div class="result-meta"><span class="badge">{labRes.lab_name} = {labRes.value}</span><span class="badge">{labRes.latency_ms} ms</span></div>
          <p class="explanation">{labRes.interpretation}</p>
        </div>
      )}
    </div>
  );
}
