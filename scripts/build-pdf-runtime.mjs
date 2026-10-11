#!/usr/bin/env node
/**
 * 生成小程序端 PDF 渲染运行时（vendor/wechat-miniprogram-pdf.js）。
 *
 * 上游 dist/index.cjs 是 esnext：含 `?.`(805) / `??`(125) 等现代语法，
 * 直接进包会在老 JSCore 上 SyntaxError；而走 babel（babel.config.js 的
 * targets ios9/android5）会把 280 处 async 重写成 regenerator，
 * 产物从 1.62MB 膨胀到 1.95MB → 撞微信分包 2MB 上限。
 *
 * 折中：用 esbuild 降到 es2019（iOS 11+ / Chrome 73+，远超微信最低支持），
 * 只展开 `?.`/`??` 不重写 async，体积可控；输出到项目根 vendor/（不在 src/），
 * 因此不被 babel 的 script 规则 include 命中，原样进分包 chunk。
 *
 * 构建入口（build:weapp / dev:weapp）前置执行；CI 亦走这两个命令。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { transform } from 'esbuild'

/**
 * 运行时 API polyfill（注入到产物顶部，随分包加载，不污染主包）。
 * esbuild 的 target 只降**语法**（`?.`/`??`），不补**运行时方法**；
 * pdfjs-dist 6 用到的这批现代 API 在微信 JSCore / 老 iOS 上缺失，
 * 且包内置 polyfill 仅覆盖 TextDecoder/structuredClone 等，缺口如下：
 *   - Uint8Array.toHex/toBase64/fromBase64  (ES2025，iOS 至今没有 → open 即抛
 *     "a.toHex is not a function")
 *   - Promise.withResolvers                  (ES2024，iOS 17.4+ → 渲染核心 40 处)
 *   - Object.hasOwn / Array.at / Array.findLast (ES2022/2023，iOS 15.4+)
 * 原生存在时一律跳过，不覆盖。
 */
const POLYFILL = `
;(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : this;
  if (typeof Promise.withResolvers !== 'function') {
    Promise.withResolvers = function () {
      var resolve, reject;
      var promise = new Promise(function (res, rej) { resolve = res; reject = rej; });
      return { promise: promise, resolve: resolve, reject: reject };
    };
  }
  if (!Object.hasOwn) {
    Object.hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  }
  if (!Array.prototype.at) {
    Array.prototype.at = function (i) {
      var n = Math.trunc(i) || 0;
      if (n < 0) n += this.length;
      return this[n];
    };
  }
  if (!String.prototype.at) {
    String.prototype.at = function (i) {
      var n = Math.trunc(i) || 0;
      var s = String(this);
      if (n < 0) n += s.length;
      return s.charAt(n);
    };
  }
  if (!Array.prototype.findLast) {
    Array.prototype.findLast = function (fn, t) {
      for (var i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return this[i];
    };
  }
  if (!Array.prototype.findLastIndex) {
    Array.prototype.findLastIndex = function (fn, t) {
      for (var i = this.length - 1; i >= 0; i--) if (fn.call(t, this[i], i, this)) return i;
      return -1;
    };
  }
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64encode(u8) {
    var s = '', i, n, rem;
    for (i = 0; i + 2 < u8.length; i += 3) {
      n = (u8[i] << 16) | (u8[i + 1] << 8) | u8[i + 2];
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    rem = u8.length - i;
    if (rem === 1) {
      n = u8[i] << 16;
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
    } else if (rem === 2) {
      n = (u8[i] << 16) | (u8[i + 1] << 8);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
    }
    return s;
  }
  function b64decode(str) {
    var clean = String(str).replace(/=+$/, '').replace(/\\s+/g, '');
    var out = new Uint8Array(Math.floor((clean.length * 3) / 4));
    var o = 0, i, buf = 0, bits = 0;
    for (i = 0; i < clean.length; i++) {
      var idx = B64.indexOf(clean.charAt(i));
      if (idx < 0) continue;
      buf = (buf << 6) | idx;
      bits += 6;
      if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 0xff; }
    }
    return o === out.length ? out : out.subarray(0, o);
  }
  if (typeof Uint8Array.prototype.toHex !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      value: function () {
        var s = '';
        for (var i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, '0');
        return s;
      },
      writable: true, enumerable: false, configurable: true,
    });
  }
  if (typeof Uint8Array.prototype.toBase64 !== 'function') {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value: function () { return b64encode(this); },
      writable: true, enumerable: false, configurable: true,
    });
  }
  if (typeof Uint8Array.fromBase64 !== 'function') {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value: function (str) { return b64decode(str); },
      writable: true, enumerable: false, configurable: true,
    });
  }
  void g;
})();
`

