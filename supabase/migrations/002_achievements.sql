-- Create achievements table
CREATE TABLE achievements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  icon TEXT NOT NULL,
  requirement TEXT NOT NULL,
  rarity TEXT DEFAULT 'common' CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()) NOT NULL
);

-- Enable RLS
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;

-- RLS Policies - achievements are public read-only
CREATE POLICY "Anyone can view achievements"
  ON achievements FOR SELECT
  USING (true);

-- Seed initial achievements
INSERT INTO achievements (name, description, icon, requirement, rarity) VALUES
('First Flight', 'Complete your first Quidditch match', '🧹', 'Complete 1 match', 'common'),
('First Victory', 'Win your first Quidditch match', '🏆', 'Win 1 match', 'common'),
('Keeper''s Wall', 'Block 10 shots as Keeper', '🛡️', 'Block 10 shots', 'rare'),
('Perfect Defense', 'Win a match without conceding any goals', '⭐', 'Zero goals conceded', 'epic'),
('Chaser''s Glory', 'Score 10 goals as Chaser', '⚡', 'Score 10 goals', 'rare'),
('Bludger Master', 'Hit 5 opponents with Bludgers', '🪨', 'Hit 5 opponents', 'rare'),
('Golden Seeker', 'Catch the Golden Snitch', '🥇', 'Catch Snitch', 'epic'),
('Team Player', 'Participate in 10 team matches', '🤝', '10 team matches', 'common'),
('Quidditch Champion', 'Win 10 matches', '👑', 'Win 10 matches', 'epic'),
('Legendary Wizard', 'Achieve all other achievements', '🌟', 'Unlock all achievements', 'legendary');
