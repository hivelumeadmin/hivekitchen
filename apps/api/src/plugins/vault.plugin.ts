import fp from 'fastify-plugin';

export const vaultPlugin = fp(async (fastify) => {
  const nodeEnv = fastify.env.NODE_ENV;

  if (nodeEnv === 'development' || nodeEnv === 'test') {
    return;
  }

  if (nodeEnv === 'staging') {
    fastify.log.warn(
      { nodeEnv },
      'vault.plugin: Vault integration not yet implemented — staging runs against process.env secrets',
    );
    return;
  }

  fastify.log.fatal(
    { nodeEnv },
    'vault.plugin: Vault integration not yet implemented — refusing to start in production',
  );
  process.exit(1);
});
