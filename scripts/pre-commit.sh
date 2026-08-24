#!/bin/bash
set -e

echo "🔍 ESLint..."
npx eslint src/ --ext .ts,.vue || {
  echo "❌ ESLint 失败,请修复后再提交"
  exit 1
}

echo "🧪 前端测试..."
npx vitest run --reporter=verbose 2>&1 | tail -5 || {
  echo "❌ 前端测试失败"
  exit 1
}

echo "🦀 Rust 测试..."
cd src-tauri && cargo test 2>&1 | tail -5 || {
  echo "❌ Rust 测试失败"
  exit 1
}
cd ..

echo "📦 类型检查 + 构建..."
npm run build 2>&1 | tail -3 || {
  echo "❌ 构建失败"
  exit 1
}

echo "✅ 全部通过,提交放行"
