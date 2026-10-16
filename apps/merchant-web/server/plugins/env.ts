import { useEnv } from '../utils/env.ts';

// fail at startup, not on the first request
export default defineNitroPlugin(() => {
  useEnv();
});
