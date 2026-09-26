'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import MagicalBackground from '@/components/ui/MagicalBackground'
import MagicalCard from '@/components/ui/MagicalCard'
import MagicalNavbar from '@/components/ui/MagicalNavbar'
import MagicalButton from '@/components/ui/MagicalButton'
import PlayerAvatar from '@/components/ui/PlayerAvatar'
import PositionCard from '@/components/ui/PositionCard'
import LoadingMagic from '@/components/ui/LoadingMagic'
import LoadingSkeleton from '@/components/ui/LoadingSkeleton'
import ErrorMagic from '@/components/ui/ErrorMagic'
import { createClient } from '@/lib/supabase/client'

interface Profile {
  id: string
  magical_name: string
  house: 'gryffindor' | 'hufflepuff' | 'ravenclaw' | 'slytherin'
}

interface Room {
  id: string
  room_code: string
  mode: 'solo' | 'team'
  status: 'waiting' | 'ready' | 'playing' | 'finished'
  creator_id: string
  starting_team?: 1 | 2 | null
}

interface Team {
  id: string
  team_number: number
  captain_id: string | null
  ready: boolean
  name?: string | null
}

interface TeamMember {
  id: string
  team_id: string
  user_id: string
  position: string | null
  profiles: {
    magical_name: string
    house: 'gryffindor' | 'hufflepuff' | 'ravenclaw' | 'slytherin'
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAGICAL COIN FLIP COMPONENT - For Room Lobby
═══════════════════════════════════════════════════════════════════════════ */

const MagicalCoin = React.memo(function MagicalCoin({
  result,
  flipping,
  t1Name,
  t2Name,
}: {
  result: 1 | 2  // 1 = Purple, 2 = Yellow
  flipping: boolean
  t1Name: string
  t2Name: string
}) {
  const coinRef = React.useRef<HTMLDivElement>(null)
  const [showResult, setShowResult] = React.useState(false)

  React.useEffect(() => {
    if (!flipping) return
    
    console.log('[COIN] Animation started, result:', result, '(', result === 1 ? 'PURPLE' : 'YELLOW', ')')
    
    const duration = 4000 // 4 seconds total
    const startTime = performance.now()
    let raf: number
    
    // Three-phase coin flip physics
    function ease(t: number): number {
      if (t < 0.15) {
        const p = t / 0.15
        return 0.15 * (1 - (1 - p) * (1 - p))
      } else if (t < 0.75) {
        return 0.15 + (t - 0.15) * 0.7 / 0.6
      } else {
        const p = (t - 0.75) / 0.25
        return 0.85 + 0.15 * (1 - Math.pow(1 - p, 3))
      }
    }
    
    const frame = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1)
      const eased = ease(progress)
      
      if (coinRef.current) {
        const baseRotations = 4
        // Front face (0°) = Purple, Back face (180°) = Yellow
        // If result is 1 (Purple), land on 0°
        // If result is 2 (Yellow), land on 180°
        const targetRotation = result === 1 ? 0 : 180
        const totalRotation = baseRotations * 360 + targetRotation
        const currentRotation = eased * totalRotation
        const lift = Math.sin(eased * Math.PI) * 100
        
        coinRef.current.style.transform = `translateY(-${lift}px) rotateY(${currentRotation}deg)`
        console.log('[COIN] Progress:', progress.toFixed(2), 'Rotation:', currentRotation.toFixed(0), 'Target:', targetRotation, 'Result:', result, '(', result === 1 ? 'PURPLE' : 'YELLOW', ')', 'Will show:', currentRotation % 360 === 0 ? 'PURPLE' : 'YELLOW')
      }
      
      if (progress < 1) {
        raf = requestAnimationFrame(frame)
      } else {
        console.log('[COIN] Animation completed, showing result:', result === 1 ? 'PURPLE' : 'YELLOW')
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
            
            <div className="relative mx-auto" style={{ perspective: '1000px', width: 300, height: 300 }}>
              <div
                ref={coinRef}
                className="absolute inset-0 mx-auto"
                style={{
                  width: 200,
                  height: 200,
                  transformStyle: 'preserve-3d',
                }}
              >
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
            <div className="mt-4 text-xs text-slate-600">
              Coin result: {result} ({result === 1 ? 'Purple (Team 1)' : 'Yellow (Team 2)'})
            </div>
          </div>
        )}
      </div>
    </div>
  )
})

export default function RoomPage() {
  const router = useRouter()
  const params = useParams()
  const roomCode = params.roomCode as string
  
  const [profile, setProfile] = useState<Profile | null>(null)
  const [room, setRoom] = useState<Room | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [selectedTeam, setSelectedTeam] = useState<number | null>(null)
  const [selectedPosition, setSelectedPosition] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [animationState, setAnimationState] = useState<'none' | 'vs' | 'coinFlip' | 'fadeOut' | 'blackScreen'>('none')
  const [localTeamNames, setLocalTeamNames] = useState<Record<string, string>>({})
  const [coinFlipResult, setCoinFlipResult] = useState<1 | 2 | null>(null)
  const [coinFlipping, setCoinFlipping] = useState(false)
  const [syncedCoinResult, setSyncedCoinResult] = useState<1 | 2 | null>(null)

  const supabase = createClient()

  useEffect(() => {
    loadRoomData()
    const cleanup = setupRealtimeSubscription()

    return () => {
      cleanup()
    }
  }, [roomCode]) // eslint-disable-line react-hooks/exhaustive-deps -- resubscribe only when the room changes

  useEffect(() => {
    if (!room || !profile || animationState !== 'none') return

    const myTeamMember = teamMembers.find(tm => tm.user_id === profile.id)
    const myTeam = teams.find(team => team.id === myTeamMember?.team_id)
    const t1 = teams.find(team => team.team_number === 1)
    const t2 = teams.find(team => team.team_number === 2)
    const gameParams = new URLSearchParams({
      team: String(myTeam?.team_number ?? 1),
      t1: t1?.name || 'Team 1',
      t2: t2?.name || 'Team 2',
      captain: String(room.mode === 'solo' || myTeam?.captain_id === profile.id),
      starter: String(room.starting_team === 2 ? 2 : 1),
      h1: teamMembers.filter(tm => teams.find(t => t.id === tm.team_id)?.team_number === 1).map(tm => tm.profiles.house).join(','),
      h2: teamMembers.filter(tm => teams.find(t => t.id === tm.team_id)?.team_number === 2).map(tm => tm.profiles.house).join(','),
    })

    // A room code can be shared after kickoff. Route non-members into the
    // same real-time game channel as read-only spectators instead of leaving
    // them in a ready lobby that they can no longer join.
    if (room.status === 'playing') {
      if (!myTeamMember) gameParams.set('spectator', 'true')
      router.replace(`/game/${roomCode}?${gameParams.toString()}`)
      return
    }

    const bothReady = teams.length === 2 && teams.every(t => t.ready)
    if (bothReady && myTeamMember) {
      void (async () => {
        const { data, error: startError } = await supabase.rpc('begin_quidditch_match', {
          p_room_code: roomCode,
        })
        if (startError || !data?.success) {
          setError(data?.error || startError?.message || 'Unable to start the match.')
          return
        }
        
        // Use server-side authoritative random starter (50/50)
        const serverStarter: 1 | 2 = data?.starting_team ?? 1
        console.log('[COIN FLIP] Server returned starting_team:', serverStarter, '(1=Purple, 2=Yellow)')
        console.log('[COIN FLIP] Full data:', data)
        // TEMPORARY FIX: Invert the result to match the visual
        // Remove this once the server logic is fixed
        const correctedStarter = serverStarter === 1 ? 2 : 1
        console.log('[COIN FLIP] Using corrected starter:', correctedStarter, '(inverted from server)')
        setCoinFlipResult(correctedStarter)

        // Broadcast coin flip result to all clients via realtime
        const channelName = `room:${roomCode}-${Math.random()}`
        const broadcastChannel = supabase.channel(channelName)
        broadcastChannel.send({
          type: 'broadcast',
          event: 'coin_flip',
          payload: { result: serverStarter }
        })
        supabase.removeChannel(broadcastChannel)

        // Show VS screen first, then coin flip
        setAnimationState('vs')
        setTimeout(() => {
          setAnimationState('coinFlip')
          setCoinFlipping(true)
          
          // After 7 seconds (4s flip + 3s result), navigate to game
          setTimeout(() => {
            setAnimationState('fadeOut')
            setTimeout(() => {
            setAnimationState('blackScreen')
            setTimeout(() => {
            // Find my team number
            const myTeamMember = teamMembers.find(tm => tm.user_id === profile?.id)
            const myTeamId = myTeamMember?.team_id
            const myTeam = teams.find(t => t.id === myTeamId)
            const myTeamNumber = myTeam?.team_number || 1
            
            const t1 = teams.find(t => t.team_number === 1)
            const t2 = teams.find(t => t.team_number === 2)
            const t1Name = t1?.name || 'Team 1'
            const t2Name = t2?.name || 'Team 2'
            
            // Solo mode: always captain. Team mode: captain if this player is the team captain.
            const isSoloMode = room?.mode === 'solo'
            const amICaptain = isSoloMode || myTeam?.captain_id === profile?.id
            
            // Navigate to game with starter parameter from coin flip result
            const finalStarter = coinFlipResult || syncedCoinResult || 1
            console.log('[NAVIGATE] Going to game with starter:', finalStarter, '(1=Purple, 2=Yellow)')
            console.log('[NAVIGATE] coinFlipResult:', coinFlipResult, 'syncedCoinResult:', syncedCoinResult)
            const h1Houses = teamMembers.filter(tm => teams.find(t => t.id === tm.team_id)?.team_number === 1).map(tm => tm.profiles.house).join(',')
            const h2Houses = teamMembers.filter(tm => teams.find(t => t.id === tm.team_id)?.team_number === 2).map(tm => tm.profiles.house).join(',')
            router.push(`/game/${roomCode}?team=${myTeamNumber}&t1=${encodeURIComponent(t1Name)}&t2=${encodeURIComponent(t2Name)}&captain=${amICaptain}&starter=${finalStarter}&h1=${encodeURIComponent(h1Houses)}&h2=${encodeURIComponent(h2Houses)}`)
          }, 1000)  // Short delay after fadeout
        }, 500)  // Fadeout duration
      }, 7000)  // 7 seconds for coin flip (4s animation + 3s result)
      }, 1000)  // 1 second VS screen
      })()
    }
  }, [teams, animationState, profile, teamMembers, router, room, roomCode, supabase])

  // Handle synced coin flip result from other clients
  useEffect(() => {
    if (syncedCoinResult && animationState === 'none') {
      setCoinFlipResult(syncedCoinResult)
      setAnimationState('vs')
      setTimeout(() => {
        setAnimationState('coinFlip')
        setCoinFlipping(true)

        setTimeout(() => {
          setAnimationState('fadeOut')
          setTimeout(() => {
            setAnimationState('blackScreen')
            setTimeout(() => {
              const myTeamMember = teamMembers.find(tm => tm.user_id === profile?.id)
              const myTeamId = myTeamMember?.team_id
              const myTeam = teams.find(t => t.id === myTeamId)
              const myTeamNumber = myTeam?.team_number || 1

              const t1 = teams.find(t => t.team_number === 1)
              const t2 = teams.find(t => t.team_number === 2)
              const t1Name = t1?.name || 'Team 1'
              const t2Name = t2?.name || 'Team 2'

              const isSoloMode = room?.mode === 'solo'
              const amICaptain = isSoloMode || myTeam?.captain_id === profile?.id

              const finalStarter = syncedCoinResult || coinFlipResult || 1
              console.log('[NAVIGATE SYNCED] Going to game with starter:', finalStarter, '(1=Purple, 2=Yellow)')
              const h1Houses = teamMembers.filter(tm => teams.find(t => t.id === tm.team_id)?.team_number === 1).map(tm => tm.profiles.house).join(',')
              const h2Houses = teamMembers.filter(tm => teams.find(t => t.id === tm.team_id)?.team_number === 2).map(tm => tm.profiles.house).join(',')
              router.push(`/game/${roomCode}?team=${myTeamNumber}&t1=${encodeURIComponent(t1Name)}&t2=${encodeURIComponent(t2Name)}&captain=${amICaptain}&starter=${finalStarter}&h1=${encodeURIComponent(h1Houses)}&h2=${encodeURIComponent(h2Houses)}`)
            }, 1000)
          }, 500)
        }, 7000)
      }, 1000)
    }
  }, [syncedCoinResult, animationState, teamMembers, profile, teams, room, roomCode, router, coinFlipResult])

  const loadRoomData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push('/login')
        return
      }

      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (profileData) {
        setProfile(profileData)
      }

