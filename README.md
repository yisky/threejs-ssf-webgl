# 屏幕空间雾

用 three.js 和 postprocessing 实现的屏幕空间雾示例。场景里可以同时看到高度雾、距离雾、流动噪声和朝向太阳的方向散射。

效果在 `src/ssf/`：`SSFEffect.ts` 接在 `EffectPass` 上，着色器读取场景深度。右侧面板可以开关雾，并调节雾体、高度、噪声和散射。

## 运行

需要 pnpm。

```sh
pnpm install
pnpm dev
```

`pnpm build` 做类型检查并打包，`pnpm preview` 预览构建结果。

## 操作

- 鼠标拖拽旋转，滚轮缩放。
- WASD 沿相机视线前后左右移动，观察点同步平移。

## 模型

场景模型为 99.Miles 的《Dirt Road Through Forest》，CC BY 4.0。

This work is based on "[UPDATE] Dirt Road Through Forest" (https://sketchfab.com/3d-models/update-dirt-road-through-forest-c4676cdf7715484382400ff63faffd45) by 99.Miles (https://sketchfab.com/99.Miles) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
