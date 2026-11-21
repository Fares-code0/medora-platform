/**
 * Babel — Metro and Jest share this configuration so the module alias
 * (`@/…`) resolves identically in the bundler, the type checker and the
 * test runner. A third resolution path is a third place they can drift.
 */
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          alias: { '@': './src' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};
