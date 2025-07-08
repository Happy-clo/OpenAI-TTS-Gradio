# 随机一言古诗词 API 文档

## 概述

随机一言古诗词 API 提供了获取随机一言或古诗词的功能，为应用提供灵感和文化内容。该接口基于第三方服务，提供快速响应和丰富的内容库。

## 功能特性

- 🎯 **精准定位**: 可定位到县级行政区
- 🌍 **全球覆盖**: 支持国内外 IP 地址查询
- ⚡ **快速响应**: 基于本地数据实现高效查询
- 📊 **详细信息**: 包含地理位置、运营商、经纬度等完整信息

## API 端点

### 随机一言古诗词

**端点**: `GET /api/network/yiyan`

**描述**: 获取随机的一言或古诗词内容

**参数**:

| 参数名 | 类型   | 必传 | 说明                                           |
| ------ | ------ | ---- | ---------------------------------------------- |
| type   | string | 是   | 返回类型：`hitokoto`(一言) 或 `poetry`(古诗词) |

**请求示例**:

```bash
# 获取随机一言
curl "http://localhost:3000/api/network/yiyan?type=hitokoto"

# 获取随机古诗词
curl "http://localhost:3000/api/network/yiyan?type=poetry"
```

**响应示例**:

```json
{
  "success": true,
  "message": "随机一言古诗词获取完成",
  "data": {
    "code": "200",
    "data": "和王位什么的无关，我只为了这位殿下本人而挥剑。",
    "msg": "数据请求成功"
  }
}
```

**错误响应示例**:

```json
{
  "success": false,
  "error": "类型参数必须是 hitokoto(一言) 或 poetry(古诗词)"
}
```

## 使用场景

### 1. 网站首页展示

```javascript
// 在网站首页显示每日一言
fetch("/api/network/yiyan?type=hitokoto")
  .then((response) => response.json())
  .then((data) => {
    if (data.success) {
      document.getElementById("daily-quote").textContent = data.data.data;
    }
  });
```

### 2. 移动应用启动页

```javascript
// 应用启动时显示随机古诗词
fetch("/api/network/yiyan?type=poetry")
  .then((response) => response.json())
  .then((data) => {
    if (data.success) {
      showSplashScreen(data.data.data);
    }
  });
```

### 3. 社交媒体分享

```javascript
// 生成分享内容
async function generateShareContent() {
  const response = await fetch("/api/network/yiyan?type=hitokoto");
  const data = await response.json();

  if (data.success) {
    return `今日一言：${data.data.data}`;
  }
  return "今日一言获取失败";
}
```

## 错误处理

### 常见错误码

| 状态码 | 说明       | 解决方案               |
| ------ | ---------- | ---------------------- |
| 400    | 参数错误   | 检查 type 参数是否正确 |
| 500    | 服务器错误 | 稍后重试或联系管理员   |

### 错误处理示例

```javascript
async function getRandomQuote(type) {
  try {
    const response = await fetch(`/api/network/yiyan?type=${type}`);
    const data = await response.json();

    if (data.success) {
      return data.data.data;
    } else {
      console.error("获取失败:", data.error);
      return "获取失败，请稍后重试";
    }
  } catch (error) {
    console.error("网络错误:", error);
    return "网络错误，请检查连接";
  }
}
```

## 限流规则

- **普通用户**: 每分钟最多 30 次请求
- **本地 IP**: 不受限流限制
- **超出限制**: 返回 429 状态码

## 测试

### 运行完整测试

```bash
# 测试所有网络API（包括一言古诗词）
node scripts/test-network-apis.js

# 专门测试一言古诗词功能
node scripts/test-yiyan.js
```

### 手动测试

```bash
# 测试一言
curl "http://localhost:3000/api/network/yiyan?type=hitokoto"

# 测试古诗词
curl "http://localhost:3000/api/network/yiyan?type=poetry"

# 测试错误参数
curl "http://localhost:3000/api/network/yiyan?type=invalid"
```

## 注意事项

1. **内容随机性**: 每次请求返回的内容都是随机的
2. **内容质量**: 内容来源于第三方服务，质量有保障
3. **响应时间**: 通常在 1-3 秒内响应
4. **缓存建议**: 建议在客户端适当缓存，避免频繁请求
5. **使用场景**: 适用于网站装饰、应用启动页、社交媒体分享等

## 部署要求

1. **网络连接**: 确保服务器能够访问 `https://v2.xxapi.cn`
2. **依赖**: 项目已包含所需依赖
3. **防火墙**: 确保没有阻止外部网络请求
4. **监控**: 建议监控 API 使用情况和错误率

## 扩展功能

未来可以考虑添加的功能：

1. 更多内容类型（名言警句、诗词鉴赏等）
2. 按主题分类（爱情、励志、哲理等）
3. 多语言支持
4. 内容收藏功能
5. 个性化推荐

## 技术支持

如有问题或建议，请联系开发团队或查看项目文档。
