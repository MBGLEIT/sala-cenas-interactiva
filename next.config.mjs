/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@napi-rs/canvas"],
    outputFileTracingIncludes: {
      "/api/admin/mesas/import-plan": [
        "./node_modules/tesseract.js/**/*",
        "./node_modules/tesseract.js-core/**/*",
        "./node_modules/pdfjs-dist/**/*",
        "./node_modules/@napi-rs/canvas/**/*",
      ],
    },
  },
};

export default nextConfig;