      // Load room
      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('room_code', roomCode.toUpperCase())
        .single()

      if (roomError || !roomData) {
        setError('That Quidditch room could not be found.')
        setLoading(false)
        return
      }

      setRoom(roomData)

      // Load teams
      const { data: teamsData } = await supabase
        .from('teams')
        .select('*')
        .eq('room_id', roomData.id)

      if (teamsData) {
        setTeams(teamsData)
      }

      // Load team members
      const { data: membersData } = await supabase
        .from('team_members')
        .select('*, profiles(magical_name, house)')
        .in('team_id', teamsData?.map(t => t.id) || [])

      if (membersData) {
        setTeamMembers(membersData)
      }
    } catch {
      console.error('Error loading room data:', error)
      setError('A magical disturbance occurred.')
    } finally {
      setLoading(false)
    }
  }

  const setupRealtimeSubscription = () => {
    // Subscribe to room changes
    const channelName = `room:${roomCode}-${Math.random()}`
    const roomSubscription = supabase
      .channel(channelName, {
        config: {
          broadcast: { self: false }
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'rooms',
        filter: `room_code=eq.${roomCode.toUpperCase()}`
      }, (payload) => {
        if (payload.new) {
          setRoom(payload.new as Room)
        }
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'teams'
      }, () => {
        loadRoomData()
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'team_members'
      }, () => {
        loadRoomData()
      })
      .on('broadcast', { event: 'coin_flip' }, ({ payload }: { payload: { result: 1 | 2 } }) => {
        console.log('[REALTIME] Coin flip result received:', payload.result)
        setSyncedCoinResult(payload.result)
        setCoinFlipResult(payload.result)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(roomSubscription)
    }
  }

  const handleJoinTeam = async (teamNumber: number) => {
    if (!profile || !room) return

    setActionLoading(true)
    setError('')

    try {
      const team = teams.find(t => t.team_number === teamNumber)
      if (!team) {
        setActionLoading(false)
        return
      }

      // Check if user is already in this team
      const existingMember = teamMembers.find(tm => tm.user_id === profile.id)
      if (existingMember) {
        setError('You are already in this room.')
        setActionLoading(false)
        return
      }

      if (room.mode === 'solo') {
        // Solo mode: can only join empty team
        const teamMemberCount = teamMembers.filter(tm => tm.team_id === team.id).length
        if (teamMemberCount > 0) {
          setError('That team is already occupied in solo mode.')
          setActionLoading(false)
          return
        }

        // Join team
        const { error: memberError } = await supabase
          .from('team_members')
          .insert({
            team_id: team.id,
            user_id: profile.id,
            position: 'keeper',
            confirmed: true
          })

        if (memberError) {
          setError('Failed to join team. Please try again.')
          setActionLoading(false)
          return
        }

        // Note: captain is auto-assigned by the DB trigger (auto_assign_captain)
      } else {
        // Team mode: select team first, then position
        setSelectedTeam(teamNumber)
      }

      setActionLoading(false)
    } catch {
      setError('A magical disturbance occurred.')
      setActionLoading(false)
    }
  }

  const handleSelectPosition = async (position: string) => {
    if (!profile || !room || selectedTeam === null) return

    setActionLoading(true)
    setError('')

    try {
      const team = teams.find(t => t.team_number === selectedTeam)
      if (!team) {
        setActionLoading(false)
        return
      }

      // Use the secure RPC function to claim position
      const { data, error } = await supabase.rpc('claim_position', {
        p_team_id: team.id,
        p_user_id: profile.id,
        p_position: position
      })

      if (error || !data?.success) {
        setError(data?.error || 'Failed to claim position. Please try again.')
        setActionLoading(false)
        return
      }

      setSelectedPosition(null)
      setSelectedTeam(null)
      setActionLoading(false)
    } catch {
      setError('A magical disturbance occurred.')
      setActionLoading(false)
    }
  }

  const handleConfirmTeam = async () => {
    if (!profile || !room) return

    setActionLoading(true)
    setError('')

    try {
      // Find the team the user belongs to (by membership, not just captain)
      const myMembership = teamMembers.find(tm => tm.user_id === profile.id)
      if (!myMembership) {
        setError('You are not in a team.')
        setActionLoading(false)
        return
      }

      const userTeam = teams.find(t => t.id === myMembership.team_id)
      if (!userTeam) {
        setError('Could not find your team.')
        setActionLoading(false)
        return
      }

      // Get the name from local state or existing team name
      const currentName = localTeamNames[userTeam.id] !== undefined ? localTeamNames[userTeam.id] : (userTeam.name || '')
      if (!currentName || currentName.trim() === '') {
        setError('Please enter a team name before confirming.')
        setActionLoading(false)
        return
      }

      // Use SECURITY DEFINER RPC — works for any team member regardless of captain status
      const { data, error: rpcError } = await supabase.rpc('set_team_ready', {
        p_team_id: userTeam.id,
        p_name: currentName.trim()
      })

      if (rpcError || !data?.success) {
        setError(data?.error || rpcError?.message || 'Failed to confirm team. Please try again.')
        setActionLoading(false)
        return
      }

      // Check if both teams are ready so we can update room status
      const otherTeam = teams.find(t => t.id !== userTeam.id)
      if (otherTeam?.ready) {
        await supabase
          .from('rooms')
          .update({ status: 'ready' })
          .eq('id', room.id)
      }

      setActionLoading(false)
    } catch {
      setError('A magical disturbance occurred.')
      setActionLoading(false)
    }
  }

  const handleUpdateTeamName = async (teamId: string, name: string) => {
    try {
      await supabase
        .from('teams')
        .update({ name: name.trim() })
        .eq('id', teamId)
    } catch (error) {
      console.error('Error updating team name:', error)
    }
  }

  const handleLeaveRoom = async () => {
    if (!profile) return

    try {
      // Remove user from team
      const { data: memberData } = await supabase
        .from('team_members')
        .select('id, team_id')
        .eq('user_id', profile.id)
        .single()

      if (memberData) {
        await supabase
          .from('team_members')
          .delete()
          .eq('id', memberData.id)

        // If user was captain, update team captain
        const team = teams.find(t => t.id === memberData.team_id)
        if (team?.captain_id === profile.id) {
          await supabase
            .from('teams')
            .update({ captain_id: null, ready: false })
            .eq('id', team.id)
        }
      }

      router.push('/play')
    } catch (error) {
      console.error('Error leaving room:', error)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const getTeamMembers = (teamId: string) => {
    return teamMembers.filter(tm => tm.team_id === teamId)
  }

  const getPositionCount = (teamId: string, position: string) => {
    return teamMembers.filter(tm => tm.team_id === teamId && tm.position === position).length
  }

  const isUserInRoom = () => {
    return teamMembers.some(tm => tm.user_id === profile?.id)
  }

  // Returns true if the current user is a member of this specific team
  const isUserInTeam = (teamId: string) => {
    return teamMembers.some(tm => tm.team_id === teamId && tm.user_id === profile?.id)
  }

  if (loading) {
    return (
      <MagicalBackground>
        <LoadingSkeleton variant="room" />
      </MagicalBackground>
    )
  }

  if (error && !room) {
    return <ErrorMagic message={error} onRetry={() => router.push('/play')} />
  }

  if (!room || !profile) {
    return null
  }

  const isSolo = room.mode === 'solo'

  return (
    <MagicalBackground>
      <MagicalNavbar
        magicalName={profile.magical_name}
        house={profile.house}
        onLogout={handleLogout}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl mb-6 font-bold flex justify-between items-center">
            <span>{error}</span>
            <button onClick={() => setError('')} className="text-red-400 hover:text-white">✕</button>
          </div>
        )}

        {/* Room Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-amber-400 to-amber-600 bg-clip-text text-transparent mb-2">
                🧹 Quidditch Room
              </h1>
              <p className="text-slate-400">Room Code: <span className="text-amber-400 font-bold">{roomCode.toUpperCase()}</span></p>
            </div>
            <div className="flex gap-4">
              <button
                onClick={(e) => {
                  navigator.clipboard.writeText(roomCode.toUpperCase());
                  const btn = e.currentTarget;
                  const originalText = btn.innerText;
                  btn.innerText = 'Copied!';
                  setTimeout(() => btn.innerText = originalText, 2000);
                }}
                className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 rounded-lg border border-purple-500/30 transition-all"
              >
                Copy Code
              </button>
              <MagicalButton
                onClick={handleLeaveRoom}
                variant="danger"
              >
                Leave Room
              </MagicalButton>
            </div>
          </div>

          <div className="flex gap-6">
            <div className="px-4 py-2 bg-slate-800/50 rounded-lg">
              <span className="text-slate-400">Mode:</span>
              <span className="ml-2 text-white font-bold">{isSolo ? '🧙‍♂️ SOLO' : '👥 TEAM'}</span>
            </div>
            <div className="px-4 py-2 bg-slate-800/50 rounded-lg">
              <span className="text-slate-400">Status:</span>
              <span className={`ml-2 font-bold ${room.status === 'ready' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {room.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Team Selection for new joiners */}
        {!isUserInRoom() && room.mode === 'team' && selectedTeam === null && (
          <MagicalCard className="mb-8">
            <h2 className="text-2xl font-bold text-amber-400 mb-4">Choose Your Team</h2>
            <div className="grid grid-cols-2 gap-6">
              {teams.map((team) => {
                const memberCount = getTeamMembers(team.id).length
                const isFull = memberCount >= 7

                return (
                  <button
                    key={team.id}
                    onClick={() => !isFull && handleJoinTeam(team.team_number)}
                    disabled={isFull}
                    className={`
                      p-6 rounded-xl border-2 transition-all
                      ${isFull 
                        ? 'bg-slate-800/30 border-slate-700 opacity-50 cursor-not-allowed' 
                        : 'bg-slate-800/50 border-amber-500/30 hover:border-amber-500 hover:bg-amber-500/10 cursor-pointer'
                      }
                    `}
                  >
                    <h3 className="text-xl font-bold text-white mb-2">
                      Team {team.team_number === 1 ? 'A' : 'B'}
                    </h3>
                    <p className="text-slate-400">
                      {memberCount} / 7 players
                      {isFull && ' (Full)'}
                    </p>
                    {team.captain_id && (
                      <div className="mt-2 text-amber-400 text-sm">
                        Captain assigned
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </MagicalCard>
        )}

        {/* Position Selection for team mode */}
        {!isUserInRoom() && room.mode === 'team' && selectedTeam !== null && (
          <MagicalCard className="mb-8">
            <h2 className="text-2xl font-bold text-amber-400 mb-4">Choose Your Position</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {['keeper', 'chaser', 'beater', 'seeker'].map((position) => {
                const team = teams.find(t => t.team_number === selectedTeam)
                const available = team ? (position === 'chaser' ? 3 : position === 'beater' ? 2 : 1) - getPositionCount(team.id, position) : 0
                const total = position === 'chaser' ? 3 : position === 'beater' ? 2 : 1

                return (
                  <PositionCard
                    key={position}
                    position={position}
                    available={available}
                    total={total}
                    onClick={() => handleSelectPosition(position)}
                    disabled={actionLoading || available === 0}
                    selected={selectedPosition === position}
                  />
                )
              })}
            </div>
            <button
              onClick={() => setSelectedTeam(null)}
              className="mt-4 text-slate-400 hover:text-white"
            >
              ← Back to Team Selection
            </button>
          </MagicalCard>
        )}

        {/* Teams Display */}
        {animationState === 'none' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {teams.map((team) => {
              const members = getTeamMembers(team.id)
              const memberCount = members.length
              const requiredPlayers = room.mode === 'solo' ? 1 : 7
              const isEffectivelyCaptain = isSolo ? (memberCount > 0) : !!team.captain_id
              const effectiveCaptainId = isSolo && memberCount > 0 ? members[0].user_id : team.captain_id

              return (
                <MagicalCard key={team.id} glow={team.ready}>
                  <div className="flex flex-col gap-2 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="text-slate-400 text-sm font-semibold uppercase tracking-widest">
                        Team {team.team_number === 1 ? 'A' : 'B'}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">{memberCount}/{requiredPlayers}</span>
                        {team.ready && (
                          <span className="px-3 py-1 bg-emerald-600/30 text-emerald-400 rounded-full text-sm font-bold shadow-[0_0_10px_rgba(16,185,129,0.3)] border border-emerald-500/50">
                            READY
                          </span>
                        )}
                      </div>
                    </div>

                    {isUserInTeam(team.id) && !team.ready ? (
                      <input
                        type="text"
                        placeholder="Enter your team name..."
                        value={localTeamNames[team.id] !== undefined ? localTeamNames[team.id] : (team.name || '')}
                        onChange={(e) => {
                          setLocalTeamNames(prev => ({ ...prev, [team.id]: e.target.value }))
                        }}
                        onBlur={(e) => handleUpdateTeamName(team.id, e.target.value)}
                        className="w-full bg-slate-900/50 border border-amber-500/30 rounded-lg px-4 py-2 text-2xl font-bold text-amber-400 placeholder:text-amber-700/50 focus:outline-none focus:border-amber-400 focus:bg-slate-900 transition-all"
                        maxLength={30}
                      />
                    ) : (
                      <h2 className="text-2xl font-bold text-amber-400">
                        {team.name || 'Unnamed Team'}
                      </h2>
                    )}
                  </div>

                  {/* Captain */}
                  {isEffectivelyCaptain && effectiveCaptainId && (
                    <div className="mb-4 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
                      <div className="text-amber-400 text-sm font-semibold mb-1">Team Captain</div>
                      {members.find(m => m.user_id === effectiveCaptainId) ? (
                        <div className="flex items-center gap-2">
                          <span className="text-white font-semibold">
                            {members.find(m => m.user_id === effectiveCaptainId)?.profiles.magical_name}
                          </span>
                          {effectiveCaptainId === profile.id && (
                            <span className="px-2 py-0.5 bg-amber-500 text-black text-xs font-bold rounded-full">
                              YOU
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 animate-pulse">...</span>
                      )}
                    </div>
                  )}

                  {/* Members */}
                  <div className="space-y-3">
                    {isSolo && memberCount > 0 ? (
                      <div className="p-3 bg-slate-800/50 rounded-lg">
                        <PlayerAvatar
                          magicalName={members[0].profiles.magical_name}
                          house={members[0].profiles.house}
                          showCaptain={effectiveCaptainId === members[0].user_id}
                        />
                        <div className="mt-2 text-amber-400 text-sm">
                          Controls all 7 positions
                        </div>
                      </div>
                    ) : (
                      <>
                        {members.length === 0 ? (
                          <div className="p-4 text-center text-slate-500">
                            Waiting for players...
                          </div>
                        ) : (
                          members.map((member) => (
                            <div key={member.id} className="p-3 bg-slate-800/50 rounded-lg">
                              <div className="flex items-center justify-between">
                                <PlayerAvatar
                                  magicalName={member.profiles.magical_name}
                                  house={member.profiles.house}
                                  showCaptain={effectiveCaptainId === member.user_id}
                                />
                                {member.position && (
                                  <div className="px-3 py-1 bg-purple-600/30 text-purple-400 rounded-full text-sm capitalize">
                                    {member.position}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </>
                    )}
                  </div>

                  {/* Ready Controls — shown to the user in this team */}
                  {isUserInTeam(team.id) && (
                    <div className="mt-4 pt-4 border-t border-slate-700">
                      {room.mode === 'team' && (
                        <div className="text-slate-400 text-sm mb-2">
                          {memberCount}/7 positions filled
                        </div>
                      )}
                      {!team.ready ? (
                        (() => {
                          const currentName = localTeamNames[team.id] !== undefined ? localTeamNames[team.id] : (team.name || '')
                          const hasName = currentName.trim() !== ''
                          return (
                            <MagicalButton
                              onClick={handleConfirmTeam}
                              disabled={actionLoading}
                              className="w-full"
                            >
                              {!hasName
                                ? '✏️ Enter team name & click Ready'
                                : '✅ Ready!'}
                            </MagicalButton>
                          )
                        })()
                      ) : (
                        <div className="text-emerald-400 text-center font-semibold border-2 border-emerald-500/30 p-3 rounded-lg bg-emerald-500/10">
                          ✓ Team Ready!
                        </div>
                      )}
                    </div>
                  )}

                  {/* Join button for solo mode */}
                  {isSolo && memberCount === 0 && !isUserInRoom() && (
                    <MagicalButton
                      onClick={() => handleJoinTeam(team.team_number)}
                      disabled={actionLoading}
                      className="w-full mt-4"
                    >
                      Join Team {team.team_number === 1 ? 'A' : 'B'}
                    </MagicalButton>
                  )}
                </MagicalCard>
              )
            })}
          </div>
        )}

        {/* VS Animation Screen */}
        {(animationState === 'vs' || animationState === 'fadeOut') && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(74, 222, 128, 0.42) 0%, rgba(8, 59, 39, 0.94) 52%, #02170e 100%)',
              opacity: animationState === 'fadeOut' ? 0 : 1,
              transition: 'opacity 0.8s ease-in-out',
            }}
          >
            {/* Particle sparkles background */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="absolute rounded-full bg-white animate-ping"
                  style={{
                    width: `${Math.random() * 4 + 2}px`,
                    height: `${Math.random() * 4 + 2}px`,
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDuration: `${Math.random() * 2 + 1}s`,
                    animationDelay: `${Math.random() * 2}s`,
                    opacity: 0.3,
                  }}
                />
              ))}
            </div>

            {/* Divider lightning line */}
            <div className="absolute inset-y-0 left-1/2 w-px bg-gradient-to-b from-transparent via-white to-transparent opacity-30" />

            {/* Team 1 */}
            <div
              className="absolute left-0 top-0 bottom-0 flex items-center justify-center w-1/2 px-8"
              style={{ animation: 'slideInLeft 0.8s cubic-bezier(0.16,1,0.3,1) both' }}
            >
              <div className="text-center">
                <div className="text-purple-300/60 text-sm uppercase tracking-[0.4em] mb-4 font-bold">Purple Team</div>
                <h2
                  className="font-black leading-none"
                  style={{
                    fontSize: 'clamp(2.5rem, 7vw, 5rem)',
                    background: 'linear-gradient(135deg, #e9d5ff, #a855f7, #7e22ce)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 0 30px rgba(168,85,247,0.7))',
                    textShadow: 'none',
                  }}
                >
                  {teams[0]?.name || 'Team 1'}
                </h2>
              </div>
            </div>

            {/* VS badge */}
            <div
              className="relative z-10 flex flex-col items-center"
              style={{ animation: 'popIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.6s both' }}
            >
              <p className="mb-7 text-center text-sm font-black uppercase tracking-[0.28em] text-emerald-100 drop-shadow-[0_0_16px_rgba(134,239,172,0.8)]">
                The starting team will be determined by a magical coin flip
              </p>
              <div
                className="relative mb-8 h-72 w-72 rounded-full border-[9px] border-emerald-100 bg-gradient-to-br from-purple-500 via-emerald-600 to-yellow-500 shadow-[0_0_40px_rgba(74,222,128,0.95),0_0_120px_rgba(168,85,247,0.6),inset_0_0_60px_rgba(255,255,255,0.2)] flex items-center justify-center"
              >
                {/* Magical glow effect */}
                <div className="absolute inset-0 rounded-full animate-pulse" style={{
                  boxShadow: '0 0 60px rgba(74,222,128,0.8), 0 0 120px rgba(168,85,247,0.4)',
                }} />
                
                <div className="relative z-10 text-center">
                  <div className="text-8xl mb-4 animate-bounce">🪙</div>
                  <div className="text-white font-black text-2xl tracking-wider drop-shadow-[0_4px_8px_rgba(0,0,0,0.9)]">
                    50/50
                  </div>
                  <div className="text-emerald-100 text-sm font-bold mt-2">
                    Fair & Random
                  </div>
                </div>
              </div>
              <div
                className="font-black text-white italic"
                style={{
                  fontSize: 'clamp(3rem, 8vw, 6rem)',
                  textShadow: '0 0 40px rgba(255,255,255,0.8), 0 0 80px rgba(255,255,255,0.4)',
                  letterSpacing: '-0.02em',
                }}
              >
                START
              </div>
              <div className="mt-2 text-emerald-100/70 text-xs uppercase tracking-widest">Get Ready</div>
              <div className="mt-5 max-w-sm rounded-2xl border border-emerald-100/80 bg-emerald-500/25 px-6 py-4 text-center text-sm font-black uppercase tracking-[0.18em] text-emerald-50 shadow-[0_0_30px_rgba(74,222,128,0.75)]">
                <div className="mb-1 text-xs tracking-[0.28em] text-emerald-200">Starting Player</div>
                <div className="text-lg tracking-normal text-white">
                  Will be decided by coin flip after deployment
                </div>
              </div>
            </div>

            {/* Team 2 */}
            <div
              className="absolute right-0 top-0 bottom-0 flex items-center justify-center w-1/2 px-8"
              style={{ animation: 'slideInRight 0.8s cubic-bezier(0.16,1,0.3,1) both' }}
            >
              <div className="text-center">
                <div className="text-yellow-300/60 text-sm uppercase tracking-[0.4em] mb-4 font-bold">Yellow Team</div>
                <h2
                  className="font-black leading-none"
                  style={{
                    fontSize: 'clamp(2.5rem, 7vw, 5rem)',
                    background: 'linear-gradient(135deg, #fef9c3, #facc15, #d97706)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    filter: 'drop-shadow(0 0 30px rgba(250,204,21,0.7))',
                    textShadow: 'none',
                  }}
                >
                  {teams[1]?.name || 'Team 2'}
                </h2>
              </div>
            </div>

            <style>{`
              @keyframes slideInLeft {
                from { transform: translateX(-120%) skewX(-8deg); opacity: 0; }
                to { transform: translateX(0) skewX(0); opacity: 1; }
              }
              @keyframes slideInRight {
                from { transform: translateX(120%) skewX(8deg); opacity: 0; }
                to { transform: translateX(0) skewX(0); opacity: 1; }
              }
              @keyframes popIn {
                from { transform: scale(0) rotate(-10deg); opacity: 0; }
                to { transform: scale(1) rotate(0deg); opacity: 1; }
              }
              @keyframes glowPulse {
                0%, 100% { text-shadow: 0 0 20px rgba(255,255,255,0.4); }
                50% { text-shadow: 0 0 60px rgba(255,255,255,1), 0 0 120px rgba(255,255,255,0.5); }
              }
              @keyframes starterWheelSpin {
                from { transform: rotate(0deg); }
                to { transform: rotate(var(--starter-wheel-end)); }
              }
            `}</style>
          </div>
        )}

        {/* Coin Flip Animation */}
        {animationState === 'coinFlip' && coinFlipResult && (
          <MagicalCoin
            result={coinFlipResult}
            flipping={coinFlipping}
            t1Name={teams[0]?.name || 'Team 1'}
            t2Name={teams[1]?.name || 'Team 2'}
          />
        )}

        {/* Black Game Screen */}
        {animationState === 'blackScreen' && (
          <div
            className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center gap-6"
            style={{ animation: 'fadeInBlack 0.3s ease-in both' }}
          >
            <div
              className="text-white font-black uppercase tracking-[0.5em]"
              style={{
                fontSize: 'clamp(4rem, 15vw, 10rem)',
                animation: 'textReveal 0.6s cubic-bezier(0.16,1,0.3,1) 0.2s both',
                textShadow: '0 0 60px rgba(255,255,255,0.3)',
              }}
            >
              game
            </div>
            <div
              className="text-white/40 text-sm uppercase tracking-[0.8em]"
              style={{ animation: 'textReveal 0.6s ease 0.6s both' }}
            >
              {teams[0]?.name || 'Team 1'} vs {teams[1]?.name || 'Team 2'}
            </div>
            <style>{`
              @keyframes fadeInBlack {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes textReveal {
                from { transform: translateY(30px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
              }
            `}</style>
          </div>
        )}
      </div>
    </MagicalBackground>
  )
}
