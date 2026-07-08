import { useState } from 'preact/hooks';
import { PharmacistReview } from './components/PharmacistReview';
import { EHRQuery }          from './components/EHRQuery';
import { DiagnosisSupport }  from './components/DiagnosisSupport';
import { ConfigBrowser }     from './components/ConfigBrowser';

type Tab = 'pharmacist' | 'ehr' | 'diagnosis' | 'config';

export function App() {
  const [tab, setTab] = useState<Tab>('pharmacist');
  return (
    <div class="app">
      <header class="app-header">
        <div class="header-content">
          <span class="logo">🏥</span>
          <div>
            <h1>Healthcare RAG — Clinical Decision Support</h1>
            <p>ClinicalBERT · Bedrock Claude Sonnet 4.6 · 1,036 indexed documents</p>
          </div>
          <a href="/docs" target="_blank" class="api-link">RAG API Docs ↗</a>
        </div>
      </header>

      <nav class="tab-nav">
        <button class={`tab ${tab === 'pharmacist' ? 'active red-tab'    : ''}`} onClick={() => setTab('pharmacist')}>💊 Pharmacist</button>
        <button class={`tab ${tab === 'ehr'        ? 'active blue-tab'   : ''}`} onClick={() => setTab('ehr')}>🔍 EHR Query</button>
        <button class={`tab ${tab === 'diagnosis'  ? 'active green-tab'  : ''}`} onClick={() => setTab('diagnosis')}>🩺 Diagnosis</button>
        <button class={`tab ${tab === 'config'     ? 'active purple-tab' : ''}`} onClick={() => setTab('config')}>📁 Config</button>
      </nav>

      <main class="main-content">
        {tab === 'pharmacist' && <PharmacistReview />}
        {tab === 'ehr'        && <EHRQuery />}
        {tab === 'diagnosis'  && <DiagnosisSupport />}
        {tab === 'config'     && <ConfigBrowser />}
      </main>

      <footer class="app-footer">
        RAG :4005 &nbsp;·&nbsp; Pharmacist :4006 &nbsp;·&nbsp;
        EHR :4007 &nbsp;·&nbsp; Diagnosis :4008 &nbsp;·&nbsp; Config :4009
        &nbsp;·&nbsp; <a href="/api/config/docs">Config API Docs</a>
      </footer>
    </div>
  );
}
