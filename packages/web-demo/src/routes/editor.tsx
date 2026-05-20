import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { createEditorKernel } from '../demo-lib/editor-kernel'
import { VariantPicker } from '../demo-lib/VariantPicker'

export const Route = createFileRoute('/editor')({ component: EditorPage })

const editorWorkerFactory = () =>
  new Worker(new URL('../workers/editor-worker.ts', import.meta.url), { type: 'module' })

function EditorPage() {
  // The kernel owns its EditBuffer in closure — same instance across frames
  // for the main-thread variants. The worker variant has its own kernel
  // instance inside the worker; main-thread keystrokes are forwarded.
  const { draw, handleInput } = useMemo(() => createEditorKernel(), [])
  return (
    <VariantPicker
      title="editor"
      subtitle="opentui EditBuffer · type to edit · arrows / backspace / enter"
      draw={draw}
      workerFactory={editorWorkerFactory}
      onInput={handleInput}
      defaultEncoder="diff"
    />
  )
}
