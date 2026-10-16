DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'merchant_api') THEN CREATE ROLE merchant_api NOLOGIN; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'buyer_api') THEN CREATE ROLE buyer_api NOLOGIN; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'worker') THEN CREATE ROLE worker NOLOGIN; END IF; END $$;
--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashboard') THEN CREATE ROLE dashboard NOLOGIN; END IF; END $$;
--> statement-breakpoint
REVOKE ALL ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA merchant, buyer, leads, ops FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA merchant, ops TO merchant_api, dashboard;
--> statement-breakpoint
GRANT USAGE ON SCHEMA merchant, buyer, leads, ops TO buyer_api, worker;
--> statement-breakpoint
ALTER TABLE merchant.organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.terminals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.receipts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.receipt_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.receipt_lines ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.merchant_users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.dashboard_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.daily_rollups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE merchant.exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.locations FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.terminals FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.receipts FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.receipt_versions FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.receipt_lines FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.merchant_users FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.dashboard_sessions FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.daily_rollups FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.exports FOR ALL TO merchant_api, dashboard USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY org_isolation ON merchant.organizations FOR ALL TO merchant_api, dashboard USING (id = NULLIF(current_setting('app.org_id', true), '')::uuid) WITH CHECK (id = NULLIF(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.organizations FOR SELECT TO buyer_api, worker USING (true);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.locations FOR SELECT TO buyer_api, worker USING (true);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.receipts FOR SELECT TO buyer_api, worker USING (true);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.receipt_versions FOR SELECT TO buyer_api, worker USING (true);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.receipt_lines FOR SELECT TO buyer_api, worker USING (true);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.daily_rollups FOR SELECT TO buyer_api, worker USING (true);
--> statement-breakpoint
CREATE POLICY internal_read ON merchant.exports FOR SELECT TO buyer_api, worker USING (true);
--> statement-breakpoint
CREATE POLICY worker_write ON merchant.receipts FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY worker_write ON merchant.receipt_versions FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY worker_write ON merchant.receipt_lines FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY worker_write ON merchant.daily_rollups FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY worker_write ON merchant.exports FOR ALL TO worker USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON merchant.receipts TO merchant_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON merchant.receipt_versions TO merchant_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON merchant.receipt_lines TO merchant_api;
--> statement-breakpoint
GRANT SELECT ON merchant.organizations, merchant.locations, merchant.terminals TO merchant_api;
--> statement-breakpoint
GRANT UPDATE (last_seen_at) ON merchant.terminals TO merchant_api;
--> statement-breakpoint
GRANT INSERT ON ops.audit_log TO merchant_api, buyer_api, worker, dashboard;
--> statement-breakpoint
GRANT SELECT, INSERT ON ops.idempotency_keys TO merchant_api;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA ops TO merchant_api, buyer_api, worker, dashboard;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON merchant.locations, merchant.terminals, merchant.merchant_users, merchant.dashboard_sessions TO dashboard;
--> statement-breakpoint
GRANT SELECT, UPDATE ON merchant.organizations TO dashboard;
--> statement-breakpoint
GRANT SELECT ON merchant.receipts, merchant.receipt_versions, merchant.receipt_lines, merchant.daily_rollups TO dashboard;
--> statement-breakpoint
GRANT SELECT, INSERT ON merchant.exports TO dashboard;
--> statement-breakpoint
GRANT SELECT ON merchant.receipts, merchant.receipt_versions TO buyer_api, worker;
--> statement-breakpoint
GRANT SELECT (id, legal_name, kvk_number, vat_number, country) ON merchant.organizations TO buyer_api, worker;
--> statement-breakpoint
GRANT SELECT (id, org_id, name, address, postcode) ON merchant.locations TO buyer_api, worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON merchant.receipt_lines, merchant.daily_rollups TO worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON merchant.exports TO worker;
--> statement-breakpoint
GRANT DELETE ON merchant.receipts, merchant.receipt_versions TO worker;
--> statement-breakpoint
GRANT SELECT ON merchant.receipt_lines TO buyer_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON buyer.users, buyer.sessions, buyer.email_codes, buyer.push_subscriptions, buyer.claims, buyer.uploads TO buyer_api, worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON buyer.consents TO buyer_api, worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON leads.unknown_merchants, leads.unknown_merchant_uploaders TO buyer_api, worker;
--> statement-breakpoint
GRANT SELECT ON ops.idempotency_keys TO worker;
--> statement-breakpoint
CREATE FUNCTION merchant.authenticate_terminal(p_hash text) RETURNS TABLE (id uuid, org_id uuid, location_id uuid, signing_public_key text, revoked_at timestamptz) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = merchant, pg_temp AS $$ SELECT t.id, t.org_id, t.location_id, t.signing_public_key, t.revoked_at FROM merchant.terminals t WHERE t.api_key_hash = p_hash $$;
--> statement-breakpoint
CREATE FUNCTION merchant.find_user_for_login(p_email text) RETURNS TABLE (id uuid, org_id uuid, email text, password_hash text, totp_secret_encrypted text, role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = merchant, pg_temp AS $$ SELECT u.id, u.org_id, u.email, u.password_hash, u.totp_secret_encrypted, u.role FROM merchant.merchant_users u WHERE u.email = p_email $$;
--> statement-breakpoint
CREATE FUNCTION merchant.find_dashboard_session(p_hash text) RETURNS TABLE (user_id uuid, org_id uuid, mfa_done boolean, expires_at timestamptz, role text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = merchant, pg_temp AS $$ SELECT s.user_id, s.org_id, s.mfa_done, s.expires_at, u.role FROM merchant.dashboard_sessions s JOIN merchant.merchant_users u ON u.id = s.user_id WHERE s.token_hash = p_hash $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION merchant.authenticate_terminal(text), merchant.find_user_for_login(text), merchant.find_dashboard_session(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION merchant.authenticate_terminal(text) TO merchant_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION merchant.find_user_for_login(text), merchant.find_dashboard_session(text) TO dashboard;
