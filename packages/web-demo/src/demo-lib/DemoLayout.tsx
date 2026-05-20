import type { RefObject } from 'react'

interface Props {
  title: string
  subtitle?: string
  status: 'loading' | 'ready' | 'error'
  fps?: number
  bytesPerFrame?: number
  encoderMode?: 'full' | 'diff'
  error?: string | null
  hostRef: RefObject<HTMLDivElement | null>
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function DemoFrame({ title, subtitle, status, fps, bytesPerFrame, encoderMode, error, hostRef }: Props) {
  return (
    <main className="flex flex-1 flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <div>
          <span className="font-mono text-sm">{title}</span>
          {subtitle ? (
            <span className="ml-3 font-mono text-xs text-white/40">{subtitle}</span>
          ) : null}
        </div>
        <div className="font-mono text-xs">
          <span className={status === 'ready' ? 'text-[#9ece6a]' : 'text-white/50'}>{status}</span>
          {status === 'ready' && fps !== undefined ? (
            <span className="ml-3 text-[#7aa2f7]">{fps} fps</span>
          ) : null}
          {status === 'ready' && bytesPerFrame !== undefined && bytesPerFrame > 0 ? (
            <span className="ml-3 text-white/60">
              {formatBytes(bytesPerFrame)}/frame
              {encoderMode === 'diff' ? <span className="ml-1 text-[#bb9af7]">diff</span> : null}
            </span>
          ) : null}
          {error ? <span className="ml-3 text-[#f7768e]">{error}</span> : null}
        </div>
      </div>
      <div
        ref={hostRef}
        className="flex-1 overflow-hidden rounded-md border border-white/5"
      />
    </main>
  )
}
