import ReactDOM from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

// Vite sets BASE_URL from the `base` config — '/' for local dev, '/opentui-web/'
// when built for GitHub Pages. TanStack Router needs the same prefix passed via
// its own basepath option so internally-generated URLs land at the right place.
const baseUrl = import.meta.env.BASE_URL
const basepath = baseUrl === '/' ? undefined : baseUrl.replace(/\/$/, '')

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  basepath,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('app')!

if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(<RouterProvider router={router} />)
}