const SRC = path.resolve('node_modules/wechat-miniprogram-pdf/dist/index.cjs')
const OUT = path.resolve('vendor/wechat-miniprogram-pdf.js')

let source = await readFile(SRC, 'utf8')

/**
 * pdf.js 源内两处 ES2018 正则（\p{Mn}/\p{Cf}/\p{L} Unicode 属性转义）：
 * 老内核 parse 期直接 SyntaxError——正则字面量在**解析阶段**校验，try/catch
 * 包不住字面量，esbuild 也只把字面量改成 new RegExp(同内容) 不降属性转义。
 * 对策：转换前把字面量改成运行时 new RegExp(字符串) + try/catch 降级，
 * 老引擎上退化为近似正则（只影响 Mn/Cf 空白判断与 XFA 名字校验，均非渲染路径）。
 */
const NEEDLE_RE_SPACE = String.raw`/^(\s)|(\p{Mn})|(\p{Cf})$/u`
const REPL_RE_SPACE = String.raw`(function(){try{return new RegExp("^(\\s)|(\\p{Mn})|(\\p{Cf})$","u")}catch(_e){return /^\s$/}})()`
const NEEDLE_RE_XFA = String.raw`/[\p{L}_][\p{L}\d._\p{M}-]*/u`
const REPL_RE_XFA = String.raw`(function(){try{return new RegExp("[\\p{L}_][\\p{L}\\d._\\p{M}-]*","u")}catch(_e){return /[A-Za-z_][\w._-]*/}})()`
for (const [needle, repl] of [
  [NEEDLE_RE_SPACE, REPL_RE_SPACE],
  [NEEDLE_RE_XFA, REPL_RE_XFA],
]) {
  if (!source.includes(needle)) {
    throw new Error(`pdf-runtime patch: ES2018 regex needle not found (pdfjs updated?): ${needle}`)
  }
  // 函数形式替换，避免 repl 中 `$"` 被当作 String.replace 特殊占位符
  source = source.replace(needle, () => repl)
}

/**
 * ctx 适配层 Proxy invariant 修复：G4 用 get trap 把 `i.canvas`（适配画布）
 * 覆盖到真实 ctx 上，但真机的 ctx.canvas 是 own、只读且 non-configurable 的
 * OffscreenCanvas 数据属性——Proxy 规范要求此类属性必须原样返回 target 值，
 * 否则抛 "get on proxy ... did not return its actual value"（工具端该属性
 * 是 configurable 故不暴露）。trap 开头对只读 non-configurable own 属性直通。
 * 注意：仅对**非函数值**直通（数据属性如 canvas）；方法属性（getTransform 等）
 * 必须落到 `r in i` 走适配——否则真机会直通拿到原生方法，返回没有
 * invertSelf 的微信原生 matrix，报 "invertSelf is not a function"。
 */
const NEEDLE_PROXY = 'new Proxy(s,{get(a,r){if(r in i)return i[r];'
const REPL_PROXY =
  'new Proxy(s,{get(a,r){var d=Object.getOwnPropertyDescriptor(a,r);if(d&&d.configurable===false&&d.writable===false&&typeof a[r]!=="function")return a[r];if(r in i)return i[r];'
if (!source.includes(NEEDLE_PROXY)) {
  throw new Error('pdf-runtime patch: ctx adapt Proxy needle not found (package changed?)')
}
source = source.replace(NEEDLE_PROXY, () => REPL_PROXY)

/**
 * 真机 offscreen canvas null 加固（W4 = 包提供给 pdf.js 的 CanvasFactory，
 * 所有临时 canvas——图片缩放/渐变 pattern/字体测量/mask 合成——都经它创建）：
 * `wx.createOffscreenCanvas({type:"2d"})` 真机返回 null 是微信已知 bug
 * （官方社区置顶帖：开发者工具正常、iOS 真机必现；另有超宽必现 null、
 * width/height 失效等变体），原实现第一行 `n.width=e` 即抛
 * "Cannot set properties of null (setting 'width')"。
 * 加固：create 重试一次 → 全局 OffscreenCanvas 构造器（对象参→数字参）
 * 逐级回退，全失败抛带尺寸的明确错误；reset 对 null holder 抛明确错误；
 * destroy 幂等（double-destroy 时 e.canvas 已为 null 也会炸同一消息）。
 * 另在 renderPage 入口对 canvas node 判空，区分 app 传参与 vendor 内部问题。
 */
const NEEDLE_W4 =
  'var W4=class{create(e,t){let n=Lz().createOffscreenCanvas({type:"2d",width:e,height:t});return n.width=e,n.height=t,{canvas:n,context:G4(n.getContext("2d"),n)}}reset(e,t,n){e.canvas.width=t,e.canvas.height=n}destroy(e){e.canvas.width=0,e.canvas.height=0,e.canvas=null,e.context=null}}'
