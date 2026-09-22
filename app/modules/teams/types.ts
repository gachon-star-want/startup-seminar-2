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
