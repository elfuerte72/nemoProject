import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@nemo/db', '@nemo/types', '@nemo/crypto'],
  serverExternalPackages: ['postgres'],
};

export default config;
