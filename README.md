# galadocs
galadocs

## 盘后复盘部署

运行 `npm run deploy:mac-build-server` 会以 `/review/` 为基础路径构建页面，并部署到 `/Users/zhulijian/mac-build-server/public/review`。访问 `http://kuiklybuild.local:9000/review/`。

运行 `npm run review:collect` 会在采集成功后自动重新打包，并部署到 `/Users/zhulijian/mac-build-server/public/review`；采集失败时不会部署。定时任务在周一至周五北京时间 18:30 运行，交易日历会跳过休市日。原始日行情保存在项目根目录 `market-data/daily/YYYY-MM-DD/`，不会复制到网页服务目录。`npm run review:publish` 仅用于手动同步 JSON，不作为定时更新入口。
# galadocs

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd) 
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

## Project Setup

```sh
npm install
```

### Compile and Hot-Reload for Development

```sh
npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```
