import resolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import commonjs from "@rollup/plugin-commonjs";

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.vsavinkov.claude.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: true,
  },
  plugins: [
    resolve({ preferBuiltins: true }),
    commonjs(),
    typescript({
      tsconfig: "./tsconfig.json",
      outDir: "com.vsavinkov.claude.sdPlugin/bin",
    }),
  ],
  external: [
    "@elgato/streamdeck",
    /^node:/,
    "child_process", "fs", "os", "path", "util", "events", "stream", "net", "http", "https", "tls", "crypto", "buffer", "url", "querystring", "zlib",
  ],
};
