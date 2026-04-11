import React from 'react';

export default function ArcReactor({ status, audioLevel = 0 }) {
  const speaking = status === 'SPEAKING';
  const listening = status === 'LISTENING';
  const level = Math.min(1, Math.max(0, audioLevel));

  return (
    <section className="flex min-h-[420px] flex-col items-center justify-center gap-8 px-4">
      <div className={`relative h-72 w-72 sm:h-96 sm:w-96 ${speaking ? 'reactor-speaking' : ''}`}>
        <div className="absolute inset-0 rounded-full border border-reactor/20 shadow-reactor" />
        <div className="reactor-ring absolute inset-6 rounded-full border-2 border-dashed border-reactor/55" />
        <div className="reactor-ring absolute inset-14 rounded-full border border-warning/45" style={{ animationDirection: 'reverse', animationDuration: '9s' }} />
        <div className="absolute inset-24 rounded-full border-4 border-reactor/70 bg-void shadow-reactor" />
        <div className="absolute inset-[42%] rounded-full bg-reactor shadow-reactor" />
        <div className="absolute left-1/2 top-1/2 flex h-40 w-40 -translate-x-1/2 -translate-y-1/2 items-end justify-center gap-1">
          {Array.from({ length: 28 }).map((_, index) => (
            <span
              key={index}
              className="wave-bar w-1 rounded-full bg-reactor"
              style={{
                animationDelay: `${index * 45}ms`,
                opacity: listening || speaking ? 0.9 : 0.28,
                height: `${18 + level * 70}%`
              }}
            />
          ))}
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.24em] text-reactor/80">ARC voice core</p>
        <p className="mt-2 max-w-xl text-lg text-slate-200">
          {status === 'IDLE' && 'Passive monitoring paused.'}
          {status === 'LISTENING' && 'Listening, Sir.'}
          {status === 'THINKING' && 'Cross-referencing the obvious with the improbable.'}
          {status === 'SPEAKING' && 'Responding.'}
          {status === 'ERROR' && 'Voice systems degraded. Text operations remain online.'}
        </p>
      </div>
    </section>
  );
}
