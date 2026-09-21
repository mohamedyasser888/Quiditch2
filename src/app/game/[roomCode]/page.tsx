'use client'

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import Image from 'next/image'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { KeyboardHintGroup } from '@/components/ui/KeyboardHint'
import ToastNotification from '@/components/ui/ToastNotification'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES & CONSTANTS
═══════════════════════════════════════════════════════════════════════════ */

type Col       = 'A' | 'B' | 'C' | 'D'
type PieceType = 'GK' | 'D' | 'A' | 'S'
type Team      = 1 | 2
type Choice    = 'LEFT' | 'MIDDLE' | 'RIGHT'
type BroomSpeed = 0 | 1 | 2 | 3 | 4
type SnitchOutcome = 'hold' | 'move' | 'hide'
type SnitchWheelContext = 'seeker' | 'return' | 'place'

interface Piece {
  id:         string
  team:       Team
  type:       PieceType
  col:        Col
  row:        number   // 0 = Yellow GZ · 1-5 = field · 6 = Purple GZ
  broomSpeed: BroomSpeed
  bludgerUsed?: boolean
  disabledUntilTurn?: number
  stayedInGoalZone?: boolean  // True if attacker chose "stay" after winning combat in goal zone
  readyToShoot?: boolean      // True if attacker is ready to shoot on next turn (after choosing STAY)
}

interface BludgerAction {
  attackerId: string
  target: { col: Col; row: number }
  hitIds: string[]
  phase: 'traveling' | 'choosing'
}

interface Combat {
  attackerId:  string
  defenderId:  string
  attackerSpeed: BroomSpeed
  defenderSpeed: BroomSpeed
  atkTeam:     Team
  defTeam:     Team
  phase:       'spinning' | 'spinning_anim' | 'reveal'
  result:      'win' | 'lose' | null
  spinTarget?: number
}

interface GoalDuel {
  attackerId: string
  phase:      'choosing' | 'reveal'
  t1Choice:   Choice | null
  t2Choice:   Choice | null
  result:     'goal' | 'save' | null
}

interface GS {
  phase:         'deployment' | 'match' | 'finished'
  turn:          Team
  s1:            number
  s2:            number
  saves1:        number   // Team 1 saves count
  saves2:        number   // Team 2 saves count
  pieces:        Piece[]
  starterPhase:  null | 'spinning_anim' | 'done'
  starterSpinTarget?: number
  starterTeam?: Team
  streak1:       number
  streak2:       number
  streakBonusTeam: Team | null
  duel:          GoalDuel | null
  combat:        Combat | null
  d1:            boolean
  d2:            boolean
  turnCount:     number                              // increments every MOVE
  snitchPos:     { col: Col; row: number } | null   // snitch location on board
  snitchPhase:   null | 'appearing' | 'spinning' | 'active' | 'encounter' | 'catching' | 'hiding' | 'caught'
  snitchSquares?: string[]
  snitchAngle?:  number
  snitchTarget?: { col: Col; row: number }
  snitchRecentSquares?: string[]
  snitchOutcomeLabels?: string[]
  snitchOutcomeAngle?: number
  snitchOutcome?: SnitchOutcome
  snitchWheelContext?: SnitchWheelContext
  snitchHiddenMoves?: number
  snitchEncounterPending?: boolean
  snitchEncounterDelayTurns?: number  // Legacy — migrated to snitchWaitTurnsCompleted
  snitchWaitTurnsCompleted?: number   // Completed turns since seekers began waiting (trigger at 2)
  seekerBonusMoveActive?: boolean     // True when player can take bonus move after moving seeker
  attackerScoringChoice?: string      // AttackerId when attacker can choose to score or stay after winning combat
  snitchCatchLabels?: string[]
  snitchCatchAngle?: number
  snitchCatchWinnerId?: string
  bludger: BludgerAction | null
  revision?: number  // Optimistic concurrency control version
  matchId?: string   // Unique identifier for this match session to prevent cross-game contamination
  snitchEventId?: string  // Unique identifier for Snitch events to prevent duplicates
  snitchHiddenSquare?: { col: Col; row: number }  // Save square where Snitch disappeared for return
  // Coin flip state (replaces starter wheel)
  coinFlipStatus?: 'pending' | 'flipping' | 'completed'
  coinFlipResult?: Team
  coinFlipEventId?: string
}

type Act =
  | { kind: 'PLACE';        id: string; team: Team; pt: PieceType; col: Col; row: number }
  | { kind: 'DDONE';        team: Team }
  | { kind: 'MOVE';         pid: string; col: Col; row: number }
  | { kind: 'END_BONUS_TURN' }
  | { kind: 'SEEKER_CONTINUE' }
  | { kind: 'ATTACKER_CHOICE'; choice: 'score' | 'stay' }
  | { kind: 'ATTACKER_SHOOT'; pieceId: string }
  | { kind: 'COMBAT_SPIN';  angle: number; winner: 'atk' | 'def' }
  | { kind: 'COMBAT_RESOLVE' }
  | { kind: 'COMBAT_REVEAL_COMPLETE' }
  | { kind: 'DUEL';         team: Team; choice: Choice }
  | { kind: 'DRESET' }
  | { kind: 'SYNC';         gs: GS }
  | { kind: 'ASSIGN_BROOM'; pieceId: string; speed: BroomSpeed }
  | { kind: 'SNITCH_SPIN';  squares: string[]; angle: number; col: Col; row: number }
  | { kind: 'SNITCH_LAND' }
  | { kind: 'SNITCH_OUTCOME_SPIN'; labels: string[]; angle: number; outcome: SnitchOutcome; eventId: string }
  | { kind: 'SNITCH_OUTCOME_RESOLVE' }
  | { kind: 'SNITCH_CATCH_SPIN'; labels: string[]; angle: number; winnerId: string }
  | { kind: 'SNITCH_CATCH_RESOLVE' }
  | { kind: 'SNITCH_TRIGGER_ENCOUNTER' }
  | { kind: 'SNITCH_SYNC_WAIT' }
  | { kind: 'STARTER_SPIN'; angle: number; starter: Team }
  | { kind: 'STARTER_RESOLVE' }
  | { kind: 'COIN_FLIP_START'; eventId: string; result: Team }
  | { kind: 'COIN_FLIP_COMPLETE' }
  | { kind: 'BLUDGER_FIRE'; pieceId: string; col: Col; row: number }
  | { kind: 'BLUDGER_READY' }
  | { kind: 'BLUDGER_RESOLVE'; targetId?: string }

const COLS: Col[] = ['A', 'B', 'C', 'D']
// Goalkeepers move within three wide goal-zone slots; the field remains four columns wide.
const GOAL_ZONE_COLS: Col[] = ['A', 'B', 'C']
const MAX: Record<PieceType, number> = { GK: 1, D: 2, A: 3, S: 1 }
// How many pieces may hold each broom speed (0 is auto-locked to GK)
const BROOM_LIMITS: Record<BroomSpeed, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 1 }
const ASSIGNABLE_SPEEDS: BroomSpeed[] = [1, 2, 3, 4]
const MAX_PIECES_PER_CELL = 5
const SNITCH_SPAWN_AFTER_MOVES = 4 // Snitch spawns after 4 total moves (2 complete turns - each team moves twice)
const FIELD_SQUARES = COLS.flatMap(col =>
  Array.from({ length: 5 }, (_, index) => `${col}${index + 1}`)
)

const T1_GK: { col: Col; row: number } = { col: 'B', row: 6 }
const T2_GK: { col: Col; row: number } = { col: 'C', row: 0 }

/** Build alternating ATK/DEF wheel sections.
 *  atkCount  = the combat attacker's broom speed  → that many ATK slots
 *  defCount  = the combat defender's broom speed  → defCount+1 DEF slots */
function buildWheelSections(atkCount: number, defCount: number): ('atk' | 'def')[] {
  const as = Math.max(1, atkCount)
  const ds = Math.max(1, defCount + 1)
  const out: ('atk' | 'def')[] = []
  let ai = 0, di = 0
  while (ai < as || di < ds) {
    if (ai < as) { out.push('atk'); ai++ }
    if (di < ds) { out.push('def'); di++ }
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   PURE HELPERS
═══════════════════════════════════════════════════════════════════════════ */

function initGS(matchId?: string): GS {
  return {
    phase:  'deployment',
    pieces: [
      { id: 't1-gk', team: 1, type: 'GK', col: T1_GK.col, row: T1_GK.row, broomSpeed: 0 },
      { id: 't2-gk', team: 2, type: 'GK', col: T2_GK.col, row: T2_GK.row, broomSpeed: 0 },
    ],
    turn: 1 as Team, s1: 0, s2: 0, saves1: 0, saves2: 0, streak1: 0, streak2: 0, streakBonusTeam: null, duel: null, combat: null, d1: false, d2: false,
    turnCount:     0,
    snitchPos:     null,
    snitchPhase:   null,
    snitchHiddenMoves: 0, // Initialize hidden move counter to 0 for fresh matches
    bludger:       null,
    revision:      0,
    starterPhase:  null,
    matchId:       matchId || `room-${Date.now()}`, // Use room-based match ID for consistency
    coinFlipStatus: 'completed', // Coin flip already happened in room lobby
    coinFlipResult: 1 as Team, // Default, will be overridden by URL param
  }
}

const getOcc = (ps: Piece[], col: Col, row: number) =>
  ps.filter(p => p.col === col && p.row === row)

const cnt = (ps: Piece[], team: Team, type: PieceType) =>
  ps.filter(p => p.team === team && p.type === type).length

function deployable(ps: Piece[], team: Team, type: PieceType): string[] {
  const out: string[] = []
  for (const col of COLS) {
    for (let r = 1; r <= 5; r++) {
      if (getOcc(ps, col, r).length >= MAX_PIECES_PER_CELL) continue 
      
      if (type === 'S') {
        out.push(`${col}${r}`)
        continue
      }
      
      if (team === 1) { 
        if (type === 'D' && r < 4) continue 
        if (type === 'A' && r < 2) continue 
      } else { 
        if (type === 'D' && r > 2) continue 
        if (type === 'A' && r > 4) continue 
      }
      out.push(`${col}${r}`)
    }
  }
  return out
}

function movable(ps: Piece[], p: Piece): string[] {
  const ci  = COLS.indexOf(p.col)
  const out: string[] = []

  if (p.type === 'GK') {
    const goalIndex = GOAL_ZONE_COLS.indexOf(p.col)
    for (let d = 1; d <= 2; d++) {
      const lc = goalIndex - d
      if (lc < 0 || getOcc(ps, GOAL_ZONE_COLS[lc], p.row).length >= MAX_PIECES_PER_CELL) break
      out.push(`${GOAL_ZONE_COLS[lc]}${p.row}`)
    }
    for (let d = 1; d <= 2; d++) {
      const rc = goalIndex + d
      if (rc >= GOAL_ZONE_COLS.length || getOcc(ps, GOAL_ZONE_COLS[rc], p.row).length >= MAX_PIECES_PER_CELL) break
      out.push(`${GOAL_ZONE_COLS[rc]}${p.row}`)
    }
    return out
  }

  const broomSpeed = p.broomSpeed
  const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]]

  // 1-block moves (speeds 1-4 all can move 1 block)
  for (const [dr, dc] of dirs) {
    const nr = p.row + dr
    const nc = ci + dc
    if (nr < 1 || nr > 5 || nc < 0 || nc >= 4) continue
    if (getOcc(ps, COLS[nc], nr).length < MAX_PIECES_PER_CELL) out.push(`${COLS[nc]}${nr}`)
  }

  if (broomSpeed === 4) {
    // Speed 4 BONUS: also allow 2-block TRUE JUMPs (ignores intermediate pieces)
    for (const [dr, dc] of dirs) {
      const nr = p.row + dr * 2
      const nc = ci + dc * 2
      if (nr < 1 || nr > 5 || nc < 0 || nc >= 4) continue
      const key = `${COLS[nc]}${nr}`
      if (getOcc(ps, COLS[nc], nr).length < MAX_PIECES_PER_CELL && !out.includes(key)) out.push(key)
    }
  }

  return out
}

function bludgerTargets(p: Piece): string[] {
  if (p.type !== 'D' || p.row < 1 || p.row > 5) return []
  const ci = COLS.indexOf(p.col)
  const out: string[] = []
  // Include current square to hit opponents on same square
  out.push(`${p.col}${p.row}`)
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    for (let step = 1; step <= 5; step++) {
      const row = p.row + dr * step
      const colIndex = ci + dc * step
      if (row < 1 || row > 5 || colIndex < 0 || colIndex >= COLS.length) break
      out.push(`${COLS[colIndex]}${row}`)
    }
  }
  return out
}

/** Opposing pieces a Defender can aim a Bludger at. The Bludger still stops at
 * the first opponent it reaches, so a piece farther down the same lane can be
 * selected without letting the shot pass through the closer one. */
function bludgerTargetIds(ps: Piece[], attacker: Piece): string[] {
  const targetCells = new Set(bludgerTargets(attacker))
  return ps
    .filter(piece => piece.team !== attacker.team && targetCells.has(`${piece.col}${piece.row}`))
    .map(piece => piece.id)
}

function firstBludgerContact(ps: Piece[], attacker: Piece, col: Col, row: number): string[] {
  const startCol = COLS.indexOf(attacker.col)
  const endCol = COLS.indexOf(col)
  const dr = Math.sign(row - attacker.row)
  const dc = Math.sign(endCol - startCol)
  
  // Allow diagonal moves? No, bludger only moves in straight lines
  if (dr !== 0 && dc !== 0) return []
  
  // Check starting position (step 0) for opponents on same square
  const opponentsAtStart = getOcc(ps, attacker.col, attacker.row).filter(piece => piece.team !== attacker.team)
  if (opponentsAtStart.length) {
    console.log('[BLUDGER CONTACT] Found opponents on same square:', opponentsAtStart.map(p => p.id))
    return opponentsAtStart.map(piece => piece.id)
  }
  
  // If targeting same square (dr === 0 && dc === 0), no opponents at start means no hit
  if (dr === 0 && dc === 0) return []
  
  for (let step = 1; ; step++) {
    const currentRow = attacker.row + dr * step
    const currentCol = startCol + dc * step
    if (currentRow < 1 || currentRow > 5 || currentCol < 0 || currentCol >= COLS.length) break
    const opponents = getOcc(ps, COLS[currentCol], currentRow).filter(piece => piece.team !== attacker.team)
    if (opponents.length) return opponents.map(piece => piece.id)
    if (currentRow === row && currentCol === endCol) break
  }
  return []
}

function knockBack(ps: Piece[], target: Piece): Piece[] {
  let row = target.row
  // Team 1 is knocked back toward their goal zone (row 6, so direction +1)
  // Team 2 is knocked back toward their goal zone (row 0, so direction -1)
  const direction = target.team === 1 ? 1 : -1
  console.log('[KNOCKBACK] Hitting piece:', target.id, 'team:', target.team, 'direction:', direction, 'from row:', target.row)
  for (let step = 0; step < 2; step++) {
    const nextRow = row + direction
    console.log('[KNOCKBACK] Step', step, 'checking row:', nextRow)
    if (nextRow < 1 || nextRow > 5) {
      console.log('[KNOCKBACK] Out of bounds, stopping at row:', row)
      break
    }
    if (getOcc(ps.filter(piece => piece.id !== target.id), target.col, nextRow).length >= MAX_PIECES_PER_CELL) {
      console.log('[KNOCKBACK] Cell full, stopping at row:', row)
      break
    }
    row = nextRow
  }
  console.log('[KNOCKBACK] Final position:', row)
  return ps.map(piece => piece.id === target.id
    ? { ...piece, row, disabledUntilTurn: undefined }
    : piece
  )
}

const triggersShoot = (p: Piece) =>
  p.type === 'A' && ((p.team === 1 && p.row === 1) || (p.team === 2 && p.row === 5))

const nextTeam = (team: Team): Team => team === 1 ? 2 : 1

const bumpRevision = (s: GS): number => (s.revision ?? 0) + 1

function seekersOnSnitch(pieces: Piece[], snitchPos: GS['snitchPos']): Piece[] {
  if (!snitchPos) return []
  return pieces.filter(piece =>
    piece.type === 'S' && piece.col === snitchPos.col && piece.row === snitchPos.row
  )
}

function getSnitchWaitTurnsCompleted(s: GS): number | undefined {
  if (s.snitchWaitTurnsCompleted !== undefined) return s.snitchWaitTurnsCompleted
  // Migrate legacy delay counter: delay 2 → 0 turns done, delay 1 → 1 turn done
  if (s.snitchEncounterDelayTurns !== undefined) return 2 - s.snitchEncounterDelayTurns
  return undefined
}

function triggerSnitchEncounterPhase(s: GS): Partial<GS> {
  return {
    snitchPhase: 'encounter',
    snitchEncounterDelayTurns: undefined,
    snitchWaitTurnsCompleted: undefined,
    snitchEncounterPending: false,
    snitchWheelContext: s.snitchWheelContext ?? 'seeker',
    snitchOutcomeLabels: undefined,
    snitchOutcomeAngle: undefined,
    snitchOutcome: undefined,
  }
}

/** Start or advance the wait timer when seekers occupy the Snitch square (called after moves). */
function ensureSnitchWaitActive(s: GS): Partial<GS> {
  if (s.snitchPhase !== 'active' || !s.snitchPos) return {}
  const seekers = seekersOnSnitch(s.pieces, s.snitchPos)
  if (seekers.length === 0) return {}

  const bothTeamsPresent = new Set(seekers.map(seeker => seeker.team)).size >= 2
  const turnsCompleted = getSnitchWaitTurnsCompleted(s)

  // Both seekers already present — credit one completed turn so one more turn-end triggers the wheel
  if (turnsCompleted === 0 && bothTeamsPresent) {
    console.log('[SNITCH] Both seekers on snitch — wait progress 1/2')
    return {
      snitchWaitTurnsCompleted: 1,
      snitchEncounterPending: true,
      snitchEncounterDelayTurns: undefined,
      snitchWheelContext: s.snitchWheelContext ?? 'seeker',
    }
  }

  if (turnsCompleted !== undefined) return {}

  const initialTurns = bothTeamsPresent ? 1 : 0
  console.log('[SNITCH] Seekers on snitch — wait timer started (' + initialTurns + '/2 turns)')
  return {
    snitchWaitTurnsCompleted: initialTurns,
    snitchEncounterPending: true,
    snitchEncounterDelayTurns: undefined,
    snitchWheelContext: s.snitchWheelContext ?? 'seeker',
  }
}

function applySnitchWaitToState(s: GS): GS {
  return { ...s, ...ensureSnitchWaitActive(s) }
}

/**
 * Single authoritative Snitch encounter evaluation — runs after each completed turn.
 * Golden rule: 2 completed turns while seekers wait on the Snitch square.
 */
function evaluateSnitchAfterTurnComplete(s: GS): Partial<GS> {
  if (s.snitchPhase !== 'active' || !s.snitchPos) return {}

  const seekers = seekersOnSnitch(s.pieces, s.snitchPos)
  if (seekers.length === 0) {
    if (getSnitchWaitTurnsCompleted(s) !== undefined || s.snitchEncounterPending) {
      return {
        snitchEncounterDelayTurns: undefined,
        snitchWaitTurnsCompleted: undefined,
        snitchEncounterPending: false,
      }
    }
    return {}
  }

  let turnsCompleted = getSnitchWaitTurnsCompleted(s)

  if (turnsCompleted === undefined) {
    console.log('[SNITCH] Turn ended with seekers on snitch — wait timer started (0/2 turns)')
    return {
      snitchWaitTurnsCompleted: 0,
      snitchEncounterPending: true,
      snitchEncounterDelayTurns: undefined,
      snitchWheelContext: s.snitchWheelContext ?? 'seeker',
    }
  }

  const nextTurns = turnsCompleted + 1
  if (nextTurns >= 2) {
    console.log('[SNITCH] Full turn requirement met — triggering encounter wheel')
    return triggerSnitchEncounterPhase(s)
  }

  console.log('[SNITCH] Snitch wait progress:', nextTurns, '/ 2 completed turns')
  return {
    snitchWaitTurnsCompleted: nextTurns,
    snitchEncounterPending: true,
    snitchEncounterDelayTurns: undefined,
  }
}

function isSnitchEncounterReady(s: GS): boolean {
  if (s.snitchPhase !== 'active' || !s.snitchPos) return false
  if (seekersOnSnitch(s.pieces, s.snitchPos).length === 0) return false
  const turns = getSnitchWaitTurnsCompleted(s)
  if (turns === undefined) return false
  if (turns >= 2) return true
  // Legacy persisted state: delay=1 means one turn already completed
  if (s.snitchEncounterDelayTurns === 1 && turns >= 1) return true
  return false
}

function finishMatchTurn(s: GS, pieces: Piece[], progress: ReturnType<typeof progressAfterMove>): GS {
  const next = { ...s, pieces, ...progress, turn: nextTeam(s.turn) }
  return { ...next, ...evaluateSnitchAfterTurnComplete(next) }
}

function completeTurn(s: GS, patch: Partial<GS>): GS {
  const next = { ...s, ...patch, revision: bumpRevision(s) }
  return { ...next, ...evaluateSnitchAfterTurnComplete(next) }
}

