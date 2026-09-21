export type SubmissionFileItem = {
  id: string;
  filename: string;
  size: number;
  mime?: string | null;
};

export type SubmissionView = {
  id: string;
  content: string | null;
  link: string | null;
  updatedAt: string;
  files: SubmissionFileItem[];
};

export type StudentAssignmentView = {
  assignment: {
    id: string;
    title: string;
    description: string | null;
    dueAt: string;
    unit: string;
  };
  closed: boolean;
  myTeam: { teamId: string; teamName: string } | null;
  submission: SubmissionView | null;
};

export type AdminSubmissionItem = {
  id: string;
  content: string | null;
  link: string | null;
  userName: string;
  teamName: string | null;
  updatedAt: string;
  files: SubmissionFileItem[];
};

export type AdminAssignmentOverview = {
  assignment: {
    id: string;
    title: string;
    description: string | null;
    unit: string;
    dueAt: string;
    dueAtLocal: string;
  };
  submissions: AdminSubmissionItem[];
  missing: Array<{ label: string }>;
};

export type PresentSubmissionItem = {
  id: string;
  sortKey: string;
  label: string;
  presenter: string;
  content: string | null;
  link: string | null;
  updatedAt: string;
  files: SubmissionFileItem[];
};

export type AdminPresentOverview = {
  assignment: {
    id: string;
    title: string;
    description: string | null;
    unit: string;
    dueAt: string;
  };
  submissions: PresentSubmissionItem[];
  missing: string[];
};

export type AdminAssignmentListItem = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string;
  unit: string;
  submissionCount: number;
};
