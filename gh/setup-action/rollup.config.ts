// See: https://rollupjs.org/introduction/

import commonjs from '@rollup/plugin-commonjs'
import json from '@rollup/plugin-json'
import nodeResolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const config = {
  input: 'src/index.ts',
  output: {
    esModule: true,
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true
  },
  plugins: [
    typescript(),
    nodeResolve({ preferBuiltins: true }),
    commonjs(),
    json()
  ],
  onwarn(warning, warn) {
    // Known circular dep inside @actions/core (oidc-utils ↔ core); harmless in bundle
    if (warning.code === 'CIRCULAR_DEPENDENCY') return
    warn(warning)
  }
}

export default config
