-- =============================================================================
-- Migration 030: Captain-Only Piece Movement & Player Action Ownership
-- Adds server-side validated RPCs for:
--   1. claim_captain      — atomic captain transfer with race-condition safety
--   2. move_piece_captain_only — only the captain can save piece movement state
--   3. submit_player_action   — only the action-player can save their action
-- =============================================================================

-- =============================================================================
-- 1. claim_captain: Atomic captain claim with SELECT FOR UPDATE
-- =============================================================================
CREATE OR REPLACE FUNCTION claim_captain(p_team_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team teams%ROWTYPE;
  v_is_member BOOLEAN;
BEGIN
  -- Verify the caller is a member of this team
  SELECT EXISTS (
    SELECT 1 FROM team_members
    WHERE team_id = p_team_id AND user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not a member of this team.');
  END IF;

  -- Lock the teams row to prevent simultaneous captain claims (race-condition safety)
  SELECT * INTO v_team FROM teams WHERE id = p_team_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Team not found.');
  END IF;

  -- If already the captain, nothing to do
  IF v_team.captain_id = auth.uid() THEN
    RETURN jsonb_build_object('success', true, 'already_captain', true);
  END IF;

  -- Atomically transfer captaincy
  UPDATE teams
  SET captain_id = auth.uid()
  WHERE id = p_team_id;

  RETURN jsonb_build_object('success', true, 'previous_captain', v_team.captain_id);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_captain(UUID) TO authenticated;

-- =============================================================================
-- 2. move_piece_captain_only: Captain-gated game state save for piece movement
--    The frontend still uses save_quidditch_game_state for most actions,
--    but this RPC is used specifically for MOVE/PLACE/DDONE/ASSIGN_BROOM
--    so the backend can reject non-captains.
-- =============================================================================
CREATE OR REPLACE FUNCTION move_piece_captain_only(
  p_room_code TEXT,
  p_expected_revision INTEGER,
  p_game_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_room_id UUID;
  v_team_id UUID;
  v_captain_id UUID;
  v_state JSONB;
  v_revision INTEGER;
BEGIN
  -- Look up the room
  SELECT * INTO v_room FROM rooms WHERE room_code = upper(trim(p_room_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room not found.');
  END IF;
  IF v_room.status <> 'playing' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match is not active.');
  END IF;
  v_room_id := v_room.id;

  -- Verify the caller is a captain of one of the teams in this room
  SELECT t.id, t.captain_id INTO v_team_id, v_captain_id
  FROM teams t
  JOIN team_members tm ON tm.team_id = t.id
  WHERE t.room_id = v_room_id AND tm.user_id = auth.uid()
  LIMIT 1;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not a player in this room.');
  END IF;

  IF v_captain_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the team captain can move pieces.');
  END IF;

  -- Optimistic concurrency update
  SELECT game_state, revision INTO v_state, v_revision
  FROM quidditch_game_states WHERE room_id = v_room_id FOR UPDATE;

  IF v_revision IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Game state unavailable.');
  END IF;

  IF v_revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'game_state', v_state || jsonb_build_object('revision', v_revision)
    );
  END IF;

  UPDATE quidditch_game_states
  SET
    game_state = p_game_state - 'revision',
    revision   = revision + 1,
    updated_at = timezone('utc', now())
  WHERE room_id = v_room_id;

  RETURN jsonb_build_object('success', true, 'revision', v_revision + 1);
END;
$$;

GRANT EXECUTE ON FUNCTION move_piece_captain_only(TEXT, INTEGER, JSONB) TO authenticated;

-- =============================================================================
-- 3. submit_player_action: Only the designated action-player can save their action
--    Used for DUEL choices, keeper decisions, attacker choices, etc.
-- =============================================================================
CREATE OR REPLACE FUNCTION submit_player_action(
  p_room_code TEXT,
  p_action_player_id UUID,
  p_expected_revision INTEGER,
  p_game_state JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_room_id UUID;
  v_state JSONB;
  v_revision INTEGER;
  v_is_member BOOLEAN;
BEGIN
  -- The caller must be the declared action player
  IF auth.uid() <> p_action_player_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not the action player for this action.');
  END IF;

  -- Look up the room
  SELECT * INTO v_room FROM rooms WHERE room_code = upper(trim(p_room_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Room not found.');
  END IF;
  IF v_room.status <> 'playing' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Match is not active.');
  END IF;
  v_room_id := v_room.id;

  -- Verify the caller is a player in this room
  SELECT EXISTS (
    SELECT 1
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE t.room_id = v_room_id AND tm.user_id = auth.uid()
  ) INTO v_is_member;

  IF NOT v_is_member THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are not a player in this room.');
  END IF;

  -- Optimistic concurrency update
  SELECT game_state, revision INTO v_state, v_revision
  FROM quidditch_game_states WHERE room_id = v_room_id FOR UPDATE;

  IF v_revision IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Game state unavailable.');
  END IF;

  IF v_revision <> p_expected_revision THEN
    RETURN jsonb_build_object(
      'success', false,
      'conflict', true,
      'game_state', v_state || jsonb_build_object('revision', v_revision)
    );
  END IF;

  UPDATE quidditch_game_states
  SET
    game_state = p_game_state - 'revision',
    revision   = revision + 1,
    updated_at = timezone('utc', now())
  WHERE room_id = v_room_id;

  RETURN jsonb_build_object('success', true, 'revision', v_revision + 1);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_player_action(TEXT, UUID, INTEGER, JSONB) TO authenticated;

-- =============================================================================
-- 4. Update RLS on teams to allow any team member to update (for claim_captain)
--    The claim_captain RPC enforces security — RLS just needs to allow the row
--    to be touched by team members so the SECURITY DEFINER function can work.
-- =============================================================================
DROP POLICY IF EXISTS "Anyone can claim empty team captain" ON teams;
DROP POLICY IF EXISTS "Team members can update captain" ON teams;

-- Allow the RPC to update teams; the RPC itself enforces business logic
-- We keep the existing "Room creator and captains can update teams" policy
-- and add one for team members (needed for claim_captain to bypass RLS)
CREATE POLICY "Team members can update team"
  ON teams FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_id = teams.id AND user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM team_members
      WHERE team_id = teams.id AND user_id = auth.uid()
    )
  );

-- =============================================================================
-- 5. Reload PostgREST schema cache
-- =============================================================================
NOTIFY pgrst, 'reload schema';
