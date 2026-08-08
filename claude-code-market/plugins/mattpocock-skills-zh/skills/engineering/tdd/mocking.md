# 何时使用 Mock

只在**系统边界**使用 mock：

- 外部 API（支付、邮件等）
- 数据库（有时需要；优先使用测试数据库）
- 时间与随机性
- 文件系统（有时需要）

不要 mock：

- 自己的类或模块
- 内部协作者
- 任何由你控制的内容

## 为可 Mock 性设计

在系统边界设计易于 mock 的接口：

**1. 使用依赖注入**

从外部传入依赖，不要在内部创建：

```typescript
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. 优先使用 SDK 风格接口，而不是通用 fetcher**

为每项外部操作创建专用函数，不要使用一个带条件逻辑的通用函数：

```typescript
// GOOD: Each function is independently mockable
const api = {
  getUser: (id) => fetch(`/users/${id}`),
  getOrders: (userId) => fetch(`/users/${userId}/orders`),
  createOrder: (data) => fetch('/orders', { method: 'POST', body: data }),
};

// BAD: Mocking requires conditional logic inside the mock
const api = {
  fetch: (endpoint, options) => fetch(endpoint, options),
};
```

SDK 方式意味着：
- 每个 mock 只返回一种具体形状
- 测试设置中没有条件逻辑
- 更容易看出测试调用了哪些端点
- 每个端点都具备类型安全
