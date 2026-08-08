# HTML 报告格式

架构评审应渲染为操作系统临时目录中的单个自包含 HTML 文件。Tailwind 和 Mermaid 均来自 CDN。Mermaid 适合图关系；手写 div 与内联 SVG 适合质量图、剖面等编辑式视觉。混合使用，不要让所有内容都像通用 Mermaid 图。

## 脚手架

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>架构评审 — {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      /* Tailwind 不便表达的少量样式：虚线接缝、箭头等。 */
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## 页首

显示仓库名、日期和紧凑图例：实线框代表模块，虚线代表接缝，红箭头代表泄漏，粗深色框代表深模块。不要写引言，直接进入候选项。

## 候选卡片

图承担主要表达，文字应简短、直白，并自然使用 `/codebase-design` 词汇。每个候选项一个 `<article>`：

- **标题**：简短且直接描述深化，例如“合并 Order intake 流水线”。
- **徽标行**：推荐强度（`Strong` 为祖母绿、`Worth exploring` 为琥珀、`Speculative` 为石板灰）和依赖类别（`in-process`、`local-substitutable`、`ports & adapters`、`mock`）。
- **文件**：使用 `font-mono text-sm`。
- **前后对照图**：双栏并排，是卡片核心。
- **问题**：一句话说明哪里造成了痛苦。
- **方案**：一句话说明什么会发生变化。
- **收益**：每项不超过六个词。
- **ADR 提示**：需要时用一行琥珀色提示框。

若图必须依赖一整段文字才能理解，应重画。

## 图形模式

为候选项选择最合适的模式并保持多样性。

### Mermaid 图：依赖与调用流

当重点是“X 调用 Y、Y 再调用 Z，看看这有多混乱”时，使用 Mermaid 的 `flowchart` 或 `graph`。用 Tailwind 卡片包裹 Mermaid；泄漏边用红色，深模块用深色。时序图适合对比改造前后的往返次数。

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
  <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### 手绘框与箭头

Mermaid 排版不合适时，用带边框的 `<div>` 表示模块，在相对定位容器上用内联 SVG `<line>` 或 `<path>` 画箭头。改造后可用一个粗边框深模块包裹淡化的内部细节。

### 剖面图

适合分层浅度：改造前是调用穿过的多个薄水平带（`h-12 border-l-4`），改造后是一条承担统一职责的厚带。

### 质量图

每个模块用两个矩形表示接口表面积与实现。浅模块的接口矩形几乎和实现一样高；深模块的接口短、实现高。

### 调用图折叠

改造前显示嵌套函数调用树，改造后折叠成一个框，并在内部淡化原调用。

## 样式

- 使用编辑式而非企业仪表盘风格，保留充足留白；标题可用 `font-serif`。
- 色彩克制：一个祖母绿或靛蓝强调色，红色表示泄漏，琥珀色表示警告。
- 图高约 320px，使前后对照无需滚动即可并排。
- 图内模块标签使用 `text-xs uppercase tracking-wider`，呈现示意图而非 UI。
- 仅允许 Tailwind CDN 与 Mermaid ESM import；其余内容为静态 HTML。

## 首要推荐

使用一张较大的卡片，只包含候选项名称、一句优先原因和指向对应卡片的锚链接。

## 语气与词汇

表达应简洁直白，但架构名词和动词必须来自 `/codebase-design`。

必须使用：module、interface、implementation、depth、deep、shallow、seam、adapter、leverage、locality。

不要替换为：component、service、unit（代替 module）；API、signature（代替 interface）；boundary（代替 seam）；layer、wrapper（本意是 module 时）。

合适的表达：

- “Order intake module 很浅：interface 几乎等同于 implementation。”
- “Pricing 越过 seam 泄漏。”
- “深化：一个 interface，一个测试位置。”
- “两个 adapter 证明 seam 成立：生产使用 HTTP，测试使用内存实现。”

收益项应点明词汇，例如“locality：缺陷集中在一个 module”、“leverage：一个 interface，N 个调用点”、“interface 缩小，implementation 吸收浅模块”。不要写空泛的“更易维护”或“代码更干净”。

不要含糊、铺垫或写“值得注意的是”。句子能改成条目就改，条目能删除就删。优先复用词汇表，避免发明新术语。
