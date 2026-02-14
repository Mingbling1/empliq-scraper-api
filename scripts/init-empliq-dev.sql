-- ==========================================
-- empliq_dev - Scraper Staging Database
-- ==========================================
-- This database stores raw scraper data from n8n.
-- All scraped fields are stored in a single JSONB column.
-- Data will be processed and migrated to the empliq production DB later.
--
-- Usage (from inside chatwoot-postgres container):
--   psql -U postgres -c "CREATE DATABASE empliq_dev OWNER postgres;"
--   psql -U postgres -d empliq_dev -f /path/to/init-empliq-dev.sql
-- ==========================================

CREATE TABLE IF NOT EXISTS companies_raw (
    id SERIAL PRIMARY KEY,
    ruc VARCHAR(11) UNIQUE NOT NULL,
    razon_social VARCHAR(500),
    data JSONB NOT NULL DEFAULT '{}',
    source VARCHAR(50) DEFAULT 'n8n_scraper',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_companies_raw_ruc ON companies_raw(ruc);
CREATE INDEX IF NOT EXISTS idx_companies_raw_data ON companies_raw USING GIN(data);

COMMENT ON TABLE companies_raw IS 'Raw scraper data from n8n. All scraped fields stored in the data JSONB column. Will be processed and migrated to the empliq production DB later.';
COMMENT ON COLUMN companies_raw.ruc IS 'RUC de SUNAT - unique identifier for each company';
COMMENT ON COLUMN companies_raw.razon_social IS 'Company legal name from CSV';
COMMENT ON COLUMN companies_raw.data IS 'All scraped data as JSON: website, search results, AI extraction, etc.';
COMMENT ON COLUMN companies_raw.source IS 'Origin of the data: n8n_scraper, manual, etc.';
