import { DEMO_OWNER } from '../../utils/demo.ts';

/** Tells the login page whether demo sign-in is on, and the demo account to prefill. */
export default publicHandler(async () => (useEnv().DEMO_MODE ? { enabled: true, email: DEMO_OWNER.email, password: DEMO_OWNER.password } : { enabled: false }));
