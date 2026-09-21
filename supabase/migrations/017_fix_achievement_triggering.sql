-- Fix achievement triggering after match wins
-- The record_match_result function was missing achievement evaluation calls

-- Update unlock_achievement with debugging
CREATE OR REPLACE FUNCTION unlock_achievement(p_user_id UUID, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_achievement_id UUID;
BEGIN
  RAISE NOTICE 'Attempting to unlock achievement % for user %', p_name, p_user_id;
  
  -- Get the achievement ID
  SELECT id INTO v_achievement_id FROM achievements WHERE name = p_name;
  
  IF v_achievement_id IS NULL THEN
    RAISE NOTICE 'Achievement % not found', p_name;
    RETURN;
  END IF;
  
  -- Insert the achievement
  INSERT INTO user_achievements (user_id, achievement_id)
  VALUES (p_user_id, v_achievement_id)
  ON CONFLICT (user_id, achievement_id) DO NOTHING;
  
  RAISE NOTICE 'Achievement unlock attempt completed for % (ID: %)', p_name, v_achievement_id;
END;
$$;

-- Update evaluate_game_achievements with debugging
CREATE OR REPLACE FUNCTION evaluate_game_achievements(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matches INTEGER := 0;
  v_wins INTEGER := 0;
  v_score INTEGER := 0;
  v_saves INTEGER := 0;
  v_team_matches INTEGER := 0;
  v_total_achievements INTEGER := 0;
BEGIN
  RAISE NOTICE 'Evaluating achievements for user %', p_user_id;
  
  SELECT
    COALESCE(SUM(matches), 0),
    COALESCE(SUM(wins), 0),
    COALESCE(SUM(total_score), 0),
    COALESCE(SUM(total_saves), 0),
    COALESCE(MAX(matches) FILTER (WHERE mode = 'team'), 0)
  INTO v_matches, v_wins, v_score, v_saves, v_team_matches
  FROM player_game_stats
  WHERE user_id = p_user_id;

  RAISE NOTICE 'User stats - Matches: %, Wins: %, Score: %, Saves: %, Team matches: %', 
    v_matches, v_wins, v_score, v_saves, v_team_matches;

  IF v_matches >= 1 THEN 
    RAISE NOTICE 'Unlocking First Flight for user %', p_user_id;
    PERFORM unlock_achievement(p_user_id, 'First Flight'); 
  END IF;
  
  IF v_wins >= 1 THEN 
    RAISE NOTICE 'Unlocking First Victory for user %', p_user_id;
    PERFORM unlock_achievement(p_user_id, 'First Victory'); 
  END IF;
  
  IF v_saves >= 10 THEN 
    PERFORM unlock_achievement(p_user_id, 'Keeper''s Wall'); 
  END IF;
  
  IF v_score >= 1000 THEN 
    PERFORM unlock_achievement(p_user_id, 'Chaser''s Glory'); 
  END IF;
  
  IF v_team_matches >= 10 THEN 
    PERFORM unlock_achievement(p_user_id, 'Team Player'); 
  END IF;
  
  IF v_wins >= 10 THEN 
    PERFORM unlock_achievement(p_user_id, 'Quidditch Champion'); 
  END IF;

  IF EXISTS (
    SELECT 1
    FROM match_results mr
    JOIN teams t ON t.room_id = mr.room_id AND t.team_number = mr.winner_team
    JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = p_user_id
      AND ((mr.winner_team = 1 AND mr.team2_score = 0) OR (mr.winner_team = 2 AND mr.team1_score = 0))
  ) THEN
    PERFORM unlock_achievement(p_user_id, 'Perfect Defense');
  END IF;

  -- Count total achievements excluding Legendary Wizard
  SELECT COUNT(*) INTO v_total_achievements
  FROM achievements
  WHERE name <> 'Legendary Wizard';

  -- Legendary Wizard is only awarded after every other seeded achievement.
  IF (SELECT COUNT(*) FROM user_achievements ua
      JOIN achievements a ON a.id = ua.achievement_id
      WHERE ua.user_id = p_user_id AND a.name <> 'Legendary Wizard')
     >= v_total_achievements THEN
    PERFORM unlock_achievement(p_user_id, 'Legendary Wizard');
  END IF;
  
  RAISE NOTICE 'Achievement evaluation completed for user %', p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION record_match_result(
  p_room_code TEXT,
  p_winner_team INTEGER,
  p_team1_score INTEGER,
  p_team2_score INTEGER,
  p_team1_saves INTEGER DEFAULT 0,
  p_team2_saves INTEGER DEFAULT 0,
  p_snitch_team INTEGER DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_room rooms%ROWTYPE;
  v_inserted UUID;
  v_user_id UUID;
BEGIN
  SELECT * INTO v_room FROM rooms WHERE room_code = upper(p_room_code) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Room not found');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id
    WHERE t.room_id = v_room.id AND tm.user_id = auth.uid()
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Not a room participant');
  END IF;

  INSERT INTO match_results (room_id, mode, winner_team, team1_score, team2_score, team1_saves, team2_saves, snitch_team)
  VALUES (v_room.id, v_room.mode, p_winner_team, p_team1_score, p_team2_score, p_team1_saves, p_team2_saves, p_snitch_team)
  ON CONFLICT (room_id) DO NOTHING
  RETURNING room_id INTO v_inserted;
  IF v_inserted IS NULL THEN
    RETURN json_build_object('success', true, 'already_recorded', true);
  END IF;

  INSERT INTO player_game_stats (user_id, mode, matches, wins, losses, total_score, total_saves)
  SELECT tm.user_id, v_room.mode, 1,
         CASE WHEN t.team_number = p_winner_team THEN 1 ELSE 0 END,
         CASE WHEN t.team_number = p_winner_team THEN 0 ELSE 1 END,
         CASE WHEN t.team_number = 1 THEN p_team1_score ELSE p_team2_score END,
         CASE WHEN t.team_number = 1 THEN p_team1_saves ELSE p_team2_saves END
  FROM team_members tm
  JOIN teams t ON t.id = tm.team_id
  WHERE t.room_id = v_room.id
  ON CONFLICT (user_id, mode) DO UPDATE SET
    matches = player_game_stats.matches + 1,
    wins = player_game_stats.wins + EXCLUDED.wins,
    losses = player_game_stats.losses + EXCLUDED.losses,
    total_score = player_game_stats.total_score + EXCLUDED.total_score,
    total_saves = player_game_stats.total_saves + EXCLUDED.total_saves,
    updated_at = timezone('utc', now());

  -- Evaluate achievements for all players in the match
  FOR v_user_id IN 
    SELECT tm.user_id 
    FROM team_members tm 
    JOIN teams t ON t.id = tm.team_id 
    WHERE t.room_id = v_room.id
  LOOP
    RAISE NOTICE 'Evaluating achievements for user: %', v_user_id;
    PERFORM evaluate_game_achievements(v_user_id);
  END LOOP;

  -- Award Golden Seeker achievement if Snitch was caught
  IF p_snitch_team IS NOT NULL THEN
    PERFORM unlock_achievement(tm.user_id, 'Golden Seeker')
    FROM team_members tm JOIN teams t ON t.id = tm.team_id
    WHERE t.room_id = v_room.id AND t.team_number = p_snitch_team
      AND (v_room.mode = 'solo' OR tm.position = 'seeker');
  END IF;

  -- Recheck achievements after Snitch award
  FOR v_user_id IN 
    SELECT tm.user_id 
    FROM team_members tm 
    JOIN teams t ON t.id = tm.team_id 
    WHERE t.room_id = v_room.id
  LOOP
    PERFORM evaluate_game_achievements(v_user_id);
  END LOOP;

  UPDATE rooms SET status = 'finished', updated_at = timezone('utc', now()) WHERE id = v_room.id;
  RETURN json_build_object('success', true, 'already_recorded', false);
END;
$$;

-- Ensure proper permissions are granted
REVOKE ALL ON FUNCTION record_match_result(TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION unlock_achievement(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION evaluate_game_achievements(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION record_match_result(TEXT, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION unlock_achievement(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION evaluate_game_achievements(UUID) TO authenticated;
