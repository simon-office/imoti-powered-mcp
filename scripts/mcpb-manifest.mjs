export function createMcpbManifest(packageJson) {
  return {
    manifest_version: '0.2',
    name: packageJson.name,
    version: packageJson.version,
    description: packageJson.description,
    author: { name: 'Simon Office' },
    server: {
      type: 'node',
      entry_point: 'dist/main.js',
      mcp_config: { command: 'node', args: ['${__dirname}/dist/main.js'] }
    }
  };
}
