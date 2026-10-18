export function createMcpbManifest(packageJson) {
  return {
    manifest_version: '0.2',
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    author: { name: 'Simon Office' },
    compatibility: { platforms: ['darwin', 'win32', 'linux'], runtimes: { node: '>=24.0.0' } },
    user_config: {
      IMOTI_VISIBLE: { type: 'boolean', title: 'Visible browser', description: 'Show the browser while searching.', default: false },
      IMOTI_BROWSER_EXECUTABLE: { type: 'string', title: 'Browser executable', description: 'Optional path to a Chromium browser executable.', default: '' },
      IMOTI_DATA_DIR: { type: 'directory', title: 'Data directory', description: 'Directory for local property data.', default: '' }
    },
    server: {
      type: 'node',
      entry_point: 'dist/main.js',
      mcp_config: {
        command: 'node',
        args: ['--disable-warning=ExperimentalWarning', '${__dirname}/dist/main.js'],
        env: {
          IMOTI_VISIBLE: '${user_config.IMOTI_VISIBLE}',
          IMOTI_BROWSER_EXECUTABLE: '${user_config.IMOTI_BROWSER_EXECUTABLE}',
          IMOTI_DATA_DIR: '${user_config.IMOTI_DATA_DIR}'
        }
      }
    }
  };
}
