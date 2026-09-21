-- Fix achievement evaluation to properly count total achievements for Legendary Wizard
-- This ensures the 10/10 achievement properly unlocks Legendary Wizard

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
  SELECT
    COALESCE(SUM(matches), 0),
    COALESCE(SUM(wins), 0),
    COALESCE(SUM(total_score), 0),
    COALESCE(SUM(total_saves), 0),
    COALESCE(MAX(matches) FILTER (WHERE mode = 'team'), 0)
  INTO v_matches, v_wins, v_score, v_saves, v_team_matches
  FROM player_game_stats
  WHERE user_id = p_user_id;

  IF v_matches >= 1 THEN PERFORM unlock_achievement(p_user_id, 'First Flight'); END IF;
  IF v_wins >= 1 THEN PERFORM unlock_achievement(p_user_id, 'First Victory'); END IF;
  IF v_saves >= 10 THEN PERFORM unlock_achievement(p_user_id, 'Keeper''s Wall'); END IF;
  IF v_score >= 100 THEN PERFORM unlock_achievement(p_user_id, 'Chaser''s Glory'); END IF;
  IF v_team_matches >= 10 THEN PERFORM unlock_achievement(p_user_id, 'Team Player'); END IF;
  IF v_wins >= 10 THEN PERFORM unlock_achievement(p_user_id, 'Quidditch Champion'); END IF;

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
END;
$$;

-- Re-evaluate achievements for all existing players
DO $$
DECLARE
  v_user_id UUID;
BEGIN
  FOR v_user_id IN SELECT DISTINCT user_id FROM player_game_stats LOOP
    PERFORM evaluate_game_achievements(v_user_id);
  END LOOP;
END;
$$;
