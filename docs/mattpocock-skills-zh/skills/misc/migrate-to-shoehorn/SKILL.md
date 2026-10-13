---
name: migrate-to-shoehorn
description: 将测试文件中的 `as` 类型断言迁移到 @total-typescript/shoehorn。用户提到 shoehorn、希望替换测试中的 `as`，或需要不完整的测试数据时使用。
---

# 迁移到 Shoehorn

## 使用 shoehorn 的原因

`shoehorn` 允许在测试中传入不完整数据，同时满足 TypeScript 类型检查。它用类型安全的替代方式取代 `as` 断言。

**仅用于测试代码。** 绝不在生产代码中使用 shoehorn。

测试中使用 `as` 的问题：

- 模型训练为不使用它。
- 必须手动指定目标类型。
- 有意传入错误数据时，需要双重 as（`as unknown as Type`）。

## 安装

```bash
npm i @total-typescript/shoehorn
```

## 迁移模式

### 大对象中只需要少量属性

修改前：

```ts
type Request = {
  body: { id: string };
  headers: Record<string, string>;
  cookies: Record<string, string>;
  // ……还有 20 个属性
};

it("gets user by id", () => {
  // 只关心 body.id，却必须伪造整个 Request
  getUser({
    body: { id: "123" },
    headers: {},
    cookies: {},
    // ……伪造全部 20 个属性
  });
});
```

修改后：

```ts
import { fromPartial } from "@total-typescript/shoehorn";

it("gets user by id", () => {
  getUser(
    fromPartial({
      body: { id: "123" },
    }),
  );
});
```

### `as Type` → `fromPartial()`

修改前：

```ts
getUser({ body: { id: "123" } } as Request);
```

修改后：

```ts
import { fromPartial } from "@total-typescript/shoehorn";

getUser(fromPartial({ body: { id: "123" } }));
```

### `as unknown as Type` → `fromAny()`

修改前：

```ts
getUser({ body: { id: 123 } } as unknown as Request); // 有意传入错误类型
```

修改后：

```ts
import { fromAny } from "@total-typescript/shoehorn";

getUser(fromAny({ body: { id: 123 } }));
```

## 各函数的适用情况

| 函数 | 用途 |
| --- | --- |
| `fromPartial()` | 传入仍能通过类型检查的不完整数据 |
| `fromAny()` | 有意传入错误数据，保留自动补全 |
| `fromExact()` | 强制提供完整对象，之后可换成 fromPartial |

## 工作流

1. **收集要求**，询问用户：
   - 哪些测试文件中的 `as` 断言造成问题？
   - 是否在处理只关心部分属性的大对象？
   - 是否要在错误测试中有意传入错误数据？
2. **安装并迁移**：
   - [ ] 安装：`npm i @total-typescript/shoehorn`。
   - [ ] 查找包含 `as` 断言的测试文件：`grep -r " as [A-Z]" --include="*.test.ts" --include="*.spec.ts"`。
   - [ ] 将 `as Type` 替换为 `fromPartial()`。
   - [ ] 将 `as unknown as Type` 替换为 `fromAny()`。
   - [ ] 添加来自 `@total-typescript/shoehorn` 的导入。
   - [ ] 运行类型检查验证。