/** Records board-move counters (turn count, snitch spawn, hiding). Snitch encounter timing is handled by evaluateSnitchAfterTurnComplete. */
function progressAfterMove(s: GS, movedPiece?: Piece) {
  // Only increment turnCount if a piece was actually moved (not for bludger hits)
  const incrementTurnCount = movedPiece !== undefined
  const turnCount = incrementTurnCount ? s.turnCount + 1 : s.turnCount
  const hiddenMoves = s.snitchPhase === 'hiding' && incrementTurnCount ? (s.snitchHiddenMoves ?? 0) + 1 : s.snitchHiddenMoves
  const snitchReadyToReturn = s.snitchPhase === 'hiding' && hiddenMoves !== undefined && hiddenMoves === 4

  console.log('[PROGRESS AFTER MOVE]', {
    incrementTurnCount,
    previousTurnCount: s.turnCount,
    newTurnCount: turnCount,
    snitchPhase: s.snitchPhase,
    snitchHiddenMoves: hiddenMoves,
    snitchReadyToReturn,
    snitchSpawnThreshold: SNITCH_SPAWN_AFTER_MOVES,
    shouldSpawn: s.snitchPhase === null && turnCount === SNITCH_SPAWN_AFTER_MOVES,
    movedPiece: movedPiece?.id
  })

  if (snitchReadyToReturn) {
    console.log('[PROGRESS AFTER MOVE] Snitch ready to return after exactly 4 hidden moves')
    return {
      turnCount,
      snitchHiddenMoves: hiddenMoves,
      snitchPhase: 'active' as const,
      snitchPos: s.snitchHiddenSquare || s.snitchPos,
      snitchHiddenSquare: undefined,
      snitchWheelContext: 'return' as const,
    }
  }

  const shouldSpawn = s.snitchPhase === null && turnCount === SNITCH_SPAWN_AFTER_MOVES
  if (shouldSpawn) {
    console.log('[PROGRESS AFTER MOVE] TRIGGERING SNITCH APPEARANCE at turnCount:', turnCount)
  }

  return {
    turnCount,
    snitchHiddenMoves: hiddenMoves,
    snitchPhase: shouldSpawn ? 'appearing' as const : s.snitchPhase,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REDUCER
═══════════════════════════════════════════════════════════════════════════ */

function reduce(s: GS, a: Act): GS {
  if (s.phase === 'finished' && a.kind !== 'SYNC') return s

  switch (a.kind) {
    case 'PLACE':
      console.log('[REDUCER PLACE] Adding piece:', {
        pieceId: a.id,
        team: a.team,
        type: a.pt,
        position: `${a.col}${a.row}`,
        beforeCount: s.pieces.length,
        currentRevision: s.revision
      })
      const placeState = {
        ...s,
        pieces: [...s.pieces, { id: a.id, team: a.team, type: a.pt, col: a.col, row: a.row, broomSpeed: 1 as BroomSpeed }],
        revision: (s.revision ?? 0) + 1,  // ← INCREMENT REVISION OPTIMISTICALLY
      }
      console.log('[REDUCER PLACE] After add:', {
        afterCount: placeState.pieces.length,
        newPiece: placeState.pieces[placeState.pieces.length - 1],
        newRevision: placeState.revision
      })
      return placeState

    case 'DDONE': {
      const d1 = s.d1 || a.team === 1
      const d2 = s.d2 || a.team === 2
      // When both teams finish deployment, go straight to match phase
      // Coin flip already happened in room lobby, turn is already set correctly
      if (d1 && d2) {
        console.log('[DEPLOYMENT] ✅ Both teams deployed, starting match with turn:', s.turn)
        return { ...s, d1, d2, phase: 'match' }
      }
      return { ...s, d1, d2, phase: 'deployment', turn: s.turn }
    }

    case 'MOVE': {
      const pieces = s.pieces.map(p =>
        p.id === a.pid ? { ...p, col: a.col, row: a.row } : p
      )
      const moved = pieces.find(p => p.id === a.pid)!
      
      console.log('[MOVE] Piece moved:', { id: moved.id, type: moved.type, to: `${a.col}${a.row}`, turnCount: s.turnCount })
      
      // If making a move during bonus turn, clear the bonus state
      const wasBonusMoveActive = s.seekerBonusMoveActive
      
      // Check if this is a seeker move (ANY seeker move, not just during delay)
      const isSeekerMove = moved.type === 'S' && !wasBonusMoveActive
      
      const moveProgress = progressAfterMove(s, moved)

      const allExceptMoved = pieces.filter(p => p.id !== moved.id)
      
      // ATTACKER/DEFENDER FIX: Check for defender FIRST before any goal zone logic
      const defender = allExceptMoved.find(
        x => x.col === moved.col && x.row === moved.row && x.team !== moved.team && x.type === 'D'
      )
      
      // If attacker moved and there's a defender, trigger combat
      if (defender && moved.type === 'A') {
        console.log('[ATTACKER MOVE] Defender found, triggering combat')
        return applySnitchWaitToState({
          ...s, pieces, ...moveProgress,
          seekerBonusMoveActive: false,
          combat: {
            attackerId: moved.id,
            defenderId: defender.id,
            attackerSpeed: moved.broomSpeed,
            defenderSpeed: defender.broomSpeed,
            atkTeam: moved.team,
            defTeam: defender.team,
            phase: 'spinning',
            result: null,
          },
        })
      }

      // If attacker reached goal zone WITHOUT defender, trigger choice UI
      if (moved.type === 'A' && triggersShoot(moved) && !defender) {
        console.log('[ATTACKER MOVE] Reached goal zone without defender, showing choice')
        // Clear stayedInGoalZone flag if attacker is choosing
        const updatedPieces = pieces.map(p => 
          p.id === moved.id ? { ...p, stayedInGoalZone: false } : p
        )
        return applySnitchWaitToState({
          ...s, 
          pieces: updatedPieces, 
          ...moveProgress,
          seekerBonusMoveActive: false,
          attackerScoringChoice: moved.id,  // Show STAY / SHOOT choice
          // Do NOT switch turn yet - wait for user's choice (STAY or SCORE)
        })
      }

      // Seeker move (first in turn): always offer move-again / end-turn prompt
      if (isSeekerMove) {
        console.log('[SEEKER MOVE] Offering bonus move prompt, turn stays with current player')
        // Mark the seeker as having moved this turn to prevent re-selection
        const updatedPieces = pieces.map(p => 
          p.id === moved.id ? { ...p, disabledUntilTurn: s.turnCount + 1 } : p
        )
        return applySnitchWaitToState({
          ...s,
          pieces: updatedPieces,
          ...moveProgress,
          seekerBonusMoveActive: true,
          revision: bumpRevision(s),
        })
      }

      // Bonus follow-up move (non-seeker): end turn with normal turn-completion path
      if (wasBonusMoveActive) {
        return completeTurn(
          applySnitchWaitToState({ ...s, pieces, ...moveProgress }),
          { seekerBonusMoveActive: false, turn: nextTeam(s.turn) },
        )
      }

      return { ...finishMatchTurn(s, pieces, moveProgress), ...ensureSnitchWaitActive({ ...s, pieces, ...moveProgress }), revision: bumpRevision(s) }
    }

    case 'SEEKER_CONTINUE':
      // Player chose to move another piece after seeker move — keep turn, close prompt
      if (!s.seekerBonusMoveActive) return s
      console.log('[SEEKER_CONTINUE] Bonus move active, clearing to allow other piece movement', {
        before: s.seekerBonusMoveActive,
        pieces: s.pieces.map(p => ({ id: p.id, type: p.type, disabledUntilTurn: p.disabledUntilTurn, turnCount: s.turnCount }))
      })
      const nextState = { ...s, seekerBonusMoveActive: false, revision: bumpRevision(s) }
      console.log('[SEEKER_CONTINUE] After clearing:', {
        after: nextState.seekerBonusMoveActive,
        pieces: nextState.pieces.map(p => ({ id: p.id, type: p.type, disabledUntilTurn: p.disabledUntilTurn, turnCount: nextState.turnCount }))
      })
      return nextState

    case 'END_BONUS_TURN':
      // Player chose to end turn after seeker move
      if (!s.seekerBonusMoveActive) return s
      return completeTurn(s, { seekerBonusMoveActive: false, turn: nextTeam(s.turn) })

    case 'ATTACKER_CHOICE': {
      // Attacker chose to score or stay after reaching the goal zone
      if (!s.attackerScoringChoice) return s
      const atk = s.pieces.find(p => p.id === s.attackerScoringChoice)
      if (!atk) return s

      // Guard: prevent duplicate choice processing
      if (s.duel && s.duel.attackerId === atk.id) return s
      if (a.choice === 'stay' && atk.readyToShoot) return s

      if (a.choice === 'score') {
        // Trigger goal duel immediately; turn ends after duel resolves
        return {
          ...s,
          attackerScoringChoice: undefined,
          combat: null,
          duel: { attackerId: atk.id, phase: 'choosing', t1Choice: null, t2Choice: null, result: null },
          revision: bumpRevision(s),
        }
      }

      // STAY: keep position, mark ready to shoot on a future turn, end turn now
      const progress = progressAfterMove(s, atk)
      const pieces = s.pieces.map(p =>
        p.id === atk.id ? { ...p, stayedInGoalZone: true, readyToShoot: true } : p
      )
      return {
        ...finishMatchTurn(s, pieces, progress),
        combat: null,
        attackerScoringChoice: undefined,
        revision: bumpRevision(s),
      }
    }

    case 'ATTACKER_SHOOT': {
      // Attacker shoots after choosing STAY on previous turn
      const atk = s.pieces.find(p => p.id === a.pieceId)
      if (!atk || !atk.readyToShoot) return s
      
      // Guard: prevent double-shoot by checking if duel already exists
      if (s.duel && s.duel.attackerId === atk.id) return s
      
      // ATTACKER_SHOOT doesn't count as a move for snitch timing (it's part of attack sequence)
      const progress = progressAfterMove(s, undefined)
      
      // Clear readyToShoot and trigger goal duel; turn ends after duel resolves
      return {
        ...s,
        ...progress,
        pieces: s.pieces.map(p => 
          p.id === atk.id ? { ...p, readyToShoot: false } : p
        ),
        duel: { attackerId: atk.id, phase: 'choosing', t1Choice: null, t2Choice: null, result: null },
        revision: bumpRevision(s),
      }
    }

    case 'COMBAT_SPIN': {
      if (!s.combat) return s
      return {
        ...s,
        combat: { 
          ...s.combat, 
          phase: 'spinning_anim', 
          spinTarget: a.angle, 
          result: a.winner === 'atk' ? 'win' : 'lose' 
        }
      }
    }

    case 'COMBAT_RESOLVE': {
      if (!s.combat || !s.combat.result) return s
      const atk = s.pieces.find(p => p.id === s.combat!.attackerId)!
      const win = s.combat.result === 'win'

      let newPieces: Piece[]
      if (win) {
        newPieces = s.pieces // Attacker remains in place after winning
        
        // If attacker won combat in the goal zone
        if (triggersShoot(atk)) {
          // If attacker previously stayed, auto-shoot (no choice)
          if (atk.stayedInGoalZone) {
            return {
              ...s,
              pieces: newPieces.map(p => 
                p.id === atk.id ? { ...p, stayedInGoalZone: false } : p
              ),
              combat: null,
              duel: { attackerId: atk.id, phase: 'choosing', t1Choice: null, t2Choice: null, result: null },
              revision: bumpRevision(s),
            }
          }
          // Otherwise, give them a choice
          return {
            ...s,
            pieces: newPieces,
            combat: null,
            attackerScoringChoice: atk.id,  // Show choice UI
            revision: bumpRevision(s),
          }
        }
        // Attacker won but not in goal zone - continue to reveal phase
        newPieces = s.pieces
        return {
          ...s,
          pieces: newPieces,
          combat: { ...s.combat, phase: 'reveal' },
          revision: bumpRevision(s),
        }
      } else {
        // Attacker LOST - push back and show reveal phase
        const pushBack = triggersShoot(atk) ? 2 : 1
        const prevRow = atk.team === 1 ? atk.row + pushBack : atk.row - pushBack
        const clampedRow = Math.max(1, Math.min(5, prevRow))
        newPieces = s.pieces.map(p => p.id === atk.id ? { ...p, row: clampedRow } : p)
        
        // Show reveal phase with retreat result
        return {
          ...s,
          pieces: newPieces,
          combat: { ...s.combat, phase: 'reveal' },
          revision: bumpRevision(s),
        }
      }
    }

    case 'COMBAT_REVEAL_COMPLETE': {
      // After reveal phase is shown, clear combat and end turn
      if (!s.combat || s.combat.phase !== 'reveal') return s
      const atk = s.pieces.find(p => p.id === s.combat!.attackerId)
      if (!atk) return s
      
      // Combat resolution doesn't count as a move for snitch timing
      const progress = progressAfterMove(s, undefined)
      return {
        ...finishMatchTurn(s, s.pieces, progress),
        combat: null,
        revision: bumpRevision(s),
      }
    }

    case 'DUEL': {
      if (!s.duel) return s
      const d = {
        ...s.duel,
        t1Choice: a.team === 1 ? a.choice : s.duel.t1Choice,
        t2Choice: a.team === 2 ? a.choice : s.duel.t2Choice,
      }
      if (!d.t1Choice || !d.t2Choice) return { ...s, duel: d }
      const atk    = s.pieces.find(p => p.id === d.attackerId)!
      const atkC   = atk.team === 1 ? d.t1Choice : d.t2Choice
      const gkC    = atk.team === 1 ? d.t2Choice : d.t1Choice
      const isGoal = atkC !== gkC
      const nextStreak = isGoal ? (atk.team === 1 ? s.streak1 + 1 : s.streak2 + 1) : 0
      const streakBonus = isGoal && nextStreak === 2
      // Regular goal = 10 points, Streak bonus (2nd consecutive goal) = 20 points total
      const goalPoints = isGoal ? (streakBonus ? 20 : 10) : 0
      
      // DUEL doesn't count as a move for snitch timing (it's part of attack sequence)
      const progress = progressAfterMove(s, undefined)
      
      // Streak logic:
      // - If goal scored: increment streak (or reset to 0 if bonus was earned)
      // - If save: keep current streak (goalkeeper save doesn't reset)
      // - If opponent scores on their turn: their goal resets your streak (handled naturally)
      
      return {
        ...s,
        ...progress,
        duel: { ...d, phase: 'reveal', result: isGoal ? 'goal' : 'save' },
        s1: isGoal && atk.team === 1 ? s.s1 + goalPoints : s.s1,
        s2: isGoal && atk.team === 2 ? s.s2 + goalPoints : s.s2,
        saves1: !isGoal && atk.team === 2 ? s.saves1 + 1 : s.saves1,
        saves2: !isGoal && atk.team === 1 ? s.saves2 + 1 : s.saves2,
        // If attacker scores: update their streak (reset to 0 if bonus earned, otherwise increment)
        // If attacker is saved: keep their streak unchanged
        // If opponent had a streak: their score resets it (naturally happens when different team attacks)
        streak1: atk.team === 1 
          ? (isGoal ? (streakBonus ? 0 : nextStreak) : s.streak1) 
          : (isGoal ? 0 : s.streak1),
        streak2: atk.team === 2 
          ? (isGoal ? (streakBonus ? 0 : nextStreak) : s.streak2) 
          : (isGoal ? 0 : s.streak2),
        streakBonusTeam: streakBonus ? atk.team : null,
      }
    }

    case 'DRESET': {
      if (!s.duel && !s.combat) return s
      if (s.duel) {
        const atk = s.pieces.find(p => p.id === s.duel!.attackerId)!
        const resetRow = atk.team === 1 ? Math.min(5, atk.row + 2) : Math.max(1, atk.row - 2)
        const next = {
          ...s,
          pieces: s.pieces.map(p => p.id === atk.id ? { ...p, row: resetRow } : p),
          duel: null,
        }
        // DRESET doesn't count as a move for snitch timing
        const progress = progressAfterMove(s, undefined)
        return completeTurn({ ...next, ...progress }, { turn: nextTeam(s.turn) })
      }
      // DRESET doesn't count as a move for snitch timing
      const progress = progressAfterMove(s, undefined)
      return completeTurn({ ...s, ...progress }, { combat: null, turn: nextTeam(s.turn) })
    }

    case 'ASSIGN_BROOM': {
      // Brooms are a deployment choice. Once deployed, a team's setup is locked.
      if (s.phase !== 'deployment') return s
      const piece = s.pieces.find(p => p.id === a.pieceId)
      if (!piece || piece.type === 'GK') return s
      const alreadyUsingSpeed = s.pieces.filter(
        p => p.team === piece.team && p.type !== 'GK' && p.broomSpeed === a.speed && p.id !== piece.id
      ).length
      if (alreadyUsingSpeed >= BROOM_LIMITS[a.speed]) return s
      return {
        ...s,
        pieces: s.pieces.map(p => p.id === a.pieceId ? { ...p, broomSpeed: a.speed } : p),
      }
    }

    case 'BLUDGER_FIRE': {
      if (s.phase !== 'match' || s.bludger || s.duel || s.combat) return s
      const attacker = s.pieces.find(piece => piece.id === a.pieceId)
      if (!attacker || attacker.team !== s.turn || attacker.type !== 'D' || attacker.bludgerUsed || (attacker.disabledUntilTurn ?? -1) >= s.turnCount) return s
      if (!bludgerTargets(attacker).includes(`${a.col}${a.row}`)) return s
      const selectedTarget = s.pieces.find(piece => piece.col === a.col && piece.row === a.row && piece.team !== attacker.team)
      if (!selectedTarget) return s
      const hitIds = firstBludgerContact(s.pieces, attacker, a.col, a.row)
      const firstHit = hitIds[0] ? s.pieces.find(piece => piece.id === hitIds[0]) : undefined
      return {
        ...s,
        pieces: s.pieces.map(piece => piece.id === attacker.id ? { ...piece, bludgerUsed: true } : piece),
        // Aim at the selected opponent, but visually and mechanically stop at
        // the first opponent in that direction.
        bludger: { attackerId: attacker.id, target: firstHit ? { col: firstHit.col, row: firstHit.row } : { col: a.col, row: a.row }, hitIds, phase: 'traveling' },
      }
    }

    case 'BLUDGER_READY':
      return s.bludger?.phase === 'traveling' ? { ...s, bludger: { ...s.bludger, phase: 'choosing' } } : s

    case 'BLUDGER_RESOLVE': {
      if (!s.bludger || s.bludger.phase !== 'choosing') return s
      const targetId = a.targetId ?? s.bludger.hitIds[0]
      if (targetId && !s.bludger.hitIds.includes(targetId)) return s
      const hit = targetId ? s.pieces.find(piece => piece.id === targetId) : undefined
      console.log('[BLUDGER_RESOLVE] Resolving bludger hit:', { targetId, hitIds: s.bludger.hitIds, hit: hit?.id })
      // Bludger hits don't count as piece moves for snitch delay purposes
      const progress = progressAfterMove(s, undefined)
      let pieces = s.pieces
      if (hit) {
        console.log('[BLUDGER_RESOLVE] Knocking back piece:', hit.id)
        pieces = knockBack(s.pieces, hit).map(piece => piece.id === hit.id
          ? { ...piece, disabledUntilTurn: progress.turnCount + 1 }
          : piece
        )
      }
      return completeTurn(
        { ...s, ...progress, pieces, bludger: null },
        { turn: nextTeam(s.turn) },
      )
    }

    case 'SNITCH_SYNC_WAIT': {
      if (s.snitchPhase !== 'active' || !s.snitchPos) return s
      if (seekersOnSnitch(s.pieces, s.snitchPos).length === 0) return s
      return applySnitchWaitToState({ ...s, revision: bumpRevision(s) })
    }

    case 'SNITCH_TRIGGER_ENCOUNTER': {
      if (s.snitchPhase !== 'active' || !s.snitchPos) return s
      if (seekersOnSnitch(s.pieces, s.snitchPos).length === 0) return s
      if (!isSnitchEncounterReady(s)) return s
      return { ...s, ...triggerSnitchEncounterPhase(s), revision: bumpRevision(s) }
    }

    case 'SNITCH_SPIN':
      // Ignore delayed or duplicate broadcasts from an earlier Snitch cycle.
      if (s.snitchPhase !== 'appearing' || !FIELD_SQUARES.includes(`${a.col}${a.row}`) || a.squares.length === 0) {
        console.log('[SNITCH_SPIN] Rejected - phase:', s.snitchPhase, 'valid square:', FIELD_SQUARES.includes(`${a.col}${a.row}`), 'squares length:', a.squares.length)
        return s
      }
      console.log('[SNITCH_SPIN] Transitioning from appearing to spinning with squares:', a.squares)
      return { 
        ...s, 
        snitchPhase: 'spinning' as const, 
        snitchEncounterPending: false,
        snitchSquares: a.squares, 
        snitchAngle: a.angle, 
        snitchTarget: { col: a.col, row: a.row },
        revision: bumpRevision(s)
      }

    case 'SNITCH_LAND':
      if (s.snitchPhase !== 'spinning' || !s.snitchTarget) return s
      const landingSeekers = seekersOnSnitch(s.pieces, s.snitchTarget)
      
      // If seekers are already on the landing square, determine delay needed
      if (landingSeekers.length > 0) {
        return {
          ...s,
          snitchPos: s.snitchTarget,
          snitchPhase: 'active',
          snitchEncounterPending: true,
          snitchWaitTurnsCompleted: 0,
          snitchEncounterDelayTurns: undefined,
          snitchWheelContext: 'seeker',
          snitchRecentSquares: [...(s.snitchRecentSquares ?? []), `${s.snitchTarget.col}${s.snitchTarget.row}`].slice(-3),
          revision: bumpRevision(s),
        }
      }
      
      // No seekers waiting, just land normally
      return {
        ...s,
        snitchPos: s.snitchTarget,
        snitchPhase: 'active',
        snitchEncounterPending: false,
        snitchEncounterDelayTurns: undefined,
        snitchRecentSquares: [...(s.snitchRecentSquares ?? []), `${s.snitchTarget.col}${s.snitchTarget.row}`].slice(-3),
      }

    case 'SNITCH_OUTCOME_SPIN': {
      // Guard: prevent duplicate spins
      if (s.snitchPhase !== 'encounter' || s.snitchOutcomeAngle !== undefined || s.snitchOutcome !== undefined || a.labels.length !== 3) return s
      // Guard: prevent processing if event ID matches (duplicate event)
      if (s.snitchEventId && a.eventId && s.snitchEventId === a.eventId) return s
      return { 
        ...s, 
        snitchOutcomeLabels: a.labels,
        snitchOutcomeAngle: a.angle,
        snitchOutcome: a.outcome,
        snitchEventId: a.eventId,
      }
    }

    case 'SNITCH_OUTCOME_RESOLVE': {
      if (s.snitchPhase !== 'encounter' || !s.snitchOutcome) return s
      const nextTurn = s.turn
      const eventId = `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`
      
      if (s.snitchOutcome === 'hold') {
        if (s.snitchWheelContext === 'return') {
          // Second wheel result: تثبت - check if seekers are on the snitch
          const returnPos = s.snitchHiddenSquare || s.snitchPos
          const seekersOnReturn = returnPos ? s.pieces.filter(piece =>
            piece.type === 'S' && piece.col === returnPos.col && piece.row === returnPos.row
          ) : []

          if (seekersOnReturn.length === 0) {
            // No seekers on return position - just return snitch to hidden square
            return {
              ...s,
              snitchPhase: 'active',
              snitchHiddenMoves: 0,
              snitchPos: returnPos,
              snitchHiddenSquare: undefined,
              snitchWheelContext: undefined,
              snitchEventId: eventId,
            }
          } else if (seekersOnReturn.length === 1) {
            // Single seeker on return position - they catch the snitch and get 50 points
            const seeker = seekersOnReturn[0]
            return {
              ...s, phase: 'finished', duel: null, combat: null,
              s1: seeker.team === 1 ? s.s1 + 50 : s.s1,
              s2: seeker.team === 2 ? s.s2 + 50 : s.s2,
              snitchPhase: 'caught',
              snitchCatchWinnerId: seeker.id,
              snitchEventId: eventId,
            }
          } else {
            // Multiple seekers on return position - trigger catch-off wheel based on broom speed
            return {
              ...s,
              snitchPhase: 'catching',
              snitchCatchLabels: undefined,
              snitchCatchAngle: undefined,
              snitchCatchWinnerId: undefined,
              snitchEventId: eventId,
            }
          }
        }
        // First wheel result: تثبت - check if seekers are on the snitch position
        const seekers = seekersOnSnitch(s.pieces, s.snitchPos)
        if (seekers.length === 0) return { ...s, snitchPhase: 'active' }
        if (seekers.length > 1) {
          // Multiple seekers - trigger catch-off wheel to determine winner based on broom speed
          return { ...s, snitchPhase: 'catching', snitchCatchLabels: undefined, snitchCatchAngle: undefined, snitchCatchWinnerId: undefined, snitchEventId: eventId }
        }
        // Single seeker - they catch the snitch and get 50 points, game ends
        const seeker = seekers[0]
        return {
          ...s, phase: 'finished', duel: null, combat: null,
          s1: seeker.team === 1 ? s.s1 + 50 : s.s1,
          s2: seeker.team === 2 ? s.s2 + 50 : s.s2,
          snitchPhase: 'caught',
          snitchCatchWinnerId: seeker.id,
          snitchEventId: eventId,
        }
      }
      if (s.snitchOutcome === 'move') {
        // تتحرك - trigger place wheel for new square
        return {
          ...s,
          turn: nextTurn,
          snitchPhase: 'appearing',
          snitchHiddenMoves: 0,
          snitchOutcome: undefined,
          snitchOutcomeAngle: undefined,
          snitchWheelContext: 'place',
          snitchEventId: eventId,
        }
      }
      // تختفى - hide for 2 moves, then trigger second wheel
      return {
        ...s,
        turn: nextTurn,
        snitchPhase: 'hiding',
        snitchHiddenMoves: 0,
        snitchOutcome: undefined,
        snitchOutcomeAngle: undefined,
        snitchHiddenSquare: s.snitchPos, // Save current position for return
        snitchWheelContext: 'return', // Next wheel will be تثبت-تختفى-تتحرك
        snitchEventId: eventId,
      }
    }

    case 'SNITCH_CATCH_SPIN':
      // Guard: prevent duplicate catch spins
      if (s.snitchPhase !== 'catching' || s.snitchCatchAngle !== undefined || s.snitchCatchWinnerId !== undefined) return s
      if (a.labels.length < 2 || !seekersOnSnitch(s.pieces, s.snitchPos).some(piece => piece.id === a.winnerId)) return s
      return { ...s, snitchCatchLabels: a.labels, snitchCatchAngle: a.angle, snitchCatchWinnerId: a.winnerId }

    case 'SNITCH_CATCH_RESOLVE': {
      if (s.snitchPhase !== 'catching' || !s.snitchCatchWinnerId) return s
      const winner = seekersOnSnitch(s.pieces, s.snitchPos).find(piece => piece.id === s.snitchCatchWinnerId)
      if (!winner) return { ...s, snitchPhase: 'active' }
      return {
        ...s, phase: 'finished', duel: null, combat: null,
        s1: winner.team === 1 ? s.s1 + 50 : s.s1,
        s2: winner.team === 2 ? s.s2 + 50 : s.s2,
        snitchPhase: 'caught',
      }
    }

    case 'STARTER_SPIN': {
      // Accept starter spin broadcast and set spinning animation target.
      return {
        ...s,
        starterPhase: 'spinning_anim',
        starterSpinTarget: a.angle,
        starterTeam: a.starter,
        // set the turn to the chosen starter immediately so UI reflects it during animation
        turn: a.starter,
      }
    }

    case 'STARTER_RESOLVE': {
      // After animation finishes, mark starter resolved and enter match with a brief delay.
      return {
        ...s,
        phase: 'match',
        starterPhase: 'done',
        starterSpinTarget: undefined,
      }
    }

    case 'COIN_FLIP_START': {
      // Team 1 broadcasts the coin flip result to all clients
      console.log('[COIN] COIN_FLIP_START received, result:', a.result === 1 ? 'PURPLE' : 'YELLOW')
      return {
        ...s,
        coinFlipStatus: 'flipping',
        coinFlipResult: a.result,
        coinFlipEventId: a.eventId,
        turn: a.result, // Set turn to winning team
      }
    }

    case 'COIN_FLIP_COMPLETE': {
      // After coin animation finishes, start the match
      console.log('[COIN] COIN_FLIP_COMPLETE, starting match')
      return {
        ...s,
        phase: 'match',
        coinFlipStatus: 'completed',
      }
    }

    case 'SYNC':
      // Preserve current state if game is finished, otherwise sync with fallback for revision
      if (s.phase === 'finished') return s

      // For initial sync, update matchId to match the incoming state to ensure convergence
      // This handles the case where browsers navigate directly to game with different initial states
      const shouldUpdateMatchId = !s.matchId || (a.gs.matchId && s.matchId !== a.gs.matchId)

      // CRITICAL: Never let an older revision overwrite a newer state
      // This prevents race conditions where stale SYNC events can make pieces disappear
      const incomingRevision = a.gs.revision ?? 0
      const currentRevision = s.revision ?? 0

      console.log('[REDUCER SYNC] Received SYNC:', {
        incomingRevision,
        currentRevision,
        incomingPiecesCount: a.gs.pieces?.length,
        currentPiecesCount: s.pieces.length,
        incomingTurnCount: a.gs.turnCount,
        currentTurnCount: s.turnCount,
        incomingSnitchPhase: a.gs.snitchPhase,
        currentSnitchPhase: s.snitchPhase,
        matchId: a.gs.matchId,
        seekerBonusMoveActive: a.gs.seekerBonusMoveActive,
        timestamp: Date.now()
      })

      // Accept incoming state if:
      // 1. It has a strictly higher revision, OR
      // 2. Same revision BUT more or equal pieces (prevents losing optimistic placements), OR
      // 3. Current revision is 0 (initial load) - always accept fresh data from database
      const shouldAccept = incomingRevision > currentRevision ||
                          (incomingRevision === currentRevision && (a.gs.pieces?.length ?? 0) >= s.pieces.length) ||
                          currentRevision === 0

      // Never revert a completed STAY/SHOOT choice back to the pending choice UI
      const incomingChoiceId = a.gs.attackerScoringChoice
      const stayAlreadyCommitted = incomingChoiceId &&
        !s.attackerScoringChoice &&
        s.pieces.some(p => p.id === incomingChoiceId && p.readyToShoot)
      
      if (!shouldAccept || stayAlreadyCommitted) {
        // Incoming state is older, incomplete, or would undo a committed attacker choice
        console.log('[REDUCER SYNC] REJECTED - Older, incomplete, or stale attacker choice')
        return s
      }
      
      console.log('[REDUCER SYNC] ACCEPTED - Syncing with fresh state')
      const result = { ...a.gs, revision: incomingRevision }
      
      // CRITICAL: Always preserve the higher turnCount to prevent snitch timing regression
      // This ensures that if one client has made more moves, the turnCount doesn't get reverted
      if (a.gs.turnCount > s.turnCount) {
        result.turnCount = a.gs.turnCount
      } else if (s.turnCount > a.gs.turnCount) {
        result.turnCount = s.turnCount
      }
      
      // Also preserve snitch-related state from the more advanced state
      if (a.gs.turnCount > s.turnCount) {
        // Incoming state is more advanced, use its snitch state
        result.snitchPhase = a.gs.snitchPhase
        result.snitchPos = a.gs.snitchPos
        result.snitchHiddenMoves = a.gs.snitchHiddenMoves
        result.snitchHiddenSquare = a.gs.snitchHiddenSquare
      } else if (s.turnCount > a.gs.turnCount) {
        // Current state is more advanced, preserve its snitch state
        result.snitchPhase = s.snitchPhase
        result.snitchPos = s.snitchPos
        result.snitchHiddenMoves = s.snitchHiddenMoves
        result.snitchHiddenSquare = s.snitchHiddenSquare
      }
      
      // Update matchId if needed for convergence
      if (shouldUpdateMatchId && a.gs.matchId) {
        result.matchId = a.gs.matchId
      }
      
      console.log('[REDUCER SYNC] Final synced state:', {
        turnCount: result.turnCount,
        snitchPhase: result.snitchPhase,
        snitchPos: result.snitchPos
      })
      
      return result

    default:
      return s
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANIMATED SCORE COUNTER
═══════════════════════════════════════════════════════════════════════════ */

function AnimatedScore({ target, isFlash, tc }: { target: number, isFlash: boolean, tc: string }) {
  const [val, setVal] = useState(target)

  useEffect(() => {
    if (val === target) return
    const diff = target - val
    const step = diff > 0 ? 1 : -1
    const interval = setInterval(() => {
      setVal(prev => {
        if (prev === target) {
          clearInterval(interval)
          return prev
        }
        return prev + step
      })
    }, 40)
    return () => clearInterval(interval)
  }, [target, val])

  return (
    <span className={`text-5xl font-black tabular-nums transition-all duration-300 ${isFlash ? 'text-emerald-400 scale-125' : tc}`}>
      {val}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   PIECE SHAPE SVGs
═══════════════════════════════════════════════════════════════════════════ */

function PieceShape({ type, team, selected, size = 56, broomSpeed, disabled = false }: {
  type: PieceType
  team: Team
  selected: boolean
  size?: number
  broomSpeed?: BroomSpeed
  disabled?: boolean
}) {
  const purple = '#a855f7'
  const yellow = '#fbbf24'
  const fill   = team === 1 ? purple : yellow
  const glow   = team === 1
    ? 'drop-shadow(0 0 6px rgba(168,85,247,0.8))'
    : 'drop-shadow(0 0 6px rgba(251,191,36,0.8))'
  const selGlow = selected
    ? team === 1
      ? 'drop-shadow(0 0 10px rgba(255,255,255,0.9)) drop-shadow(0 0 20px rgba(168,85,247,1))'
      : 'drop-shadow(0 0 10px rgba(255,255,255,0.9)) drop-shadow(0 0 20px rgba(251,191,36,1))'
    : glow
  const stroke  = disabled ? '#94a3b8' : selected ? '#ffffff' : fill
  const sw      = selected ? 3 : 2
  const s       = size
  const c       = s / 2

  // Small speed badge in bottom-right corner (only for non-zero speeds with size big enough)
  const badge = broomSpeed !== undefined && broomSpeed !== 0 && size >= 32 ? (
    <>
      <rect x={s - s * 0.38} y={s - s * 0.38} width={s * 0.36} height={s * 0.36} rx={s * 0.07}
        fill={broomSpeed === 4 ? '#f59e0b' : '#1e293b'} stroke={broomSpeed === 4 ? '#f59e0b' : fill} strokeWidth={1} />
      <text x={s - s * 0.2} y={s - s * 0.12} textAnchor="middle" fontSize={s * 0.22}
        fontWeight="900" fill={broomSpeed === 4 ? '#000' : fill} fontFamily="monospace">
        {broomSpeed}
      </text>
    </>
  ) : null

  if (type === 'GK') {
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ filter: disabled ? 'grayscale(1) opacity(0.55)' : selGlow }}>
        <rect x={4} y={4} width={s - 8} height={s - 8} rx={6}
          fill={fill + '33'} stroke={stroke} strokeWidth={sw} />
        <text x={c} y={c + 5} textAnchor="middle" fontSize={s * 0.28}
          fontWeight="900" fill={stroke} fontFamily="monospace">GK</text>
        {badge}
      </svg>
    )
  }

  if (type === 'D') {
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ filter: disabled ? 'grayscale(1) opacity(0.55)' : selGlow }}>
        <rect x={6} y={6} width={s - 12} height={s - 12} rx={3}
          fill={fill + '44'} stroke={stroke} strokeWidth={sw} />
        <text x={c} y={c + 4} textAnchor="middle" fontSize={s * 0.3}
          fontWeight="900" fill={stroke} fontFamily="monospace">D</text>
        {badge}
      </svg>
    )
  }

  if (type === 'A') {
    const pad = 6
    const pts = team === 1
      ? `${c},${pad} ${pad},${s - pad} ${s - pad},${s - pad}`
      : `${pad},${pad} ${s - pad},${pad} ${c},${s - pad}`
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ filter: disabled ? 'grayscale(1) opacity(0.55)' : selGlow }}>
        <polygon points={pts} fill={fill + '44'} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
        <text x={c} y={c + 6} textAnchor="middle" fontSize={s * 0.28}
          fontWeight="900" fill={stroke} fontFamily="monospace">A</text>
        {badge}
      </svg>
    )
  }

  if (type === 'S') {
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} style={{ filter: selGlow }}>
        <circle cx={c} cy={c} r={c - 5} fill={fill + '44'} stroke={stroke} strokeWidth={sw} />
        <text x={c} y={c + 4} textAnchor="middle" fontSize={s * 0.3}
          fontWeight="900" fill={stroke} fontFamily="monospace">S</text>
        {badge}
      </svg>
    )
  }

  return null
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMBAT WHEEL — dynamic shuffled sections (ATK = # attackers, DEF = # defenders + 1)
═══════════════════════════════════════════════════════════════════════════ */

function CombatWheel({
  atkTeam,
  defTeam,
  attackerSpeed,
  defenderSpeed,
  spinAngle,
  spinning,
}: {
  atkTeam: Team
  defTeam: Team
  attackerSpeed: BroomSpeed
  defenderSpeed: BroomSpeed
  spinAngle: number
  spinning: boolean
}) {
  const atkColor = atkTeam === 1 ? '#a855f7' : '#fbbf24'
  const defColor = defTeam === 1 ? '#a855f7' : '#fbbf24'
  const R = 180, cx = 200, cy = 200

  // Build alternating section array
  const sections = buildWheelSections(attackerSpeed, defenderSpeed)
  const total = sections.length
  const deg = 360 / total

  // Clock-angle (0=top, CW) → SVG point on rim
  const pt = (a: number) => ({
    x: cx + R * Math.sin((a * Math.PI) / 180),
    y: cy - R * Math.cos((a * Math.PI) / 180),
  })

  const slices = sections.map((type, i) => {
    const start = i * deg, end = (i + 1) * deg
    const s = pt(start), e = pt(end)
    const path = `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 ${deg > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`
    const mid = start + deg / 2
    const lr = R * 0.62
    return { type, path, lx: cx + lr * Math.sin((mid * Math.PI) / 180), ly: cy - lr * Math.cos((mid * Math.PI) / 180), mid }
  })

  const svgRef = useRef<SVGSVGElement>(null)

  /* ── Big-spin: rAF loop writes style.transform directly ──────────────────
     Both clients receive the same spinAngle and run the same easing function
     → identical animation guaranteed on both screens.                        */
  useEffect(() => {
    if (!spinning || spinAngle <= 0) return
    const duration = 10000
    const startTime = performance.now()
    let raf: number
    function ease(t: number): number {
      const x1 = 0.18, y1 = 0.98, x2 = 0.28, y2 = 1
      const cx3 = 3 * x1, bx3 = 3 * (x2 - x1) - cx3, ax3 = 1 - cx3 - bx3
      const cy3 = 3 * y1, by3 = 3 * (y2 - y1) - cy3, ay3 = 1 - cy3 - by3
      let u = t
      for (let i = 0; i < 8; i++) {
        const xErr = ((ax3 * u + bx3) * u + cx3) * u - t
        const dxDu = (3 * ax3 * u + 2 * bx3) * u + cx3
        if (Math.abs(dxDu) < 1e-6) break
        u -= xErr / dxDu
      }
      return ((ay3 * u + by3) * u + cy3) * u
    }
    function frame(now: number) {
      const progress = Math.min((now - startTime) / duration, 1)
      if (svgRef.current) {
        svgRef.current.style.transform = `rotate(${ease(progress) * spinAngle}deg)`
        svgRef.current.style.transformOrigin = '200px 200px'
      }
      if (progress < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [spinning, spinAngle])

  const svgStyle: React.CSSProperties = spinning
    ? { transformOrigin: '200px 200px' }
    : { transformOrigin: '200px 200px', animation: 'wheel-idle-spin 3s linear infinite' }

  return (
    <div className="relative mx-auto mb-4" style={{ width: 400, height: 400 }}>
      <style>{`
        @keyframes wheel-idle-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <svg ref={svgRef} width={400} height={400} viewBox="0 0 400 400" style={svgStyle}>
        <circle cx={cx} cy={cy} r={R + 8} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={16} />

        {slices.map((s, i) => (
          <path key={i} d={s.path}
            fill={s.type === 'atk' ? atkColor : defColor}
            opacity={s.type === 'atk' ? 0.92 : (i % 2 === 0 ? 0.65 : 0.80)}
            stroke="#1e293b" strokeWidth={3}
          />
        ))}

        {slices.map((s, i) => {
          if (deg < 28) return null
          return (
            <text key={`t${i}`} x={s.lx} y={s.ly}
              textAnchor="middle" alignmentBaseline="middle"
              fontSize={deg >= 60 ? 26 : deg >= 40 ? 20 : 14}
              fontWeight="700" fill="white"
              fontFamily="'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', sans-serif"
              transform={`rotate(${s.mid - 90} ${s.lx} ${s.ly})`}
              style={{ 
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
                textShadow: '0 0 12px rgba(255,255,255,0.25)',
                letterSpacing: '0.02em'
              }}
            >
              {s.type === 'atk' ? 'ATK' : 'DEF'}
            </text>
          )
        })}

        <circle cx={cx} cy={cy} r={24} fill="white" />
        <circle cx={cx} cy={cy} r={14} fill="#1e293b" />
      </svg>

      {/* Fixed pointer at 12 o'clock */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-4 z-10">
        <div className="w-0 h-0 border-l-[18px] border-r-[18px] border-t-[40px] border-l-transparent border-r-transparent border-t-white drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]" />
      </div>
      <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-10" style={{ color: atkColor, fontSize: 16, fontWeight: 900 }}>
        <div style={{ background: atkColor + '22', border: `2px solid ${atkColor}55`, borderRadius: 8, padding: '4px 12px' }}>T{atkTeam}</div>
      </div>
      <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-10" style={{ color: defColor, fontSize: 16, fontWeight: 900 }}>
        <div style={{ background: defColor + '22', border: `2px solid ${defColor}55`, borderRadius: 8, padding: '4px 12px' }}>T{defTeam}</div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   SNITCH WHEEL — spins to pick a random field square
═══════════════════════════════════════════════════════════════════════════ */

// Every playable field square (A1-A5 through D1-D5), shuffled for the wheel.
/** Browser cryptographic randomness, with a safe fallback for non-browser rendering. */
function randomIndex(length: number): number {
  if (length <= 0) return 0
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const limit = Math.floor(0x1_0000_0000 / length) * length
    const value = new Uint32Array(1)
    do crypto.getRandomValues(value)
    while (value[0] >= limit)
    return value[0] % length
  }
  return Math.floor(Math.random() * length)
}

function randomFraction(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const value = new Uint32Array(1)
    crypto.getRandomValues(value)
    return value[0] / 0x1_0000_0000
  }
  return Math.random()
}

function shuffleSquares(excluded: string[] = []): string[] {
  const blocked = new Set(excluded)
  const squares = FIELD_SQUARES.filter(square => !blocked.has(square))
  for (let i = squares.length - 1; i > 0; i--) {
    const swapIndex: number = randomIndex(i + 1)
    ;[squares[i], squares[swapIndex]] = [squares[swapIndex], squares[i]]
  }
  return squares
}

const WHEEL_SPIN_DURATION_MS = 8500

function cubicBezierEase(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const cx3 = 3 * x1, bx3 = 3 * (x2 - x1) - cx3, ax3 = 1 - cx3 - bx3
  const cy3 = 3 * y1, by3 = 3 * (y2 - y1) - cy3, ay3 = 1 - cy3 - by3
  let u = t
  for (let i = 0; i < 8; i++) {
    const xErr = ((ax3 * u + bx3) * u + cx3) * u - t
    const dxDu = (3 * ax3 * u + 2 * bx3) * u + cx3
    if (Math.abs(dxDu) < 1e-6) break
    u -= xErr / dxDu
  }
  return ((ay3 * u + by3) * u + cy3) * u
}

/** Very fast initial spin, gradual deceleration to complete stop. */
function wheelSpinEase(t: number): number {
  return cubicBezierEase(t, 0.18, 0.98, 0.28, 1)
}

/** Equal-probability stop angle for any wheel segment count. */
function computeWheelSpinAngle(segmentCount: number, chosenIndex: number, fullRotations = 12): number {
  const deg = 360 / segmentCount
  const margin = deg * 0.1
  const lo = 360 - (chosenIndex + 1) * deg + margin
  const hi = 360 - chosenIndex * deg - margin
  const finalMod = lo + randomFraction() * (hi - lo)
  console.log('[COMPUTE WHEEL ANGLE]', { segmentCount, chosenIndex, deg, lo, hi, finalMod, fullRotations })
  return 360 * fullRotations + finalMod
}

function shuffleOutcomes(context?: SnitchWheelContext): { labels: string[]; outcomes: SnitchOutcome[] } {
  let entries: { label: string; outcome: SnitchOutcome }[]
  
  if (context === 'return') {
    // Second wheel after hiding: تثبت - تختفى - تتحرك
    entries = [
      { label: 'تثبت', outcome: 'hold' },    // Return to hidden square
      { label: 'تختفى', outcome: 'hide' },   // Hide again
      { label: 'تتحرك', outcome: 'move' },   // Move to new square
    ]
  } else {
    // First wheel (seeker context): تثبت - تتحرك - تختفى
    entries = [
      { label: 'تثبت', outcome: 'hold' },
      { label: 'تتحرك', outcome: 'move' },
      { label: 'تختفى', outcome: 'hide' },
    ]
  }
  
  console.log('[SHUFFLE OUTCOMES] Before shuffle:', entries.map(e => e.label))
  
  // Fisher-Yates shuffle for equal probability (33.33% each)
  for (let i = entries.length - 1; i > 0; i--) {
    const swapIndex: number = randomIndex(i + 1)
    console.log('[SHUFFLE OUTCOMES] Swapping index', i, 'with', swapIndex)
    ;[entries[i], entries[swapIndex]] = [entries[swapIndex], entries[i]]
  }
  
  console.log('[SHUFFLE OUTCOMES] After shuffle:', entries.map(e => e.label))
  return { labels: entries.map(entry => entry.label), outcomes: entries.map(entry => entry.outcome) }
}

const SnitchWheel = React.memo(function SnitchWheel({
  squares,
  spinAngle,
  spinning,
  smallerFont = false,
}: {
  squares: string[]
  spinAngle: number
  spinning: boolean
  smallerFont?: boolean
}) {
  // Check if this is a placement wheel (has position names like "A1", "B2", etc.)
  const isPlacementWheel = squares.length > 0 && /^[A-Z]\d+$/.test(squares[0])
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!spinning || spinAngle <= 0) return
    const duration = 10000 // Same duration as CombatWheel
    const startTime = performance.now()
    let raf: number
    function ease(t: number): number {
      const x1 = 0.18, y1 = 0.98, x2 = 0.28, y2 = 1
      const cx3 = 3 * x1, bx3 = 3 * (x2 - x1) - cx3, ax3 = 1 - cx3 - bx3
      const cy3 = 3 * y1, by3 = 3 * (y2 - y1) - cy3, ay3 = 1 - cy3 - by3
      let u = t
      for (let i = 0; i < 8; i++) {
        const xErr = ((ax3 * u + bx3) * u + cx3) * u - t
        const dxDu = (3 * ax3 * u + 2 * bx3) * u + cx3
        if (Math.abs(dxDu) < 1e-6) break
        u -= xErr / dxDu
      }
      return ((ay3 * u + by3) * u + cy3) * u
    }
    function frame(now: number) {
      const progress = Math.min((now - startTime) / duration, 1)
      if (svgRef.current) {
        svgRef.current.style.transform = `rotate(${ease(progress) * spinAngle}deg)`
        svgRef.current.style.transformOrigin = '200px 200px'
      }
      if (progress < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [spinning, spinAngle])

  if (!squares || squares.length === 0) return null
  const total = squares.length
  const deg   = 360 / total
  // Adjust radius for 3-item wheels to prevent Arabic text overflow
  const R = total === 3 ? 135 : 175
  const cx = 200, cy = 200

  const pt = (a: number) => ({
    x: cx + R * Math.sin((a * Math.PI) / 180),
    y: cy - R * Math.cos((a * Math.PI) / 180),
  })

  const slices = squares.map((label, i) => {
    const start = i * deg, end = (i + 1) * deg
    const s = pt(start), e = pt(end)
    const path = `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${R} ${R} 0 ${deg > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`
    const mid  = start + deg / 2
    // Adjust label radius based on wheel size to prevent overflow
    const lr   = total === 3 ? R * 0.55 : R * 0.68
    return { label, path, lx: cx + lr * Math.sin((mid * Math.PI) / 180), ly: cy - lr * Math.cos((mid * Math.PI) / 180), mid }
  })

  // Gold gradient palette cycling
  const goldPalette = ['#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f']

  const svgStyle: React.CSSProperties = spinning
    ? { transformOrigin: '200px 200px' }
    : { transformOrigin: '200px 200px', animation: 'wheel-idle-spin 3s linear infinite' }

  return (
    <div className="relative mx-auto mb-4" style={{ width: 400, height: 400 }}>
      <style>{`
        @keyframes wheel-idle-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <svg ref={svgRef} width={400} height={400} viewBox="0 0 400 400" style={svgStyle}>
        <circle cx={cx} cy={cy} r={R + 8} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={16} />

        {slices.map((s, i) => (
          <path key={i} d={s.path}
            fill={goldPalette[i % goldPalette.length]}
            opacity={0.85 + (i % 2) * 0.1}
            stroke="#1e293b" strokeWidth={3}
          />
        ))}

        {slices.map((s, i) => {
          return (
            <text key={`t${i}`} x={s.lx} y={s.ly}
              textAnchor="middle" alignmentBaseline="middle"
              fontSize={isPlacementWheel ? (deg >= 60 ? 26 : deg >= 40 ? 20 : deg >= 20 ? 12 : 10) : (smallerFont ? 24 : 30)}
              fontWeight="700" fill="white"
              fontFamily="'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', sans-serif"
              transform={`rotate(${s.mid - 90} ${s.lx} ${s.ly})`}
              style={{ 
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
                textShadow: '0 0 12px rgba(255,255,255,0.25)',
                letterSpacing: '0.02em',
                wordSpacing: '0.1em'
              }}
            >
              {s.label}
            </text>
          )
        })}

        <circle cx={cx} cy={cy} r={26} fill="#fbbf24" className={spinning ? 'animate-pulse' : ''} />
        <image href="/snitch.png" x={cx-18} y={cy-18} width={36} height={36} style={{ filter: 'drop-shadow(0 0 6px #f59e0b)' }} />
      </svg>
      {/* Fixed pointer - glowing when spinning */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-4 z-10 transition-all duration-300 ${spinning ? 'scale-110' : ''}`}>
        <div className={`w-0 h-0 border-l-[16px] border-r-[16px] border-t-[36px] border-l-transparent border-r-transparent border-t-amber-400 ${spinning ? 'drop-shadow-[0_4px_12px_rgba(251,191,36,0.8)]' : 'drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]'}`} />
      </div>
    </div>
  )
})

/* ═══════════════════════════════════════════════════════════════════════════
   MAGICAL STARTING COIN — 3D Flip Animation
═══════════════════════════════════════════════════════════════════════════ */

const MagicalCoin = React.memo(function MagicalCoin({
  result,
  flipping,
  t1Name,
  t2Name,
}: {
  result: Team  // 1 = Purple, 2 = Yellow
  flipping: boolean
  t1Name: string
  t2Name: string
}) {
  const coinRef = useRef<HTMLDivElement>(null)
  const [showResult, setShowResult] = useState(false)

  useEffect(() => {
    if (!flipping) return
    
    console.log('[COIN] Animation started, result:', result === 1 ? 'PURPLE' : 'YELLOW')
    
    const duration = 4000 // 4 seconds total
    const startTime = performance.now()
    let raf: number
    
    // Fast start, gradual deceleration to complete stop
    function ease(t: number): number {
      const x1 = 0.18, y1 = 0.98, x2 = 0.28, y2 = 1
      const cx3 = 3 * x1, bx3 = 3 * (x2 - x1) - cx3, ax3 = 1 - cx3 - bx3
      const cy3 = 3 * y1, by3 = 3 * (y2 - y1) - cy3, ay3 = 1 - cy3 - by3
      let u = t
      for (let i = 0; i < 8; i++) {
        const xErr = ((ax3 * u + bx3) * u + cx3) * u - t
        const dxDu = (3 * ax3 * u + 2 * bx3) * u + cx3
        if (Math.abs(dxDu) < 1e-6) break
        u -= xErr / dxDu
      }
      return ((ay3 * u + by3) * u + cy3) * u
    }
    
    const frame = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = ease(progress)
      
      if (coinRef.current) {
        // Calculate rotations - result determines final orientation
        // If result is 1 (Purple): end at 0° or 360°
        // If result is 2 (Yellow): end at 180° or 540°
        const baseRotations = 4 // 4 full spins
        const totalRotation = baseRotations * 360 + (result === 2 ? 180 : 0)
        const currentRotation = eased * totalRotation
        
        // Vertical lift (parabolic arc)
        const lift = Math.sin(eased * Math.PI) * 100 // peaks at 50% progress
        
        // Apply transforms
        coinRef.current.style.transform = `
          translateY(-${lift}px) 
          rotateY(${currentRotation}deg)
        `
      }
      
      if (progress < 1) {
        raf = requestAnimationFrame(frame)
      } else {
        // Animation complete, show result
        console.log('[COIN] Animation completed')
        setShowResult(true)
      }
    }
    
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      setShowResult(false)
    }
  }, [flipping, result])

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/95 backdrop-blur-xl">
      <div className="text-center">
        {!showResult ? (
          <>
            <h1 className="text-5xl font-black text-white mb-12 animate-pulse">
              ✨ CHOOSING STARTING TEAM ✨
            </h1>
            
            {/* 3D Coin Container */}
            <div className="relative mx-auto" style={{ perspective: '1000px', width: 300, height: 300 }}>
              <div
                ref={coinRef}
                className="absolute inset-0 mx-auto"
                style={{
                  width: 200,
                  height: 200,
                  transformStyle: 'preserve-3d',
                  transition: flipping ? 'none' : 'transform 0.6s',
                }}
              >
                {/* Purple Side (Front) */}
                <div
                  className="absolute inset-0 rounded-full flex items-center justify-center text-6xl font-black"
                  style={{
                    backfaceVisibility: 'hidden',
                    background: 'radial-gradient(circle at 30% 30%, #a855f7, #7c3aed, #6d28d9)',
                    boxShadow: '0 0 60px rgba(168, 85, 247, 0.8), inset 0 -20px 40px rgba(0,0,0,0.3)',
                    border: '8px solid #ddd6fe',
                  }}
                >
                  <span className="drop-shadow-2xl text-white">P</span>
                </div>
                
                {/* Yellow Side (Back) */}
                <div
                  className="absolute inset-0 rounded-full flex items-center justify-center text-6xl font-black"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    background: 'radial-gradient(circle at 30% 30%, #fbbf24, #f59e0b, #d97706)',
                    boxShadow: '0 0 60px rgba(251, 191, 36, 0.8), inset 0 -20px 40px rgba(0,0,0,0.3)',
                    border: '8px solid #fef3c7',
                  }}
                >
                  <span className="drop-shadow-2xl text-white">Y</span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="animate-in zoom-in fade-in duration-700">
            <div className="text-8xl mb-6 animate-bounce">
              {result === 1 ? '🟣' : '🟡'}
            </div>
            <h1 className={`text-7xl font-black mb-4 drop-shadow-2xl ${result === 1 ? 'text-purple-400' : 'text-yellow-400'}`}>
              {result === 1 ? t1Name.toUpperCase() : t2Name.toUpperCase()}
            </h1>
            <h2 className="text-4xl font-bold text-white mb-8">
              STARTS THE MATCH!
            </h2>
            <p className="text-xl text-slate-400 animate-pulse">
              Starting in 3 seconds...
            </p>
          </div>
        )}
      </div>
    </div>
  )
})

const StarterWheel = React.memo(function StarterWheel({
  spinAngle,
  spinning,
  t1Label,
  t2Label,
}: {
  spinAngle: number
  spinning: boolean
  t1Label: string
  t2Label: string
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!spinning || spinAngle <= 0) return
    const duration = 5600
    const startTime = performance.now()
    let raf: number
    // Fast start, gradual deceleration to complete stop
    function ease(t: number): number {
      const x1 = 0.18, y1 = 0.98, x2 = 0.28, y2 = 1
      const cx3 = 3 * x1, bx3 = 3 * (x2 - x1) - cx3, ax3 = 1 - cx3 - bx3
      const cy3 = 3 * y1, by3 = 3 * (y2 - y1) - cy3, ay3 = 1 - cy3 - by3
      let u = t
      for (let i = 0; i < 8; i++) {
        const xErr = ((ax3 * u + bx3) * u + cx3) * u - t
        const dxDu = (3 * ax3 * u + 2 * bx3) * u + cx3
        if (Math.abs(dxDu) < 1e-6) break
        u -= xErr / dxDu
      }
      return ((ay3 * u + by3) * u + cy3) * u
    }
    const frame = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1)
      if (svgRef.current) {
        const rotation = ease(progress) * spinAngle
        svgRef.current.style.transform = `rotate(${rotation}deg)`
        svgRef.current.style.transformOrigin = '100px 100px'
      }
      if (progress < 1) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [spinAngle, spinning])

  const cx = 100, cy = 100, R = 80
  const path1 = `M ${cx} ${cy} L ${cx} ${cy - R} A ${R} ${R} 0 0 1 ${cx} ${cy + R} Z`
  const path2 = `M ${cx} ${cy} L ${cx} ${cy + R} A ${R} ${R} 0 0 1 ${cx} ${cy - R} Z`

  const svgStyle: React.CSSProperties = spinning ? { transformOrigin: '100px 100px', filter: 'drop-shadow(0 0 16px rgba(168,85,247,0.4))' } : { transformOrigin: '100px 100px' }

  return (
    <div className="relative mx-auto mb-2 transition-all duration-300" style={{ width: 200, height: 200 }}>
      {spinning && (
        <div className="absolute inset-0 rounded-full bg-purple-500/10 animate-pulse blur-lg" />
      )}
      <svg ref={svgRef} width={200} height={200} viewBox="0 0 200 200" style={svgStyle} className="transition-all duration-300">
        <circle cx={cx} cy={cy} r={R + 6} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={12} />
        <path d={path1} fill="#7c3aed" stroke="#111827" strokeWidth={2} className="transition-all duration-150" />
        <path d={path2} fill="#f59e0b" stroke="#111827" strokeWidth={2} className="transition-all duration-150" />
        <circle cx={cx} cy={cy} r={18} fill="white" className={spinning ? 'animate-pulse' : ''} />
        <circle cx={cx} cy={cy} r={10} fill="#0f172a" />
        <text x={cx} y={cy - 44} textAnchor="middle" fontSize={14} fontWeight={900} fill="white">{t1Label}</text>
        <text x={cx} y={cy + 58} textAnchor="middle" fontSize={14} fontWeight={900} fill="white">{t2Label}</text>
      </svg>
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-3 z-10 transition-all duration-300 ${spinning ? 'scale-110' : ''}`}>
        <div className={`w-0 h-0 border-l-[12px] border-r-[12px] border-t-[28px] border-l-transparent border-r-transparent border-t-white ${spinning ? 'drop-shadow-[0_4px_10px_rgba(255,255,255,0.8)]' : 'drop-shadow-[0_4px_6px_rgba(0,0,0,0.6)]'}`} />
      </div>
    </div>
  )
})

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function GamePage() {
  const params   = useParams()
  const router   = useRouter()
  const search   = useSearchParams()

  const roomCode = (params.roomCode as string).toUpperCase()
  const requestedTeam = search.get('team') === '2' ? 2 : 1
  const isSpectator = search.get('spectator') === 'true'
  const [myTeam, setMyTeam] = useState<Team>(requestedTeam)
  const [teamIdentityReady, setTeamIdentityReady] = useState(isSpectator)
  // Team names from URL
  const t1Name   = search.get('t1') || 'Team 1'
  const t2Name   = search.get('t2') || 'Team 2'
  // Captain flag — solo players are always captain; team mode passes ?captain=true for the captain
  const isCaptain = !isSpectator && search.get('captain') !== 'false'
  // Starter team from coin flip result in room lobby
  const starterParam = search.get('starter')
  const starterTeam = starterParam === '2' ? 2 : (starterParam === '1' ? 1 : 1) // Default to 1 if null
  const tn       = (t: Team) => t === 1 ? t1Name : t2Name

  console.log('[INIT] Starter team from URL:', starterTeam, 'from param:', starterParam)

  /* ── State ────────────────────────────────────────────────────────────── */
  // Initialize game state with starter team from coin flip result and unique match ID
  const [gs, disp]           = useReducer(reduce, undefined, () => ({
    ...initGS(`room-${roomCode}`), // Use roomCode as base for match ID for consistency
    turn: starterTeam as Team, // Use the starter team from coin flip result
    coinFlipResult: starterTeam as Team, // Use the starter team from coin flip result
  }))
  const [selId, setSel]      = useState<string | null>(null)
  const [moves, setMoves]    = useState<Set<string>>(new Set())
  const [bludgerMode, setBludgerMode] = useState<string | null>(null)
  const [bludgerCells, setBludgerCells] = useState<Set<string>>(new Set())
  const [dpType, setDpType]  = useState<PieceType | null>(null)
  const [dpCells, setDpCells]= useState<Set<string>>(new Set())
  const [hover, setHover]    = useState<string | null>(null)
  const [scoreFlash, setFlash] = useState<Team | null>(null)
  const [celebration, setCelebration] = useState<{ team: Team; points: number; isStreakBonus: boolean } | null>(null)
  
  // DEBUG: Log state changes
  useEffect(() => {
    console.log('[STATE CHANGE] gs updated:', {
      piecesCount: gs.pieces.length,
      revision: gs.revision,
      phase: gs.phase,
      pieces: gs.pieces.map(p => ({ id: p.id, type: p.type, pos: `${p.col}${p.row}` })),
      timestamp: Date.now()
    })
  }, [gs])
  
  const [spinAngle, setSpin] = useState(0)
  const [spinning, setSpinning] = useState(false)
  // Starter wheel state
  const [starterSpinAngle, setStarterSpin] = useState(0)
  const [starterSpinning, setStarterSpinning] = useState(false)
  const [combatCountdown, setCombatCountdown] = useState<number | null>(null)
  
  const [cellWidth, setCellWidth]   = useState(180)
  const [cellHeight, setCellHeight] = useState(90)
  const [syncReceived, setSyncReceived] = useState(false)

  // Snitch wheel state
  const [snitchSquares, setSnitchSquares]   = useState<string[]>([])
  const [snitchSpinAngle, setSnitchSpin]    = useState(0)
  const [snitchSpinning, setSnitchSpinning] = useState(false)
  const [matchRecordStatus, setMatchRecordStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [matchRecordError, setMatchRecordError] = useState<string | null>(null)
  const [matchRecordAttempt, setMatchRecordAttempt] = useState(0)
  const [gameStateRoomId, setGameStateRoomId] = useState<string | null>(null)
  const [achievementToast, setAchievementToast] = useState<{ message: string; type: 'success' } | null>(null)
  const [achievementCheckRetries, setAchievementCheckRetries] = useState(0)

  // Keep one client and one set of channels for the lifetime of this match.
  const supabase   = useMemo(() => createClient(), [])
  const chRef      = useRef<ReturnType<typeof supabase.channel> | null>(null)
  const gsRef      = useRef(gs)
  const syncRcvRef = useRef(false)
  const matchRecordRef = useRef(false)
  const attackerChoicePendingRef = useRef(false)
  useEffect(() => { gsRef.current = gs }, [gs])
  useEffect(() => { syncRcvRef.current = syncReceived }, [syncReceived])

  /* ── Send action: Updates local state and broadcasts to others ─────── */
  const emit = useCallback((a: Act) => {
    if (isSpectator || !teamIdentityReady) return

    const expectedRevision = gsRef.current.revision ?? 0
    const nextState = reduce(gsRef.current, a)

    // Update local state immediately for instant feedback
    disp(a)

    // Broadcast to other players via realtime
    chRef.current?.send({ type: 'broadcast', event: 'g', payload: a })

    // Save important actions to database for persistence
    const shouldSave = a.kind === 'PLACE' || a.kind === 'DDONE' || a.kind === 'MOVE' || a.kind === 'DRESET' || a.kind === 'ATTACKER_CHOICE' || a.kind === 'ATTACKER_SHOOT' || a.kind === 'COMBAT_SPIN' || a.kind === 'COMBAT_RESOLVE' || a.kind === 'COMBAT_REVEAL_COMPLETE' || a.kind === 'END_BONUS_TURN' || a.kind === 'SEEKER_CONTINUE' || a.kind === 'SNITCH_SYNC_WAIT' || a.kind === 'SNITCH_TRIGGER_ENCOUNTER' || a.kind === 'SNITCH_OUTCOME_SPIN' || a.kind === 'SNITCH_OUTCOME_RESOLVE' || a.kind === 'SNITCH_LAND'
    if (shouldSave && (nextState.revision ?? 0) > expectedRevision) {
      void (async () => {
        const { error } = await supabase.rpc('save_quidditch_game_state', {
          p_room_code: roomCode,
          p_game_state: nextState,
          p_expected_revision: expectedRevision,
        })
        if (error) {
          // Silent fail - realtime broadcast handles sync
        }
      })()
    }
  }, [isSpectator, roomCode, supabase, teamIdentityReady, myTeam])

  /* Starter Wheel: DEPRECATED - replaced by coin flip in room lobby */
  // Old wheel code removed - starter is now determined in room lobby
  
  // Do not trust the team number in a URL. It is convenient for navigation,
  // but the authenticated room membership is the source of truth. This avoids
  // two browsers accidentally controlling the same colour and both waiting.
  useEffect(() => {
    if (isSpectator) return
    let cancelled = false
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || cancelled) return
      const { data: room } = await supabase
        .from('rooms')
        .select('id')
        .eq('room_code', roomCode)
        .single()
      if (!room || cancelled) return
      const { data: teams } = await supabase
        .from('teams')
        .select('id, team_number')
        .eq('room_id', room.id)
      const membership = teams && (await supabase
        .from('team_members')
        .select('team_id')
        .eq('user_id', user.id)
        .in('team_id', teams.map(team => team.id))
        .maybeSingle()).data
      const verifiedTeam = teams?.find(team => team.id === membership?.team_id)?.team_number
      if (!cancelled && (verifiedTeam === 1 || verifiedTeam === 2)) setMyTeam(verifiedTeam)
      if (!cancelled) setTeamIdentityReady(true)
    })()
    return () => { cancelled = true }
  }, [isSpectator, roomCode, supabase])

  /* ── Dynamic Size for Full Screen Without Cutoff ──────────────────────── */
  useEffect(() => {
    function updateSize() {
      const availableHeight = window.innerHeight - 180
      // On desktop, reserve room for both setup panels. On smaller screens
      // the panels stack, so the pitch can use the full width.
      const availableWidth = window.innerWidth >= 1024
        ? window.innerWidth - 640
        : window.innerWidth - 48
      // Keep the pitch vertical, but use wide rectangular cells so the board
      // fills the unused space at the left and right of the screen.
      const byHeight = Math.floor(availableHeight / 7.6)
      const byWidth = Math.floor(availableWidth / 4.15)
      setCellHeight(Math.max(62, Math.min(130, byHeight)))
      setCellWidth(Math.max(110, Math.min(260, byWidth)))
    }
    updateSize()
    window.addEventListener('resize', updateSize)
    return () => window.removeEventListener('resize', updateSize)
  }, [])

  /* ── Clear selection when turn changes or bonus state changes ─────────── */
  useEffect(() => {
    // Clear any piece selection when it becomes the opponent's turn
    if (gs.turn !== myTeam) {
      setSel(null)
      setMoves(new Set())
      setBludgerMode(null)
    }
    // Also clear when seeker bonus UI is active (player must choose from modal)
    if (gs.seekerBonusMoveActive) {
      setSel(null)
      setMoves(new Set())
      setBludgerMode(null)
    }
    // Reset attacker choice guard when the choice UI closes
    if (!gs.attackerScoringChoice) {
      attackerChoicePendingRef.current = false
    }
  }, [gs.turn, gs.seekerBonusMoveActive, gs.attackerScoringChoice, myTeam])



  /* ── Countdown when combat starts ────────────────────────────────────── */
  useEffect(() => {
    if (!gs.combat || gs.combat.phase !== 'spinning') {
      setCombatCountdown(null)
      return
    }
    // Start fresh countdown from 3
    setCombatCountdown(3)
    const t1 = setTimeout(() => setCombatCountdown(2), 1000)
    const t2 = setTimeout(() => setCombatCountdown(1), 2000)
    const t3 = setTimeout(() => setCombatCountdown(0), 3000)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [gs.combat?.attackerId, gs.combat?.phase]) // eslint-disable-line react-hooks/exhaustive-deps -- combat object identity changes on synced updates

  /* ── Auto start spin sequence when countdown finishes ─────────────────── */
  useEffect(() => {
    if (combatCountdown !== 0 || gs.combat?.phase !== 'spinning') return

    if (gs.combat.atkTeam === myTeam) {
      // Attacker: generate outcome and broadcast to both clients
      // ATK sections = attacker's broom speed (no bonus)
      // DEF sections = defender's broom speed + 1 (defender advantage)
      const sections = buildWheelSections(gs.combat.attackerSpeed, gs.combat.defenderSpeed)
      const total = sections.length
      const deg = 360 / total

      // Winner probability = ATK sections / total
      const atkProb = sections.filter(s => s === 'atk').length / total
      const winner = randomFraction() < atkProb ? 'atk' : 'def'

      // Find all sections of the winning type and pick one randomly
      const validIdxs = sections
        .map((type, i) => ({ type, i }))
        .filter(s => s.type === winner)
        .map(s => s.i)
      const chosen = validIdxs[randomIndex(validIdxs.length)]

      // Pointer (at top=0°) sees section i when: (360 - spinAngle % 360) ∈ [i*deg, (i+1)*deg)
      // So spinAngle % 360 ∈ (360 - (chosen+1)*deg + margin, 360 - chosen*deg - margin)
      const margin = Math.min(5, deg * 0.12)
      const lo = 360 - (chosen + 1) * deg + margin
      const hi = 360 - chosen * deg - margin
      const finalMod = lo + randomFraction() * (hi - lo)

      emit({ kind: 'COMBAT_SPIN', angle: 360 * 15 + finalMod, winner })
    } else {
      // Defender: if COMBAT_SPIN broadcast is lost, request SYNC after 600ms
      const t = setTimeout(() => {
        if (gsRef.current?.combat?.phase === 'spinning') {
          chRef.current?.send({ type: 'broadcast', event: 'g', payload: { kind: 'REQ' } })
        }
      }, 600)
      return () => clearTimeout(t)
    }
  }, [combatCountdown, gs.combat?.phase, gs.combat?.atkTeam, myTeam, emit]) // eslint-disable-line react-hooks/exhaustive-deps -- speeds are read only while this combat spin is active

  /* ── Handle animated spin on both clients ────────────────────────────── */
  useEffect(() => {
    if (gs.combat?.phase === 'spinning_anim' && gs.combat.spinTarget !== undefined) {
      const target = gs.combat.spinTarget

      // Set spinning + target in one render.
      // CombatWheel uses a dynamic @keyframes animation (not a CSS transition)
      // so it always starts from rotate(0deg) and spins to target — no timing tricks needed.
      setSpinning(true)
      setSpin(target)

      const t = setTimeout(() => {
        // After 10s animation completes, attacker initiates resolution
        if (gs.combat?.atkTeam === myTeam) {
          emit({ kind: 'COMBAT_RESOLVE' })
        }
      }, 10200)

      return () => clearTimeout(t)
    }
  }, [gs.combat?.phase, gs.combat?.spinTarget, gs.combat?.atkTeam, myTeam, emit])

  /* ── Auto complete combat reveal phase after showing result ─────────────── */
  useEffect(() => {
    if (gs.combat?.phase !== 'reveal' || gs.combat.result === undefined) return
    // Attacker's team triggers the completion after showing result
    if (gs.combat.atkTeam === myTeam) {
      const t = setTimeout(() => emit({ kind: 'COMBAT_REVEAL_COMPLETE' }), 2000)
      return () => clearTimeout(t)
    }
  }, [gs.combat?.phase, gs.combat?.result, gs.combat?.atkTeam, myTeam, emit])

  /* ── Snitch Appearing / Spinning ───────────────────────────────────────── */
  // Team 1 hosts: generate and broadcast the SNITCH_SPIN when 'appearing' starts
  useEffect(() => {
    if (gs.snitchPhase !== 'appearing' || myTeam !== 1) return
    console.log('[SNITCH] Starting appearing phase timer for 800ms')
    const t = setTimeout(() => {
      const live = gsRef.current
      // Double-check phase hasn't changed
      if (live.snitchPhase !== 'appearing') {
        console.log('[SNITCH] Phase changed, aborting')
        return
      }
      // Wait for combat or duel to finish before triggering Snitch wheel
      if (live.combat?.phase || live.combat || live.duel?.phase || live.duel) {
        console.log('[SNITCH] Waiting for combat/duel to finish before triggering wheel')
        return
      }
      // A moving Snitch can never be sent back to the square it just left.
      const currentSquare = live.snitchPos
        ? `${live.snitchPos.col}${live.snitchPos.row}`
        : null
      const squares = shuffleSquares().filter(square => square !== currentSquare)
      if (squares.length === 0) {
        console.log('[SNITCH] No available squares to spawn snitch, using all squares')
        // Fallback: use all squares if filtered list is empty
        const allSquares = shuffleSquares()
        if (allSquares.length === 0) {
          console.log('[SNITCH] ERROR: No squares available at all')
          return
        }
        const chosenIdx = randomIndex(allSquares.length)
        const targetSq = allSquares[chosenIdx]
        if (!targetSq) {
          console.log('[SNITCH] Failed to select target square from fallback')
          return
        }
        console.log('[SNITCH] Emitting SNITCH_SPIN with fallback squares:', allSquares)
        emit({
          kind: 'SNITCH_SPIN',
          squares: allSquares,
          angle: computeWheelSpinAngle(allSquares.length, chosenIdx, 12),
          col: targetSq[0] as Col,
          row: parseInt(targetSq[1])
        })
        return
      }
      const chosenIdx = randomIndex(squares.length)
      const targetSq = squares[chosenIdx]
      if (!targetSq) {
        console.log('[SNITCH] Failed to select target square')
        return
      }
      console.log('[SNITCH] Emitting SNITCH_SPIN with squares:', squares)
      emit({
        kind: 'SNITCH_SPIN',
        squares,
        angle: computeWheelSpinAngle(squares.length, chosenIdx, 12),
        col: targetSq[0] as Col,
        row: parseInt(targetSq[1])
      })
    }, 800) // Reduced to 800ms for faster transition
    
    // SAFETY FALLBACK: Force transition if stuck in appearing phase for too long
    const safetyT = setTimeout(() => {
      const live = gsRef.current
      if (live.snitchPhase === 'appearing') {
        console.log('[SNITCH] SAFETY: Still in appearing phase, forcing transition')
        // Force a simple wheel with all squares
        const allSquares = shuffleSquares()
        const chosenIdx = randomIndex(allSquares.length)
        const targetSq = allSquares[chosenIdx]
        if (targetSq) {
          emit({
            kind: 'SNITCH_SPIN',
            squares: allSquares,
            angle: computeWheelSpinAngle(allSquares.length, chosenIdx, 12),
            col: targetSq[0] as Col,
            row: parseInt(targetSq[1])
          })
        }
      }
    }, 3000) // 3 second safety timeout
    
    return () => {
      clearTimeout(t)
      clearTimeout(safetyT)
    }
  }, [gs.snitchPhase, myTeam, emit])

  // Sync local wheel state when SNITCH_SPIN lands in gs (both teams)
  useEffect(() => {
    console.log('[SNITCH WHEEL SYNC] Phase changed:', gs.snitchPhase, 'squares:', gs.snitchSquares?.length, 'angle:', gs.snitchAngle)
    if (gs.snitchPhase === 'appearing') {
      setSnitchSquares([])
      setSnitchSpin(0)
      setSnitchSpinning(false)
      return
    }
    if (gs.snitchPhase === 'spinning' && gs.snitchSquares && gs.snitchAngle !== undefined) {
      console.log('[SNITCH WHEEL SYNC] Starting wheel with squares:', gs.snitchSquares)
      // Force immediate update with a small delay to ensure React processes the state change
      setTimeout(() => {
        setSnitchSquares(gs.snitchSquares)
        setSnitchSpin(gs.snitchAngle)
        setSnitchSpinning(true)
      }, 50)
      return
    }
    if (gs.snitchPhase === 'active' || gs.snitchPhase === 'caught' || gs.snitchPhase === null) {
      setSnitchSpinning(false)
    }
  }, [gs.snitchPhase, gs.snitchSquares, gs.snitchAngle])

  // Team 1 hosts: emit SNITCH_LAND after animation completes
  useEffect(() => {
    if (gs.snitchPhase !== 'spinning' || myTeam !== 1) return
    // Wait for combat to finish before proceeding - comprehensive check
    if (gs.combat?.phase || gs.combat) {
      console.log('[SNITCH] Waiting for combat to finish before SNITCH_LAND')
      return
    }
    const t = setTimeout(() => emit({ kind: 'SNITCH_LAND' }), 10200) // Same timing as CombatWheel
    return () => clearTimeout(t)
  }, [gs.snitchPhase, gs.combat, myTeam, emit])

  /* ── Snitch encounter: Team 1 syncs wait state and promotes ready → encounter ── */
  useEffect(() => {
    if (myTeam !== 1 || gs.snitchPhase !== 'active' || !gs.snitchPos) return
    if (seekersOnSnitch(gs.pieces, gs.snitchPos).length === 0) return

    if (getSnitchWaitTurnsCompleted(gs) === undefined) {
      emit({ kind: 'SNITCH_SYNC_WAIT' })
      return
    }

    if (isSnitchEncounterReady(gs)) {
      console.log('[SNITCH] Wait requirement satisfied — triggering encounter phase')
      emit({ kind: 'SNITCH_TRIGGER_ENCOUNTER' })
    }
  }, [gs.snitchPhase, gs.snitchWaitTurnsCompleted, gs.snitchEncounterDelayTurns, gs.pieces, gs.snitchPos, myTeam, emit])

  /* ── Snitch fate wheel: Team 1 hosts authoritative spin when encounter phase is set ── */
  useEffect(() => {
    if (gs.snitchPhase !== 'encounter') return
    if (gs.snitchOutcomeAngle !== undefined) return
    if (myTeam !== 1) return

    const current = gsRef.current
    if (!current.snitchPos || seekersOnSnitch(current.pieces, current.snitchPos).length === 0) return

    console.log('[SNITCH] Encounter phase confirmed — scheduling authoritative wheel spin')
    const t = setTimeout(() => {
      const live = gsRef.current
      if (live.snitchPhase !== 'encounter' || live.snitchOutcomeAngle !== undefined) return
      if (!live.snitchPos || seekersOnSnitch(live.pieces, live.snitchPos).length === 0) return

      const { labels, outcomes } = shuffleOutcomes(live.snitchWheelContext)
      // After shuffle, pick index 0 - the shuffle already guarantees equal probability
      const chosenIdx = 0
      const chosenOutcome = outcomes[chosenIdx]
      console.log('[SNITCH OUTCOME] Chosen outcome:', chosenOutcome, 'at index:', chosenIdx)
      const eventId = `${live.matchId ?? 'match'}-enc-${live.turnCount}-${Date.now()}`
      emit({
        kind: 'SNITCH_OUTCOME_SPIN',
        labels,
        angle: computeWheelSpinAngle(outcomes.length, chosenIdx, 12),
        outcome: chosenOutcome,
        eventId,
      })
    }, 900)
    return () => clearTimeout(t)
  }, [gs.snitchPhase, gs.snitchOutcomeAngle, gs.snitchWheelContext, myTeam, emit])

  useEffect(() => {
    if (gs.snitchPhase !== 'encounter' || gs.snitchOutcomeAngle === undefined || myTeam !== 1) return
    // Wait for combat to finish before proceeding - comprehensive check
    if (gs.combat?.phase || gs.combat) {
      console.log('[SNITCH] Waiting for combat to finish before SNITCH_OUTCOME_RESOLVE')
      return
    }
    const t = setTimeout(() => emit({ kind: 'SNITCH_OUTCOME_RESOLVE' }), 10200) // Same timing as CombatWheel
    return () => clearTimeout(t)
  }, [gs.snitchPhase, gs.snitchOutcomeAngle, gs.combat, myTeam, emit])

  /* A held Snitch shared by both Seekers gets a speed-weighted catch wheel. */
  useEffect(() => {
    if (gs.snitchPhase !== 'catching' || gs.snitchCatchAngle !== undefined || myTeam !== 1) return
    const t = setTimeout(() => {
      const contenders = seekersOnSnitch(gsRef.current.pieces, gsRef.current.snitchPos)
      const slots = contenders.flatMap(piece =>
        Array.from({ length: Math.max(1, piece.broomSpeed) }, () => ({
          pieceId: piece.id,
          label: piece.team === 1 ? 'PURPLE' : 'YELLOW',
        }))
      )
      // A delayed state update can remove a contender before this timer fires.
      // In that case do not create an invalid wheel; request a fresh game sync.
      if (slots.length < 2) {
        chRef.current?.send({ type: 'broadcast', event: 'g', payload: { kind: 'REQ' } })
        return
      }
      for (let i = slots.length - 1; i > 0; i--) {
        const j = randomIndex(i + 1)
        ;[slots[i], slots[j]] = [slots[j], slots[i]]
      }
      const winnerIndex = randomIndex(slots.length)
      const deg = 360 / slots.length
      const margin = deg * 0.18
      const lo = 360 - (winnerIndex + 1) * deg + margin
      const hi = 360 - winnerIndex * deg - margin
      emit({
        kind: 'SNITCH_CATCH_SPIN',
        labels: slots.map(slot => slot.label),
        angle: 360 * 12 + lo + randomFraction() * (hi - lo),
        winnerId: slots[winnerIndex].pieceId,
      })
    }, 900)
    return () => clearTimeout(t)
  }, [gs.snitchPhase, gs.snitchCatchAngle, myTeam, emit])

  useEffect(() => {
    if (gs.snitchPhase !== 'catching' || gs.snitchCatchAngle === undefined || myTeam !== 1) return
    // Wait for combat to finish before proceeding - comprehensive check
    if (gs.combat?.phase || gs.combat) {
      console.log('[SNITCH] Waiting for combat to finish before SNITCH_CATCH_RESOLVE')
      return
    }
    const t = setTimeout(() => emit({ kind: 'SNITCH_CATCH_RESOLVE' }), 10200) // Same timing as CombatWheel
    return () => clearTimeout(t)
  }, [gs.snitchPhase, gs.snitchCatchAngle, gs.combat, myTeam, emit])

  useEffect(() => {
    if (gs.snitchPhase !== 'caught' || matchRecordStatus === 'saving' || matchRecordStatus === 'error') return
    const t = setTimeout(() => router.replace('/home'), 6000)
    return () => clearTimeout(t)
  }, [gs.snitchPhase, matchRecordStatus, router])

  // Captains persist the completed match. The database function is idempotent,
  // so simultaneous clients cannot count the same room twice.
  useEffect(() => {
    if (gs.phase !== 'finished' || !isCaptain || matchRecordRef.current) return
    matchRecordRef.current = true
    setMatchRecordStatus('saving')
    setMatchRecordError(null)
    const winnerTeam: Team = gs.s1 > gs.s2 ? 1 : 2
    const snitchCatcher = gs.snitchCatchWinnerId
      ? gs.pieces.find(piece => piece.id === gs.snitchCatchWinnerId)
      : undefined
    
    console.log('[MATCH RECORD] Recording match result:', {
      roomCode,
      winnerTeam,
      scores: { t1: gs.s1, t2: gs.s2 },
      saves: { t1: gs.saves1, t2: gs.saves2 },
      snitchCatcher: snitchCatcher?.id
    })
    
    void supabase.rpc('record_match_result', {
      p_room_code: roomCode,
      p_winner_team: winnerTeam,
      p_team1_score: gs.s1,
      p_team2_score: gs.s2,
      p_team1_saves: gs.saves1,
      p_team2_saves: gs.saves2,
      p_snitch_team: snitchCatcher?.team ?? null,
    }).then(async ({ error }) => {
      if (!error) {
        console.log('[MATCH RECORD] Match result saved successfully')
        setMatchRecordStatus('saved')
        setAchievementCheckRetries(0) // Reset retry counter
        
        // Check for newly unlocked achievements
        try {
          const { data: { user } } = await supabase.auth.getUser()
          if (user) {
            console.log('[ACHIEVEMENT] Checking for newly unlocked achievements for user:', user.id)
            
            // Get user's achievements before the match to compare
            const { data: oldAchievements } = await supabase
              .from('user_achievements')
              .select('achievement_id')
              .eq('user_id', user.id)
            
            const oldCount = oldAchievements?.length || 0
            
            // Wait a moment for the database to process achievements
            await new Promise(resolve => setTimeout(resolve, 500))
            
            // Get user's achievements after the match
            const { data: newAchievements } = await supabase
              .from('user_achievements')
              .select('achievement_id, achievements(name, icon)')
              .eq('user_id', user.id)
            
            const newCount = newAchievements?.length || 0
            
            console.log('[ACHIEVEMENT] Achievement count:', { old: oldCount, new: newCount })
            
            if (newAchievements && newCount > oldCount) {
              // Show toast for newly unlocked achievements
              const newlyUnlocked = newAchievements.slice(oldCount)
              newlyUnlocked.forEach((achievement, index) => {
                // @ts-ignore
                const achievementName = achievement.achievements?.name
                if (achievementName) {
                  console.log('[ACHIEVEMENT] Newly unlocked:', achievementName)
                  // Show toast for each new achievement with slight delay
                  setTimeout(() => {
                    setAchievementToast({
                      message: `🏆 Achievement Unlocked: ${achievementName}!`,
                      type: 'success'
                    })
                  }, index * 6000) // 6 seconds between toasts
                }
              })
            } else {
              console.log('[ACHIEVEMENT] No new achievements detected on first check')
            }
          }
        } catch (achievementError) {
          console.error('[ACHIEVEMENT] Failed to check achievements:', achievementError)
          // Don't fail the match recording if achievement check fails
        }
        return
      }

      console.error('[MATCH RECORD] Failed to save match result:', error)
      matchRecordRef.current = false
      setMatchRecordStatus('error')
      setMatchRecordError(
        error.message.includes('record_match_result')
          ? 'Game database needs to be updated. Please contact the administrator to apply the latest updates.'
          : `Could not save match results: ${error.message}. Your game progress is safe, but stats may not be recorded.`
      )
    })
  }, [gs.phase, gs.s1, gs.s2, gs.saves1, gs.saves2, isCaptain, roomCode, matchRecordAttempt, supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback: Retry achievement check if initial check didn't detect new achievements
  // This handles cases where the database is slow to process achievements
  useEffect(() => {
    if (matchRecordStatus !== 'saved' || achievementCheckRetries >= 3) return
    
    const retryDelay = 2000 * (achievementCheckRetries + 1) // 2s, 4s, 6s delays
    
    const timer = setTimeout(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        
        console.log('[ACHIEVEMENT FALLBACK] Retry attempt:', achievementCheckRetries + 1)
        
        const { data: newAchievements } = await supabase
          .from('user_achievements')
          .select('achievement_id, achievements(name, icon)')
          .eq('user_id', user.id)
        
        const newCount = newAchievements?.length || 0
        
        // If we have achievements now, show them
        if (newAchievements && newCount > 0) {
          // We can't know which are new without the old count, so just show the most recent
          const latestAchievement = newAchievements[newAchievements.length - 1]
          // @ts-ignore
          const achievementName = latestAchievement.achievements?.name
          if (achievementName) {
            console.log('[ACHIEVEMENT FALLBACK] Found achievement on retry:', achievementName)
            setAchievementToast({
              message: `🏆 Achievement Unlocked: ${achievementName}!`,
              type: 'success'
            })
          }
        }
        
        setAchievementCheckRetries(prev => prev + 1)
      } catch (error) {
        console.error('[ACHIEVEMENT FALLBACK] Retry failed:', error)
        setAchievementCheckRetries(prev => prev + 1)
      }
    }, retryDelay)
    
    return () => clearTimeout(timer)
  }, [matchRecordStatus, achievementCheckRetries, supabase])

  // Fetch one canonical board before subscribing. The database inserts the
  // initial board only once, so every player and spectator starts in sync.
  useEffect(() => {
    let cancelled = false
    void supabase.rpc('get_or_create_quidditch_game_state', {
      p_room_code: roomCode,
      p_initial_state: initGS(`room-${roomCode}`), // Use room code for consistent matchId
    }).then(({ data, error }) => {
      if (cancelled || error || !data?.success) {
        // Silent fail - game will sync from other players
        return
      }
      const loadedState = data.game_state as GS
      console.log('[INITIAL LOAD] Game state loaded:', {
        phase: loadedState.phase,
        piecesCount: loadedState.pieces.length,
        turn: loadedState.turn,
        seekerBonusMoveActive: loadedState.seekerBonusMoveActive,
        revision: loadedState.revision,
        matchId: loadedState.matchId,
        timestamp: Date.now()
      })
      setGameStateRoomId(data.room_id)
      // Force fresh state - always accept the loaded state
      disp({ kind: 'SYNC', gs: loadedState })
      setSyncReceived(true)
      syncRcvRef.current = true
    })
    return () => { cancelled = true }
  }, [roomCode, supabase])

  /* ── Supabase Realtime ────────────────────────────────────────────────── */
  useEffect(() => {
    if (!gameStateRoomId) return
    
    const chan = supabase.channel(`game:${roomCode}`, {
      config: { 
        broadcast: { 
          self: false,   // Don't receive our own broadcasts
          ack: false     // Don't wait for acknowledgment (faster)
        },
        presence: { key: '' }  // Disable presence tracking for better performance
      },
    })
    chRef.current = chan

    chan.on('broadcast', { event: 'g' }, ({ payload }: { payload: Act | { kind: 'REQ' } | { kind: 'SYNC'; gs: GS } }) => {
      console.log('[REALTIME] Broadcast received:', payload.kind, 'isSpectator:', isSpectator, 'myTeam:', myTeam)
      
      if (payload.kind === 'REQ') {
        // Only players respond to state requests, not spectators
        if (!isSpectator) {
          chan.send({ type: 'broadcast', event: 'g', payload: { kind: 'SYNC', gs: gsRef.current } })
        }
        return
      }
      if (payload.kind === 'SYNC') {
        // For initial sync, accept the incoming matchId to ensure both clients converge
        // This handles the case where browsers navigate directly to game with different initial states
        console.log('[REALTIME] SYNC received, updating state')
        setSyncReceived(true)
        syncRcvRef.current = true
        disp({ kind: 'SYNC', gs: payload.gs })
        return
      }
      
      // Guard: Log match ID for all actions to prevent cross-game contamination
      console.log('[REALTIME] Action received:', payload.kind, 'matchId:', gsRef.current.matchId)
      
      // SPECTATOR FIX: Spectators must receive ALL actions from BOTH teams
      // Players skip their own actions (already applied locally)
      if (!isSpectator && 'team' in payload && payload.team === myTeam) {
        console.log('[REALTIME] Ignoring own action')
        return
      }
      
      console.log('[REALTIME] Applying action from', 'team' in payload ? `team ${payload.team}` : 'system')
      // Apply other player's action (or all actions if spectator)
      disp(payload as Act)
    })

    chan.on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'quidditch_game_states',
      filter: `room_id=eq.${gameStateRoomId}`,
    }, (payload) => {
      const dbState = (payload.new as { game_state?: GS; revision?: number })
      if (!dbState?.game_state) return
      
      const incomingRevision = dbState.revision ?? 0
      const currentRevision = gsRef.current.revision ?? 0
      
      // Only apply if incoming is newer
      if (incomingRevision > currentRevision) {
        disp({ kind: 'SYNC', gs: { ...dbState.game_state, revision: incomingRevision } })
      }
    })

    chan.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Request initial state
        for (let i = 0; i < 2; i++) {
          await new Promise<void>(r => setTimeout(r, 600))
          if (syncRcvRef.current) break
          chan.send({ type: 'broadcast', event: 'g', payload: { kind: 'REQ' } })
        }
      }
    })

    return () => { 
      supabase.removeChannel(chan) 
    }
  }, [roomCode, gameStateRoomId, myTeam, supabase])

  /* ── Connection Health Monitor (DISABLED FOR PERFORMANCE) ─────────────── */
  // Heavy monitoring disabled - game works without it
  /*
  useEffect(() => {
    const healthCheck = setInterval(() => {
      const timeSinceLastSync = Date.now() - lastSyncTime
      if (timeSinceLastSync > 120000) setConnectionHealth('degraded')
      if (timeSinceLastSync > 300000 && reconnectAttempts < 3) {
        setConnectionHealth('disconnected')
        setReconnectAttempts(prev => prev + 1)
        chRef.current?.send({ type: 'broadcast', event: 'g', payload: { kind: 'REQ' } })
      }
    }, 30000)
    return () => clearInterval(healthCheck)
  }, [lastSyncTime, myTeam, reconnectAttempts])
  */

  /* ── Auto-reconnect on visibility change (DISABLED FOR PERFORMANCE) ───── */
  // Disabled - adds overhead, game syncs automatically via broadcast
  /*
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        chRef.current?.send({ type: 'broadcast', event: 'g', payload: { kind: 'REQ' } })
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [myTeam])
  */

  /* ── Keyboard navigation - Escape to deselect ─────────────────────────── */
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selId) {
        setSel(null)
        setMoves(new Set())
        setBludgerMode(null)
      }
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [selId])

  /* ── Periodic state backup (DISABLED FOR PERFORMANCE) ─────────────────── */
  // Heavy database saves every 2 minutes disabled
  // Game state persists via emit() which is sufficient
  /*
  useEffect(() => {
    if (gs.phase === 'finished' || isSpectator) return
    const backupInterval = setInterval(() => {
      void supabase.rpc('save_quidditch_game_state', {
        p_room_code: roomCode,
        p_game_state: gs,
        p_expected_revision: gs.revision ?? 0,
      })
    }, 120000)
    return () => clearInterval(backupInterval)
  }, [gs, roomCode, supabase, myTeam, isSpectator])
  */

  /* ── Goal duel reveal ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (gs.duel?.phase !== 'reveal' || !gs.duel.result) return
    const atk = gs.pieces.find(p => p.id === gs.duel!.attackerId)
    if (gs.duel.result === 'goal') {
      setFlash(atk?.team ?? 1)
      // Show celebration with correct points
      const team = atk?.team ?? 1
      const currentStreak = team === 1 ? gs.streak1 : gs.streak2
      const isStreakBonus = currentStreak === 1 // They had 1 streak, this is the 2nd goal
      const points = isStreakBonus ? 20 : 10
      setCelebration({ team, points, isStreakBonus })
    }
    const t = setTimeout(() => {
      setFlash(null)
      emit({ kind: 'DRESET' })
    }, 3000)
    return () => clearTimeout(t)
  }, [gs.duel?.phase, emit]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Combat reveal → reset spin UI (turn ends via COMBAT_REVEAL_COMPLETE) ─ */
  useEffect(() => {
    if (gs.combat?.phase !== 'reveal') return
    const t = setTimeout(() => {
      setSpinning(false)
      setSpin(0)
    }, 3000)
    return () => clearTimeout(t)
  }, [gs.combat?.phase])

  /* ── Deploy cells ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (dpType && gs.phase === 'deployment')
      setDpCells(new Set(deployable(gs.pieces, myTeam, dpType)))
    else
      setDpCells(new Set())
  }, [dpType, gs.pieces, gs.phase, myTeam])

  useEffect(() => {
    const piece = gs.pieces.find(item => item.id === bludgerMode)
    if (!piece || piece.bludgerUsed || gs.phase !== 'match') {
      setBludgerCells(new Set())
      return
    }
    setBludgerCells(new Set(bludgerTargetIds(gs.pieces, piece)))
  }, [bludgerMode, gs.pieces, gs.phase])

  useEffect(() => {
    if (!gs.bludger || gs.bludger.phase !== 'traveling') return
    const attacker = gs.pieces.find(piece => piece.id === gs.bludger!.attackerId)
    if (!attacker || attacker.team !== myTeam) return
    const timer = setTimeout(() => emit({ kind: 'BLUDGER_READY' }), 700)
    return () => clearTimeout(timer)
  }, [gs.bludger?.phase, gs.bludger?.attackerId, gs.pieces, myTeam, emit]) // eslint-disable-line react-hooks/exhaustive-deps -- action payload is stable for its phase

  useEffect(() => {
    if (!gs.bludger || gs.bludger.phase !== 'choosing' || gs.bludger.hitIds.length > 1) return
    const attacker = gs.pieces.find(piece => piece.id === gs.bludger!.attackerId)
    if (!attacker || attacker.team !== myTeam) return
    const timer = setTimeout(() => emit({ kind: 'BLUDGER_RESOLVE', targetId: gs.bludger!.hitIds[0] }), 500)
    return () => clearTimeout(timer)
  }, [gs.bludger?.phase, gs.bludger?.hitIds, gs.bludger?.attackerId, gs.pieces, myTeam, emit]) // eslint-disable-line react-hooks/exhaustive-deps -- action payload is stable for its phase

  /* ── Derived ──────────────────────────────────────────────────────────── */
  const myDone    = myTeam === 1 ? gs.d1 : gs.d2
  const myD       = cnt(gs.pieces, myTeam, 'D')
  const myA       = cnt(gs.pieces, myTeam, 'A')
  const myS       = cnt(gs.pieces, myTeam, 'S')
  const canFinish = myD >= 2 && myA >= 3 && myS >= 1 && !myDone
  // Brooms are valid only when each speed is assigned exactly BROOM_LIMITS[spd] times
  const broomsOk  = canFinish && ASSIGNABLE_SPEEDS.every(spd =>
    gs.pieces.filter(p => p.team === myTeam && p.type !== 'GK' && p.broomSpeed === spd).length === BROOM_LIMITS[spd]
  )
  const canDeploy = teamIdentityReady && canFinish && broomsOk
  const selectedPiece = selId ? gs.pieces.find(piece => piece.id === selId) : null
  const selectedDefenderCanBludger = teamIdentityReady && selectedPiece?.type === 'D' && !selectedPiece.bludgerUsed && gs.phase === 'match' && gs.turn === myTeam

  const duelAtk      = gs.duel ? gs.pieces.find(p => p.id === gs.duel!.attackerId) : null
  const combatAtk    = gs.combat ? gs.pieces.find(p => p.id === gs.combat!.attackerId) : null
  const iAmAttacker  = duelAtk?.team === myTeam
  const iAmCombatAtk = combatAtk?.team === myTeam

  // Derive myChoice purely from gs to prevent sync overwrites causing stuck states
  const myChoice     = gs.duel ? (myTeam === 1 ? gs.duel.t1Choice : gs.duel.t2Choice) : null
  const oppHasChosen = gs.duel && (myTeam === 1 ? gs.duel.t2Choice : gs.duel.t1Choice) !== null

  /* ── Handlers ─────────────────────────────────────────────────────────── */
  function clickPiece(p: Piece) {
    if (isSpectator || !teamIdentityReady) return
    if (gs.duel || gs.combat || gs.bludger || gs.phase !== 'match') return
    
    // CRITICAL: Block all piece selection while attacker scoring choice UI is shown
    if (gs.attackerScoringChoice) {
      console.log('[CLICK PIECE] Cannot select pieces while attacker scoring choice is pending')
      return
    }
    
    if (bludgerMode) {
      if (bludgerCells.has(p.id)) {
        emit({ kind: 'BLUDGER_FIRE', pieceId: bludgerMode, col: p.col, row: p.row })
        setSel(null); setMoves(new Set()); setBludgerMode(null)
      }
      return
    }
    if (p.team !== myTeam || gs.turn !== myTeam) return
    if ((p.disabledUntilTurn ?? -1) >= gs.turnCount) return
    
    // CRITICAL: Block seeker selection during bonus move
    if (gs.seekerBonusMoveActive && p.type === 'S') {
      console.log('[CLICK PIECE] Seeker cannot be moved during bonus turn')
      return
    }
    
    // CRITICAL: Block selecting any piece that was just moved (disabled until next turn)
    if ((p.disabledUntilTurn ?? -1) >= gs.turnCount) {
      console.log('[CLICK PIECE] Piece is disabled until next turn')
      return
    }
    
    // If attacker is ready to shoot, don't show normal movement - SHOOT button will be shown separately
    if (p.readyToShoot && p.type === 'A') {
      console.log('[CLICK PIECE] Attacker is ready to shoot, SHOOT button will be shown')
      setSel(p.id)
      setMoves(new Set())  // No movement options when ready to shoot
      return
    }
    
    console.log('[CLICK PIECE] Selecting piece:', p.id, 'type:', p.type, 'seekerBonusMoveActive:', gs.seekerBonusMoveActive)
    if (selId === p.id) { setSel(null); setMoves(new Set()); setBludgerMode(null); return }
    setBludgerMode(null)
    setSel(p.id)
    setMoves(new Set(movable(gs.pieces, p)))
  }

  function clickCell(col: Col, row: number) {
    if (isSpectator) return
    const k = `${col}${row}`
    if (gs.phase === 'deployment' && !myDone && dpType && deployable(gs.pieces, myTeam, dpType).includes(k)) {
      // Check current count BEFORE placing
      const currentCount = cnt(gs.pieces, myTeam, dpType)
      
      // Don't allow placement if limit already reached
      if (currentCount >= MAX[dpType]) {
        console.log(`[DEPLOY] Cannot place ${dpType}: limit ${MAX[dpType]} already reached`)
        setDpType(null)
        return
      }
      
      // Place piece
      const id = `${myTeam}-${dpType}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      emit({ kind: 'PLACE', id, team: myTeam, pt: dpType, col, row })
      
      // Auto-deselect when limit will be reached after this placement
      if (currentCount + 1 >= MAX[dpType]) setDpType(null)
      return
    }
    if (gs.phase === 'match' && selId && moves.has(k)) {
      // Move piece
      emit({ kind: 'MOVE', pid: selId, col, row })
      setMoves(new Set())
      setSel(null)
    }
  }

  function chooseDuel(c: Choice) {
    if (isSpectator) return
    if (myChoice) return
    emit({ kind: 'DUEL', team: myTeam, choice: c })
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BROOM PANEL RENDERER
  ═══════════════════════════════════════════════════════════════════════ */

  function renderBroomPanel(team: Team) {
    const allPieces = gs.pieces.filter(p => p.team === team)
    const nonGK = allPieces.filter(p => p.type !== 'GK')
    if (nonGK.length === 0) return null

    const teamColor = team === 1 ? 'purple' : 'amber'

    // How many of each speed are currently in use by this team's non-GK pieces
    const used = (spd: BroomSpeed) => nonGK.filter(p => p.broomSpeed === spd).length
    const remaining = (spd: BroomSpeed) => BROOM_LIMITS[spd] - used(spd)

    const canAssign = (piece: Piece, spd: BroomSpeed) => {
      if (piece.broomSpeed === spd) return true  // already this speed — always ok
      return remaining(spd) > 0
    }

    const SPD_CONFIG: Record<BroomSpeed, { label: string; color: string; bg: string; activeBg: string; glow: string }> = {
      0: { label: '0', color: 'text-slate-500', bg: 'border-slate-700', activeBg: 'bg-slate-700', glow: '' },
      1: { label: '1', color: 'text-sky-400',   bg: 'border-sky-700',   activeBg: 'bg-sky-800/80',   glow: 'shadow-[0_0_8px_rgba(56,189,248,0.5)]' },
      2: { label: '2', color: 'text-emerald-400', bg: 'border-emerald-700', activeBg: 'bg-emerald-800/80', glow: 'shadow-[0_0_8px_rgba(52,211,153,0.5)]' },
      3: { label: '3', color: 'text-orange-400', bg: 'border-orange-700', activeBg: 'bg-orange-800/80', glow: 'shadow-[0_0_8px_rgba(251,146,60,0.5)]' },
      4: { label: '4★', color: 'text-amber-300', bg: 'border-amber-500', activeBg: 'bg-amber-500/30', glow: 'shadow-[0_0_10px_rgba(251,191,36,0.7)]' },
    }

    const typeName = (pt: PieceType) => pt === 'D' ? 'Def' : pt === 'A' ? 'Atk' : 'Skr'

    return (
      <div className="mt-3 pt-3 border-t border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <p className="font-black text-xs tracking-widest text-slate-300">🧹 BROOMS</p>
          {!isCaptain && (
            <span className="text-xs text-slate-500 italic">Captain only</span>
          )}
        </div>

        {/* Inventory bar */}
        <div className="flex gap-1.5 mb-3 px-0.5">
          {ASSIGNABLE_SPEEDS.map(spd => {
            const rem = remaining(spd)
            const cfg = SPD_CONFIG[spd]
            return (
              <div key={spd} className={`flex-1 text-center rounded-lg py-1 border ${rem > 0 ? cfg.bg : 'border-slate-800'} ${rem > 0 ? 'bg-white/5' : 'opacity-30'}`}>
                <div className={`text-xs font-black ${rem > 0 ? cfg.color : 'text-slate-600'}`}>{cfg.label}</div>
                <div className={`text-[10px] font-bold ${rem > 0 ? 'text-slate-400' : 'text-slate-700'}`}>×{rem}</div>
              </div>
            )
          })}
        </div>

        {/* GK row — locked */}
        <div className="flex items-center justify-between mb-1.5 px-1 py-1 rounded-lg bg-slate-900/40">
          <div className="flex items-center gap-2 text-xs">
            <PieceShape type="GK" team={team} selected={false} size={20} />
            <span className="text-slate-400 font-semibold">GK</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <span>🔒</span>
            <span className="font-bold bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5">Spd 0</span>
          </div>
        </div>

        {/* Piece rows */}
        <div className="space-y-1">
          {nonGK.map(p => {
            const cur = p.broomSpeed  // always fresh — lives on the piece
            return (
              <div key={p.id} className={`flex items-center justify-between px-1 py-1 rounded-lg bg-slate-900/40 border border-transparent hover:border-white/10 transition-all`}>
                {/* Piece info */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <PieceShape type={p.type} team={team} selected={false} size={20} />
                  <div className="text-xs leading-tight min-w-0">
                    <div className={`font-bold ${teamColor === 'purple' ? 'text-purple-300' : 'text-amber-300'}`}>{typeName(p.type)}</div>
                    <div className="text-slate-500 font-mono">{p.col}{p.row}</div>
                  </div>
                </div>

                {/* Speed selector */}
                <div className="flex gap-0.5 shrink-0">
                  {ASSIGNABLE_SPEEDS.map(spd => {
                    const ok = canAssign(p, spd)
                    const active = cur === spd
                    const cfg = SPD_CONFIG[spd]
                    return (
                      <button
                        key={spd}
                        disabled={!isCaptain || (!ok && !active)}
                        onClick={() => isCaptain && ok && emit({ kind: 'ASSIGN_BROOM', pieceId: p.id, speed: spd })}
                        title={spd === 4 ? '⚡ Speed 4 — jumps 2 squares!' : `Speed ${spd} — 1 square`}
                        className={`
                          w-7 h-6 rounded text-[11px] font-black border transition-all duration-100
                          ${active
                            ? `${cfg.activeBg} border-white/40 ${cfg.color} ${cfg.glow} scale-110`
                            : !ok || !isCaptain
                              ? 'border-slate-800 text-slate-700 cursor-not-allowed'
                              : `bg-transparent ${cfg.bg} ${cfg.color} opacity-60 hover:opacity-100 hover:scale-105 cursor-pointer`
                          }
                        `}
                      >
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Speed 4 tip */}
        <p className="text-[10px] text-slate-600 text-center mt-2 leading-tight">
          ⚡ Speed <span className="text-amber-500 font-bold">4★</span> jumps 2 squares (skips over pieces)
        </p>

        {/* Broom validity warning — shown when all pieces placed but assignment is wrong */}
        {canFinish && (() => {
          const issues = ASSIGNABLE_SPEEDS.map(spd => {
            const have = nonGK.filter(p => p.broomSpeed === spd).length
            const need = BROOM_LIMITS[spd]
            return have !== need ? { spd, have, need } : null
          }).filter(Boolean) as { spd: BroomSpeed; have: number; need: number }[]
          if (issues.length === 0) return (
            <div className="mt-2 px-2 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-500/40 flex items-center gap-1.5">
              <span className="text-emerald-400 text-xs">✅</span>
              <span className="text-xs text-emerald-400 font-bold">Broom assignment valid!</span>
            </div>
          )
          return (
            <div className="mt-2 px-2 py-2 rounded-lg bg-red-950/70 border border-red-500/60">
              <p className="text-xs font-black text-red-400 mb-1">⚠️ Fix brooms before deploying</p>
              {issues.map(({ spd, have, need }) => (
                <p key={spd} className="text-[11px] text-red-300 leading-tight">
                  Speed {spd}: have <strong>{have}</strong>, need <strong>{need}</strong>
                </p>
              ))}
            </div>
          )
        })()}
      </div>
    )
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BOARD RENDERER (Vertical)
  ═══════════════════════════════════════════════════════════════════════ */

  function renderCell(col: Col, row: number, isGZ = false, gzTeam?: Team, width = cellWidth) {
    const k      = `${col}${row}`
    const pieces = gs.pieces.filter(p => {
      if (p.col !== col || p.row !== row) return false
      // HIDE opponent pieces during deployment so you only see your own plant (and the static GKs)
      if (gs.phase === 'deployment' && p.team !== myTeam && p.type !== 'GK') return false
      return true
    })
    
    const primary = pieces[0] ?? null
    const vMove  = moves.has(k)
    const vDep   = dpCells.has(k)
    const vBludger = pieces.some(piece => bludgerCells.has(piece.id))
    const pieceBase = Math.min(width, cellHeight)
    // Keep the Snitch visually prominent even on a crowded square. Its source
    // artwork is wide, so preserve its native aspect ratio rather than forcing
    // it into a tiny square.
    const snitchWidth = Math.min(168, Math.max(112, pieceBase * 1.05))
    const snitchHeight = Math.round(snitchWidth * 482 / 1024)

    let bg = 'bg-slate-800/40 border-slate-600/25'
    if (isGZ && gzTeam === 1) bg = 'bg-purple-950/70 border-purple-500/40'
    if (isGZ && gzTeam === 2) bg = 'bg-amber-950/70 border-amber-500/40'
    if (vMove && !primary)    bg = 'bg-indigo-500/25 border-indigo-400/80 cursor-pointer'
    if (vDep  && !primary)    bg = 'bg-emerald-500/20 border-emerald-400/70 cursor-pointer'
    if (vMove && primary)     bg = 'bg-indigo-500/25 border-indigo-400/80 cursor-pointer'
    if (vDep && primary)      bg = 'bg-emerald-500/20 border-emerald-400/70 cursor-pointer' 
    if (vBludger)             bg = 'bg-rose-500/25 border-rose-300/90 cursor-crosshair shadow-[0_0_18px_rgba(251,113,133,0.6)]'

    const stripe = (COLS.indexOf(col) + row) % 2 === 0 ? 'brightness-[1.05]' : ''

    return (
      <div
        key={k}
        className={`relative border-2 rounded-xl transition-all duration-200 ease-out ${bg} ${stripe} hover:brightness-110 hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-900`}
        style={{ width, height: cellHeight, flexShrink: 0 }}
        onMouseEnter={() => setHover(k)}
        onMouseLeave={() => setHover(null)}
        onClick={() => clickCell(col, row)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            clickCell(col, row)
          }
        }}
        tabIndex={vMove || vDep ? 0 : -1}
        role="button"
        aria-label={`${col} ${row}${vMove ? ' - available move' : ''}${vDep ? ' - deploy here' : ''}`}
      >
        {isGZ && !primary && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span style={{ fontSize: Math.min(width, cellHeight) * 0.3, opacity: 0.15 }}>🥅</span>
          </div>
        )}

        {vMove && !primary && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-6 h-6 rounded-full bg-indigo-400/80 animate-ping" />
          </div>
        )}

        {vDep && !primary && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-5 h-5 rounded-full bg-emerald-400/70 shadow-[0_0_10px_rgba(52,211,153,0.7)]" />
          </div>
        )}

        {vBludger && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <span className="text-xl animate-pulse drop-shadow-[0_0_8px_rgba(251,113,133,1)]">●</span>
          </div>
        )}

        {gs.bludger?.phase === 'traveling' && gs.bludger.target.col === col && gs.bludger.target.row === row && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <span className="text-3xl animate-bounce drop-shadow-[0_0_14px_rgba(244,63,94,1)]">●</span>
          </div>
        )}

        {hover === k && !primary && !vMove && !vDep && (
          <span className="absolute top-1 left-1.5 text-xs text-white/25 font-mono pointer-events-none">
            {k}
          </span>
        )}

        <div
          className="absolute inset-2 grid place-items-center gap-1 transition-all duration-300 ease-out"
          style={{
            gridTemplateColumns: `repeat(${pieces.length <= 2 ? pieces.length : pieces.length === 5 ? 3 : 2}, minmax(0, 1fr))`,
            gridTemplateRows: pieces.length <= 2 ? '1fr' : 'repeat(2, minmax(0, 1fr))',
          }}
        >
          {pieces.map((piece) => {
          const count = pieces.length
          // A compact grid retains a large, readable token instead of shrinking
          // every player into an unreadable side-by-side sliver.
          const pieceSize = count === 1
            ? Math.min(pieceBase * 0.72, 84)
            : count === 2
              ? Math.min(pieceBase * 0.62, 72)
              : count <= 4
                ? Math.min(pieceBase * 0.5, 58)
                : Math.min(pieceBase * 0.42, 50)
          return (
            <div
              key={piece.id}
              className="relative flex h-full w-full items-center justify-center transform transition-all duration-300 ease-out hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-400 rounded"
              onClick={e => {
                e.stopPropagation()
                // Every piece owns a separate side-by-side slot, including five-piece cells.
                if (vMove || vDep) clickCell(col, row)
                else clickPiece(piece)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  if (vMove || vDep) clickCell(col, row)
                  else clickPiece(piece)
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`${piece.type} for team ${piece.team} at ${col} ${row}${piece.disabledUntilTurn && (piece.disabledUntilTurn >= gs.turnCount) ? ' - frozen' : ''}`}
            >
              <PieceShape type={piece.type} team={piece.team} selected={selId === piece.id} size={pieceSize} broomSpeed={piece.broomSpeed} disabled={(piece.disabledUntilTurn ?? -1) >= gs.turnCount} />
              {(piece.disabledUntilTurn ?? -1) >= gs.turnCount && <span className="absolute top-1 text-xs animate-pulse">❄️</span>}
            </div>
          )
          })}
        </div>

        {/* Snitch icon */}
        {gs.snitchPhase === 'active' && gs.snitchPos?.col === col && gs.snitchPos?.row === row && (
          <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
            <div className="relative flex flex-col items-center">
              <Image
                src="/snitch.png"
                width={Math.min(cellWidth * 0.35, 50)}
                height={Math.min(cellWidth * 0.35, 50)}
                className="drop-shadow-[0_0_16px_rgba(251,191,36,1)] animate-bounce"
                alt="Golden Snitch"
                style={{ 
                  filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.8)) drop-shadow(0 0 16px rgba(251,191,36,0.6))',
                  animation: 'bounce 1s ease-in-out infinite'
                }}
              />
              <div className="absolute -bottom-6 px-2 py-0.5 rounded-full bg-amber-500/90 border border-amber-300">
                <span className="text-[8px] font-black tracking-[0.15em] text-slate-950">SNITCH</span>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const tc  = (t: Team) => t === 1 ? 'text-purple-400' : 'text-amber-400'

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white select-none overflow-hidden flex flex-col">
      <div className="fixed inset-0 pointer-events-none">
        <Image src="/quid.png" alt="" fill sizes="100vw" className="object-cover" priority />
        <div className="absolute inset-0 bg-slate-950/55" />
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/55 via-slate-900/25 to-slate-950/65" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(120,53,15,0.25),transparent)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_100%,rgba(88,28,135,0.3),transparent)]" />
      </div>

      <header className="relative z-10 shrink-0 flex items-center justify-between px-6 py-3 bg-black/60 border-b border-white/10 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-amber-500 shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
          <span className={`font-black text-xl ${tc(2)}`}>{t2Name}</span>
        </div>
        <div className="flex items-center gap-6 px-8">
          <AnimatedScore target={gs.s2} isFlash={scoreFlash === 2} tc={tc(2)} />
          <span className="text-slate-500 font-black text-3xl">:</span>
          <AnimatedScore target={gs.s1} isFlash={scoreFlash === 1} tc={tc(1)} />
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-black text-xl ${tc(1)}`}>{t1Name}</span>
          <div className="w-4 h-4 rounded-full bg-purple-500 shadow-[0_0_12px_rgba(168,85,247,0.8)]" />
          
          {/* Connection Status Indicator */}
        </div>
      </header>

      <div className="relative z-10 flex items-center justify-center gap-6 border-b border-amber-200/10 bg-black/25 px-4 py-1.5 text-xs font-bold">
        <span className="text-purple-200">{t1Name} streak: <strong className="text-white">{gs.streak1}/2</strong></span>
        <span className="text-amber-200">{t2Name} streak: <strong className="text-white">{gs.streak2}/2</strong></span>
        <span className="text-slate-400">Score 2 in a row for +10 bonus. Opponent scoring resets streak.</span>
      </div>

      {isSpectator && (
        <div className="relative z-20 flex items-center justify-center gap-3 border-b border-amber-300/30 bg-[#0e4a86]/70 px-4 py-2 text-center text-sm font-black tracking-[0.18em] text-amber-100 backdrop-blur-md">
          <span>SPECTATOR MODE</span>
          <span className="text-white/50">|</span>
          <span className="text-white/80">MATCH {roomCode}</span>
          <span className="text-white/50">|</span>
          <span className="normal-case font-semibold tracking-normal text-white/80">You are watching live — controls are read-only.</span>
        </div>
      )}

      <div className="relative z-10 shrink-0 text-center py-2 bg-black/30 border-b border-white/5 text-sm px-4 font-semibold">
        {gs.phase === 'deployment' && !myDone && (
          <span className="text-slate-300">⚔️ TACTICAL DEPLOYMENT — place your pieces, then click Deploy</span>
        )}
        {gs.phase === 'deployment' && myDone && !(myTeam === 1 ? gs.d2 : gs.d1) && (
          <span className="text-slate-400 animate-pulse">⏳ Waiting for {tn(myTeam === 1 ? 2 : 1)} to finish deployment…</span>
        )}
        {gs.phase === 'deployment' && gs.d1 && gs.d2 && (
          <span className="text-emerald-400 font-bold">✅ Both teams ready — {tn(gs.turn)} starts!</span>
        )}
        {gs.phase === 'match' && !gs.duel && !gs.combat && !gs.attackerScoringChoice && (
          <span className={`font-bold ${tc(gs.turn)}`}>
            {gs.turn === myTeam
              ? '⚡ YOUR TURN — select a piece, then click its destination'
              : `⏳ ${tn(gs.turn)}'s turn…`}
          </span>
        )}
        {gs.duel?.phase === 'choosing' && (
          <span className="text-white font-bold animate-pulse">⚡ GOAL DUEL IN PROGRESS</span>
        )}
        {gs.combat && (gs.combat.phase === 'spinning' || gs.combat.phase === 'spinning_anim') && (
          <span className="text-orange-400 font-bold animate-pulse">⚔️ COMBAT! — Team {gs.combat.atkTeam} vs Team {gs.combat.defTeam}</span>
        )}
        {gs.attackerScoringChoice && (() => {
          const atk = gs.pieces.find(p => p.id === gs.attackerScoringChoice)
          return atk && atk.team === myTeam && (
            <div className="flex flex-col items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300">
              <span className="text-amber-400 font-bold text-sm">
                🏆 COMBAT WON! Choose your action:
              </span>
              <div className="flex gap-3">
                <button
                  disabled={attackerChoicePendingRef.current}
                  onClick={() => {
                    if (attackerChoicePendingRef.current || !gs.attackerScoringChoice) return
                    attackerChoicePendingRef.current = true
                    emit({ kind: 'ATTACKER_CHOICE', choice: 'stay' })
                    setSel(null)
                    setMoves(new Set())
                  }}
                  className="rounded-lg border-2 border-blue-500/60 bg-blue-900/90 px-5 py-2 text-sm font-black text-blue-200 hover:bg-blue-800 hover:border-blue-400 transition-all shadow-lg disabled:opacity-50 disabled:pointer-events-none"
                >
                  🛡️ STAY IN POSITION
                </button>
                <button
                  disabled={attackerChoicePendingRef.current}
                  onClick={() => {
                    if (attackerChoicePendingRef.current || !gs.attackerScoringChoice) return
                    attackerChoicePendingRef.current = true
                    emit({ kind: 'ATTACKER_CHOICE', choice: 'score' })
                    setSel(null)
                    setMoves(new Set())
                  }}
                  className="rounded-lg border-2 border-amber-500/70 bg-amber-950/80 px-5 py-2 text-sm font-black text-amber-200 hover:bg-amber-800 hover:border-amber-400 transition-all shadow-lg shadow-amber-500/20 animate-pulse disabled:opacity-50 disabled:pointer-events-none"
                >
                  ⚽ SHOOT GOAL
                </button>
              </div>
            </div>
          )
        })()}
        {selId && (() => {
          const selectedPiece = gs.pieces.find(p => p.id === selId)
          return selectedPiece && selectedPiece.readyToShoot && selectedPiece.team === myTeam && gs.turn === myTeam && (
            <div className="flex flex-col items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-300">
              <span className="text-amber-400 font-bold text-sm">
                ⚽ READY TO SHOOT!
              </span>
              <button
                onClick={() => {
                  emit({ kind: 'ATTACKER_SHOOT', pieceId: selectedPiece.id })
                  setSel(null)
                  setMoves(new Set())
                }}
                className="rounded-lg border-2 border-amber-500/70 bg-amber-950/80 px-6 py-3 text-sm font-black text-amber-200 hover:bg-amber-800 hover:border-amber-400 transition-all shadow-lg shadow-amber-500/20 animate-pulse"
              >
                ⚽ SHOOT GOAL
              </button>
            </div>
          )
        })()}
      </div>

      {selectedDefenderCanBludger && !gs.bludger && (
        <div className="relative z-20 shrink-0 flex justify-center gap-2 bg-black/35 px-4 py-2">
          <button
            onClick={() => { setBludgerMode(null); setMoves(new Set(movable(gs.pieces, selectedPiece))) }}
            className="rounded-lg border border-slate-500/60 bg-slate-900/80 px-4 py-2 text-xs font-black text-slate-200 hover:bg-slate-800"
          >MOVE</button>
          <button
            onClick={() => { setMoves(new Set()); setBludgerMode(selectedPiece.id) }}
            className={`rounded-lg border px-4 py-2 text-xs font-black transition ${bludgerMode === selectedPiece.id ? 'border-rose-200 bg-rose-500 text-white shadow-[0_0_16px_rgba(244,63,94,0.7)]' : 'border-rose-400/70 bg-rose-950/80 text-rose-200 hover:bg-rose-800'}`}
          >● {isCaptain ? 'CAPTAIN BLUDGER' : 'BLUDGER'} · 1 LEFT</button>
        </div>
      )}

      <main className="relative z-10 flex-1 flex items-center justify-center p-4 gap-8 overflow-auto flex-col lg:flex-row">
        
        {/* ── Left/Bottom Panel (Purple - Team 1) ──────────────────────────── */}
        <aside className={`shrink-0 w-64 p-5 rounded-2xl border backdrop-blur-sm order-3 lg:order-1
          ${gs.phase === 'deployment' && !myDone && myTeam === 1
            ? 'bg-purple-500/10 border-purple-500/40'
            : 'bg-slate-900/40 border-slate-700/30'}`}>
          <p className="font-black text-base tracking-widest mb-4 text-purple-300 text-center">
            {myTeam === 1 ? '🟣 YOUR PIECES' : '🟣 PURPLE TEAM'}
          </p>
          {gs.phase === 'deployment' && !myDone && myTeam === 1 && (
            <>
              <div className="text-sm text-slate-500 mb-3 flex justify-between items-center">
                <span className="text-slate-300 font-bold">⬡ Goalkeeper</span>
                <span className="text-emerald-400">1/1 ✓</span>
              </div>
              {(['D', 'A', 'S'] as PieceType[]).map(pt => {
                const cur  = cnt(gs.pieces, 1, pt)
                const max  = MAX[pt]
                const full = cur >= max
                const lbl  = pt === 'D' ? 'Defender' : pt === 'A' ? 'Attacker' : 'Seeker'
                const hint = pt === 'D' ? 'Rows 4-5' : pt === 'A' ? 'Rows 2-5' : 'Any Row'
                return (
                  <button
                    key={pt}
                    disabled={full}
                    onClick={() => !full && setDpType(dpType === pt ? null : pt)}
                    className={`
                      w-full mb-3 px-4 py-3 rounded-xl text-base font-bold text-left border
                      transition-all duration-150 flex justify-between items-center
                      ${full
                        ? 'opacity-40 border-slate-700 cursor-not-allowed text-slate-500'
                        : dpType === pt
                          ? 'border-white bg-white/15 text-white scale-105 shadow-[0_0_12px_rgba(255,255,255,0.25)]'
                          : 'border-purple-500/30 text-purple-300/80 hover:text-white hover:border-purple-400 hover:bg-purple-500/10'}
                    `}
                  >
                    <div>
                      <div className="flex items-center gap-3">
                        <PieceShape type={pt} team={1} selected={false} size={24} />
                        <span>{lbl}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{hint}</div>
                    </div>
                    <span className={full ? 'text-emerald-400 text-sm' : 'text-slate-500 text-sm'}>{cur}/{max}</span>
                  </button>
                )
              })}
              {dpType && <p className="text-sm text-slate-400 mb-3 text-center animate-pulse">Click a cell to place</p>}

              {renderBroomPanel(1)}

              <button
                disabled={!canDeploy}
                onClick={() => canDeploy && emit({ kind: 'DDONE', team: myTeam })}
                className={`w-full py-4 rounded-xl text-base font-black transition-all duration-150 ${canDeploy ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.5)]' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
              >
                {canDeploy ? '✅ Deploy!' : canFinish ? '⚠️ Fix broom assignment' : 'Place all pieces'}
              </button>
            </>
          )}
          {gs.phase === 'match' && (
            <div className={`p-4 rounded-xl border ${gs.turn === 1 ? 'border-purple-400/60 bg-purple-500/10' : 'border-slate-700/30 bg-transparent'}`}>
              <p className="text-sm text-purple-300 font-bold mb-1 text-center">{t1Name}</p>
              <p className="text-5xl font-black text-purple-400 text-center">{gs.s1}</p>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-700/40 space-y-3 text-sm text-slate-500">
            <p className="font-black text-slate-400 text-sm mb-2 text-center">SHAPES</p>
            <div className="flex items-center justify-center gap-3"><PieceShape type="D" team={1} selected={false} size={24} /> <span>Defender</span></div>
            <div className="flex items-center justify-center gap-3"><PieceShape type="A" team={1} selected={false} size={24} /> <span>Attacker</span></div>
            <div className="flex items-center justify-center gap-3"><PieceShape type="S" team={1} selected={false} size={24} /> <span>Seeker</span></div>
          </div>
        </aside>

        {/* ══════════════════════════════════════════════════════════════
            VERTICAL PITCH
        ══════════════════════════════════════════════════════════════ */}
        <section className="flex flex-col items-center shrink-0 order-2">
          {/* Team 2 GZ (Top) */}
          <div className="flex justify-center mb-1">
            <p className={`text-sm font-black tracking-widest ${tc(2)}`}>
              ↓ {t2Name.toUpperCase()} ↓
            </p>
          </div>
          
          <div className="flex gap-1 mb-1" style={{ marginLeft: 28 }}>
            {COLS.map(col => (
              <div key={col} style={{ width: cellWidth }} className="text-center text-slate-500 font-mono font-bold text-sm">
                {col}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1 mb-1">
            <div className="w-6 text-center text-amber-500 font-black text-xs">GZ</div>
            {GOAL_ZONE_COLS.map(col => renderCell(col, 0, true, 2, (cellWidth * COLS.length) / GOAL_ZONE_COLS.length))}
          </div>

          {[1, 2, 3, 4, 5].map(row => (
            <div key={row} className="flex items-center gap-1 mb-1">
              <div className="w-6 text-right pr-1 text-slate-400 font-mono font-black text-lg">{row}</div>
              {COLS.map(col => renderCell(col, row))}
            </div>
          ))}

          <div className="flex items-center gap-1 mt-1">
            <div className="w-6 text-center text-purple-500 font-black text-xs">GZ</div>
            {GOAL_ZONE_COLS.map(col => renderCell(col, 6, true, 1, (cellWidth * COLS.length) / GOAL_ZONE_COLS.length))}
          </div>

          <div className="flex justify-center mt-2">
            <p className={`text-sm font-black tracking-widest ${tc(1)}`}>
              ↑ {t1Name.toUpperCase()} ↑
            </p>
          </div>
        </section>

        {/* ── Right/Top Panel (Yellow - Team 2) ─────────────────────────── */}
        <aside className={`shrink-0 w-64 p-5 rounded-2xl border backdrop-blur-sm order-1 lg:order-3
          ${gs.phase === 'deployment' && !myDone && myTeam === 2
            ? 'bg-amber-500/10 border-amber-500/40'
            : 'bg-slate-900/40 border-slate-700/30'}`}>
          <p className="font-black text-base tracking-widest mb-4 text-amber-300 text-center">
            {myTeam === 2 ? '🟡 YOUR PIECES' : '🟡 YELLOW TEAM'}
          </p>
          {gs.phase === 'deployment' && !myDone && myTeam === 2 && (
            <>
              <div className="text-sm text-slate-500 mb-3 flex justify-between items-center">
                <span className="text-slate-300 font-bold">⬡ Goalkeeper</span>
                <span className="text-emerald-400">1/1 ✓</span>
              </div>
              {(['D', 'A', 'S'] as PieceType[]).map(pt => {
                const cur  = cnt(gs.pieces, 2, pt)
                const max  = MAX[pt]
                const full = cur >= max
                const lbl  = pt === 'D' ? 'Defender' : pt === 'A' ? 'Attacker' : 'Seeker'
                const hint = pt === 'D' ? 'Rows 1-2' : pt === 'A' ? 'Rows 1-4' : 'Any Row'
                return (
                  <button
                    key={pt}
                    disabled={full}
                    onClick={() => !full && setDpType(dpType === pt ? null : pt)}
                    className={`
                      w-full mb-3 px-4 py-3 rounded-xl text-base font-bold text-left border
                      transition-all duration-150 flex justify-between items-center
                      ${full
                        ? 'opacity-40 border-slate-700 cursor-not-allowed text-slate-500'
                        : dpType === pt
                          ? 'border-white bg-white/15 text-white scale-105 shadow-[0_0_12px_rgba(255,255,255,0.25)]'
                          : 'border-amber-500/30 text-amber-300/80 hover:text-white hover:border-amber-400 hover:bg-amber-500/10'}
                    `}
                  >
                    <div>
                      <div className="flex items-center gap-3">
                        <PieceShape type={pt} team={2} selected={false} size={24} />
                        <span>{lbl}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">{hint}</div>
                    </div>
                    <span className={full ? 'text-emerald-400 text-sm' : 'text-slate-500 text-sm'}>{cur}/{max}</span>
                  </button>
                )
              })}
              {dpType && <p className="text-sm text-slate-400 mb-3 text-center animate-pulse">Click a cell to place</p>}

              {renderBroomPanel(2)}

              <button
                disabled={!canDeploy}
                onClick={() => canDeploy && emit({ kind: 'DDONE', team: myTeam })}
                className={`w-full py-4 rounded-xl text-base font-black transition-all duration-150 ${canDeploy ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-[0_0_20px_rgba(16,185,129,0.5)]' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
              >
                {canDeploy ? '✅ Deploy!' : canFinish ? '⚠️ Fix broom assignment' : 'Place all pieces'}
              </button>
            </>
          )}
          {gs.phase === 'match' && (
            <div className={`p-4 rounded-xl border ${gs.turn === 2 ? 'border-amber-400/60 bg-amber-500/10' : 'border-slate-700/30 bg-transparent'}`}>
              <p className="text-sm text-amber-300 font-bold mb-1 text-center">{t2Name}</p>
              <p className="text-5xl font-black text-amber-400 text-center">{gs.s2}</p>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-700/40 space-y-3 text-sm text-slate-500">
            <p className="font-black text-slate-400 text-sm mb-2 text-center">SHAPES</p>
            <div className="flex items-center justify-center gap-3"><PieceShape type="D" team={2} selected={false} size={24} /> <span>Defender</span></div>
            <div className="flex items-center justify-center gap-3"><PieceShape type="A" team={2} selected={false} size={24} /> <span>Attacker</span></div>
            <div className="flex items-center justify-center gap-3"><PieceShape type="S" team={2} selected={false} size={24} /> <span>Seeker</span></div>
          </div>
        </aside>
      </main>

      {/* ═══════════════════════════════════════════════════════════════════
          COMBAT OVERLAY
      ═══════════════════════════════════════════════════════════════════ */}
      {gs.bludger?.phase === 'choosing' && (() => {
        const attacker = gs.pieces.find(piece => piece.id === gs.bludger!.attackerId)
        const choices = gs.bludger!.hitIds.map(id => gs.pieces.find(piece => piece.id === id)).filter(Boolean) as Piece[]
        if (!attacker || attacker.team !== myTeam) return null
        if (choices.length < 2) {
          return <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-rose-400/60 bg-slate-950/95 px-5 py-3 text-sm font-bold text-rose-200">Bludger missed — ending turn…</div>
        }
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-rose-400/60 bg-slate-950 p-7 text-center shadow-[0_0_50px_rgba(244,63,94,0.35)]">
              <p className="mb-2 text-xs font-black tracking-[0.2em] text-rose-300">BLUDGER TARGET WHEEL</p>
              <h2 className="mb-6 text-2xl font-black text-white">Spin to choose the hit piece</h2>
              <div className="mx-auto mb-6 grid h-48 w-48 place-items-center rounded-full border-8 border-rose-500/70 bg-rose-950/50 shadow-[0_0_30px_rgba(244,63,94,0.5)]">
                <div className="grid grid-cols-2 gap-3">
                  {choices.map(piece => <div key={piece.id} className="rounded-lg border border-white/20 bg-black/40 px-3 py-2 text-sm font-black text-white">{piece.type}</div>)}
                </div>
              </div>
              <button onClick={() => emit({ kind: 'BLUDGER_RESOLVE', targetId: choices[randomIndex(choices.length)].id })} className="rounded-xl bg-rose-500 px-6 py-3 font-black text-white shadow-[0_0_18px_rgba(244,63,94,0.8)] hover:bg-rose-400">SPIN WHEEL</button>
            </div>
          </div>
        )
      })()}

      {gs.combat && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="text-center px-8 max-w-3xl w-full">
            {(gs.combat.phase === 'spinning' || gs.combat.phase === 'spinning_anim') && (
              <>
                <div className="text-5xl mb-2">⚔️</div>
                <h2 className="text-4xl font-black text-orange-400 mb-1 drop-shadow-[0_0_20px_rgba(251,146,60,0.6)]">COMBAT!</h2>

                {combatCountdown !== null && combatCountdown > 0 ? (
                  /* Countdown phase — big number only, no wheel yet */
                  <div className="py-12 flex flex-col items-center justify-center animate-in fade-in zoom-in duration-300">
                    <div className="text-[120px] font-black text-white leading-none drop-shadow-[0_0_40px_rgba(255,255,255,0.6)] animate-pulse">
                      {combatCountdown}
                    </div>
                    <p className="text-xl text-slate-400 font-bold tracking-widest uppercase mt-4">Get Ready!</p>
                  </div>
                ) : (
                  /* After countdown — VS badge + spinning wheel + legend */
                  <div className="animate-in fade-in zoom-in duration-500">
                    <div className="flex items-center justify-center gap-4 mb-5">
                      <div
                        className="px-4 py-2 rounded-xl font-black text-lg border-2"
                        style={{
                          color: gs.combat.atkTeam === 1 ? '#a855f7' : '#fbbf24',
                          borderColor: (gs.combat.atkTeam === 1 ? '#a855f7' : '#fbbf24') + '88',
                          background: (gs.combat.atkTeam === 1 ? '#a855f7' : '#fbbf24') + '15',
                        }}
                      >
                        Team {gs.combat.atkTeam} <span className="text-xs font-normal opacity-70">ATK</span>
                      </div>
                      <span className="text-slate-400 font-black text-2xl">vs</span>
                      <div
                        className="px-4 py-2 rounded-xl font-black text-lg border-2"
                        style={{
                          color: gs.combat.defTeam === 1 ? '#a855f7' : '#fbbf24',
                          borderColor: (gs.combat.defTeam === 1 ? '#a855f7' : '#fbbf24') + '88',
                          background: (gs.combat.defTeam === 1 ? '#a855f7' : '#fbbf24') + '15',
                        }}
                      >
                        Team {gs.combat.defTeam} <span className="text-xs font-normal opacity-70">DEF</span>
                      </div>
                    </div>

                    {(() => {
                      // ATK sections = attacker's broom speed (no bonus)
                      // DEF sections = defender's broom speed + 1 (defender advantage)
                      const ac = gs.combat.attackerSpeed
                      const dc = gs.combat.defenderSpeed
                      const secs = buildWheelSections(ac, dc)
                      const atkSlots = secs.filter(s => s === 'atk').length
                      const defSlots = secs.length - atkSlots
                      return (
                        <>
                          <CombatWheel
                            atkTeam={gs.combat.atkTeam}
                            defTeam={gs.combat.defTeam}
                            attackerSpeed={ac}
                            defenderSpeed={dc}
                            spinAngle={spinAngle}
                            spinning={spinning}
                          />
                          <div className="flex justify-center gap-8 mb-5 text-sm">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-sm" style={{ background: gs.combat.atkTeam === 1 ? '#a855f7' : '#fbbf24' }} />
                              <span className="text-slate-300">T{gs.combat.atkTeam} <strong className="text-white">ATK</strong> = {atkSlots}/{secs.length} sections (Spd {ac})</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-sm" style={{ background: gs.combat.defTeam === 1 ? '#a855f7' : '#fbbf24' }} />
                              <span className="text-slate-300">T{gs.combat.defTeam} <strong className="text-white">DEF</strong> = {defSlots}/{secs.length} sections (Spd {dc}+1)</span>
                            </div>
                          </div>
                        </>
                      )
                    })()}

                    <p className="text-orange-400 font-bold animate-pulse text-xl mt-4">
                      {spinning ? '🌀 Spinning...' : '🎲 Starting Spin...'}
                    </p>
                  </div>
                )}
              </>
            )}

            {gs.combat.phase === 'reveal' && gs.combat.result && (
              <>
                {gs.combat.result === 'win' ? (
                  <>
                    <div className="text-8xl mb-4">🏆</div>
                    <h2 className="text-6xl font-black text-emerald-400 mb-3 drop-shadow-[0_0_30px_rgba(52,211,153,0.8)]">
                      {iAmCombatAtk ? 'YOU WIN!' : 'YOU LOSE!'}
                    </h2>
                    <p className="text-slate-300 text-lg">{iAmCombatAtk ? '⚡ Attacker advances!' : '🔻 Attacker pushed through!'}</p>
                  </>
                ) : (
                  <>
                    <div className="text-8xl mb-4">🛡️</div>
                    <h2 className="text-6xl font-black text-red-400 mb-3 drop-shadow-[0_0_30px_rgba(248,113,113,0.8)]">
                      {iAmCombatAtk ? 'BLOCKED!' : 'DEFENDED!'}
                    </h2>
                    <p className="text-slate-300 text-lg">{iAmCombatAtk ? '⬅ Attacker retreats' : '✅ Defender holds the line!'}</p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          GOAL DUEL OVERLAY
      ═══════════════════════════════════════════════════════════════════ */}
      {gs.duel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="text-center px-8 max-w-md w-full">
            {gs.duel.phase === 'choosing' && (
              <>
                <div className="text-7xl mb-4 animate-bounce">⚽</div>
                <h2 className="text-5xl font-black text-white mb-2 drop-shadow-[0_0_25px_rgba(255,255,255,0.4)]">GOAL DUEL</h2>
                <p className={`text-base mb-8 font-semibold ${iAmAttacker ? 'text-orange-400' : 'text-sky-400'}`}>
                  {iAmAttacker ? '🏹 ATTACKER — choose your shot direction' : '🧤 GOALKEEPER — choose your dive direction'}
                </p>
                {!myChoice ? (
                  <div className="grid grid-cols-3 gap-4">
                    {(['LEFT', 'MIDDLE', 'RIGHT'] as Choice[]).map(c => (
                      <button
                        key={c}
                        onClick={() => chooseDuel(c)}
                        className={`py-8 rounded-2xl border-2 font-black text-lg transition-all duration-150 hover:scale-105 active:scale-95 ${
                          iAmAttacker
                            ? 'border-amber-500 bg-amber-500/15 text-amber-300 hover:bg-amber-500/30 shadow-[0_0_20px_rgba(251,191,36,0.2)]'
                            : 'border-purple-500 bg-purple-500/15 text-purple-300 hover:bg-purple-500/30 shadow-[0_0_20px_rgba(168,85,247,0.2)]'
                        }`}
                      >
                        <div className="text-3xl mb-2">{c === 'LEFT' ? '◀' : c === 'RIGHT' ? '▶' : '●'}</div>
                        <div className="text-sm">{c}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="py-10 text-slate-400">
                    <div className="text-5xl mb-3">✓</div>
                    <p className="text-lg">You chose <span className="text-white font-black">{myChoice}</span></p>
                    {oppHasChosen ? (
                      <p className="text-base mt-4 font-bold text-emerald-400 animate-pulse">✅ Opponent has locked in their choice!</p>
                    ) : (
                      <p className="text-sm mt-4 animate-pulse">⏳ Waiting for opponent…</p>
                    )}
                  </div>
                )}
              </>
            )}
            {gs.duel.phase === 'reveal' && (
              <>
                {gs.duel.result === 'goal' ? (
                  <>
                    <div className="text-9xl mb-3 animate-bounce">⚽</div>
                    <h2 className="text-7xl font-black mb-4" style={{ color: '#fbbf24', textShadow: '0 0 60px rgba(251,191,36,0.9), 0 0 120px rgba(251,191,36,0.4)' }}>GOAL!</h2>
                    <p className="text-4xl font-black text-emerald-400 mb-2">+{gs.streakBonusTeam ? 30 : 10} POINTS</p>
                    {gs.streakBonusTeam && (
                      <div className="mt-3 animate-bounce rounded-2xl border border-amber-200/80 bg-amber-400/15 px-5 py-3 text-2xl font-black text-amber-200 shadow-[0_0_32px_rgba(251,191,36,0.65)]">
                        GOAL STREAK! +20 BONUS
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-9xl mb-3">🧤</div>
                    <h2 className="text-7xl font-black mb-4" style={{ color: '#a855f7', textShadow: '0 0 60px rgba(168,85,247,0.9), 0 0 120px rgba(168,85,247,0.4)' }}>SAVED!</h2>
                  </>
                )}
                <div className="mt-4 py-3 px-5 bg-white/5 rounded-xl text-base text-slate-400">
                  <span>Shot: </span><span className="text-white font-black">{duelAtk?.team === 1 ? gs.duel.t1Choice : gs.duel.t2Choice}</span>
                  <span className="mx-3 text-slate-600">·</span>
                  <span>Dive: </span><span className="text-white font-black">{duelAtk?.team === 1 ? gs.duel.t2Choice : gs.duel.t1Choice}</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SNITCH OVERLAYS
      ═══════════════════════════════════════════════════════════════════ */}
      {gs.snitchPhase === 'appearing' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-amber-950/95 backdrop-blur-xl">
          <div className="text-center w-full px-4 relative z-[10000]">
            <div className="animate-in fade-in duration-500">
              <h1 className="text-5xl md:text-6xl font-serif italic font-black text-amber-300 drop-shadow-[0_0_40px_rgba(251,191,36,0.8)] animate-pulse tracking-wide">
                ✨ The Snitch Has Chosen to Appear ✨
              </h1>
              <p className="text-amber-100/70 mt-4 text-sm animate-pulse">Preparing the wheel...</p>
            </div>
          </div>
        </div>
      )}
      
      {gs.snitchPhase === 'spinning' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-amber-950/95 backdrop-blur-xl">
          <div className="text-center w-full px-4 relative z-[10000]">
            <div className="animate-in fade-in zoom-in duration-300">
              <h2 className="text-3xl font-black text-amber-300 mb-4 drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]">
                Where will it land?
              </h2>
              <SnitchWheel
                squares={snitchSquares.length > 0 ? snitchSquares : (gs.snitchSquares ?? [])}
                spinAngle={snitchSpinAngle}
                spinning={snitchSpinning}
              />
            </div>
          </div>
        </div>
      )}

      {gs.snitchPhase === 'encounter' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-amber-950/95 backdrop-blur-xl">
          <div className="text-center w-full px-4 relative z-[10000]">
            <div className="animate-in fade-in zoom-in duration-500">
              <h2 className="text-4xl font-black text-amber-300 mb-2 drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]" dir="rtl">
                {gs.snitchWheelContext === 'return' ? 'مصير السنيتش بعد الاختفاء' : 'مصير السنيتش بين يدي الباحث'}
              </h2>
              <p className="text-amber-100/80 mb-5" dir="rtl">
                {gs.snitchWheelContext === 'return' ? 'تثبت تعيدها إلى مكانها، وتتحرك تختار لها مربعاً جديداً.' : 'العجلة عشوائية تماماً في كل مرة.'}
              </p>
              <SnitchWheel
                squares={gs.snitchOutcomeLabels ?? []}
                spinAngle={gs.snitchOutcomeAngle ?? 0}
                spinning={gs.snitchOutcomeAngle !== undefined}
              />
            </div>
          </div>
        </div>
      )}

      {gs.snitchPhase === 'catching' && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-amber-950/95 backdrop-blur-xl">
          <div className="text-center w-full px-4 animate-in fade-in zoom-in duration-500 relative z-[10000]">
            <h2 className="mb-2 text-4xl font-black text-amber-300 drop-shadow-[0_0_20px_rgba(251,191,36,0.6)]">SEEKER CATCH-OFF</h2>
            <p className="mb-5 text-amber-100/80">Each wheel slot equals one broom-speed point.</p>
            <SnitchWheel
              squares={gs.snitchCatchLabels ?? []}
              spinAngle={gs.snitchCatchAngle ?? 0}
              spinning={gs.snitchCatchAngle !== undefined}
            />
          </div>
        </div>
      )}

      {gs.snitchPhase === 'hiding' && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-2xl border border-amber-300/30 bg-slate-950/90 px-6 py-3 text-center shadow-2xl">
          <div className="font-black text-amber-300" dir="rtl">اختفت السنيتش لمدة 4 حركات</div>
          <div className="text-sm text-slate-300">{4 - (gs.snitchHiddenMoves ?? 0)} moves until the fate wheel returns</div>
        </div>
      )}

      {gs.snitchPhase === 'caught' && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 backdrop-blur-2xl">
          <div className="text-center px-4 max-w-xl">
            <Image src="/snitch.png" width={192} height={192} className="mx-auto mb-8 h-48 w-48 animate-bounce drop-shadow-[0_0_80px_rgba(251,191,36,1)]" alt="Snitch" />
            <h1 className="text-6xl md:text-8xl font-black text-white mb-6 drop-shadow-xl tracking-tighter">
              TEAM {gs.s1 > gs.s2 ? '1' : gs.s1 < gs.s2 ? '2' : 'TIE'} WINS
            </h1>
            <p className="text-2xl text-amber-400 font-bold mb-8">
              A Seeker caught the Golden Snitch for +50 points — match complete!
            </p>
            {isCaptain && matchRecordStatus === 'saving' && (
              <p className="mb-6 text-sm font-bold text-slate-300">Saving the official match result...</p>
            )}
            {isCaptain && matchRecordStatus === 'saved' && (
              <p className="mb-6 text-sm font-bold text-emerald-300">Match result saved. Stats and achievements are updated.</p>
            )}
            {isCaptain && matchRecordStatus === 'error' && (
              <div className="mx-auto mb-6 max-w-xl rounded-2xl border border-rose-400/50 bg-rose-950/40 p-4 text-left">
                <p className="font-black text-rose-200">Match result still needs to be saved</p>
                <p className="mt-1 text-sm leading-6 text-rose-100/90">{matchRecordError}</p>
                <button
                  type="button"
                  onClick={() => {
                    setMatchRecordError(null)
                    setMatchRecordStatus('idle')
                    setMatchRecordAttempt(attempt => attempt + 1)
                  }}
                  className="mt-4 rounded-xl border border-rose-300/60 bg-rose-400/15 px-4 py-2 text-sm font-black text-rose-100 transition hover:bg-rose-400/25"
                >
                  Try saving again
                </button>
              </div>
            )}
            <div className="flex items-center justify-center gap-12 mt-12 bg-white/5 rounded-3xl p-8 border border-white/10">
              <div className="text-center">
                <div className="text-6xl font-black text-purple-400 mb-2">{gs.s1}</div>
                <div className="text-slate-400 font-bold">TEAM 1</div>
              </div>
              <div className="text-4xl text-slate-500 font-black">vs</div>
              <div className="text-center">
                <div className="text-6xl font-black text-amber-400 mb-2">{gs.s2}</div>
                <div className="text-slate-400 font-bold">TEAM 2</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Panel - Hidden on mobile/touch devices */}
      {gs.phase === 'match' && !isSpectator && (
        <div className="hidden lg:block fixed bottom-4 right-4 z-10 rounded-xl border border-slate-700/50 bg-slate-900/90 backdrop-blur-sm p-3 shadow-2xl max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-black text-slate-300">⌨️ KEYBOARD SHORTCUTS</h3>
          </div>
          <KeyboardHintGroup
            hints={[
              { keys: ['Tab'], action: 'Navigate pieces & cells' },
              { keys: ['Enter'], action: 'Select / Activate' },
              { keys: ['Space'], action: 'Select / Activate' },
              { keys: ['Esc'], action: 'Deselect piece' },
            ]}
            className="text-xs"
          />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SEEKER BONUS MOVE OVERLAY
      ═══════════════════════════════════════════════════════════════════ */}
      {gs.seekerBonusMoveActive && gs.turn === myTeam && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-red-900/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="text-center px-8 max-w-2xl w-full">
            <div className="bg-slate-900/95 border-4 border-red-500/60 rounded-3xl p-12 shadow-[0_0_60px_rgba(239,68,68,0.5)]">
              <div className="text-8xl mb-6 animate-bounce">⚡</div>
              <h2 className="text-6xl font-black text-white mb-4 drop-shadow-[0_0_25px_rgba(255,255,255,0.4)]">
                SEEKER MOVED!
              </h2>
              <p className="text-2xl text-red-400 font-bold mb-10">
                You have a bonus move. Choose your action:
              </p>
              <div className="flex gap-6 justify-center">
                <button
                  onClick={() => {
                    emit({ kind: 'END_BONUS_TURN' })
                    // Clear any piece selection immediately
                    setSel(null)
                    setMoves(new Set())
                  }}
                  className="px-10 py-6 rounded-2xl border-3 border-slate-500/80 bg-slate-800/90 text-slate-200 font-black text-xl hover:bg-slate-700 hover:border-slate-400 hover:scale-105 transition-all duration-200 shadow-xl"
                >
                  🏁 END TURN
                </button>
                <button
                  onClick={() => {
                    console.log('[BONUS MOVE] Clicking MOVE ANOTHER PIECE')
                    emit({ kind: 'SEEKER_CONTINUE' })
                    setSel(null)
                    setMoves(new Set())
                  }}
                  className="px-10 py-6 rounded-2xl border-3 border-emerald-500/80 bg-emerald-900/90 text-emerald-200 font-black text-xl hover:bg-emerald-800 hover:border-emerald-400 hover:scale-105 transition-all duration-200 shadow-xl shadow-emerald-500/30 animate-pulse"
                >
                  ⚡ MOVE ANOTHER PIECE
                </button>
              </div>
              <p className="text-sm text-slate-400 mt-6">
                Note: You cannot move the Seeker again during this bonus turn
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          ACHIEVEMENT TOAST NOTIFICATION
      ═══════════════════════════════════════════════════════════════════ */}
      {achievementToast && (
        <ToastNotification
          message={achievementToast.message}
          type={achievementToast.type}
          duration={5000}
          onClose={() => setAchievementToast(null)}
        />
      )}
    </div>
  )
}
