let reading;

/** One read serves every row that uses it, so the table describes a single block. */
export const registryState = async () => {
  const { readRegistryState } = await import('../dist/chain/registry.js');
  reading ??= readRegistryState();
  return reading;
};
