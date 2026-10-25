/**
 * dsh-explain-note —— 浏览器半端（Client half）
 * ============================================================================
 * 这个文件是 DSH 的“自注册 client bundle”，不是 ESM：
 *
 *     window.__ModuleLoader__.load({ id, factory(require) { ... } })
 *
 * 功能：
 *   · 在 AI 回答里选中一段文字后右键，接管原生菜单，换成
 *     「复制 / 解释」两个按钮（原生菜单在 Electron 主进程里，插件加不进去，
 *      所以这里只接管“回答区域”的右键，别处仍然用原生菜单）。
 *   · 点「解释」在会话区与左侧栏之间的空隙里开一张便签；
 *     便签可拖拽、可折叠成一条栏、可关闭、可固定（钉住位置并置顶）。
 *   · 字号 A− / A+ 独立缩放，默认字号与字体从当前主题/字体插件在页面上
 *     实际计算出来的样式里取，所以换主题、换字体插件都会跟着变。
 *   · 便签始终被夹在浏览器窗口内，拖不出去。
 *
 * 依赖：只用 DOM + fetch；不依赖 React，也不 import 任何包。
 * ============================================================================
 */
window.__ModuleLoader__.load({
  id: 'dsh-explain-note',
  factory() {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const API = '/api/explain-note/explain'
    const STYLE_ID = 'dsh-explain-note'
    const NOTE_WIDTH = 348
    const MARGIN = 8
    const GAP = 10
    const MAX_SELECTION = 800
    const Z_NOTE_BASE = 900
    const Z_NOTE_MAX = 938
    const Z_MENU = 945
    const ZOOM_MIN = 0.85
    const ZOOM_MAX = 1.6
    const ZOOM_STEP = 0.1

    /* ───────────────────────────── 文案 ───────────────────────────── */

    const isZh = String(document.documentElement.lang || navigator.language || 'zh')
      .toLowerCase()
      .startsWith('zh')

    const L = isZh ? {
      menuLabel: '文本操作',
      copy: '复制',
      copied: '已复制',
      explain: '解释',
      explainHint: 'AI',
      tooLong: '选区太长',
      noteLabel: '词义解释',
      kicker: '解释',
      loading: '正在结合上下文解释…',
      slow: '模型还在想，再等一会儿…',
      failed: '解释失败',
      retry: '重试',
      pin: '固定位置',
      unpin: '取消固定',
      collapse: '折叠成栏',
      expand: '展开',
      close: '关闭',
      fontDown: '缩小字号',
      fontUp: '放大字号',
      copyNote: '复制解释',
      inContext: '在本文中',
      quote: '原文',
      model: '模型',
      noModel: '未标明模型',
    } : {
      menuLabel: 'Text actions',
      copy: 'Copy',
      copied: 'Copied',
      explain: 'Explain',
      explainHint: 'AI',
      tooLong: 'Too long',
      noteLabel: 'Term explanation',
      kicker: 'Explain',
      loading: 'Explaining in context…',
      slow: 'The model is still thinking…',
      failed: 'Could not explain',
      retry: 'Retry',
      pin: 'Pin in place',
      unpin: 'Unpin',
      collapse: 'Collapse',
      expand: 'Expand',
      close: 'Close',
      fontDown: 'Smaller text',
      fontUp: 'Larger text',
      copyNote: 'Copy explanation',
      inContext: 'In context',
      quote: 'Passage',
      model: 'Model',
      noModel: 'model unknown',
    }

    /* ───────────────────────────── 样式 ───────────────────────────── */

    const CSS = `
[data-xn-menu] {
  position: fixed;
  z-index: ${Z_MENU};
  min-width: 184px;
  padding: 5px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22));
  border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-overlay, var(--dsw-specific-menu, #fff));
  color: var(--dsw-alias-label-primary, #111);
  box-shadow: var(--dsw-shadow-lv3, 0 18px 44px rgba(0,0,0,.22));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(18px) saturate(1.2));
  font-family: var(--xn-font, var(--dsw-font-family, system-ui));
  font-size: 13px;
  line-height: 1.4;
  user-select: none;
  animation: xn-menu-in .09s ease-out;
}
@keyframes xn-menu-in { from { opacity: 0; transform: translateY(-2px) scale(.985); } to { opacity: 1; transform: none; } }
[data-xn-menu] [data-xn-item] {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
[data-xn-menu] [data-xn-item]:hover,
[data-xn-menu] [data-xn-item]:focus-visible {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  outline: none;
}
[data-xn-menu] [data-xn-item][disabled] { opacity: .45; cursor: default; }
[data-xn-menu] [data-xn-item][disabled]:hover { background: transparent; }
[data-xn-menu] [data-xn-icon] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 16px;
  height: 16px;
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.8));
}
[data-xn-menu] [data-xn-icon] svg { width: 16px; height: 16px; display: block; }
[data-xn-menu] [data-xn-item][data-xn-action="explain"] [data-xn-icon] {
  color: var(--dsw-alias-brand-primary, #4176e6);
}
[data-xn-menu] [data-xn-hint] {
  margin-left: auto;
  padding-left: 14px;
  font-size: 10.5px;
  letter-spacing: .02em;
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.8));
}
[data-xn-menu] [data-xn-sep] {
  height: 1px;
  margin: 4px 6px;
  background: var(--dsw-alias-border-l2, rgba(127,127,127,.16));
}

[data-xn-note] {
  position: fixed;
  z-index: ${Z_NOTE_BASE};
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(${NOTE_WIDTH}px, calc(100vw - 24px));
  max-height: min(62vh, 580px);
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, color-mix(in srgb, var(--xn-fg, #111) 16%, transparent));
  border-radius: var(--dsw-radius-lg, 14px);
  background: var(--dsw-alias-bg-overlay, var(--dsw-specific-menu, var(--xn-bg, #fff)));
  color: var(--dsw-alias-label-primary, var(--xn-fg, #111));
  box-shadow: var(--dsw-shadow-lv3, 0 18px 48px rgba(0,0,0,.24));
  backdrop-filter: var(--dsw-menu-backdrop-filter, blur(16px) saturate(1.15));
  font-family: var(--xn-font, var(--dsw-font-family, system-ui));
  font-size: calc(var(--xn-base, 14px) * var(--xn-zoom, 1));
  line-height: 1.62;
  letter-spacing: .006em;
  transform-origin: 12px 100%;
  animation: xn-note-in .16s cubic-bezier(.2,.8,.2,1);
}
/* 字体插件经常用高优先级的规则覆盖正文；便签抄的是“选区内实际算出来的字体”，
   所以这里要压过那些规则，同时给代码单独留等宽。 */
[data-xn-note], [data-xn-note] :not(code):not(pre):not(kbd):not(samp) {
  font-family: var(--xn-font, var(--dsw-font-family, system-ui)) !important;
}
[data-xn-note] code, [data-xn-note] pre, [data-xn-note] kbd, [data-xn-note] samp {
  font-family: var(--xn-mono, var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)) !important;
}
@keyframes xn-note-in {
  from { opacity: 0; transform: translateY(6px) scale(.985); }
  to { opacity: 1; transform: none; }
}

[data-xn-note][data-collapsed] {
  max-height: 46px;
  width: min(300px, calc(100vw - 24px));
}
[data-xn-note][data-collapsed] [data-xn-body] { display: none; }
[data-xn-note][data-collapsed] [data-xn-meta],
[data-xn-note][data-collapsed] [data-xn-foot] { display: none; }
[data-xn-note][data-collapsed] [data-xn-head] { border-bottom: 0; }

[data-xn-note] [data-xn-head] {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  padding: 7px 7px 7px 9px;
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.14));
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 7%, transparent),
    transparent);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
[data-xn-note][data-pinned] [data-xn-head] { cursor: default; }
[data-xn-note] [data-xn-head]:active { cursor: grabbing; }
[data-xn-note][data-pinned] [data-xn-head]:active { cursor: default; }

[data-xn-note] [data-xn-title] {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0;
}
[data-xn-note] [data-xn-kicker] {
  font-size: .64em;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, var(--xn-muted, rgba(127,127,127,.85)));
}
[data-xn-note] [data-xn-term] {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 1.02em;
  font-weight: 600;
  line-height: 1.4;
}

[data-xn-note] [data-xn-btn] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, var(--xn-muted, rgba(127,127,127,.9)));
  font: inherit;
  cursor: pointer;
}
[data-xn-note] [data-xn-btn]:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-primary, var(--xn-fg, #111));
}
[data-xn-note] [data-xn-btn]:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4176e6);
  outline-offset: 1px;
}
[data-xn-note] [data-xn-btn] svg { width: 15px; height: 15px; display: block; }
[data-xn-note] [data-xn-pin][aria-pressed="true"] {
  color: var(--dsw-alias-brand-primary, #4176e6);
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 13%, transparent);
}
[data-xn-note] [data-xn-collapse] svg { transition: transform .15s ease; }
[data-xn-note][data-collapsed] [data-xn-collapse] svg { transform: rotate(180deg); }
[data-xn-note] [data-xn-close] { font-size: 17px; line-height: 1; font-weight: 400; }

[data-xn-note] [data-xn-body] {
  min-height: 0;
  flex: 1 1 auto;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 14px 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-border-l2, rgba(127,127,127,.35)) transparent;
}
[data-xn-note] [data-xn-content] { display: block; }
[data-xn-note][data-loading] [data-xn-content],
[data-xn-note][data-loading] [data-xn-meta],
[data-xn-note][data-loading] [data-xn-foot] { display: none; }
[data-xn-note][data-error] [data-xn-content],
[data-xn-note][data-error] [data-xn-meta],
[data-xn-note][data-error] [data-xn-foot] { display: none; }

[data-xn-note] [data-xn-lead] {
  margin: 0;
  font-size: 1.01em;
  font-weight: 500;
  line-height: 1.62;
  color: var(--dsw-alias-label-primary, var(--xn-fg, #111));
}
[data-xn-note] [data-xn-sec] { margin-top: 10px; }
[data-xn-note] [data-xn-label] {
  display: inline-block;
  margin-bottom: 3px;
  font-size: .68em;
  font-weight: 600;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--dsw-alias-brand-primary, #4176e6);
}
[data-xn-note] [data-xn-sec] p {
  margin: 0;
  font-size: .96em;
  line-height: 1.64;
  color: var(--dsw-alias-label-secondary, var(--xn-muted, rgba(60,60,60,.92)));
}
[data-xn-note] [data-xn-quote] {
  margin: 11px 0 0;
  padding: 8px 10px;
  border-left: 2px solid var(--dsw-alias-brand-primary, #4176e6);
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 6%, transparent);
  font-size: .86em;
  line-height: 1.6;
  color: var(--dsw-alias-label-secondary, var(--xn-muted, rgba(60,60,60,.9)));
}
[data-xn-note] [data-xn-quote] [data-xn-quote-label] {
  display: block;
  margin-bottom: 2px;
  font-size: .74em;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.8));
}
[data-xn-note] [data-xn-quote] mark {
  padding: 0 2px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 20%, transparent);
  color: inherit;
}
[data-xn-note] [data-xn-extra] {
  margin: 10px 0 0;
  font-size: .88em;
  line-height: 1.6;
  color: var(--dsw-alias-label-tertiary, var(--xn-muted, rgba(90,90,90,.9)));
}
[data-xn-note] [data-xn-meta] {
  padding: 0 14px 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: .68em;
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.75));
}
[data-xn-note] [data-xn-foot] {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 7px 9px 8px 10px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.12));
}
[data-xn-note] [data-xn-zoom] { display: flex; align-items: center; gap: 1px; }
[data-xn-note] [data-xn-zoom] [data-xn-btn] { width: 24px; height: 24px; font-size: .76em; font-weight: 600; }
[data-xn-note] [data-xn-zoom-label] {
  min-width: 38px;
  text-align: center;
  font-size: .72em;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.85));
}
[data-xn-note] [data-xn-copy] {
  margin-left: auto;
  width: auto;
  height: 26px;
  padding: 0 9px;
  font-size: .78em;
  color: var(--dsw-alias-brand-primary, #4176e6);
}
[data-xn-note] [data-xn-copy]:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4176e6) 12%, transparent);
  color: var(--dsw-alias-brand-primary, #4176e6);
}

[data-xn-note] [data-xn-skeleton] { display: none; padding: 3px 0 8px; }
[data-xn-note][data-loading] [data-xn-skeleton] { display: block; }
[data-xn-note] [data-xn-skeleton] i {
  display: block;
  height: 9px;
  margin: 9px 0;
  border-radius: 999px;
  background: linear-gradient(90deg,
    var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)) 0%,
    var(--dsw-alias-bg-layer-3, rgba(127,127,127,.18)) 40%,
    var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10)) 80%);
  background-size: 220% 100%;
  animation: xn-shimmer 1.3s ease-in-out infinite;
}
[data-xn-note] [data-xn-skeleton] i:nth-child(2) { width: 88%; animation-delay: .1s; }
[data-xn-note] [data-xn-skeleton] i:nth-child(3) { width: 66%; animation-delay: .2s; }
@keyframes xn-shimmer { from { background-position: 120% 0; } to { background-position: -100% 0; } }
[data-xn-note] [data-xn-status] {
  display: none;
  align-items: center;
  gap: 7px;
  margin: 2px 0 0;
  font-size: .8em;
  color: var(--dsw-alias-label-tertiary, rgba(127,127,127,.9));
}
[data-xn-note][data-loading] [data-xn-status] { display: flex; }
[data-xn-note] [data-xn-dot] {
  width: 6px;
  height: 6px;
  flex: none;
  border-radius: 50%;
  background: var(--dsw-alias-brand-primary, #4176e6);
  animation: xn-pulse 1s ease-in-out infinite;
}
@keyframes xn-pulse { 0%, 100% { opacity: .3; transform: scale(.8); } 50% { opacity: 1; transform: scale(1); } }

[data-xn-note] [data-xn-error] { display: none; padding: 3px 0 6px; }
[data-xn-note][data-error] [data-xn-error] { display: block; }
[data-xn-note] [data-xn-error] p {
  margin: 0 0 9px;
  font-size: .9em;
  line-height: 1.55;
  color: var(--dsw-alias-label-secondary, var(--xn-muted, rgba(80,80,80,.95)));
}
[data-xn-note] [data-xn-retry] {
  width: auto;
  height: 27px;
  padding: 0 11px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.24));
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.08));
  font-size: .8em;
}
@media (prefers-reduced-motion: reduce) {
  [data-xn-note], [data-xn-menu], [data-xn-note] [data-xn-skeleton] i,
  [data-xn-note] [data-xn-dot] { animation: none !important; transition: none !important; }
}
`

    /* ───────────────────────────── 小工具 ───────────────────────────── */

    function clamp(value, min, max) {
      const low = Math.min(min, max)
      const high = Math.max(min, max)
      return Math.min(high, Math.max(low, value))
    }

    function text(value, max) {
      return String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, max)
    }

    function make(tag, props, children) {
      const node = document.createElement(tag)
      if (props) {
        for (const [key, value] of Object.entries(props)) {
          if (value === undefined || value === null || value === false) continue
          if (key === 'text') node.textContent = String(value)
          else if (key === 'html') node.innerHTML = String(value)
          else if (key === 'style') Object.assign(node.style, value)
          else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value)
          else node.setAttribute(key, value === true ? '' : String(value))
        }
      }
      for (const child of children ?? []) {
        if (child === undefined || child === null || child === false) continue
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
      }
      return node
    }

    function icon(markup) {
      const span = document.createElement('span')
      span.setAttribute('data-xn-icon', '')
      span.innerHTML = markup
      return span
    }

    const ICON = {
      copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2.2"/><path d="M16 8V6.2A2.2 2.2 0 0 0 13.8 4H6.2A2.2 2.2 0 0 0 4 6.2v7.6A2.2 2.2 0 0 0 6.2 16H8"/></svg>',
      explain: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.2l1.7 4.9 4.9 1.7-4.9 1.7L12 16.4l-1.7-4.9L5.4 9.8l4.9-1.7L12 3.2z"/><path d="M18.6 14.6l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" opacity=".7"/></svg>',
      pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v4"/><path d="M8.5 3h7"/><path d="M9.5 3v6.2L7.2 12h9.6l-2.3-2.8V3"/></svg>',
      chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 15l6.5-6.5L18.5 15"/></svg>',
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    }

    function iconButton(attrs, markup) {
      return make('button', Object.assign({ type: 'button', 'data-xn-btn': '' }, attrs, { html: markup }))
    }

    function ensureStyle() {
      let tag = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
      if (tag !== null) return tag
      tag = document.createElement('style')
      tag.setAttribute('data-plugin-css', STYLE_ID)
      tag.setAttribute('data-plugin', STYLE_ID)
      tag.textContent = CSS
      ;(document.head ?? document.documentElement).appendChild(tag)
      return tag
    }

    function isDark() {
      return document.body?.hasAttribute('data-ds-dark-theme') === true ||
        document.documentElement.hasAttribute('data-ds-dark-theme') ||
        window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
    }

    function parseAlpha(color) {
      if (typeof color !== 'string') return 0
      const match = /rgba?\(([^)]+)\)/i.exec(color)
      if (match === null) return 1
      const parts = match[1].split(',').map((part) => part.trim())
      const alpha = parts.length > 3 ? Number(parts[3]) : 1
      return Number.isFinite(alpha) ? alpha : 1
    }

    function surfaceOf(element) {
      let node = element
      let depth = 0
      while (node && node.nodeType === 1 && depth < 14) {
        const style = getComputedStyle(node)
        if (parseAlpha(style.backgroundColor) > 0.12) {
          const rect = node.getBoundingClientRect()
          // 整页那么大的容器不算“卡片底色”，否则会抄到画布色。
          if (rect.width < window.innerWidth * 0.98 || rect.height < window.innerHeight * 0.9) {
            return style.backgroundColor
          }
        }
        node = node.parentElement
        depth += 1
      }
      return ''
    }

    function themeFor(element) {
      const target = element && element.isConnected ? element : document.body
      const style = getComputedStyle(target)
      const bodyStyle = getComputedStyle(document.body)
      const dark = isDark()
      const fontSize = Number.parseFloat(style.fontSize) || Number.parseFloat(bodyStyle.fontSize) || 14
      return {
        font: style.fontFamily || bodyStyle.fontFamily || 'system-ui, sans-serif',
        base: clamp(fontSize, 12, 22),
        fg: style.color || bodyStyle.color || (dark ? '#e8eaed' : '#111318'),
        bg: surfaceOf(target) || (dark ? '#202124' : '#ffffff'),
        mono: (() => {
          const code = target.querySelector?.('code, pre, kbd, samp')
          return code ? getComputedStyle(code).fontFamily : ''
        })(),
        dark,
      }
    }

    function applyTheme(element, theme) {
      element.style.setProperty('--xn-font', theme.font)
      element.style.setProperty('--xn-base', theme.base.toFixed(2) + 'px')
      element.style.setProperty('--xn-fg', theme.fg)
      element.style.setProperty('--xn-bg', theme.bg)
      if (theme.mono !== '') element.style.setProperty('--xn-mono', theme.mono)
      if (theme.dark) element.setAttribute('data-xn-dark', '')
      else element.removeAttribute('data-xn-dark')
    }

    function frameTop() {
      const rootStyle = getComputedStyle(document.documentElement)
      const titlebar = Number.parseFloat(rootStyle.getPropertyValue('--dsh-windows-titlebar-height')) || 0
      const clearance = Number.parseFloat(rootStyle.getPropertyValue('--dsh-frame-top-clearance')) || 0
      return Math.max(titlebar, clearance, 0)
    }

    function topFloor() {
      return Math.max(MARGIN, frameTop() + 4)
    }

    function saveSelection() {
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      return range.cloneRange()
    }

    function restoreSelection(range) {
      if (range === null) return
      try {
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      } catch {
        /* 选不回去就算了 */
      }
    }

    async function copyText(value) {
      try {
        await navigator.clipboard.writeText(value)
        return true
      } catch {
        /* 走下面的兜底 */
      }
      try {
        const area = document.createElement('textarea')
        area.value = value
        area.setAttribute('readonly', '')
        area.style.position = 'fixed'
        area.style.left = '-9999px'
        area.style.top = '0'
        document.body.appendChild(area)
        area.select()
        const ok = document.execCommand('copy')
        area.remove()
        return ok
      } catch {
        return false
      }
    }

    function blockOf(node, flow) {
      let element = node && node.nodeType === 3 ? node.parentElement : node
      while (element && element !== flow) {
        if (element.matches?.('p, li, td, th, h1, h2, h3, h4, h5, h6, blockquote, pre, dd, dt, figcaption')) {
          return element
        }
        element = element.parentElement
      }
      return flow
    }

    function isAssistantFlow(flow) {
      const kind = flow?.getAttribute?.('data-chat-flow-kind') ?? ''
      return kind === 'assistant' || kind === 'assistant-step' || kind.startsWith('assistant-')
    }

    function readSelection() {
      const selection = window.getSelection()
      if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null

      const range = selection.getRangeAt(0)
      const startElement = range.startContainer.nodeType === 3
        ? range.startContainer.parentElement
        : range.startContainer
      const endElement = range.endContainer.nodeType === 3
        ? range.endContainer.parentElement
        : range.endContainer
      if (!startElement || !endElement) return null

      if (startElement.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) {
        return null
      }
      if (startElement.closest('[data-xn-note], [data-xn-menu]')) return null

      const flow = startElement.closest('[data-chat-flow-kind]')
      if (flow === null || !isAssistantFlow(flow)) return null

      const endFlow = endElement.closest('[data-chat-flow-kind]')
      if (endFlow !== flow && !(isAssistantFlow(endFlow) && endFlow.getAttribute('data-chat-turn') === flow.getAttribute('data-chat-turn'))) {
        return null
      }

      const selected = text(selection.toString(), 2000)
      if (selected === '') return null

      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return null

      const block = blockOf(range.startContainer, flow)
      const turn = flow.getAttribute('data-chat-turn')
      const flows = turn === null
        ? [flow]
        : Array.from(document.querySelectorAll('[data-chat-flow-kind]')).filter((candidate) =>
            candidate.getAttribute('data-chat-turn') === turn && isAssistantFlow(candidate) && !candidate.hasAttribute('hidden'),
          )
      const answer = text(flows.map((candidate) => candidate.innerText ?? '').join('\n\n'), 7000)
      const users = Array.from(document.querySelectorAll('[data-chat-flow-kind="user"]'))
        .filter((candidate) => (candidate.compareDocumentPosition(flow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
      const question = text(users.at(-1)?.innerText ?? '', 2200)
      const anchor = flow.closest('[data-chat-anchor-key]')
      const key = [
        text(selected, 120).toLowerCase(),
        turn ?? '',
        anchor?.getAttribute('data-chat-anchor-key') ?? flow.getAttribute('data-chat-flow-key') ?? '',
      ].join('|')

      return {
        term: selected,
        raw: selection.toString(),
        paragraph: text(block?.innerText ?? selected, 1800),
        answer,
        question,
        block: block ?? flow,
        flow,
        key,
        rect,
      }
    }

    /* ───────────────────────────── 主流程 ───────────────────────────── */

    function apply(ctx) {
      if (typeof document === 'undefined') return

      const state = {
        notes: [],
        menu: null,
        seq: 0,
        z: 0,
        disposed: false,
        themeFrame: 0,
      }

      const style = ensureStyle()
      const cleanup = []

      function listen(target, type, handler, options) {
        target.addEventListener(type, handler, options)
        cleanup.push(() => target.removeEventListener(type, handler, options))
      }

      function closeMenu() {
        if (state.menu === null) return
        const current = state.menu
        state.menu = null
        current.element.remove()
        current.element = null
      }

      function openMenu(info, x, y) {
        closeMenu()
        const theme = themeFor(info.block)
        const menu = make('div', {
          'data-xn-menu': '',
          role: 'menu',
          'aria-label': L.menuLabel,
          tabindex: '-1',
        })
        applyTheme(menu, theme)

        const copyLabel = make('span', { text: L.copy })
        const copyItem = make('button', {
          type: 'button',
          role: 'menuitem',
          tabindex: '-1',
          'data-xn-item': '',
          'data-xn-action': 'copy',
        }, [icon(ICON.copy), copyLabel])
        menu.appendChild(copyItem)

        const tooLong = info.term.length > MAX_SELECTION
        const explainItem = make('button', {
          type: 'button',
          role: 'menuitem',
          tabindex: '-1',
          'data-xn-item': '',
          'data-xn-action': 'explain',
          ...(tooLong ? { disabled: '' } : {}),
        }, [icon(ICON.explain), make('span', { text: L.explain }), make('span', { 'data-xn-hint': '', text: tooLong ? L.tooLong : L.explainHint })])
        menu.appendChild(explainItem)

        menu.addEventListener('contextmenu', (event) => {
          event.preventDefault()
          event.stopPropagation()
        })
        menu.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
        })

        copyItem.addEventListener('click', async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const saved = saveSelection()
          const ok = await copyText(info.raw.slice(0, 20_000))
          restoreSelection(saved)
          if (state.menu === null) return
          copyLabel.textContent = ok ? L.copied : L.copy
          copyItem.setAttribute('disabled', '')
          window.setTimeout(() => closeMenu(), 340)
        })

        explainItem.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          closeMenu()
          if (tooLong) return
          openNote(state, info)
        })

        document.body.appendChild(menu)
        positionMenu(menu, x, y)
        state.menu = { element: menu, info }
        window.setTimeout(() => {
          if (state.menu?.element === menu) explainItem.focus({ preventScroll: true })
        }, 0)
      }

      function positionMenu(menu, x, y) {
        const rect = menu.getBoundingClientRect()
        let left = x + 2
        let top = y + 2
        if (left + rect.width > window.innerWidth - MARGIN) left = x - rect.width - 2
        if (top + rect.height > window.innerHeight - MARGIN) top = y - rect.height - 2
        menu.style.left = clamp(left, MARGIN, window.innerWidth - rect.width - MARGIN) + 'px'
        menu.style.top = clamp(top, MARGIN, window.innerHeight - rect.height - MARGIN) + 'px'
      }

      function defaultPlacement(state, block, width) {
        const sidebar = document.querySelector('[class*="_sidebarCol"], [data-slot="sidebar"]')
        const sidebarRect = sidebar?.getBoundingClientRect() ?? null
        const flow = block?.closest?.('[data-chat-flow]') ?? document.querySelector('[data-chat-flow]')
        const flowRect = flow?.getBoundingClientRect() ?? null

        const leftEdge = sidebarRect && sidebarRect.width > 40 ? sidebarRect.right : MARGIN
        const contentLeft = flowRect ? flowRect.left : window.innerWidth * 0.3
        const room = contentLeft - leftEdge
        let x
        if (room >= width + 24) x = leftEdge + (room - width) / 2
        else if (contentLeft - width - 12 >= leftEdge + 4) x = contentLeft - width - 12
        else x = leftEdge + 12

        const topInset = Math.max(MARGIN, frameTop() + 16)
        let y = topInset

        const others = state.notes
          .map((note) => note.el.getBoundingClientRect())
          .filter((rect) => Math.abs(rect.left - x) < 44)
        if (others.length > 0) y = Math.max(...others.map((rect) => rect.bottom)) + GAP

        if (y > window.innerHeight - 150) {
          x = x + width + GAP
          y = topInset
          const column = state.notes
            .map((note) => note.el.getBoundingClientRect())
            .filter((rect) => Math.abs(rect.left - x) < 44)
          if (column.length > 0) y = Math.max(...column.map((rect) => rect.bottom)) + GAP
          if (y > window.innerHeight - 150) {
            x = leftEdge + 12
            y = topInset
          }
        }

        return {
          x: clamp(x, MARGIN, Math.max(MARGIN, window.innerWidth - width - MARGIN)),
          y: clamp(y, MARGIN, Math.max(MARGIN, window.innerHeight - 160)),
        }
      }

      function clampNote(note) {
        if (!note.el.isConnected) return
        const rect = note.el.getBoundingClientRect()
        const left = Number.parseFloat(note.el.style.left) || rect.left
        const top = Number.parseFloat(note.el.style.top) || rect.top
        const minTop = topFloor()
        const maxLeft = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN)
        const maxTop = Math.max(minTop, window.innerHeight - rect.height - MARGIN)
        note.el.style.left = clamp(left, MARGIN, maxLeft) + 'px'
        note.el.style.top = clamp(top, minTop, maxTop) + 'px'
      }

      function openNote(state, info) {
        const existing = state.notes.find((note) => note.key === info.key)
        if (existing) {
          existing.expand()
          existing.raise()
          existing.flash()
          return existing
        }

        const theme = themeFor(info.block)
        const zoom = readZoom()
        const note = {
          key: info.key,
          info,
          el: null,
          zoom,
          controller: null,
          payload: null,
          closed: false,
          expanded: true,
          pinned: false,
          timer: null,
          dragCleanup: null,
        }

        const termText = info.term.length > 44 ? info.term.slice(0, 43) + '…' : info.term
        const titleEl = make('div', { 'data-xn-term': '', title: info.term }, [termText])
        const kickerEl = make('div', { 'data-xn-kicker': '', text: L.kicker })
        const titleWrap = make('div', { 'data-xn-title': '' }, [kickerEl, titleEl])

        const pinButton = iconButton({ 'data-xn-pin': '', 'aria-pressed': 'false', title: L.pin, 'aria-label': L.pin }, ICON.pin)
        const collapseButton = iconButton({ 'data-xn-collapse': '', title: L.collapse, 'aria-label': L.collapse }, ICON.chevron)
        const closeButton = iconButton({ 'data-xn-close': '', title: L.close, 'aria-label': L.close }, ICON.close)

        const head = make('header', { 'data-xn-head': '' }, [pinButton, titleWrap, collapseButton, closeButton])

        const lead = make('p', { 'data-xn-lead': '' })
        const contextLabel = make('span', { 'data-xn-label': '', text: L.inContext })
        const contextText = make('p', {})
        const contextSection = make('div', { 'data-xn-sec': '' }, [contextLabel, contextText])
        const quote = make('blockquote', { 'data-xn-quote': '' })
        const extra = make('p', { 'data-xn-extra': '' })
        const content = make('div', { 'data-xn-content': '' }, [lead, contextSection, quote, extra])

        const skeleton = make('div', { 'data-xn-skeleton': '' }, [make('i'), make('i'), make('i')])
        const statusText = make('span', { text: L.loading })
        const status = make('div', { 'data-xn-status': '', role: 'status', 'aria-live': 'polite' }, [make('span', { 'data-xn-dot': '' }), statusText])

        const errorText = make('p', {})
        const retryButton = make('button', { type: 'button', 'data-xn-btn': '', 'data-xn-retry': '', text: L.retry })
        const errorBox = make('div', { 'data-xn-error': '' }, [errorText, retryButton])

        const body = make('div', { 'data-xn-body': '' }, [skeleton, status, errorBox, content])
        const meta = make('div', { 'data-xn-meta': '' })

        const zoomDown = make('button', { type: 'button', 'data-xn-btn': '', title: L.fontDown, 'aria-label': L.fontDown, text: 'A−' })
        const zoomUp = make('button', { type: 'button', 'data-xn-btn': '', title: L.fontUp, 'aria-label': L.fontUp, text: 'A+' })
        const zoomLabel = make('span', { 'data-xn-zoom-label': '', text: Math.round(zoom * 100) + '%' })
        const zoomGroup = make('div', { 'data-xn-zoom': '' }, [zoomDown, zoomLabel, zoomUp])
        const copyButton = make('button', { type: 'button', 'data-xn-btn': '', 'data-xn-copy': '', text: L.copyNote })
        const foot = make('div', { 'data-xn-foot': '' }, [zoomGroup, copyButton])

        const root = make('aside', {
          'data-xn-note': '',
          role: 'dialog',
          'aria-label': L.noteLabel,
        }, [head, body, meta, foot])

        root.style.setProperty('--xn-zoom', zoom.toFixed(2))
        root.style.setProperty('--xn-font', theme.font)
        root.style.setProperty('--xn-base', theme.base.toFixed(2) + 'px')
        root.style.setProperty('--xn-fg', theme.fg)
        root.style.setProperty('--xn-bg', theme.bg)
        if (theme.mono !== '') root.style.setProperty('--xn-mono', theme.mono)
        root.style.zIndex = String(Z_NOTE_BASE)

        note.el = root
        note.titleEl = titleEl
        note.zoomLabel = zoomLabel
        note.lead = lead
        note.contextSection = contextSection
        note.contextText = contextText
        note.quote = quote
        note.extra = extra
        note.meta = meta
        note.statusText = statusText
        note.errorText = errorText
        note.copyButton = copyButton
        note.pinButton = pinButton
        note.collapseButton = collapseButton

        note.raise = () => {
          if (note.pinned) {
            root.style.zIndex = String(Z_NOTE_MAX)
            return
          }
          state.z = (state.z + 1) % 37
          root.style.zIndex = String(Z_NOTE_BASE + state.z)
        }
        note.flash = () => {
          if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
          try {
            const normal = getComputedStyle(root).boxShadow
            root.animate([
              { boxShadow: `0 0 0 2px color-mix(in srgb, ${getComputedStyle(root).getPropertyValue('--dsw-alias-brand-primary').trim() || '#4176e6'} 55%, transparent), ${normal}` },
              { boxShadow: normal },
            ], { duration: 480, easing: 'ease-out' })
          } catch {
            /* 动画失败不影响功能 */
          }
        }
        note.expand = () => {
          root.removeAttribute('data-collapsed')
          note.expanded = true
          collapseButton.title = L.collapse
          collapseButton.setAttribute('aria-label', L.collapse)
          requestAnimationFrame(() => clampNote(note))
        }
        note.collapse = () => {
          root.setAttribute('data-collapsed', '')
          note.expanded = false
          collapseButton.title = L.expand
          collapseButton.setAttribute('aria-label', L.expand)
          requestAnimationFrame(() => clampNote(note))
        }
        note.close = () => {
          if (note.closed) return
          note.closed = true
          note.controller?.abort()
          if (note.timer !== null) window.clearTimeout(note.timer)
          note.dragCleanup?.()
          root.remove()
          state.notes = state.notes.filter((candidate) => candidate !== note)
        }
        note.setZoom = (next) => {
          note.zoom = clamp(Math.round(next * 100) / 100, ZOOM_MIN, ZOOM_MAX)
          root.style.setProperty('--xn-zoom', note.zoom.toFixed(2))
          zoomLabel.textContent = Math.round(note.zoom * 100) + '%'
          writeZoom(note.zoom)
          requestAnimationFrame(() => clampNote(note))
        }
        note.applyTheme = () => {
          const next = themeFor(info.block)
          applyTheme(root, next)
          const current = Number.parseFloat(root.style.getPropertyValue('--xn-zoom')) || note.zoom
          root.style.setProperty('--xn-zoom', current.toFixed(2))
        }

        pinButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          note.pinned = !note.pinned
          if (note.pinned) root.setAttribute('data-pinned', '')
          else root.removeAttribute('data-pinned')
          pinButton.setAttribute('aria-pressed', note.pinned ? 'true' : 'false')
          pinButton.title = note.pinned ? L.unpin : L.pin
          pinButton.setAttribute('aria-label', pinButton.title)
          note.raise()
        })
        collapseButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (note.expanded) note.collapse()
          else note.expand()
        })
        closeButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          note.close()
        })
        zoomDown.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          note.setZoom(note.zoom - ZOOM_STEP)
        })
        zoomUp.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          note.setZoom(note.zoom + ZOOM_STEP)
        })
        copyButton.addEventListener('click', async (event) => {
          event.preventDefault()
          event.stopPropagation()
          const ok = await copyText(notePlainText(note))
          if (!ok) return
          const old = copyButton.textContent
          copyButton.textContent = L.copied
          window.setTimeout(() => { copyButton.textContent = old }, 800)
        })
        retryButton.addEventListener('click', (event) => {
          event.preventDefault()
          event.stopPropagation()
          if (note.payload !== null) loadNote(state, note, note.payload)
        })

        head.addEventListener('dblclick', (event) => {
          if (event.target.closest('button')) return
          if (note.expanded) note.collapse()
          else note.expand()
        })
        head.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          if (event.target.closest('button')) return
          if (note.pinned) return
          event.preventDefault()
          const rect = root.getBoundingClientRect()
          const startX = event.clientX
          const startY = event.clientY
          const startLeft = rect.left
          const startTop = rect.top
          const move = (moveEvent) => {
            if (moveEvent.buttons === 0) {
              stop()
              return
            }
            const width = root.getBoundingClientRect().width
            const height = root.getBoundingClientRect().height
            const minTop = topFloor()
            const left = clamp(startLeft + moveEvent.clientX - startX, MARGIN, Math.max(MARGIN, window.innerWidth - width - MARGIN))
            const top = clamp(startTop + moveEvent.clientY - startY, minTop, Math.max(minTop, window.innerHeight - height - MARGIN))
            root.style.left = left + 'px'
            root.style.top = top + 'px'
          }
          const stop = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', stop)
            window.removeEventListener('pointercancel', stop)
            note.dragCleanup = null
            clampNote(note)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', stop)
          window.addEventListener('pointercancel', stop)
          note.dragCleanup = stop
        })
        root.addEventListener('pointerdown', () => note.raise(), true)

        root.style.visibility = 'hidden'
        root.style.left = '0px'
        root.style.top = '0px'
        document.body.appendChild(root)
        const rect = root.getBoundingClientRect()
        const placement = defaultPlacement(state, info.block, rect.width)
        root.style.left = placement.x + 'px'
        root.style.top = placement.y + 'px'
        root.style.visibility = ''

        state.notes.push(note)
        note.raise()
        note.el.style.setProperty('--xn-zoom', note.zoom.toFixed(2))

        const payload = {
          term: text(info.term, 400),
          paragraph: text(info.paragraph, 1800),
          answer: text(info.answer, 7000),
          question: text(info.question, 2200),
          pageTitle: text(document.title, 200),
        }
        note.payload = payload
        loadNote(state, note, payload)
        return note
      }

      async function loadNote(state, note, payload) {
        if (note.closed) return
        note.controller?.abort()
        const controller = new AbortController()
        note.controller = controller
        if (note.timer !== null) window.clearTimeout(note.timer)
        note.timer = window.setTimeout(() => {
          if (!note.closed && note.el.hasAttribute('data-loading')) note.statusText.textContent = L.slow
        }, 8000)

        note.el.setAttribute('data-loading', '')
        note.el.removeAttribute('data-error')
        note.errorText.textContent = ''
        note.statusText.textContent = L.loading
        note.lead.textContent = ''
        note.contextText.textContent = ''
        note.extra.textContent = ''
        note.quote.replaceChildren()
        note.contextSection.style.display = 'none'
        note.quote.style.display = 'none'
        note.extra.style.display = 'none'
        note.meta.textContent = ''

        try {
          const response = await fetch(API, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          })
          const data = await response.json().catch(() => null)
          if (note.closed || controller.signal.aborted) return
          if (!response.ok || data?.ok !== true) {
            throw new Error(data?.error || `HTTP ${response.status}`)
          }
          note.el.removeAttribute('data-loading')
          if (note.timer !== null) {
            window.clearTimeout(note.timer)
            note.timer = null
          }
          renderNote(note, data)
        } catch (error) {
          if (note.closed || controller.signal.aborted) return
          if (note.timer !== null) {
            window.clearTimeout(note.timer)
            note.timer = null
          }
          note.el.removeAttribute('data-loading')
          note.el.setAttribute('data-error', '')
          note.errorText.textContent = error?.name === 'AbortError'
            ? L.failed + '：请求超时了。'
            : L.failed + '：' + String(error?.message ?? error)
          clampNote(note)
        }
      }

      function renderNote(note, data) {
        const term = text(data.term, 120) || note.info.term
        if (term !== '') {
          note.titleEl.textContent = term.length > 44 ? term.slice(0, 43) + '…' : term
          note.titleEl.title = term
        }
        const brief = text(data.brief, 600)
        const inContext = text(data.inContext, 600)
        const extra = text(data.note, 300)

        note.lead.textContent = brief
        note.lead.style.display = brief === '' ? 'none' : ''

        if (inContext !== '') {
          note.contextText.textContent = inContext
          note.contextSection.style.display = ''
        } else {
          note.contextSection.style.display = 'none'
        }

        if (note.info.paragraph !== '') {
          buildQuote(note.quote, note.info.paragraph, note.info.term)
          note.quote.style.display = ''
        } else {
          note.quote.style.display = 'none'
        }

        if (extra !== '') {
          note.extra.textContent = extra
          note.extra.style.display = ''
        } else {
          note.extra.style.display = 'none'
        }

        const model = text(data.model, 120)
        note.meta.textContent = model === '' ? L.noModel : `${L.model} · ${model}`
        note.meta.title = model

        clampNote(note)
        requestAnimationFrame(() => clampNote(note))
      }

      function buildQuote(container, paragraph, term) {
        container.replaceChildren()
        container.appendChild(make('span', { 'data-xn-quote-label': '', text: L.quote }))
        const source = paragraph.replace(/\s+/g, ' ').trim()
        const lowerSource = source.toLowerCase()
        const lowerTerm = term.toLowerCase()
        let start = 0
        let end = source.length
        if (source.length > 240) {
          const hit = lowerSource.indexOf(lowerTerm)
          const center = hit >= 0 ? hit + Math.round(term.length / 2) : Math.round(source.length / 2)
          start = Math.max(0, center - 110)
          end = Math.min(source.length, start + 230)
          if (start > 0) {
            const space = source.indexOf(' ', start)
            if (space >= 0 && space < start + 24) start = space + 1
          }
          if (end < source.length) {
            const space = source.lastIndexOf(' ', end)
            if (space > end - 24) end = space
          }
        }
        const excerpt = source.slice(start, end).trim()
        const prefix = start > 0 ? '…' : ''
        const suffix = end < source.length ? '…' : ''
        const hit = excerpt.toLowerCase().indexOf(lowerTerm)
        if (hit >= 0 && term !== '') {
          container.append(prefix, excerpt.slice(0, hit), make('mark', { text: excerpt.slice(hit, hit + term.length) }), excerpt.slice(hit + term.length), suffix)
        } else {
          container.append(prefix, excerpt, suffix)
        }
      }

      function notePlainText(note) {
        const lines = []
        const term = note.titleEl?.title || note.titleEl?.textContent || note.info.term
        lines.push(term)
        if (note.lead?.textContent) lines.push(note.lead.textContent)
        if (note.contextSection?.style.display !== 'none' && note.contextText?.textContent) {
          lines.push(L.inContext + '：' + note.contextText.textContent)
        }
        if (note.info.paragraph) lines.push(L.quote + '：' + note.info.paragraph.slice(0, 220))
        if (note.extra?.style.display !== 'none' && note.extra?.textContent) lines.push(note.extra.textContent)
        return lines.filter((line) => line && line.trim() !== '').join('\n\n')
      }

      function readZoom() {
        try {
          const value = Number.parseFloat(window.localStorage.getItem('dsh-explain-note:zoom') ?? '')
          return Number.isFinite(value) ? clamp(value, ZOOM_MIN, ZOOM_MAX) : 1
        } catch {
          return 1
        }
      }

      function writeZoom(value) {
        try {
          window.localStorage.setItem('dsh-explain-note:zoom', String(value))
        } catch {
          /* 存不了就只影响“下一次默认字号” */
        }
      }

      function scheduleThemeRefresh() {
        if (state.themeFrame !== 0) return
        state.themeFrame = requestAnimationFrame(() => {
          state.themeFrame = 0
          for (const note of state.notes) {
            try {
              note.applyTheme()
              clampNote(note)
            } catch {
              /* 单个便签刷新失败不影响别的 */
            }
          }
        })
      }

      /* 事件接线 */

      listen(window, 'contextmenu', (event) => {
        if (state.menu !== null && state.menu.element?.contains(event.target)) {
          event.preventDefault()
          return
        }
        if (event.target.closest?.('[data-xn-note]')) return
        const info = readSelection()
        if (info === null) return
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation?.()
        const x = event.clientX > 0 ? event.clientX : info.rect.left
        const y = event.clientY > 0 ? event.clientY : info.rect.bottom
        openMenu(info, x, y)
      }, true)

      listen(window, 'pointerdown', (event) => {
        if (state.menu === null) return
        if (state.menu.element?.contains(event.target)) return
        closeMenu()
      }, true)

      listen(window, 'keydown', (event) => {
        if (state.menu === null) return
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          closeMenu()
          return
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const items = Array.from(state.menu.element.querySelectorAll('[role="menuitem"]:not([disabled])'))
        if (items.length === 0) return
        event.preventDefault()
        const active = document.activeElement
        const index = items.indexOf(active)
        const next = event.key === 'ArrowDown'
          ? (index < 0 ? 0 : (index + 1) % items.length)
          : (index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length)
        items[next]?.focus({ preventScroll: true })
      }, true)

      listen(window, 'scroll', (event) => {
        if (state.menu === null) return
        if (state.menu.element?.contains(event.target)) return
        closeMenu()
      }, true)

      listen(window, 'resize', () => {
        closeMenu()
        for (const note of state.notes) clampNote(note)
      })

      let themeObserver = null
      try {
        themeObserver = new MutationObserver(scheduleThemeRefresh)
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ['data-ds-dark-theme', 'data-dsh-maid-atelier', 'data-dsh-whale-maid-font', 'data-dsh-whale-maid-workspace-font', 'data-platform', 'data-windows-titlebar', 'data-fullscreen', 'style'],
        })
        themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ['data-ds-dark-theme', 'data-dsh-maid-atelier', 'class', 'style'],
        })
        themeObserver.observe(document.head, { childList: true })
      } catch {
        themeObserver = null
      }

      let media = null
      try {
        media = window.matchMedia('(prefers-color-scheme: dark)')
        media.addEventListener?.('change', scheduleThemeRefresh)
      } catch {
        media = null
      }

      const dispose = () => {
        if (state.disposed) return
        state.disposed = true
        closeMenu()
        for (const note of state.notes.slice()) note.close()
        state.notes.length = 0
        themeObserver?.disconnect()
        try {
          media?.removeEventListener?.('change', scheduleThemeRefresh)
        } catch {
          /* 忽略 */
        }
        for (const off of cleanup.splice(0)) {
          try {
            off()
          } catch {
            /* 忽略 */
          }
        }
        style.remove()
      }

      ctx.effect?.(() => dispose, 'dsh-explain-note: client lifecycle')
    }

    exports.inject = []
    exports.apply = apply
    return module.exports
  },
})
