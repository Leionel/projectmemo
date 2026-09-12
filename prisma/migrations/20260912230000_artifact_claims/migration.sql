-- E3: versioned per-sentence claim mappings for generated artifacts.
-- NULL claims = artifact saved before claim capture (legacy context-only provenance).
ALTER TABLE "GeneratedArtifact" ADD COLUMN "claims" JSON;

-- Rollback guidance: dropping the column only removes future claim capture.
