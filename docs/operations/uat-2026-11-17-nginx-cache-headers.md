# 2026-11-17 前端首页缓存策略（UAT）

## 现象

部署新版本后，用户仍看到旧界面（例如执行立案抽屉还显示「核对备案信息」「确认提交并登记」两个按钮，而代码里早已合并为一个「提交」）。

## 原因

nginx 站点 `ip-bp-uat` 只有：

```nginx
location / {
    try_files $uri $uri/ /index.html;
}
```

`index.html` 没有 `Cache-Control`，浏览器按启发式缓存；`ETag`/`Last-Modified` 又允许 304 复用，于是旧 `index.html` 一直指向旧的资源哈希，用户始终加载旧 JS。

## 处理

在 `/etc/nginx/sites-enabled/ip-bp-uat` 增加：

```nginx
location = /index.html {
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    expires -1;
    try_files $uri =404;
}

location ~* \.(?:js|css|woff2?)$ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}
```

原配置备份在 `/root/ip-bp-uat.nginx.bak.<时间戳>`；`nginx -t` 通过后 reload。

## 验证

| 请求                     | 头                                                   |
| ------------------------ | ---------------------------------------------------- |
| `GET /`                  | `Cache-Control: no-cache, no-store, must-revalidate` |
| `GET /assets/index-*.js` | `Cache-Control: public, max-age=31536000, immutable` |

## 影响

- 首页每次都向服务端校验，部署后立即生效
- 带哈希的 JS/CSS 长缓存，未变更的版本不重复下载
- 本次变更只改 nginx，不涉及应用代码与部署脚本
