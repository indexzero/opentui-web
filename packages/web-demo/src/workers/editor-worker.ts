import { createEditorKernel } from '../demo-lib/editor-kernel'
import { runWorker } from './run-worker'

const { draw, handleInput } = createEditorKernel()
runWorker(draw, handleInput)
