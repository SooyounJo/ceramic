const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 상위 디렉터리에 다른 yarn.lock이 있을 때 추적 루트 고정
  outputFileTracingRoot: path.join(__dirname),
};

module.exports = nextConfig;
