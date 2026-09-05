export type AllianceEmblemGlyph = 'starforge' | 'orbit' | 'vanguard';
export type AllianceAccent = 'cyan' | 'amber' | 'violet';

export type MemberRole = 'leader' | 'officer' | 'veteran' | 'member';
export type MemberActivity = 'online' | 'active' | 'away';

export type ResourceType = 'metal' | 'minerals' | 'gas' | 'energy';
export type RequestPriority = 'standard' | 'high' | 'critical';
export type ResourceRequestState = 'open' | 'reviewing';

export type RelationStatus = 'ally' | 'trade_pact' | 'neutral' | 'tense' | 'hostile';

export type JointOperationKind = 'sun_raid' | 'assault' | 'defense' | 'logistics';
export type JointOperationState = 'preparing' | 'mustering' | 'active' | 'awaiting';

export type AllianceEventKind = 'operation' | 'request' | 'diplomacy' | 'settings' | 'member';

export type AllianceEmblem = {
  glyph: AllianceEmblemGlyph;
  accent: AllianceAccent;
};

export type AllianceProfile = {
  name: string;
  tag: string;
  leaderMemberId: string;
  motto: string;
  description: string;
  status: 'active';
  foundedLabel: string;
  emblem: AllianceEmblem;
};

export type AllianceMember = {
  id: string;
  callsign: string;
  role: MemberRole;
  homeSector: string;
  specialization: string;
  activity: MemberActivity;
  contribution: number;
  currentOperationId: string | null;
  note: string;
};

export type ResourceRequest = {
  id: string;
  memberId: string;
  resource: ResourceType;
  amount: number;
  fulfilledAmount: number;
  purpose: string;
  priority: RequestPriority;
  state: ResourceRequestState;
};

export type DiplomaticRelation = {
  id: string;
  allianceName: string;
  tag: string;
  status: RelationStatus;
  note: string;
  meaning: string;
  history: string[];
};

export type JointOperation = {
  id: string;
  title: string;
  kind: JointOperationKind;
  objective: string;
  state: JointOperationState;
  participants: number;
  recommendedParticipants: number;
  windowLabel: string;
  description: string;
  joinedByPlayer: boolean;
};

export type AllianceEvent = {
  id: string;
  kind: AllianceEventKind;
  timestampLabel: string;
  text: string;
};

export type CommandState = {
  alliance: AllianceProfile;
  members: AllianceMember[];
  resourceRequests: ResourceRequest[];
  diplomacy: DiplomaticRelation[];
  jointOperations: JointOperation[];
  events: AllianceEvent[];
};

export type AllianceSettingsInput = Pick<AllianceProfile, 'name' | 'tag' | 'motto' | 'description' | 'emblem'>;
