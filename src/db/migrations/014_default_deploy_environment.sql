ALTER TABLE runtime_config
  ADD COLUMN IF NOT EXISTS deploy_environment TEXT NOT NULL DEFAULT 'prod';

UPDATE runtime_config
SET deploy_environment = COALESCE(NULLIF(TRIM(deploy_environment), ''), 'prod')
WHERE id = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'runtime_config_deploy_environment_check'
  ) THEN
    ALTER TABLE runtime_config
      ADD CONSTRAINT runtime_config_deploy_environment_check
      CHECK (deploy_environment IN ('prod', 'staging'));
  END IF;
END
$$;
