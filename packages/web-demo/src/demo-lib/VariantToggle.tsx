interface VariantToggleProps<T extends string> {
  value: T
  options: ReadonlyArray<{ key: T; label: string; hint?: string }>
  onChange: (next: T) => void
}

export function VariantToggle<T extends string>({ value, options, onChange }: VariantToggleProps<T>) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-white/5 bg-white/[0.03] p-0.5 font-mono text-xs">
      {options.map((opt) => {
        const active = opt.key === value
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            title={opt.hint}
            className={
              'rounded px-2 py-0.5 transition-colors ' +
              (active
                ? 'bg-white/15 text-white'
                : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80')
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
