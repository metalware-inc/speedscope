import {Rect, Vec2, AffineTransform} from '../lib/math'
import {Color} from '../lib/color'
import {Graphics} from './graphics'
import {setUniformAffineTransform} from './utils'
import DynamicTypedArray from 'dynamic-typed-array'

const vertexFormat = new Graphics.VertexFormat()
vertexFormat.add('configSpacePos', Graphics.AttributeType.FLOAT, 2)
vertexFormat.add('color', Graphics.AttributeType.FLOAT, 3)

const vert = `
  uniform mat3 configSpaceToNDC;

  attribute vec2 configSpacePos;
  attribute vec3 color;
  varying vec3 vColor;

  void main() {
    vColor = color;
    vec2 position = (configSpaceToNDC * vec3(configSpacePos, 1)).xy;
    gl_Position = vec4(position, 1, 1);
  }
`

const frag = `
  precision mediump float;
  varying vec3 vColor;

  void main() {
    gl_FragColor = vec4(vColor.rgb, 1);
  }
`

export class RectangleBatch {
  // TODO: is Uint16 enough for each coordinate? Are they screen coordinates in pixels?
  // Layout: origin.x, origin.y, size.x, size.y
  private smartRects = new DynamicTypedArray<Float32Array>(Float32Array)
  // Layout: red, green, blue, alpha
  private smartColors = new DynamicTypedArray<Uint8Array>(Uint8Array)

  getRect(index: number): Rect {
    return new Rect(
      new Vec2(this.smartRects.get(index * 4), this.smartRects.get(index * 4 + 1)),
      new Vec2(this.smartRects.get(index * 4 + 2), this.smartRects.get(index * 4 + 3)),
    )
  }
  pushRect(rect: Rect) {
    this.smartRects.push(rect.origin.x, rect.origin.y, rect.size.x, rect.size.y)
  }

  getColor(index: number): Color {
    return new Color(
      this.smartColors.get(4 * index) / 255.0,
      this.smartColors.get(4 * index + 1) / 255.0,
      this.smartColors.get(4 * index + 2) / 255.0,
      this.smartColors.get(4 * index + 3) / 255.0,
    )
  }
  pushColor(color: Color) {
    this.smartColors.push(
      Math.round(color.r * 255),
      Math.round(color.g * 255),
      Math.round(color.b * 255),
      Math.round(color.a * 255),
    )
  }

  constructor(private gl: Graphics.Context) {}

  getRectCount() {
    return this.smartRects.size() / 4
  }

  private buffer: Graphics.VertexBuffer | null = null
  getBuffer(): Graphics.VertexBuffer {
    if (this.buffer) {
      return this.buffer
    }

    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 0],
      [0, 1],
      [1, 1],
    ]

    const bytes = new Uint8Array(vertexFormat.stride * corners.length * this.getRectCount())
    const floats = new Float32Array(bytes.buffer)
    let idx = 0

    for (let i = 0; i < this.getRectCount(); i++) {
      const rect = this.getRect(i)
      const color = this.getColor(i)

      // TODO(jlfwong): In the conversion from regl to graphics.ts, I lost the
      // ability to do instanced drawing. This is a pretty significant hit to
      // the performance here since I need 6x the memory to allocate these
      // things. Adding instanced drawing to graphics.ts is non-trivial, so I'm
      // just going to try this for now.
      for (let corner of corners) {
        floats[idx++] = rect.origin.x + corner[0] * rect.size.x
        floats[idx++] = rect.origin.y + corner[1] * rect.size.y

        floats[idx++] = color.r
        floats[idx++] = color.g
        floats[idx++] = color.b
      }
    }

    if (idx !== floats.length) {
      throw new Error("Buffer expected to be full but wasn't")
    }

    this.buffer = this.gl.createVertexBuffer(bytes.length)
    this.buffer.upload(bytes)
    return this.buffer
  }

  addRect(rect: Rect, color: Color) {
    this.pushRect(rect)
    this.pushColor(color)

    if (this.buffer) {
      this.buffer.free()
      this.buffer = null
    }
  }

  free() {
    if (this.buffer) {
      this.buffer.free()
      this.buffer = null
    }
  }
}

export interface RectangleBatchRendererProps {
  batch: RectangleBatch
  configSpaceSrcRect: Rect
  physicalSpaceDstRect: Rect
}

export class RectangleBatchRenderer {
  material: Graphics.Material
  constructor(private gl: Graphics.Context) {
    this.material = gl.createMaterial(vertexFormat, vert, frag)
  }

  render(props: RectangleBatchRendererProps) {
    setUniformAffineTransform(
      this.material,
      'configSpaceToNDC',
      (() => {
        const configToPhysical = AffineTransform.betweenRects(
          props.configSpaceSrcRect,
          props.physicalSpaceDstRect,
        )

        const viewportSize = new Vec2(this.gl.viewport.width, this.gl.viewport.height)

        const physicalToNDC = AffineTransform.withTranslation(new Vec2(-1, 1)).times(
          AffineTransform.withScale(new Vec2(2, -2).dividedByPointwise(viewportSize)),
        )

        return physicalToNDC.times(configToPhysical)
      })(),
    )

    this.gl.setUnpremultipliedBlendState()
    this.gl.draw(Graphics.Primitive.TRIANGLES, this.material, props.batch.getBuffer())
  }
}