const REPL_W4 =
  'var W4=class{create(e,t){var n=null;try{n=Lz().createOffscreenCanvas({type:"2d",width:e,height:t})}catch(_e){}if(!n)try{n=Lz().createOffscreenCanvas({type:"2d",width:e,height:t})}catch(_e){}if(!n&&typeof OffscreenCanvas==="function")try{n=new OffscreenCanvas({width:e,height:t})}catch(_e){}if(!n&&typeof OffscreenCanvas==="function")try{n=new OffscreenCanvas(e,t)}catch(_e){}if(!n)throw new Error("weapp: no 2d offscreen canvas ("+e+"x"+t+")");n.width=e,n.height=t;var c=null;try{c=n.getContext("2d")}catch(_e){}if(!c)throw new Error("weapp: offscreen 2d context unavailable ("+e+"x"+t+")");return{canvas:n,context:G4(c,n)}}reset(e,t,n){if(!e||!e.canvas)throw new Error("weapp: canvasFactory.reset got null holder");e.canvas.width=t,e.canvas.height=n}destroy(e){if(!e||!e.canvas)return;e.canvas.width=0,e.canvas.height=0,e.canvas=null,e.context=null}}'
const NEEDLE_RENDERPAGE = 'async renderPage(o,l,f={}){let c=await a.getPage(o),'
const REPL_RENDERPAGE =
  'async renderPage(o,l,f={}){if(!l)throw new Error("weapp: renderPage got null canvas node");let c=await a.getPage(o),'
for (const [needle, repl, name] of [
  [NEEDLE_W4, REPL_W4, 'canvasFactory'],
  [NEEDLE_RENDERPAGE, REPL_RENDERPAGE, 'renderPage'],
]) {
  if (source.split(needle).length !== 2) {
    throw new Error(`pdf-runtime patch: ${name} needle not found or not unique (package changed?)`)
  }
  source = source.replace(needle, () => repl)
}

/**
 * 真机 matrix 缺 invertSelf 修复：pdf.js 有 4 处 `ctx.getTransform().invertSelf()`
 * （Lo 取逆 + pattern 描边/填充 + 文字裁剪），真机某路径的 ctx 不经 G4 适配
 * （G4 返回的 Fi 自带 invertSelf），拿到的是微信原生 matrix 对象——没有
 * DOMMatrix 规范的 invertSelf → 报 "invertSelf is not a function"；
 * 工具端走 G4 → Fi 故不暴露。不追 ctx 来源，调用点统一包 __wkFixM：
 * 缺方法且字段可写 → 按 DOMMatrix 语义原地补 invertSelf/multiplySelf；
 * 字段只读或不可扩展 → 回退 Fi 实例（构造读 a~f，自带全套方法）。
 */
const REGEX_GT_INV = /([\w$]+)\.getTransform\(\)\.invertSelf\(\)/g
const gtInvCount = [...source.matchAll(REGEX_GT_INV)].length
if (gtInvCount !== 4) {
  throw new Error(
    `pdf-runtime patch: getTransform().invertSelf() count=${gtInvCount}, expected 4 (pdfjs changed?)`
  )
}
source = source.replace(REGEX_GT_INV, (_, v) => `__wkFixM(${v}.getTransform()).invertSelf()`)

const NEEDLE_G4 = 'function G4(s,e){if(!s)throw'
const FIXM = `function __wkFixM(m){
  if(!m||typeof m!=="object")return new Fi(m);
  if(typeof m.invertSelf==="function"&&typeof m.multiplySelf==="function")return m;
  try{
    if(typeof m.invertSelf!=="function")m.invertSelf=function(){
      var a=this.a,b=this.b,c=this.c,d=this.d,e=this.e,f=this.f,det=a*d-b*c;
      if(!det){this.a=this.b=this.c=this.d=this.e=this.f=NaN;return this}
      this.a=d/det;this.b=-b/det;this.c=-c/det;this.d=a/det;
      this.e=(c*f-d*e)/det;this.f=(b*e-a*f)/det;return this
    };
    if(typeof m.multiplySelf!=="function")m.multiplySelf=function(o){
      if(!o||typeof o!=="object")return this;
      var a=this.a,b=this.b,c=this.c,d=this.d,e=this.e,f=this.f;
      this.a=a*o.a+c*o.b;this.b=b*o.a+d*o.b;
      this.c=a*o.c+c*o.d;this.d=b*o.c+d*o.d;
      this.e=a*o.e+c*o.f+e;this.f=b*o.e+d*o.f+f;return this
    }
  }catch(e){return new Fi(m)}
  return typeof m.invertSelf==="function"?m:new Fi(m)
}
`
if (source.split(NEEDLE_G4).length !== 2) {
  throw new Error('pdf-runtime patch: G4 needle not found or not unique (package changed?)')
}
source = source.replace(NEEDLE_G4, () => FIXM + NEEDLE_G4)

