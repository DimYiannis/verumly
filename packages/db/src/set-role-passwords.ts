import { adminDbUrl, dbEnvSchema, loadEnv, sessionModeWarning, usesDbUrls } from '@lr/config';
import { setRolePasswords } from './migrate.ts';

/**
 * `pnpm db:set-role-passwords`: set the four service roles' passwords from the `*_DB_PASSWORD` variables.
 * `pnpm db:migrate` no longer does this on a hosted database, so run this once for a new project and again only to rotate.
 * Each password must equal the one inside its role's connection URL.
 */
const env = loadEnv(dbEnvSchema);
const warning = usesDbUrls(env) ? sessionModeWarning('PG_ADMIN_URL', adminDbUrl(env)) : undefined;
if (warning) console.warn(`WARNING: ${warning}`);
await setRolePasswords(env);
console.log('role passwords set for merchant_api, buyer_api, worker, dashboard');
