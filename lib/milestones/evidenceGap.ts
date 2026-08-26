export interface EvidenceCandidate {
  evidenceType: string;
  confirmed: boolean;
}

export function getMissingEvidenceTypes(
  expectedTypes: string[],
  evidences: EvidenceCandidate[],
): string[] {
  const normalizedExpected = [...new Set(expectedTypes.map((type) => type.trim()).filter(Boolean))];
  const confirmedTypes = new Set(
    evidences
      .filter((evidence) => evidence.confirmed)
      .map((evidence) => evidence.evidenceType.trim())
      .filter(Boolean),
  );
  return normalizedExpected.filter((type) => !confirmedTypes.has(type));
}
