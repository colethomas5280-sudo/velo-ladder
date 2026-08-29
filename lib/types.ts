export type TrackerId = "mound" | "pulldown";
export type Hand = "" | "R" | "L";

/** Per-slot arrays: [80% primer, 100% #1, #2, #3, #4]. null = blank.
 *  Sessions logged before the 4th box exist as length-4 arrays. */
export type Throws = Record<string, (number | null)[]>;

export interface Athlete {
  id: string;
  name: string;
  hand: Hand;
  /** the email this athlete logs in with */
  inviteEmail: string | null;
  /** true once a password has been set (the hash itself is never sent to the client) */
  hasPassword: boolean;
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

export interface AthleteOverview extends Athlete {
  mound: number;
  pulldown: number;
  lastDate: string | null;
}

export type Role = "coach" | "athlete" | "none";

export interface Scope {
  role: Role;
  email: string;
  /** Athlete rows this user owns (athlete role). Empty for coach/none. */
  athleteIds: string[];
}
