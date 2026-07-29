import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import ShiftTab from '@/components/dashboard/ShiftTab';
import HistoricalTab from '@/components/dashboard/HistoricalTab';
import AIComparisonTab from '@/components/dashboard/AIComparisonTab';
import CriticalAlertsTab from '@/components/dashboard/CriticalAlertsTab';
import { Download } from 'lucide-react';

const TABS = [
  { key: 'shift',      ar: 'الوردية الحالية', en: 'Current Shift'  },
  { key: 'historical', ar: 'تاريخي',          en: 'Historical'     },
  { key: 'ai',         ar: 'مقارنة AI',       en: 'AI Comparison'  },
  { key: 'alerts',     ar: 'التنبيهات',       en: 'Critical Alerts' },
];

async function exportToPDF(records) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();
  const now = new Date().toLocaleDateString('en-GB');
  
  doc.setFontSize(18);
  doc.text('Triage Performance Report', 20, 20);
  doc.setFontSize(11);
  doc.text(`Date: ${now}`, 20, 32);
  doc.text(`Total Records: ${records.length}`, 20, 40);
  
  const compared = records.filter(r => r.ai_ctas && r.nurse_ctas);
  const agreement = compared.length ? Math.round(compared.filter(r => r.agreement).length / compared.length * 100) : 'N/A';
  
  doc.text(`AI Agreement Rate: ${agreement}%`, 20, 48);
  
  const ctas1 = records.filter(r => r.ctas_level === 1).length;
  const ctas2 = records.filter(r => r.ctas_level === 2).length;
  const ctas3 = records.filter(r => r.ctas_level === 3).length;
  const ctas4 = records.filter(r => r.ctas_level === 4).length;
  const ctas5 = records.filter(r => r.ctas_level === 5).length;
  
  doc.setFontSize(13);
  doc.text('CTAS Distribution', 20, 60);
  doc.setFontSize(10);
  doc.text(`CTAS 1 (Resuscitation): ${ctas1}`, 20, 70);
  doc.text(`CTAS 2 (Emergent): ${ctas2}`, 20, 78);
  doc.text(`CTAS 3 (Urgent): ${ctas3}`, 20, 86);
  doc.text(`CTAS 4 (Less Urgent): ${ctas4}`, 20, 94);
  doc.text(`CTAS 5 (Non-Urgent): ${ctas5}`, 20, 102);

  if (compared.length > 0) {
    doc.setFontSize(13);
    doc.text('AI vs Nurse Comparison', 20, 116);
    doc.setFontSize(10);
    doc.text(`Cases compared: ${compared.length}`, 20, 126);
    doc.text(`Exact match: ${compared.filter(r => r.ai_ctas === r.nurse_ctas).length}`, 20, 134);
    doc.text(`Agreement rate: ${agreement}%`, 20, 142);

    const disagree = compared.filter(r => !r.agreement).slice(0, 10);
    if (disagree.length > 0) {
      doc.setFontSize(12);
      doc.text('Recent Disagreements', 20, 156);
      doc.setFontSize(9);
      disagree.forEach((r, i) => {
        const y = 165 + i * 8;
        doc.text(`${i+1}. ${r.chief_complaint || 'N/A'} — AI:C${r.ai_ctas} Nurse:C${r.nurse_ctas} | ${r.override_reason || ''}`, 20, y);
      });
    }
  }

  doc.save(`triage-report-${now.replace(/\//g, '-')}.pdf`);
}

export default function PerformanceDashboard() {
  const [activeTab, setActiveTab] = useState('shift');

  const { data: allRecords = [] } = useQuery({
    queryKey: ['triage-all-for-export'],
    queryFn: () => base44.entities.TriageRecord.list('-created_date', 200),
  });

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-800">لوحة الأداء</h1>
          <p className="text-xs text-slate-400">Performance Dashboard</p>
        </div>
        <button
          onClick={() => exportToPDF(allRecords)}
          className="flex items-center gap-2 px-3 py-2 bg-teal-600 text-white rounded-xl text-xs font-bold hover:bg-teal-700 transition-colors"
        >
          <Download className="w-4 h-4" />
          تصدير PDF
        </button>
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-xl border border-slate-200 flex overflow-hidden">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-2.5 transition-colors ${activeTab === tab.key ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            <p className="text-xs font-bold">{tab.ar}</p>
            <p className="text-xs opacity-60">{tab.en}</p>
          </button>
        ))}
      </div>

      {activeTab === 'shift'      && <ShiftTab />}
      {activeTab === 'historical' && <HistoricalTab />}
      {activeTab === 'ai'         && <AIComparisonTab />}
      {activeTab === 'alerts'     && <CriticalAlertsTab />}
    </div>
  );
}