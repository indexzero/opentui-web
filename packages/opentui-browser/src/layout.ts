// Lightweight yoga-driven layout for opentui scenes.
//
// Compose a scene as a plain data tree, hand it to `layoutAndDraw(scene, buf)`,
// and yoga computes the boxes. Each scene-node has a small drawing contract
// (border, background, text); custom nodes get a callback with their resolved
// rect for fully manual drawing.
//
// This is *not* a reconciler. Scenes are rebuilt by the caller each frame
// (typically via useMemo over React state). Yoga node creation is cheap, so
// rebuilding 50-100 nodes per frame is well under a millisecond.

import Yoga, { Align, Direction, Edge, FlexDirection, Gutter, Justify } from 'yoga-layout'
import type { Node as YogaNode } from 'yoga-layout'
import { drawBorder, drawString, fillRect } from './draw-helpers'
import type { OpentuiBuffer, RGBA } from './buffer'

const TRANSPARENT: RGBA = [0, 0, 0, 0]
const WHITE: RGBA = [1, 1, 1, 1]

export type StackDirection = 'row' | 'column'
export type AlignAxis = 'start' | 'center' | 'end' | 'stretch' | 'space-between' | 'space-around'

export interface BoxProps {
  width?: number | `${number}%` | 'auto'
  height?: number | `${number}%` | 'auto'
  flex?: number
  flexGrow?: number
  flexShrink?: number
  direction?: StackDirection
  padding?: number
  paddingX?: number
  paddingY?: number
  gap?: number
  align?: AlignAxis // align cross-axis items
  justify?: AlignAxis // distribute main-axis
  border?: { color: RGBA; title?: string }
  bg?: RGBA
  children?: SceneNode[]
}

export interface TextProps {
  content: string
  color?: RGBA
  bg?: RGBA
  attrs?: number
  width?: number | 'auto'
  height?: number | 'auto'
  flex?: number
}

export interface CustomProps {
  width?: number | 'auto'
  height?: number | 'auto'
  flex?: number
  draw: (buf: OpentuiBuffer, rect: Rect) => void
}

export type SceneNode =
  | ({ type: 'box' } & BoxProps)
  | ({ type: 'text' } & TextProps)
  | ({ type: 'custom' } & CustomProps)

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export function box(props: BoxProps): SceneNode {
  return { type: 'box', ...props }
}
export function text(props: TextProps): SceneNode {
  return { type: 'text', ...props }
}
export function custom(props: CustomProps): SceneNode {
  return { type: 'custom', ...props }
}

function buildYogaTree(node: SceneNode): YogaNode {
  const n = Yoga.Node.create()

  if (node.type === 'box') {
    if (node.width !== undefined) n.setWidth(node.width)
    if (node.height !== undefined) n.setHeight(node.height)
    if (node.flex !== undefined) n.setFlex(node.flex)
    if (node.flexGrow !== undefined) n.setFlexGrow(node.flexGrow)
    if (node.flexShrink !== undefined) n.setFlexShrink(node.flexShrink)
    if (node.direction) {
      n.setFlexDirection(node.direction === 'row' ? FlexDirection.Row : FlexDirection.Column)
    }
    if (node.padding !== undefined) n.setPadding(Edge.All, node.padding)
    if (node.paddingX !== undefined) {
      n.setPadding(Edge.Left, node.paddingX)
      n.setPadding(Edge.Right, node.paddingX)
    }
    if (node.paddingY !== undefined) {
      n.setPadding(Edge.Top, node.paddingY)
      n.setPadding(Edge.Bottom, node.paddingY)
    }
    if (node.gap !== undefined) n.setGap(Gutter.All, node.gap)
    if (node.align) n.setAlignItems(alignFromString(node.align))
    if (node.justify) n.setJustifyContent(justifyFromString(node.justify))

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        n.insertChild(buildYogaTree(node.children[i]!), i)
      }
    }
  } else if (node.type === 'text' || node.type === 'custom') {
    if (node.width !== undefined) n.setWidth(node.width as number | 'auto')
    if (node.height !== undefined) n.setHeight(node.height as number | 'auto')
    if (node.flex !== undefined) n.setFlex(node.flex)
    if (node.type === 'text' && node.height === undefined) n.setHeight(1)
    if (node.type === 'text' && node.width === undefined) n.setWidth(node.content.length)
  }

  return n
}

function alignFromString(a: AlignAxis): Align {
  switch (a) {
    case 'start': return Align.FlexStart
    case 'center': return Align.Center
    case 'end': return Align.FlexEnd
    case 'stretch': return Align.Stretch
    case 'space-between': return Align.SpaceBetween
    case 'space-around': return Align.SpaceAround
  }
}

function justifyFromString(j: AlignAxis): Justify {
  switch (j) {
    case 'start': return Justify.FlexStart
    case 'center': return Justify.Center
    case 'end': return Justify.FlexEnd
    case 'space-between': return Justify.SpaceBetween
    case 'space-around': return Justify.SpaceAround
    case 'stretch': return Justify.FlexStart // yoga has no Stretch on Justify
  }
}

function drawTree(
  node: SceneNode,
  yogaNode: YogaNode,
  buf: OpentuiBuffer,
  offsetX: number,
  offsetY: number,
) {
  const layout = yogaNode.getComputedLayout()
  const x = Math.round(offsetX + layout.left)
  const y = Math.round(offsetY + layout.top)
  const w = Math.round(layout.width)
  const h = Math.round(layout.height)
  if (w <= 0 || h <= 0) return

  if (node.type === 'box') {
    if (node.bg) fillRect(buf, x, y, w, h, node.bg)
    if (node.border) {
      drawBorder(buf, x, y, w, h, node.border.color, node.border.title)
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]!
        const childYoga = yogaNode.getChild(i)
        drawTree(child, childYoga, buf, x, y)
      }
    }
  } else if (node.type === 'text') {
    drawString(buf, node.content, x, y, node.color ?? WHITE, node.bg ?? TRANSPARENT, node.attrs ?? 0)
  } else if (node.type === 'custom') {
    node.draw(buf, { x, y, width: w, height: h })
  }
}

export function layoutAndDraw(scene: SceneNode, buf: OpentuiBuffer) {
  const root = buildYogaTree(scene)
  root.calculateLayout(buf.width, buf.height, Direction.LTR)
  drawTree(scene, root, buf, 0, 0)
  root.freeRecursive()
}
