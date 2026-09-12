-- R1: artifact provenance refs captured at generation time.
-- Additive nullable column; historical artifacts stay NULL and the audit
-- service must report them as untraceable instead of reconstructing history.
ALTER TABLE "GeneratedArtifact" ADD COLUMN "sourceRefs" JSON;

-- Rollback guidance: dropping this column only removes future provenance
-- capture; audit history already returned to clients is unaffected.
