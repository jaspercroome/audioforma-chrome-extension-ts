// Standalone preview of the orb: the extension's own components and analysis,
// fed by a synthesized demo song or a dropped audio file instead of tab capture.
//
//   npm run build:preview
//   npx http-server preview-dist   (or any static server), then open index.html
//
// preview/audioforma-orb.html is written as page content (no <html>/<head>
// wrapper) so it can also be published as a hosted page; the build wraps it.
const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");

const wrap = (content) =>
  `<!doctype html>\n<html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head>` +
  `<body>\n${content}\n</body></html>\n`;

module.exports = {
  mode: "production",
  devtool: false,
  entry: {
    preview: path.join(__dirname, "..", "src", "preview", "index.tsx"),
    // Per-stem analysis runs in workers; the page loads this file next to itself.
    stemWorker: path.join(__dirname, "..", "src", "stems", "stemWorker.ts"),
  },
  output: {
    path: path.join(__dirname, "..", "preview-dist"),
    filename: "[name].js",
  },
  module: {
    rules: [{ test: /\.tsx?$/, use: "ts-loader", exclude: /node_modules/ }],
  },
  resolve: { extensions: [".ts", ".tsx", ".js"] },
  performance: { hints: false },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: path.join(__dirname, "..", "preview", "audioforma-orb.html"),
          to: "index.html",
          transform: (buffer) => wrap(buffer.toString()),
        },
      ],
    }),
  ],
};
