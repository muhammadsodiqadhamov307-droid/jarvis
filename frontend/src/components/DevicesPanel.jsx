import React, { useEffect, useState } from 'react';
import { Check, Loader2, RefreshCw, Save, Send, ShieldAlert, Star, X } from 'lucide-react';
import { API_URL } from '../config.js';

export default function DevicesPanel({ open, onClose }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [commands, setCommands] = useState({});
  const [drafts, setDrafts] = useState({});

  useEffect(() => {
    if (open) loadDevices();
  }, [open]);

  if (!open) return null;

  async function loadDevices() {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/devices`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load devices.');
      setDevices(payload);
      setDrafts(() => {
        const next = {};
        for (const device of payload) {
          next[device.id] = {
            name: device.name,
            isDefault: Boolean(device.is_default)
          };
        }
        return next;
      });
    } catch (error) {
      setMessage(`Device link fault: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function approve(id) {
    const draft = drafts[id] || {};
    await sendAndReload(`/api/devices/${id}/approve`, 'POST', 'Device approved.', {
      name: draft.name,
      isDefault: Boolean(draft.isDefault)
    });
  }

  async function saveDevice(id) {
    const draft = drafts[id] || {};
    await sendAndReload(`/api/devices/${id}`, 'PATCH', 'Device settings saved.', {
      name: draft.name,
      isDefault: Boolean(draft.isDefault)
    });
  }

  async function revoke(id) {
    await sendAndReload(`/api/devices/${id}/revoke`, 'POST', 'Device revoked.');
  }

  async function sendCommand(device) {
    const text = String(commands[device.id] || '').trim();
    if (!text) return;
    await sendAndReload(`/api/devices/${device.id}/commands`, 'POST', `Command sent to ${device.name}.`, {
      type: 'desktop_intent',
      payload: { message: text }
    });
    setCommands((current) => ({ ...current, [device.id]: '' }));
  }

  async function sendAndReload(path, method, success, body = {}) {
    setMessage('');
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(payload.error || 'Command failed.');
      return;
    }
    setMessage(success);
    await loadDevices();
  }

  function updateDraft(id, patch) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        name: '',
        isDefault: false,
        ...(current[id] || {}),
        ...patch
      }
    }));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-void/85 px-4 py-6 backdrop-blur">
      <section className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded border border-reactor/35 bg-[#071016] shadow-[0_0_36px_rgba(0,212,255,0.18)]">
        <div className="flex items-center justify-between border-b border-reactor/20 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-reactor">Devices</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-100">Computer Link</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={loadDevices} className="rounded border border-slate-700 px-3 py-2 text-slate-300 hover:border-reactor hover:text-reactor">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
            </button>
            <button type="button" onClick={onClose} className="rounded border border-slate-700 px-3 py-2 text-slate-300 hover:border-reactor hover:text-reactor" aria-label="Close devices">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <p className="mb-4 text-sm text-slate-400">
            New computers appear here as pending. Approve only machines you installed yourself.
          </p>
          <div className="grid gap-4">
            {devices.length === 0 && (
              <div className="rounded border border-slate-800 p-4 text-sm text-slate-400">
                No computers have reported in yet, Sir.
              </div>
            )}
            {devices.map((device) => (
              <article key={device.id} className="rounded border border-reactor/20 bg-reactor/5 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-slate-100">{device.name}</h3>
                      {device.is_default && (
                        <span className="inline-flex items-center gap-1 rounded border border-reactor/40 px-2 py-1 text-xs uppercase tracking-[0.14em] text-reactor">
                          <Star size={12} /> Default
                        </span>
                      )}
                      <span className={`rounded border px-2 py-1 text-xs uppercase tracking-[0.14em] ${
                        device.status === 'approved'
                          ? 'border-reactor/40 text-reactor'
                          : device.status === 'pending'
                            ? 'border-warning/40 text-warning'
                            : 'border-slate-600 text-slate-400'
                      }`}>
                        {device.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{device.platform}</p>
                    <p className="mt-1 break-all text-xs text-slate-500">{device.device_key}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Last seen: {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'not yet'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => approve(device.id)}
                      disabled={device.status === 'approved'}
                      className="inline-flex items-center gap-2 rounded border border-reactor/40 px-3 py-2 text-sm font-semibold text-reactor disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Check size={16} /> Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => saveDevice(device.id)}
                      className="inline-flex items-center gap-2 rounded border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-reactor hover:text-reactor"
                    >
                      <Save size={16} /> Save
                    </button>
                    <button
                      type="button"
                      onClick={() => revoke(device.id)}
                      disabled={device.status === 'revoked'}
                      className="inline-flex items-center gap-2 rounded border border-warning/40 px-3 py-2 text-sm font-semibold text-warning disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ShieldAlert size={16} /> Revoke
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 rounded border border-slate-800 bg-void/35 p-3 md:grid-cols-[1fr_auto] md:items-end">
                  <label className="text-xs uppercase tracking-[0.16em] text-slate-400">
                    Computer name
                    <input
                      value={drafts[device.id]?.name || ''}
                      onChange={(event) => updateDraft(device.id, { name: event.target.value })}
                      placeholder="My computer"
                      className="mt-2 w-full rounded border border-slate-700 bg-void/75 px-3 py-3 text-sm normal-case tracking-normal text-slate-100 outline-none placeholder:text-slate-500 focus:border-reactor"
                    />
                  </label>
                  <label className="inline-flex min-h-12 items-center gap-3 rounded border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200">
                    <input
                      type="checkbox"
                      checked={Boolean(drafts[device.id]?.isDefault)}
                      onChange={(event) => updateDraft(device.id, { isDefault: event.target.checked })}
                      className="h-4 w-4 accent-cyan-400"
                    />
                    Use as default
                  </label>
                </div>

                {device.status === 'approved' && (
                  <form
                    className="mt-4 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      sendCommand(device);
                    }}
                  >
                    <input
                      value={commands[device.id] || ''}
                      onChange={(event) => setCommands((current) => ({ ...current, [device.id]: event.target.value }))}
                      placeholder="Open Telegram, play music, close Chrome..."
                      className="min-w-0 flex-1 rounded border border-slate-700 bg-void/75 px-3 py-3 text-sm outline-none placeholder:text-slate-500 focus:border-reactor"
                    />
                    <button type="submit" className="inline-flex items-center gap-2 rounded bg-reactor px-4 py-3 text-sm font-semibold text-void hover:bg-cyan-300">
                      <Send size={16} /> Send
                    </button>
                  </form>
                )}
              </article>
            ))}
          </div>
        </div>

        <div className="border-t border-reactor/20 px-5 py-4">
          <p className="min-h-5 text-sm text-slate-300">{message}</p>
        </div>
      </section>
    </div>
  );
}
