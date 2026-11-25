/**
 * 真实 WebGL 折射透镜的渲染核心（配方提取自 WinIsland Lens 展示页）。
 *
 * 浏览器无法直接把 DOM 当作 WebGL 纹理，所以这里沿用参考页的做法：
 * 把「元素背后的画面场」预先画进一张离屏 2D canvas，作为 uTexture 上传；
 * fragment shader 用圆角矩形 SDF 求边缘法线，按 Snell 定律偏折采样 uv，
 * 再叠加 RGB 分通道色散、菲涅尔边缘高光和顶部 sheen。
 *
 * 本文件不依赖 React，只管理一个 canvas / 一个 WebGL 上下文的生命周期。
 */

export type MaterialPreset = 'clear' | 'soft' | 'thick'

export interface GlassMaterial {
  /** 折射强度 0-1：控制玻璃折射率映射后的采样偏移量 */
  refraction: number
  /** 模糊强度 0-1：控制九点取样的采样半径 */
  blur: number
  /** 色散强度 0-1：控制 RGB 三通道的分离距离 */
  dispersion: number
  /** 折射厚度倍率，参考页中 thickness = (14 + refraction * 54) * scale */
  thickness?: number
  /** 乳白染色量 0-1，越大越像磨砂玻璃 */
  tint?: number
}

export type MaterialInput = MaterialPreset | GlassMaterial

/** 对齐参考页 tokens.materials 的三档预设，并补上 thickness / tint。 */
export const MATERIAL_PRESETS: Record<MaterialPreset, GlassMaterial> = {
  clear: { refraction: 0.65, blur: 0.12, dispersion: 0.35, thickness: 0.78, tint: 0.06 },
  soft: { refraction: 0.38, blur: 0.64, dispersion: 0.12, thickness: 0.95, tint: 0.16 },
  thick: { refraction: 0.9, blur: 0.24, dispersion: 0.65, thickness: 1.3, tint: 0.1 },
}

