// babel-preset-taro 更多选项和默认值：
// https://docs.taro.zone/docs/next/babel-config
module.exports = {
  presets: [
    [
      'taro',
      {
        framework: 'react',
        ts: true,
        compiler: 'webpack5',
        // 真机兼容：显式指定转译目标。package.json 的 browserslist 面向浏览器，
        // 会产生 `?.` / `??` / `catch{}` 等现代语法——微信开发者工具（V8）能跑，
        // 真机 JSCore 解析失败（SyntaxError: Unexpected token .）。
        // 此值即 babel-preset-taro 在无 browserslist 时的默认目标，覆盖 browserslist。
        targets: { ios: '9', android: '5' },
      },
    ],
  ],
}
