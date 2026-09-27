/**
 * Game Permissions — shared permission helpers.
 *
 * These are used client-side for UI gating ONLY.
 * Every real mutation is validated independently on the server via SECURITY DEFINER RPCs.
 *
 * Three separate concepts:
 *   1. Captain  — controls piece movement, broom config, formation
 *   2. PieceController — user assigned to a piece, responsible for its special actions
 *   3. Broom — game object configured by the captain (not assigned to a player)
 */

export type Team = 1 | 2

// ─── Captain ──────────────────────────────────────────────────────────────────

/** Returns true if the given userId is the captain of their team. */
export function isCaptainOf(userId: string | null | undefined, captainId: string | null | undefined): boolean {
  if (!userId || !captainId) return false
  return userId === captainId
}

// ─── Piece controller ─────────────────────────────────────────────────────────

/**
 * Returns true if the current user controls the piece whose action is pending.
 * The captain CANNOT make piece-action decisions (only movement decisions).
 */
export function isActionPlayer(
  myUserId: string | null | undefined,
  currentActionPlayerId: string | null | undefined
): boolean {
  if (!myUserId || !currentActionPlayerId) return false
  return myUserId === currentActionPlayerId
}

// ─── Phase checks ─────────────────────────────────────────────────────────────

export type GamePhase = 'deployment' | 'match' | 'finished'

export function isSetupPhase(phase: GamePhase): boolean {
  return phase === 'deployment'
}

export function isMatchPhase(phase: GamePhase): boolean {
  return phase === 'match'
}

// ─── Piece-to-player mapping ──────────────────────────────────────────────────

/**
 * Maps piece types to player positions for the team-room assignment.
 * Used to determine which player "owns" (controls the actions of) each piece.
 */
export const PIECE_TYPE_TO_POSITION: Record<string, string> = {
  GK: 'keeper',
  D:  'beater',
  A:  'chaser',
  S:  'seeker',
}

export const POSITION_TO_PIECE_TYPE: Record<string, string> = {
  keeper: 'GK',
  beater: 'D',
  chaser: 'A',
  seeker: 'S',
}

// ─── Piece controller resolution ──────────────────────────────────────────────

export interface TeamMemberInfo {
  userId: string
  username: string
  position: string | null
}

/**
 * Given a piece's type and team, find which team member controls it.
 * In cases of multiple pieces of the same type (e.g. 3 chasers / 2 beaters),
 * we assign by order (first chaser → first player with that position, etc).
 */
export function getPieceController(
  pieceType: string,
  pieceIndex: number, // 0-based index among pieces of same type on same team
  teamMembers: TeamMemberInfo[]
): TeamMemberInfo | null {
  const position = PIECE_TYPE_TO_POSITION[pieceType]
  if (!position) return null

  const playersForPosition = teamMembers.filter(m => m.position === position)
  return playersForPosition[pieceIndex] ?? playersForPosition[0] ?? null
}
