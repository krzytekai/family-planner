export function PushPermissionPrompt({ busy, onEnable, onLater }: { busy: boolean; onEnable: () => void; onLater: () => void }) {
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
    <section role="dialog" aria-modal="true" aria-labelledby="push-permission-title" className="w-full max-w-sm rounded-2xl border border-brand-gold/15 bg-brand-bg p-5 shadow-2xl">
      <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-brand-gold">Powiadomienia Android</p>
      <h2 id="push-permission-title" className="mt-1 text-lg font-semibold">Włącz powiadomienia</h2>
      <p className="mt-2 text-sm leading-relaxed text-brand-muted">Planer rodzinny może przypominać Ci o zadaniach i wydarzeniach również wtedy, gdy aplikacja jest zamknięta.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onLater} className="min-h-11 rounded-xl px-4 text-sm text-brand-muted hover:bg-white/5 disabled:opacity-50">Później</button>
        <button type="button" disabled={busy} onClick={onEnable} className="min-h-11 rounded-xl bg-brand-gold px-4 text-sm font-semibold text-black disabled:opacity-50">{busy ? 'Włączanie…' : 'Włącz'}</button>
      </div>
    </section>
  </div>
}
