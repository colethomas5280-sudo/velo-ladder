export type TrackerId = "mound" | "pulldown";
export type Hand = "" | "R" | "L";

/** Per-slot arrays of exactly 4 entries: [80% primer, 100% #1, #2, #3]. null = blank. */
export type Throws = Record<string, (number | null)[]>;

export interface Athlete {
  id: string;
  name: string;
  hand: Hand;
  inviteEmail: string | null;
  userId: string | null;
  archived: boolean;
}

export interface TrainingSession {
  id: string;
  athleteId: string;
  type: TrackerId;
  date: string; // YYYY-MM-DD
  notes: string;
  throws: Throws;
}

export type Role = "coach" | "athlete" | "none";

export interface Scope {
  role: Role;
  userId: string;
  email: string;
  /** Athlete rows this user owns (athlete role). Empty for coach/none. */
  athleteIds: string[];
}
