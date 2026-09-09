import { useEffect, useState } from 'react';
import { api } from '@/api/client';
import { toast } from 'sonner';
import { Library, Save, RotateCcw, History } from 'lucide-react';
import { syncClinicalLibrariesFromApi } from '@/lib/clinicalLibrariesSync';

export default function ClinicalLibrariesAdmin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState(null);
  const [thresholds, setThresholds] = useState({});
  const [modifiers, setModifiers] = useState([]);
  const [changelog, setChangelog] = useState('');
  const [history, setHistory] = useState([]);
  const [textRules, setTextRules] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const current = await api.clinicalLibraries.current();
      setVersions(current.versions);
      setThresholds({ ...(current.bundle?.red_flags?.thresholds || {}) });
      setTextRules(current.bundle?.red_flags?.text_rules || []);
      setModifiers(current.bundle?.modifiers?.modifiers || []);
      const hist = await api.clinicalLibraries.history();
      setHistory(hist || []);
    } catch (err) {
      toast.error(err?.message || 'Failed to load libraries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const updateThreshold = (key, value) => {
    setThresholds((prev) => ({ ...prev, [key]: Number(value) }));
  };

  const toggleModifier = (id) => {
    setModifiers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, active: !m.active } : m)),
    );
  };

  const handlePublish = async () => {
    setSaving(true);
    try {
      const red_flags = {
        version: versions?.red_flags || '1.0.0',
        thresholds,
        text_rules: textRules,
      };
      const result = await api.clinicalLibraries.publish({
        modifiers,
        modifiers_version: versions?.modifiers || '1.0.0',
        red_flags,
        changelog: changelog || 'Admin library update',
      });
      toast.success(`Published ${result.version}`);
      setChangelog('');
      await syncClinicalLibrariesFromApi();
      await load();
    } catch (err) {
      toast.error(err?.message || 'Publish failed');
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async (id) => {
    try {
      await api.clinicalLibraries.activate(id);
      toast.success('Library version activated');
      await syncClinicalLibrariesFromApi();
      await load();
    } catch (err) {
      toast.error(err?.message || 'Activate failed');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-teal-600 rounded-full animate-spin" />
      </div>
    );
  }

  const thresholdKeys = Object.keys(thresholds);

  return (
    <div dir="rtl" className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <Library className="w-5 h-5 text-teal-700" />
            المكتبات السريرية — Clinical Libraries
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Edit modifier activity and red-flag thresholds, then publish a versioned bundle.
          </p>
          {versions && (
            <p className="text-xs text-slate-400 mt-2">
              Active: {versions.bundle} · modifiers {versions.modifiers} · red flags {versions.red_flags} ({versions.source})
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1 text-sm text-slate-600 hover:text-teal-700"
        >
          <RotateCcw className="w-4 h-4" /> Reload
        </button>
      </div>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-black text-slate-700">Red-flag thresholds</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {thresholdKeys.map((key) => (
            <label key={key} className="text-xs text-slate-600 space-y-1">
              <span className="block font-medium">{key}</span>
              <input
                type="number"
                value={thresholds[key]}
                onChange={(e) => updateThreshold(key, e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              />
            </label>
          ))}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-black text-slate-700">
          Modifiers ({modifiers.filter((m) => m.active !== false).length} active / {modifiers.length})
        </h2>
        <div className="max-h-80 overflow-y-auto space-y-2">
          {modifiers.map((m) => (
            <label
              key={m.id}
              className="flex items-start gap-3 p-2 rounded-lg hover:bg-slate-50 border border-transparent hover:border-slate-100"
            >
              <input
                type="checkbox"
                checked={m.active !== false}
                onChange={() => toggleModifier(m.id)}
                className="mt-1"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800">{m.name_ar} — {m.name}</p>
                <p className="text-xs text-slate-500 truncate">{m.id} · priority {m.priority}</p>
              </div>
            </label>
          ))}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <label className="block text-sm font-black text-slate-700">
          Changelog / ملاحظات النشر
          <textarea
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            rows={2}
            className="mt-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Why is this clinical change being published?"
          />
        </label>
        <button
          type="button"
          disabled={saving}
          onClick={handlePublish}
          className="inline-flex items-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-bold text-sm px-4 py-2.5 rounded-xl"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Publishing…' : 'Publish library version'}
        </button>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <h2 className="text-sm font-black text-slate-700 flex items-center gap-2">
          <History className="w-4 h-4" /> Publish history
        </h2>
        <div className="space-y-2">
          {history.length === 0 && (
            <p className="text-sm text-slate-400">No published versions yet — builtin libraries are active.</p>
          )}
          {history.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between gap-3 border border-slate-100 rounded-lg px-3 py-2"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {h.version} {h.isActive ? <span className="text-teal-700 text-xs">(active)</span> : null}
                </p>
                <p className="text-xs text-slate-500">
                  {new Date(h.publishedAt).toLocaleString()} — {h.changelog || '—'}
                </p>
              </div>
              {!h.isActive && (
                <button
                  type="button"
                  onClick={() => handleActivate(h.id)}
                  className="text-xs font-bold text-teal-700 hover:underline"
                >
                  Activate
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
