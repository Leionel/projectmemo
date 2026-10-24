export class ImpactEdge { fromTitle: string = ''; toTitle: string = ''; from: string = ''; to: string = ''; kind: string = ''; hard: boolean = false; }
export class ImpactItem { target: string = ''; title: string = ''; kind: string = ''; path: ImpactEdge[] = []; state: string = 'UNKNOWN'; historical: boolean = false; }
export class ImpactCoverage { state: string = 'INCOMPLETE'; reasons: string[] = []; }
export class ImpactAssessment { observedAt: string = ''; coverage: ImpactCoverage = new ImpactCoverage(); items: ImpactItem[] = []; note: string = ''; }
export class ImpactReply { enabled: boolean = false; pendingJobs: number = 0; assessment: ImpactAssessment = new ImpactAssessment(); }
export class DecisionChoice { key: string = ''; title: string = ''; minutes: number | null = null; estimateSource: string = ''; feasibility: string = 'UNKNOWN'; reasons: string[] = []; tradeoff: string = ''; executionBoundary: string = 'READ_ANALYZE'; modelTradeoff: string | undefined = undefined; }
export class DecisionBase { expectedVersion: number = 0; goal: string = ''; availableMinutes: number = 0; }
export class DecisionReceipt { missionId: string = ''; projectId: string = ''; planRevision: number = 0; missionVersion: number = 0; scenarioKey: string = ''; }
export class DecisionProposal { id: string = ''; missionId: string = ''; projectId: string = ''; proposalHash: string = ''; revision: number = 1; status: string = ''; expiresAt: string = ''; stale: boolean = false; currentVersion: number | undefined = undefined; base: DecisionBase = new DecisionBase(); scenarios: DecisionChoice[] = []; receipt: DecisionReceipt | null = null; }
export class DecisionReply { proposal: DecisionProposal | null = null; }
export class DecisionReceiptReply { receipt: DecisionReceipt = new DecisionReceipt(); }
export class DecisionInput { requestId: string = ''; availableMinutes: number = 0; deliveryMinutes: number = 0; requestModelAdvice: boolean = false; allowActionProposals: boolean = false; parentId: string | undefined = undefined; }
export class DecisionConfirm { requestId: string = ''; proposalHash: string = ''; scenarioKey: string = ''; expectedVersion: number = 0; confirmed: boolean = true; }
export class GoalQuestion { projectId: string = ''; missionId: string = ''; questionId: string = ''; contextHash: string = ''; text: string = ''; whyNow: string = ''; answerability: string = ''; unansweredConsequence: string = ''; kind: string = ''; exposed: boolean = false; deviceDelivered: boolean = false; }
export class GoalQuestionReply { question: GoalQuestion | null = null; reason: string = ''; allowed: boolean = false; mutedMissionId: string | null = null; }
export class GoalQuestionInput { action: string = ''; questionId: string = ''; contextHash: string = ''; requestId: string = ''; }
export class DecisionAck { recorded: boolean = false; resumed: boolean = false; }
