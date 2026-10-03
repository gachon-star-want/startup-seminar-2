export type TeamMemberItem = {
  userId: string;
  name: string;
  role: string; // 'leader' | 'member'
};

export type TeamOverview = {
  id: string;
  name: string;
  inviteCode: string;
  itemName: string | null;
  salesChannel: string | null;
  salesChannelLink: string | null;
  businessStatus: string;
  mailOrderStatus: string;
  memo: string | null;
  score: number;
  myRole: string; // 'leader' | 'member'
  myUserId: string;
  members: TeamMemberItem[];
};

export type LeaderboardTeam = {
  id: string;
  name: string;
  itemName: string | null;
  salesChannel: string | null;
  salesChannelLink: string | null;
  businessStatus: string;
  mailOrderStatus: string;
  memo: string | null;
  updatedAt: Date;
  score: number;
  members: string[];
};

export type UpdateTeamInput = {
  name: string;
  itemName?: string | null;
  salesChannel?: string | null;
  salesChannelLink?: string | null;
  businessStatus: string;
  mailOrderStatus: string;
  memo?: string | null;
};

export type TeamDocumentItem = {
  id: string;
  kind: string; // 'business' | 'mail_order'
  filename: string;
  size: number;
  uploadedAt: Date;
};

export type TeamDocumentMeta = {
  id: string;
  filename: string;
  size: number;
  uploadedAt: Date;
};

/** 관리자 서류 현황 한 행 — 팀 1개의 서류 2종 제출 상태 */
export type AdminTeamDocumentRow = {
  teamId: string;
  teamName: string;
  members: string[];
  businessStatus: string;
  mailOrderStatus: string;
  business: TeamDocumentMeta | null;
  mailOrder: TeamDocumentMeta | null;
};
