-- Personal navigation preference only; mission ownership and lifecycle are revalidated on reads/writes.
ALTER TABLE "ProjectMembership" ADD COLUMN "focusMissionId" TEXT;
