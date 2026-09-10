import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 빌드 산출물 폴더. 기본은 `.next`.
   *
   * 개발 서버 두 개가 같은 `.next`를 쓰면 서로의 청크를 지워 둘 다 망가진다.
   * 그래서 검증용 서버는 `npm run dev:verify`로 `.next-verify`에 따로 쌓는다.
   *
   * ⚠️ Next는 `tsconfig.json`의 `include`에 자기 distDir의 타입 경로가 없으면
   * 그 파일을 고쳐 쓴다. 그 쓰기가 돌고 있는 개발 서버를 재시작시키고, 반복되면
   * 응답이 멈춘다. `.next-verify`와 `.next-build` 경로를 tsconfig에 미리 넣어 뒀다.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",};

export default nextConfig;
