import React, { useEffect, useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, Power, Save, X } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function SettingsPanel({ open, onClose }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState([]);
  const [values, setValues] = useState({});
  const [secretVisible, setSecretVisible] = useState({});
  const [clearSecrets, setClearSecrets] = useState({});
  const [startup, setStartup] = useState({ supported: false, enabled: false, command: '' });
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setMessage('');
    fetch(`${API_URL}/api/settings`)
      .then((response) => response.json())
      .then((payload) => {
        if (cancelled) return;
        const nextSections = payload.settings?.sections || [];
        const nextValues = {};
        nextSections.forEach((section) => {
          section.fields.forEach((field) => {
            nextValues[field.key] = field.value || '';
          });
        });
        setSections(nextSections);
        setValues(nextValues);
        setStartup(payload.startup || { supported: false, enabled: false, command: '' });
      })
      .catch((error) => setMessage(`Settings could not be loaded: ${error.message}`))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const configuredSecrets = useMemo(() => {
    const result = {};
    sections.forEach((section) => {
      section.fields.forEach((field) => {
        if (field.secret) result[field.key] = field.configured;
      });
    });
    return result;
  }, [sections]);

  if (!open) return null;

  const updateValue = (key, value) => {
    setValues((current) => ({ ...current, [key]: value }));
    setClearSecrets((current) => ({ ...current, [key]: false }));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: values,
          clearSecrets: Object.entries(clearSecrets).filter(([, clear]) => clear).map(([key]) => key),
          startupEnabled: startup.supported ? startup.enabled : undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Settings save failed.');
      setMessage(payload.message || 'Settings saved.');
      setStartup(payload.startup || startup);
      setSections(payload.settings?.sections || sections);
      setClearSecrets({});
    } catch (error) {
      setMessage(`Settings fault: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-void/85 px-4 py-6 backdrop-blur">
      <form onSubmit={save} className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded border border-reactor/35 bg-[#071016] shadow-[0_0_36px_rgba(0,212,255,0.18)]">
        <div className="flex items-center justify-between border-b border-reactor/20 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-reactor">Settings</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-100">System Configuration</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-slate-700 px-3 py-2 text-slate-300 hover:border-reactor hover:text-reactor" aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-3 py-10 text-reactor">
              <Loader2 className="animate-spin" size={18} />
              Loading secure configuration.
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-2">
              {sections.map((section) => (
                <section key={section.section} className="border-t border-reactor/25 pt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-reactor">{section.section}</h3>
                  <div className="mt-4 grid gap-3">
                    {section.fields.map((field) => (
                      <label key={field.key} className="block">
                        <span className="flex items-center justify-between gap-3 text-sm text-slate-300">
                          {field.label}
                          {field.secret && configuredSecrets[field.key] && !clearSecrets[field.key] && (
                            <span className="inline-flex items-center gap-1 text-xs text-reactor">
                              <Check size={13} /> configured
                            </span>
                          )}
                        </span>
                        <div className="mt-1 flex gap-2">
                          <input
                            type={field.secret && !secretVisible[field.key] ? 'password' : 'text'}
                            value={values[field.key] || ''}
                            onChange={(event) => updateValue(field.key, event.target.value)}
                            placeholder={field.secret && configuredSecrets[field.key] ? 'Leave blank to keep current key' : field.defaultValue || field.key}
                            className="min-w-0 flex-1 rounded border border-slate-700 bg-void/80 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-reactor"
                            autoComplete="off"
                          />
                          {field.secret && (
                            <button
                              type="button"
                              onClick={() => setSecretVisible((current) => ({ ...current, [field.key]: !current[field.key] }))}
                              className="rounded border border-slate-700 px-3 py-2 text-slate-300 hover:border-reactor hover:text-reactor"
                              aria-label={`Toggle ${field.label} visibility`}
                            >
                              {secretVisible[field.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          )}
                        </div>
                        {field.secret && configuredSecrets[field.key] && (
                          <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-400">
                            <input
                              type="checkbox"
                              checked={Boolean(clearSecrets[field.key])}
                              onChange={(event) => setClearSecrets((current) => ({ ...current, [field.key]: event.target.checked }))}
                              className="accent-cyan-400"
                            />
                            Clear stored key
                          </label>
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              ))}

              <section className="border-t border-reactor/25 pt-4 lg:col-span-2">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-reactor">Windows</h3>
                <div className="mt-4 flex flex-col gap-3 border border-reactor/20 bg-reactor/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-slate-100">Launch JARVIS when Windows starts</p>
                    <p className="mt-1 text-sm text-slate-400">
                      Keeps the local server ready after a reboot. Subtle, persistent, and only mildly theatrical.
                    </p>
                    {startup.command && <p className="mt-2 break-all text-xs text-slate-500">{startup.command}</p>}
                  </div>
                  <button
                    type="button"
                    disabled={!startup.supported}
                    onClick={() => setStartup((current) => ({ ...current, enabled: !current.enabled }))}
                    className={`inline-flex items-center justify-center gap-2 rounded border px-4 py-3 text-sm font-semibold ${
                      startup.enabled
                        ? 'border-reactor/50 bg-reactor/15 text-reactor'
                        : 'border-slate-700 bg-void/60 text-slate-300'
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <Power size={16} /> {startup.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-reactor/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-h-5 text-sm text-slate-300">{message}</p>
          <button
            type="submit"
            disabled={saving || loading}
            className="inline-flex items-center justify-center gap-2 rounded bg-reactor px-4 py-3 text-sm font-semibold text-void hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            Save settings
          </button>
        </div>
      </form>
    </div>
  );
}