const { code } = await transform(source, {
  target: 'es2019',
  format: 'cjs',
  loader: 'js',
  legalComments: 'none',
  banner: POLYFILL,
})

/**
 * Path2D：不要遮蔽全局为包内 MiniPath2D（已试验并回退，见下方原因）。
 * 包的 ctx 适配 G4（__wechatPdfAdapted Proxy）拦截 fill/stroke/clip 后，
 * 会把 MiniPath2D 从参数里 splice 掉、回放到当前路径，再调原生方法 ——
 * 但 `clip(t, "evenodd")`（vendor 内多处）splice 后只剩 ["evenodd"]，
 * 实际执行成 `ctx.clip("evenodd")`：浏览器允许 clip(fillRule) 单参重载，
 * 微信则抛 "parameter 1 is not of type 'Path2D'"（evenodd 规则也无从表达）。
 * 结论：保持微信原生 Path2D（有 `new Path2D()` 的控制台警告但渲染正确）。
 * 若未来要消除警告，需自建 Mini→canvas.createPath2D() 转换并 patch Proxy
 * 参数重排，工程风险高于收益，暂不做。
 */

/**
 * JBIG2 / CCITT 回退件接线：包内 useWasm:false 时 pdf.js 经
 * `import(`${wasmUrl}${noWasmFilename}`)` 加载 pdfjs-dist 的 wasm2js 回退件
 * （自包含 asm.js，无网络依赖），但整个前缀是运行时变量，webpack 只能生成
 * 空 context → 运行时 import 必败 → 扫描件报 "JBig2 failed to initialize"、
 * 整页纯白（真机实测，背景已画、图像全无）。
 * 修补：jbig2 分支改成读 globalThis.__pkusoJbig2Fallback（由主包的 src/app.ts
 * 在启动时挂上）。早先是「对 vendor/ 静态拷贝的同步 require」，但那样会把
 * 768KB 的回退件打进 score-reader 分包，顶过微信 2MB 上限（上传报 80200）。
 * 靠主包 app.ts 引入：分包不背这份体积，且 app 先于任何页面执行，不会来不及。
 * openjpeg 仍走原动态 import 分支（JPX 罕见，回退件 451KB 超预算，维持现状）。
 * 回退件是 emscripten 现代输出（含 `?.`/`??=`/class fields），与上游 dist
 * 同样问题，必须过一遍 esbuild 降级——原样拷贝会在真机老内核 SyntaxError。
 */
const NEEDLE_JBIG2 = 't = (await import(`${h(Fn, Wd)}${this._noWasmFilename}`)).default();'
if (!code.includes(NEEDLE_JBIG2)) {
  throw new Error('pdf-runtime patch: JBIG2 fallback needle not found (esbuild output changed?)')
}
const REPL_JBIG2 =
  't = (this._noWasmFilename === "jbig2_nowasm_fallback.js" ? (globalThis.__pkusoJbig2Fallback ? globalThis.__pkusoJbig2Fallback() : (() => { throw new Error("weapp: jbig2 fallback not wired (src/app.ts 未挂 globalThis.__pkusoJbig2Fallback)"); })()) : (await import(`${h(Fn, Wd)}${this._noWasmFilename}`)).default());'
const patched = code.replace(NEEDLE_JBIG2, REPL_JBIG2)

const FB_OUT = path.resolve('vendor/jbig2_nowasm_fallback.js')
const req = createRequire(import.meta.url)
const reqFromPkg = createRequire(req.resolve('wechat-miniprogram-pdf'))
const FB_SRC = reqFromPkg.resolve('pdfjs-dist/wasm/jbig2_nowasm_fallback.js')

await mkdir(path.dirname(OUT), { recursive: true })
const fbSource = await readFile(FB_SRC, 'utf8')
// minify 是必须的：这个回退件未压缩时有 768KB，而 score-reader 分包
// （pdf runtime + 它）上限只有 2MB，微信上传会以 80200 直接拒绝
const fbCode = (
  await transform(fbSource, {
    target: 'es2019',
    loader: 'js',
    legalComments: 'none',
    minify: true,
  })
).code
await writeFile(
  FB_OUT,
  `/* AUTO-GENERATED by scripts/build-pdf-runtime.mjs — do not edit. */\n${fbCode}`
)
await writeFile(
  OUT,
  `/* AUTO-GENERATED by scripts/build-pdf-runtime.mjs — do not edit. */\n${patched}`
)

console.log(
  `✓ pdf runtime: ${path.relative(process.cwd(), OUT)} ${(patched.length / 1024).toFixed(0)} KB` +
    ` + jbig2 fallback ${(statSync(FB_OUT).size / 1024).toFixed(0)} KB (target=es2019)`
)
