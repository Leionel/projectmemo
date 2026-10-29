export class FitBasis { kind: string = ''; quote: string = ''; }
export class FitCheck { id: string = ''; expected: string = ''; basis: FitBasis = new FitBasis(); }
export class FitMeasurement { name: string = ''; unit: string = ''; period?: string; upperLimit?: number; }
export class FitPremise {
 schemaVersion: number = 1; domain: string = ''; questionId: string = ''; premiseHash: string = ''; basisStatus: string = '';
 measurement: FitMeasurement = new FitMeasurement(); checks: FitCheck[] = [];
}
export class EvidenceReview {
 schemaVersion: number = 1; mode: string = 'CONDITIONAL_ANALYSIS'; note: string = ''; premiseHash: string = ''; confirmedPremise: boolean = true;
}
export class FitGroup { sourceId: string = ''; observationGroup: string = ''; origin: string = ''; fitStatus: string = ''; measurementResult: string = ''; }
export class FitExcerpt { observationGroup: string = ''; text: string = ''; truncated: boolean = false; }
export class EvidenceFit {
 schemaVersion: number = 1; fitStatus: string = ''; premise: FitPremise = new FitPremise(); groups: FitGroup[] = []; unresolvedChecks: string[] = []; conflicts: string[] = [];
}
export class EvidenceReviewReceipt {
 eventId: string = ''; observedAt: string = ''; fitStatus: string = ''; review: EvidenceReview = new EvidenceReview();
 premise: FitPremise = new FitPremise(); unresolvedChecks: string[] = []; groups: FitGroup[] = [];
}
export class EvidenceReviewHistory { items: EvidenceReviewReceipt[] = []; truncated: boolean = false; }
