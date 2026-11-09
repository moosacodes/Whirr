import type { Config } from './config.ts';
import type { Store } from './db/index.ts';
import type { PayPalClient } from '../../../packages/paypal/src/client.ts';
import type { RateLimiter } from './lib/rate-limit.ts';
import type { Signer } from './lib/signing.ts';

export interface AppContext {
  config: Config;
  store: Store;
  paypal: PayPalClient | null;
  limiter: RateLimiter;
  signer: Signer;
  now: () => Date;
}

export interface Actor {
  type: 'operator' | 'renter';
  id: string;
}
