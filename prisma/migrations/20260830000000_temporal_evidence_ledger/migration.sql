-- ProjectMemo 2.1 / W04 Temporal Evidence Ledger
-- Additive columns keep every 2.0 CardRelation readable. Existing rows become
-- RELATED + confirmed=false and therefore cannot silently change current facts.
ALTER TABLE "CardRelation" ADD COLUMN "relationType" TEXT NOT NULL DEFAULT 'RELATED';
ALTER TABLE "CardRelation" ADD COLUMN "confidence" REAL;
ALTER TABLE "CardRelation" ADD COLUMN "confirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CardRelation" ADD COLUMN "confirmedAt" DATETIME;
ALTER TABLE "CardRelation" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "CardRelation" ADD COLUMN "validFrom" DATETIME;
ALTER TABLE "CardRelation" ADD COLUMN "validTo" DATETIME;

-- Multiple historical proposals between the same cards must remain auditable,
-- so the 2.0 pair uniqueness constraint becomes a lookup index. The service
-- layer rejects duplicate live proposals while allowing a revoked proposal to
-- be proposed again as a new immutable history row.
DROP INDEX "CardRelation_currentCardId_relatedCardId_key";
CREATE INDEX "CardRelation_currentCardId_relatedCardId_relationType_idx"
ON "CardRelation"("currentCardId", "relatedCardId", "relationType");
CREATE INDEX "CardRelation_relationType_confirmed_revokedAt_idx"
ON "CardRelation"("relationType", "confirmed", "revokedAt");

-- Rollback guidance: disable TEMPORAL_MEMORY_ENABLED first. A destructive
-- rollback must rebuild CardRelation without the seven temporal columns and
-- restore the old pair unique index only after duplicate history rows have
-- been archived; do not drop audit history automatically.
