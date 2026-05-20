import { Link, Outlet, createRootRoute } from '@tanstack/react-router'

import '../styles.css'

const TABS = [
  { to: '/plasma', label: 'plasma' },
  { to: '/matrix', label: 'matrix' },
  { to: '/counter', label: 'counter' },
  { to: '/dashboard', label: 'dashboard' },
  { to: '/editor', label: 'editor' },
  { to: '/layout', label: 'layout' },
] as const

export const Route = createRootRoute({ component: RootComponent })

function RootComponent() {
  return (
    <div className="flex h-screen flex-col bg-[#0b0b14] text-[#c0caf5]">
      <header className="flex items-baseline gap-6 border-b border-white/5 px-4 py-2">
        <h1 className="font-mono text-sm">open-tui-ghostty-web</h1>
        <nav className="flex gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.to}
              to={tab.to}
              className="rounded px-2.5 py-1 font-mono text-xs text-white/50 transition-colors hover:text-white/80"
              activeProps={{ className: 'bg-white/10 text-white' }}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
