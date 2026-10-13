// @ts-check
// 通过 dependency-cruiser 强制深模块边界。
//
// Packages 根目录下的每个 package 都是深模块：小接口背后包含大量行为。
// Package 的公开部分是入口，即 package 根目录中的文件。
// 实现位于子目录，属于私有内容。约定 `lib/` 存放实现、`tests/` 存放测试，
// 但任意子目录均私有。Package 可提供多个小入口，例如 index.ts、client.ts、
// server.ts；优先采用这种方式，而非一个巨大的 barrel index。
//
// 在这里，唯一需要编辑的内容应是 PACKAGES_ROOT。

/** Packages 的位置。每个直接子目录对应一个 package，结构扁平、不嵌套。 */
const PACKAGES_ROOT = "src/packages";

// --- 派生模式，无需编辑 -----------------------------------------------------
const R = PACKAGES_ROOT;
/**
 * Package 的私有实现：嵌套在 package 子目录中的全部内容。
 * Package 根文件是入口，不被此模式匹配，外部仍可导入。
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "应用或根目录代码可导入 package 的入口，即根文件，但不能导入子目录中的任何内容。",
      severity: "error",
      from: { pathNot: `^${R}/` }, // 导入者不在任何 package 内
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "同一 package 的文件可自由互相导入，但只能通过入口访问其他 packages，不能访问其内部实现。",
      severity: "error",
      // 导入者位于 package（$1）内，但不是测试文件
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/`, // 同一 package → 内部自由导入
      },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "Package 的测试与其他使用者一样通过入口验证行为。可导入任意 package 的入口及自身 tests/ fixtures，但不能导入任何 package 的内部实现，包括自己所在的 package。",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` }, // package $1 中的测试文件
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/tests/`, // 自身 tests/ fixtures → 允许
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "只有测试可访问 package 的 tests/ 文件夹，其他内容不能导入 fixtures。",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` }, // 导入者本身不是测试
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment: "不允许依赖循环。希望允许 packages 外部循环时，将范围限定为 `^${R}/`。",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // --- 分层，可选、默认关闭 -------------------------------------------------
    // 隐藏接口控制怎样导入，即通过入口。
    // 分层控制哪些 packages 可依赖哪些 packages。在这里添加自定义规则，例如：
    //
    // {
    //   name: "ui-may-not-depend-on-billing",
    //   severity: "error",
    //   from: { path: `^${R}/ui/` },
    //   to:   { path: `^${R}/billing/` },
    // },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