export function resolveMaterial(input: MaterialInput | undefined): GlassMaterial {
  if (!input) return MATERIAL_PRESETS.soft
  if (typeof input === 'string') return MATERIAL_PRESETS[input] || MATERIAL_PRESETS.soft
  return {
    refraction: clamp01(input.refraction),
    blur: clamp01(input.blur),
    dispersion: clamp01(input.dispersion),
    thickness: clamp(input.thickness ?? 1, 0.2, 2.5),
    tint: clamp01(input.tint ?? 0.1),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clamp01(value: number): number {
  return clamp(value, 0, 1)
}

/* ───────────────────────── shader 源码 ───────────────────────── */

/**
 * 顶点着色器：绘制一个屏幕矩形，vPixel 使用「左下原点」的设备像素坐标，
 * 与 WebGL 纹理坐标、SDF 计算保持一致。
 */
const VERTEX_SHADER = `
attribute vec2 aPosition;
uniform vec2 uResolution;
uniform vec4 uQuad;
varying vec2 vPixel;
void main() {
  vPixel = uQuad.xy + (aPosition * 0.5 + 0.5) * uQuad.zw;
  gl_Position = vec4(vPixel / uResolution * 2.0 - 1.0, 0.0, 1.0);
}
`

/**
 * 片元着色器：完整折射配方。
 * 1) roundedBox SDF + 有限差分求法线；
 * 2) refract(air -> glass, eta = 1/1.45) 得到偏折采样点；
 * 3) 九点模糊 + RGB 分离色散；
 * 4) 定向光/反向光/presnel/轮廓线构成 rim light，外加顶部 sheen；
 * 5) SDF 抗锯齿 mask 作为 alpha，透镜之外透明，露出真实 DOM。
 */
const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D uTexture;
uniform vec2 uResolution;
uniform vec4 uBox;        // x, y(左下), w, h，设备像素
uniform vec2 uFollow;     // 跟手位移，设备像素
uniform float uRadius;    // 圆角半径，设备像素
uniform float uScale;     // dpr，用于把常数缩放到设备像素
uniform float uRefraction;
uniform float uBlur;
uniform float uDispersion;
uniform float uThickness;
uniform float uTint;
uniform vec2 uPointer;    // 指针位置，左下原点，设备像素
uniform vec2 uBend;       // jelly 弯曲量，设备像素
uniform float uPressure;  // 按压量 0-1
uniform float uOpacity;

varying vec2 vPixel;

float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float surfaceDistance(vec2 p, vec2 b) {
  // 拖动时四角相对固定、中部鼓起；同一形状同时驱动轮廓、法线与高光。
  vec2 q = clamp(p / max(b, vec2(1.0)), vec2(-1.3), vec2(1.3));
  vec2 bent = p - uBend * vec2(1.0 - q.y * q.y, 1.0 - q.x * q.x) * 0.7;
  float r = min(uRadius * (1.0 + uPressure * 0.15), min(b.x, b.y));
  return roundedBox(bent, b, r);
}

vec3 sampleScene(vec2 px) {
  vec2 uv = clamp(px / uResolution, vec2(0.001), vec2(0.999));
  return texture2D(uTexture, uv).rgb;
}

// 九点加权取样：中心 0.24，四轴各 0.12，四斜角各 0.07，总和约为 1。
vec3 blurred(vec2 px, float blur) {
  vec3 c = sampleScene(px) * 0.24;
  c += sampleScene(px + vec2(blur, 0.0)) * 0.12;
  c += sampleScene(px - vec2(blur, 0.0)) * 0.12;
  c += sampleScene(px + vec2(0.0, blur)) * 0.12;
  c += sampleScene(px - vec2(0.0, blur)) * 0.12;
  c += sampleScene(px + vec2(blur, blur) * 0.707) * 0.07;
  c += sampleScene(px - vec2(blur, blur) * 0.707) * 0.07;
  c += sampleScene(px + vec2(blur, -blur) * 0.707) * 0.07;
  c += sampleScene(px + vec2(-blur, blur) * 0.707) * 0.07;
  return c;
}

void main() {
  vec2 center = uBox.xy + uBox.zw * 0.5 + uFollow;
  vec2 b = uBox.zw * 0.5;
  vec2 p = vPixel - center;
  float d = surfaceDistance(p, b);

  // SDF 之外直接丢弃，让下层 DOM 透出来（透明混合）。
  if (d > 1.5 * uScale) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec3 base = sampleScene(vPixel);
  float e = 0.7 * uScale;
  vec2 n2 = normalize(vec2(
    surfaceDistance(p + vec2(e, 0.0), b) - surfaceDistance(p - vec2(e, 0.0), b),
    surfaceDistance(p + vec2(0.0, e), b) - surfaceDistance(p - vec2(0.0, e), b)
  ) + vec2(0.00001));

  float bevel = min(min(b.x, b.y) * 0.48, 19.0 * uScale);
  float edge = clamp(1.0 + d / bevel, 0.0, 1.0);
  float slope = pow(edge, 1.65) * 0.94;
  vec2 faceNormal = clamp(p / max(b, vec2(1.0)), vec2(-1.0), vec2(1.0)) * 0.045 * (1.0 - edge);
  vec2 normalXY = n2 * slope + faceNormal;
  vec3 normal = vec3(normalXY, sqrt(max(1.0 - dot(normalXY, normalXY), 0.001)));

  // Snell 定律：空气 1.0 进入玻璃 1.45，按厚度把射线投回背景场。
  vec3 ray = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / 1.45);
  float thickness = (14.0 + uRefraction * 54.0) * uScale * uThickness * (1.0 + uPressure * 0.13);
  vec2 offset = ray.xy / max(-ray.z, 0.05) * thickness * uRefraction;
  offset -= p * 0.016 * uRefraction; // 轻微放大，模拟透镜中心
  vec2 at = vPixel + offset;

  float blur = uBlur * 10.0 * uScale;
  vec3 c = blurred(at, blur);

  // 色散：红蓝通道沿法线朝相反方向各偏移一点，边缘最明显。
  vec2 split = n2 * pow(edge, 2.8) * uDispersion * 2.6 * uScale;
  c.r += (sampleScene(at + split).r - sampleScene(at).r) * 0.8;
  c.b += (sampleScene(at - split).b - sampleScene(at).b) * 0.8;

  // 轻微提饱和 + 乳白染色，避免折射后的场发灰。
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, 1.035);
  c = mix(c, vec3(0.97, 0.985, 1.0), uTint + uBlur * 0.12);

  // rim light：定向高光 + 反向弱高光 + 菲涅尔 + 轮廓线。
  vec2 light = normalize(uPointer - center + vec2(-80.0, 150.0) * uScale);
  float directional = pow(max(dot(n2, light), 0.0), 7.0);
  float opposite = pow(max(dot(n2, -light), 0.0), 7.0) * 0.52;
  float fresnel = 0.04 + 0.96 * pow(1.0 - normal.z, 5.0);
  float outline = 1.0 - smoothstep(0.12 * uScale, 1.1 * uScale, abs(d + 0.65 * uScale));
  float edgeLight = (directional + opposite) * pow(edge, 4.0);
  float spec = edgeLight * 0.065 + outline * (0.018 + directional * 0.35 + opposite * 0.15);
  spec += fresnel * 0.035;
  vec3 environment = sampleScene(vPixel + n2 * 34.0 * uScale);
  c = mix(c, environment, fresnel * 0.12);
  c += mix(vec3(1.0), environment, 0.18) * spec;

  // 边缘下方的焦散亮线与跟随指针的宽幅柔光。
  float caustic = exp(-pow((d + 3.0 * uScale) / (1.65 * uScale), 2.0));
  c += caustic * opposite * 0.038;
  float glint = exp(-length((vPixel - uPointer) / vec2(180.0, 150.0) / uScale) * 2.0);
  c += glint * 0.024;

  // 顶部 sheen：靠近上边缘的一条细亮带，底部极淡内阴影。
  float vLocal = clamp((vPixel.y - uBox.y - uFollow.y) / max(uBox.w, 1.0), 0.0, 1.0);
  float topBand = exp(-pow((vLocal - 0.94) / 0.055, 2.0));
  c += vec3(1.0) * topBand * 0.045;
  c *= 1.0 - 0.045 * exp(-pow(vLocal / 0.11, 2.0));

  float aa = max(0.75 * uScale, 0.5);
  float mask = 1.0 - smoothstep(-aa, aa, d);
  gl_FragColor = vec4(c, mask * uOpacity);
}
`

/* ───────────────────────── 背景场绘制 ───────────────────────── */

/** 按顶层逗号切分，忽略括号内部的逗号（例如 rgba(...)）。 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(input.slice(start).trim())
  return parts.filter(Boolean)
}

/** 解析 CSS 线性渐变方向，返回 CSS 度数约定（0 向上，顺时针）。 */
function parseLinearAngle(first: string): number {
  const deg = first.match(/^(-?\d+(?:\.\d+)?)deg$/i)
  if (deg) return parseFloat(deg[1])
  const directions: Record<string, number> = {
    'to top': 0,
    'to top right': 45,
    'to right top': 45,
    'to right': 90,
    'to bottom right': 135,
    'to right bottom': 135,
    'to bottom': 180,
    'to bottom left': 225,
    'to left bottom': 225,
    'to left': 270,
    'to top left': 315,
    'to left top': 315,
  }
  return directions[first.toLowerCase()] ?? 180
}

/** 把 color / color 50% / color 12px 解析成 CanvasGradient 停靠点。 */
function addStops(gradient: CanvasGradient, stops: string[], length: number): void {
  const parsed = stops.map((stop) => {
    const match = stop.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)(%|px)$/i)
    if (!match) return { color: stop, pos: -1 }
    const value = parseFloat(match[2])
    const pos = match[3].toLowerCase() === '%' ? value / 100 : value / Math.max(length, 1)
    return { color: match[1].trim(), pos }
  })

  // 为未标注位置的停靠点补位置：按连续隐式段在左右显式锚点之间等距分布。
  let index = 0
  while (index < parsed.length) {
    if (parsed[index].pos >= 0) {
      index++
      continue
    }
    const start = index
    while (index < parsed.length && parsed[index].pos < 0) index++
    const end = index // 开区间 [start, end) 是待补全的隐式段
    const left = start > 0 ? parsed[start - 1].pos : 0
    const right = end < parsed.length ? parsed[end].pos : 1
    for (let i = start; i < end; i++) {
      parsed[i].pos = left + ((right - left) * (i - start + 1)) / (end - start + 1)
    }
  }

  parsed.forEach((stop) => {
    try {
      gradient.addColorStop(clamp01(stop.pos), stop.color)
    } catch {
      // 非法色值直接跳过，保留其余停靠点。
    }
  })
}

function isImageSource(value: string): boolean {
  return /^(data:image\/|blob:|https?:\/\/|\/|\.\/|\.\.\/)/i.test(value) || /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(value)
}

/**
 * 把 background 字符串画进离屏 canvas。
 * 支持：内置彩光场（默认）、CSS linear/radial-gradient、纯色、图片 URL/dataUrl。
 * 图片异步加载完成后通过 onReady 回调重新上传纹理。
 */
export function paintBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  background: string | undefined,
  onReady: () => void,
): void {
  ctx.clearRect(0, 0, width, height)
  if (background && isImageSource(background)) {
    const image = new Image()
    image.onload = () => {
      // object-fit: cover
      const scale = Math.max(width / Math.max(image.width, 1), height / Math.max(image.height, 1))
      const w = image.width * scale
      const h = image.height * scale
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
      onReady()
    }
    image.onerror = () => {
      paintDefaultField(ctx, width, height)
      onReady()
    }
    if (!/^data:image\//i.test(background)) image.crossOrigin = 'anonymous'
    image.src = background
    paintDefaultField(ctx, width, height)
    return
  }

  const value = (background || '').trim()
  let painted = false
  if (/^linear-gradient\(/i.test(value)) {
    const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'))
    const parts = splitTopLevel(inner)
    if (parts.length >= 2) {
      const angle = parseLinearAngle(parts[0])
      const a = (angle * Math.PI) / 180
      const dx = Math.sin(a)
      const dy = -Math.cos(a)
      const length = Math.abs(width * dx) + Math.abs(height * dy)
      const cx = width / 2
      const cy = height / 2
      const gradient = ctx.createLinearGradient(cx - (dx * length) / 2, cy - (dy * length) / 2, cx + (dx * length) / 2, cy + (dy * length) / 2)
      addStops(gradient, parts.slice(1), length)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
      painted = true
    }
  } else if (/^radial-gradient\(/i.test(value)) {
    const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'))
    const parts = splitTopLevel(inner)
    const at = inner.match(/at\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/i)
    const cx = at ? (parseFloat(at[1]) / 100) * width : width / 2
    const cy = at ? (parseFloat(at[2]) / 100) * height : height / 2
    const radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy))
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    addStops(gradient, parts.filter((part) => !/^(circle|ellipse|at\s)/i.test(part)), radius)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    painted = true
  } else if (value) {
    try {
      ctx.fillStyle = value
      ctx.fillRect(0, 0, width, height)
      painted = true
    } catch {
      // 不支持的色串回退到默认场
    }
  }
  if (painted) {
    paintStructure(ctx, width, height)
  } else {
    paintDefaultField(ctx, width, height)
  }
}

/** 内置柔和彩光场：蓝紫绿底 + 径向光斑 + 弧形色带 + 细点阵。 */
function paintDefaultField(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const base = ctx.createLinearGradient(0, 0, width, height)
  base.addColorStop(0, '#d9e8fb')
  base.addColorStop(0.38, '#c9d4f8')
  base.addColorStop(0.7, '#d7eee6')
  base.addColorStop(1, '#f1dcef')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, width, height)

  const glows: Array<[number, number, number, string]> = [
    [0.12, 0.18, 0.62, 'rgba(96,165,250,0.42)'],
    [0.82, 0.22, 0.55, 'rgba(167,139,250,0.36)'],
    [0.24, 0.82, 0.58, 'rgba(110,231,183,0.34)'],
    [0.88, 0.78, 0.5, 'rgba(244,163,205,0.28)'],
  ]
  glows.forEach(([x, y, r, color]) => {
    const gradient = ctx.createRadialGradient(width * x, height * y, 0, width * x, height * y, Math.max(width, height) * r)
    gradient.addColorStop(0, color)
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  })
  paintStructure(ctx, width, height)
}

/** 叠加弧形色带与细点阵，让折射扭曲在截图/肉眼下有明确参照物。 */
function paintStructure(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const ribbons: Array<[number, string, string]> = [
    [-0.26, 'rgba(255,255,255,0.30)', 'rgba(147,197,253,0.22)'],
    [-0.02, 'rgba(167,139,250,0.20)', 'rgba(191,219,254,0.26)'],
    [0.24, 'rgba(110,231,183,0.20)', 'rgba(196,181,253,0.24)'],
    [0.5, 'rgba(244,163,205,0.18)', 'rgba(253,230,138,0.18)'],
  ]
  ribbons.forEach(([offset, color1, color2]) => {
    const contour = new Path2D()
    contour.moveTo(-width * 0.1, height * (0.9 + offset))
    contour.bezierCurveTo(width * 0.18, height * (0.34 + offset), width * 0.52, height * (0.88 + offset), width * 1.1, height * (-0.25 + offset))
    const shape = new Path2D(contour)
    shape.lineTo(width * 1.15, height * 1.4)
    shape.lineTo(-width * 0.1, height * 1.4)
    shape.closePath()
    const gradient = ctx.createLinearGradient(width * 0.05, height * 0.1, width * 0.9, height * 0.92)
    gradient.addColorStop(0, color1)
    gradient.addColorStop(0.5, color2)
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fill(shape)
  })

  const step = Math.max(18, Math.min(width, height) / 22)
  ctx.fillStyle = 'rgba(55,65,81,0.10)'
  for (let y = step / 2; y < height; y += step) {
    for (let x = step / 2; x < width; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, Math.max(0.6, step * 0.035), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/* ───────────────────────── 渲染器 ───────────────────────── */

interface RendererOptions {
  background?: string
  material: GlassMaterial
  /** CSS 像素圆角 */
  radius: number
  reducedMotion: boolean
  onState?: (state: 'ready' | 'lost') => void
}

interface Uniforms {
  uTexture: WebGLUniformLocation | null
  uResolution: WebGLUniformLocation | null
  uQuad: WebGLUniformLocation | null
  uBox: WebGLUniformLocation | null
  uFollow: WebGLUniformLocation | null
  uRadius: WebGLUniformLocation | null
  uScale: WebGLUniformLocation | null
  uRefraction: WebGLUniformLocation | null
  uBlur: WebGLUniformLocation | null
  uDispersion: WebGLUniformLocation | null
  uThickness: WebGLUniformLocation | null
  uTint: WebGLUniformLocation | null
  uPointer: WebGLUniformLocation | null
  uBend: WebGLUniformLocation | null
  uPressure: WebGLUniformLocation | null
  uOpacity: WebGLUniformLocation | null
}

const UNIFORM_NAMES: Array<keyof Uniforms> = [
  'uTexture', 'uResolution', 'uQuad', 'uBox', 'uFollow', 'uRadius', 'uScale',
  'uRefraction', 'uBlur', 'uDispersion', 'uThickness', 'uTint',
  'uPointer', 'uBend', 'uPressure', 'uOpacity',
]

/** 一个 canvas 对应一个 WebGL 上下文；静止时不占用 rAF。 */
export class LiquidGlassRenderer {
  private canvas: HTMLCanvasElement
  private options: RendererOptions
  private gl: WebGLRenderingContext | null = null
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private texture: WebGLTexture | null = null
  private uniforms: Uniforms | null = null
  private backgroundCanvas: HTMLCanvasElement
  private material: GlassMaterial
  private radiusCss: number
  private width = 0
  private height = 0
  private dpr = 1
  private pointer = { x: 0, y: 0 }
  private pointerTarget = { x: 0, y: 0 }
  private bend = { x: 0, y: 0 }
  private bendTarget = { x: 0, y: 0 }
  private follow = { x: 0, y: 0 }
  private followTarget = { x: 0, y: 0 }
  private pressure = 0
  private pressureTarget = 0
  private frame = 0
  private lastTime = 0
  private animatingUntil = 0
  private lost = false
  private destroyed = false

  constructor(canvas: HTMLCanvasElement, options: RendererOptions) {
    this.canvas = canvas
    this.options = options
    this.material = options.material
    this.radiusCss = options.radius
    this.backgroundCanvas = document.createElement('canvas')
    canvas.addEventListener('webglcontextlost', this.onContextLost)
    canvas.addEventListener('webglcontextrestored', this.onContextRestored)
  }

  /** 初始化 GL；失败时抛出异常，由 React 组件切到 CSS fallback。 */
  init(): void {
    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      // 使用预乘 alpha：混合方程为 SRC_ALPHA / ONE_MINUS_SRC_ALPHA，
      // 写入缓冲区的是预乘色，正好匹配浏览器合成预期（边缘不会二次变暗）。
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: false,
    })
    if (!gl) throw new Error('WebGL unavailable')
    this.gl = gl
    this.createResources()
    this.resize()
    this.lost = false
    this.options.onState?.('ready')
  }

  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl!
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'shader compile failed'
      gl.deleteShader(shader)
      throw new Error(message)
    }
    return shader
  }

  private createResources(): void {
    const gl = this.gl!
    const vertex = this.compile(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = this.compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
    const program = gl.createProgram()!
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'program link failed'
      gl.deleteProgram(program)
      throw new Error(message)
    }
    this.program = program
    const uniforms = {} as Uniforms
    UNIFORM_NAMES.forEach((name) => {
      uniforms[name] = gl.getUniformLocation(program, name)
    })
    this.uniforms = uniforms

    this.buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault()
    this.lost = true
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.options.onState?.('lost')
  }

  private onContextRestored = (): void => {
    if (this.destroyed) return
    this.program = null
    this.buffer = null
    this.texture = null
    this.uniforms = null
    this.width = 0
    this.height = 0
    try {
      this.createResources()
      this.resize()
      this.lost = false
      this.options.onState?.('ready')
      this.invalidate(120)
    } catch {
      this.options.onState?.('lost')
    }
  }

  /** 尺寸变化时重设 canvas 像素并把背景场重新上传到纹理。 */
  resize(): void {
    if (this.destroyed || this.lost || !this.gl) return
    const rect = this.canvas.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = Math.max(1, Math.round(rect.width * dpr))
    const height = Math.max(1, Math.round(rect.height * dpr))
    if (width === this.width && height === this.height && dpr === this.dpr) {
      this.invalidate()
      return
    }
    this.width = width
    this.height = height
    this.dpr = dpr
    this.canvas.width = width
    this.canvas.height = height
    this.uploadBackground()
    this.invalidate()
  }

  private uploadBackground(): void {
    const gl = this.gl
    if (!gl || !this.texture || this.width < 1 || this.height < 1) return
    const scale = Math.min(1, 1024 / Math.max(this.width, this.height))
    const width = Math.max(1, Math.round(this.width * scale))
    const height = Math.max(1, Math.round(this.height * scale))
    this.backgroundCanvas.width = width
    this.backgroundCanvas.height = height
    const ctx = this.backgroundCanvas.getContext('2d')
    if (!ctx) return
    paintBackground(ctx, width, height, this.options.background, () => {
      if (this.destroyed || this.lost || !this.gl || !this.texture) return
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture)
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true)
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, this.backgroundCanvas)
      this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false)
      this.invalidate()
    })
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.backgroundCanvas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  setBackground(background: string | undefined): void {
    this.options.background = background
    this.uploadBackground()
    this.invalidate()
  }

  setMaterial(material: GlassMaterial): void {
    this.material = material
    this.invalidate(180)
  }

  setRadius(radiusCss: number): void {
    this.radiusCss = radiusCss
    this.invalidate()
  }

  /** 由 clientX/clientY 换算成左下原点的设备像素指针位置。 */
  setPointerFromClient(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect()
    this.pointerTarget.x = (clientX - rect.left) * this.dpr
    this.pointerTarget.y = (rect.bottom - clientY) * this.dpr
    this.invalidate(this.options.reducedMotion ? 0 : 150)
  }

  /** 拖动增量（CSS 像素）：驱动 jelly 弯曲与轻微跟手位移。 */
  nudge(dxCss: number, dyCss: number): void {
    const s = this.dpr
    this.bendTarget.x = clamp(this.bendTarget.x + dxCss * s * 0.6, -40 * s, 40 * s)
    this.bendTarget.y = clamp(this.bendTarget.y - dyCss * s * 0.6, -40 * s, 40 * s)
    this.followTarget.x = clamp(this.followTarget.x + dxCss * s * 0.25, -12 * s, 12 * s)
    this.followTarget.y = clamp(this.followTarget.y - dyCss * s * 0.25, -12 * s, 12 * s)
    this.invalidate(this.options.reducedMotion ? 0 : 340)
  }

  setPressed(pressed: boolean): void {
    this.pressureTarget = pressed ? 1 : 0
    this.invalidate(this.options.reducedMotion ? 0 : 420)
  }

  release(): void {
    this.bendTarget.x = 0
    this.bendTarget.y = 0
    this.followTarget.x = 0
    this.followTarget.y = 0
    this.pressureTarget = 0
    this.invalidate(this.options.reducedMotion ? 0 : 520)
  }

  /** 请求渲染：duration 内持续出帧，静止后自动停止 rAF。 */
  invalidate(duration = 0): void {
    if (this.destroyed || this.lost || !this.gl) return
    this.animatingUntil = Math.max(this.animatingUntil, performance.now() + duration)
    if (!this.frame) this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number): void => {
    this.frame = 0
    if (this.destroyed || this.lost || !this.gl) return
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0.016
    this.lastTime = now
    const immediate = this.options.reducedMotion
    const k = immediate ? 1 : 1 - Math.exp(-dt * 14)
    this.pointer.x += (this.pointerTarget.x - this.pointer.x) * k
    this.pointer.y += (this.pointerTarget.y - this.pointer.y) * k
    this.bend.x += (this.bendTarget.x - this.bend.x) * k
    this.bend.y += (this.bendTarget.y - this.bend.y) * k
    this.follow.x += (this.followTarget.x - this.follow.x) * k
    this.follow.y += (this.followTarget.y - this.follow.y) * k
    this.pressure += (this.pressureTarget - this.pressure) * k
    this.draw()

    const settling = Math.abs(this.bendTarget.x - this.bend.x) + Math.abs(this.bendTarget.y - this.bend.y)
      + Math.abs(this.followTarget.x - this.follow.x) + Math.abs(this.followTarget.y - this.follow.y)
      + Math.abs(this.pressureTarget - this.pressure)
      + Math.abs(this.pointerTarget.x - this.pointer.x) + Math.abs(this.pointerTarget.y - this.pointer.y) > 0.15
    if (settling) this.animatingUntil = Math.max(this.animatingUntil, now + 40)
    if (!immediate && now < this.animatingUntil) this.frame = requestAnimationFrame(this.tick)
  }

  private draw(): void {
    const gl = this.gl
    const u = this.uniforms
    if (!gl || !u || !this.program || !this.buffer || !this.texture) return
    if (this.width < 1 || this.height < 1) return

    // 透镜占满整个 canvas；uBox 表示 SDF 的矩形（四周留 6 CSS px 余量给边缘高光跟手位移）。
    // gl_FragColor 在 SDF 之外输出 alpha=0，因此下层 DOM 原样透出。
    const margin = 6 * this.dpr
    const box = {
      x: margin,
      y: margin,
      w: Math.max(1, this.width - margin * 2),
      h: Math.max(1, this.height - margin * 2),
    }
    const x = 0
    const y = 0
    const right = this.width
    const top = this.height
    if (right <= x || top <= y) return

    gl.viewport(0, 0, this.width, this.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    const attribute = gl.getAttribLocation(this.program, 'aPosition')
    gl.enableVertexAttribArray(attribute)
    gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.uniform1i(u.uTexture, 0)
    gl.uniform2f(u.uResolution, this.width, this.height)
    gl.uniform4f(u.uQuad, x, y, right - x, top - y)
    gl.uniform4f(u.uBox, box.x, box.y, box.w, box.h)
    gl.uniform2f(u.uFollow, 0, 0)
    gl.uniform1f(u.uRadius, this.radiusCss * this.dpr)
    gl.uniform1f(u.uScale, this.dpr)
    gl.uniform1f(u.uRefraction, this.material.refraction)
    gl.uniform1f(u.uBlur, this.material.blur)
    gl.uniform1f(u.uDispersion, this.material.dispersion)
    gl.uniform1f(u.uThickness, this.material.thickness ?? 1)
    gl.uniform1f(u.uTint, this.material.tint ?? 0.1)
    gl.uniform2f(u.uPointer, this.pointer.x, this.pointer.y)
    gl.uniform2f(u.uBend, this.bend.x, this.bend.y)
    gl.uniform1f(u.uPressure, this.pressure)
    gl.uniform1f(u.uOpacity, 1)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored)
    const gl = this.gl
    if (!gl) return
    if (this.program) gl.deleteProgram(this.program)
    if (this.buffer) gl.deleteBuffer(this.buffer)
    if (this.texture) gl.deleteTexture(this.texture)
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    this.gl = null
  }
}
