import { useState, useEffect, useCallback, useRef, FormEvent, CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Users, Monitor, Copy, Check, LogOut, RefreshCw, Volume2, VolumeX, Wifi, WifiOff } from 'lucide-react';
import confetti from 'canvas-confetti';
import { io, Socket } from 'socket.io-client';
import { generateBoard, checkLines, getBingoProgress, getCompletedPatterns } from './gameLogic';
import { Player, GameMode, GameState, BINGO_LETTERS, CompletedPattern } from './types';

const getPatternKey = (pattern: CompletedPattern) => `${pattern.type}-${pattern.index}`;

const getPatternCells = (pattern: CompletedPattern): string[] => {
  if (pattern.type === 'row') {
    return Array.from({ length: 5 }, (_, col) => `${pattern.index}-${col}`);
  }

  if (pattern.type === 'col') {
    return Array.from({ length: 5 }, (_, row) => `${row}-${pattern.index}`);
  }

  if (pattern.index === 0) {
    return Array.from({ length: 5 }, (_, idx) => `${idx}-${idx}`);
  }

  return Array.from({ length: 5 }, (_, idx) => `${idx}-${4 - idx}`);
};

const getPatternClassName = (pattern: CompletedPattern): string => {
  if (pattern.type === 'row') {
    return 'board-line board-line-horizontal';
  }

  if (pattern.type === 'col') {
    return 'board-line board-line-vertical';
  }

  return pattern.index === 0 ? 'board-line board-line-diag-main' : 'board-line board-line-diag-anti';
};

const getPatternStyle = (pattern: CompletedPattern): CSSProperties => {
  if (pattern.type === 'row') {
    return { top: `calc(${(pattern.index + 0.5) * 20}% - 2px)` };
  }

  if (pattern.type === 'col') {
    return { left: `calc(${(pattern.index + 0.5) * 20}% - 2px)` };
  }

  return {};
};

export default function App() {
  // User State
  const [playerName, setPlayerName] = useState<string>(localStorage.getItem('bingo_name') || '');
  const [isGuest, setIsGuest] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('bingo_name'));
  const [roomCode, setRoomCode] = useState<string>('');
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Game State
  const [gameMode, setGameMode] = useState<GameMode>(null);
  const [gameState, setGameState] = useState<GameState>({
    board: [],
    marked: Array(5).fill(null).map(() => Array(5).fill(false)),
    completedLines: 0,
    bingoLetters: [],
    isGameOver: false,
    winner: null,
    currentTurn: null,
  });
  const [opponentName, setOpponentName] = useState<string>('Computer');
  const [scores, setScores] = useState<{ player: number; opponent: number }>({
    player: parseInt(localStorage.getItem('bingo_score_player') || '0'),
    opponent: parseInt(localStorage.getItem('bingo_score_opponent') || '0'),
  });
  const [soundEnabled, setSoundEnabled] = useState(true);

  // Multiplayer State
  const socketRef = useRef<Socket | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Refs for state needed in socket listeners to avoid re-binding
  const stateRef = useRef({ playerName, gameMode, activeRoomCode });
  useEffect(() => {
    stateRef.current = { playerName, gameMode, activeRoomCode };
  }, [playerName, gameMode, activeRoomCode]);

  const completedPatterns = getCompletedPatterns(gameState.marked);
  const completedCellKeys = new Set(completedPatterns.flatMap(getPatternCells));
  const isPlayerTurn =
    gameState.currentTurn === (gameMode === 'single' ? 'player' : socketRef.current?.id);

  const resetBoard = () => {
    setGameState({
      board: generateBoard(),
      marked: Array(5).fill(null).map(() => Array(5).fill(false)),
      completedLines: 0,
      bingoLetters: [],
      isGameOver: false,
      winner: null,
      currentTurn: null,
    });
  };

  const markNumber = useCallback((num: number, isLocal: boolean) => {
    setGameState(prev => {
      if (prev.isGameOver) return prev;

      const newMarked = prev.marked.map(row => [...row]);
      let found = false;
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (prev.board[i][j] === num) {
            newMarked[i][j] = true;
            found = true;
          }
        }
      }

      const { gameMode, playerName, activeRoomCode } = stateRef.current;

      if (!found && gameMode === 'multi' && isLocal) return prev;

      const newLines = checkLines(newMarked);
      const newBingoLetters = getBingoProgress(newLines);
      const isWinner = newLines >= 5;

      if (isWinner && !prev.isGameOver) {
        if (gameMode === 'multi' && isLocal) {
          socketRef.current?.emit('bingo', { roomCode: activeRoomCode, playerName });
        } else if (gameMode === 'single') {
          triggerWin();
          updateScore('player');
          return {
            ...prev,
            marked: newMarked,
            completedLines: newLines,
            bingoLetters: newBingoLetters,
            isGameOver: true,
            winner: playerName
          };
        }
      }

      return {
        ...prev,
        marked: newMarked,
        completedLines: newLines,
        bingoLetters: newBingoLetters,
        isGameOver: isWinner ? true : prev.isGameOver,
        winner: isWinner ? playerName : prev.winner
      };
    });
  }, []); // No dependencies, uses refs

  // Initialize Socket
  useEffect(() => {
    const socketUrl =
      import.meta.env.VITE_SOCKET_URL ||
      (window.location.port && window.location.port !== '3000'
        ? `${window.location.protocol}//${window.location.hostname}:3000`
        : undefined);

    const socket = io(socketUrl, {
      reconnectionAttempts: 5,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      setError(null);
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      setPlayers([]);
      setGameState(prev => ({ ...prev, currentTurn: null }));
      console.log('Disconnected from server');
    });

    socket.on('connect_error', (err) => {
      console.error('Connection error:', err);
      setError('Failed to connect to game server');
    });

    socket.on('room-created', ({ roomCode, players }: { roomCode: string, players: Player[] }) => {
      console.log('Room created successfully:', roomCode);
      setActiveRoomCode(roomCode);
      setPlayers(players);
      setGameMode('multi');
      resetBoard();
    });

    socket.on('room-joined', ({ roomCode, players }: { roomCode: string, players: Player[] }) => {
      console.log('Joined room successfully:', roomCode);
      setActiveRoomCode(roomCode);
      setPlayers(players);
      setGameMode('multi');
      resetBoard();
      const other = players.find(p => p.id !== socket.id);
      if (other) setOpponentName(other.name);
    });

    socket.on('player-joined', (updatedPlayers: Player[]) => {
      setPlayers(updatedPlayers);
      const other = updatedPlayers.find(p => p.id !== socket.id);
      if (other) setOpponentName(other.name);
    });

    socket.on('game-start', ({ players: updatedPlayers, turn }) => {
      setPlayers(updatedPlayers);
      setGameState(prev => ({ ...prev, currentTurn: turn, isGameOver: false, winner: null }));
      const other = updatedPlayers.find(p => p.id !== socket.id);
      if (other) setOpponentName(other.name);
    });

    socket.on('number-selected', (num: number) => {
      markNumber(num, false);
    });

    socket.on('turn-change', (nextTurnId: string) => {
      setGameState(prev => ({ ...prev, currentTurn: nextTurnId }));
    });

    socket.on('game-over', ({ winner }) => {
      setGameState(prev => ({ ...prev, isGameOver: true, winner }));
      if (winner === stateRef.current.playerName) {
        triggerWin();
        updateScore('player');
      } else {
        updateScore('opponent');
      }
    });

    socket.on('game-reset', ({ turn }) => {
      resetBoard();
      setGameState(prev => ({ ...prev, currentTurn: turn, isGameOver: false, winner: null }));
    });

    socket.on('room-error', (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 3000);
    });

    socket.on('player-left', () => {
      setPlayers(prev => prev.filter(player => player.id === socket.id));
      setGameState(prev => ({
        ...prev,
        currentTurn: null,
        isGameOver: false,
        winner: null,
      }));
      setError('The other player left the room');
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      socket.disconnect();
    };
  }, [markNumber]); // Only markNumber as dependency

  // Generate User Code on Login
  useEffect(() => {
    if (isLoggedIn && !userCode) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      setUserCode(code);
    }
  }, [isLoggedIn, userCode]);

  const handleLogin = (e: FormEvent) => {
    e.preventDefault();
    if (playerName.trim()) {
      localStorage.setItem('bingo_name', playerName);
      setIsLoggedIn(true);
    }
  };

  const handleGuestLogin = () => {
    const guestName = 'Guest_' + Math.floor(Math.random() * 1000);
    setPlayerName(guestName);
    setIsGuest(true);
    setIsLoggedIn(true);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startSinglePlayer = () => {
    setGameMode('single');
    setOpponentName('Computer');
    resetBoard();
    setGameState(prev => ({ ...prev, currentTurn: 'player' }));
  };

  const createMultiplayer = () => {
    if (!isConnected || !socketRef.current) {
      setError("Connecting to server... Please try again in a moment.");
      return;
    }

    const code = userCode || Math.floor(100000 + Math.random() * 900000).toString();
    if (!userCode) setUserCode(code);
    
    console.log('Emitting create-room with code:', code);
    socketRef.current.emit('create-room', code, playerName);
  };

  const joinMultiplayer = () => {
    if (!isConnected || !socketRef.current) {
      setError("Connecting to server... Please try again in a moment.");
      return;
    }
    if (roomCode.length === 6) {
      console.log('Emitting join-room with code:', roomCode);
      socketRef.current.emit('join-room', roomCode, playerName);
    } else {
      setError("Please enter a valid 6-digit code");
    }
  };

  const handleCellClick = (num: number) => {
    if (gameState.isGameOver) return;
    
    if (gameMode === 'single') {
      if (gameState.currentTurn !== 'player') return;
      markNumber(num, true);
      setGameState(prev => ({ ...prev, currentTurn: 'computer' }));
    } else if (gameMode === 'multi') {
      if (gameState.currentTurn !== socketRef.current?.id) return;
      socketRef.current?.emit('make-move', { roomCode: activeRoomCode, number: num });
    }
  };

  // Computer AI Move
  useEffect(() => {
    if (gameMode === 'single' && gameState.currentTurn === 'computer' && !gameState.isGameOver) {
      const timer = setTimeout(() => {
        const calledNumbers: number[] = [];
        gameState.marked.forEach((row, i) => {
          row.forEach((isMarked, j) => {
            if (isMarked) calledNumbers.push(gameState.board[i][j]);
          });
        });

        const available = Array.from({ length: 25 }, (_, i) => i + 1).filter(n => !calledNumbers.includes(n));
        if (available.length > 0) {
          const randomNum = available[Math.floor(Math.random() * available.length)];
          markNumber(randomNum, false);
          setGameState(prev => ({ ...prev, currentTurn: 'player' }));
        }
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gameMode, gameState.currentTurn, gameState.isGameOver, markNumber]);

  const triggerWin = () => {
    confetti({
      particleCount: 150,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#FFD700', '#FFA500', '#FF4500']
    });
    if (soundEnabled) {
      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2013/2013-preview.mp3');
      audio.play().catch(() => {});
    }
  };

  const updateScore = (who: 'player' | 'opponent') => {
    setScores(prev => {
      const next = { ...prev, [who]: prev[who] + 1 };
      localStorage.setItem(`bingo_score_${who}`, next[who].toString());
      return next;
    });
  };

  const handlePlayAgain = () => {
    if (gameMode === 'multi') {
      socketRef.current?.emit('play-again', activeRoomCode);
    } else {
      resetBoard();
      setGameState(prev => ({ ...prev, currentTurn: 'player' }));
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('bingo_name');
    setIsLoggedIn(false);
    setGameMode(null);
    setPlayerName('');
  };

  if (!isLoggedIn) {
    return (
      <div className="app-shell flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-card panel-card-strong mesh-accent w-full max-w-md rounded-[2rem] p-8"
        >
          <div className="flex justify-center mb-6">
            <div className="rounded-[1.5rem] bg-[var(--coral)] p-4 shadow-lg shadow-[rgba(217,107,79,0.25)]">
              <Trophy className="h-12 w-12 text-[#fffaf2]" />
            </div>
          </div>
          <h1 className="mb-2 text-center text-4xl font-black tracking-tight text-[var(--ink)]">Bingo Royale</h1>
          <p className="mb-8 text-center text-[var(--muted)]">A warmer, sharper game night vibe with instant multiplayer rooms.</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="text"
              placeholder="Your Name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-3 text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)] transition-all"
              required
            />
            <button
              type="submit"
              className="w-full rounded-2xl bg-[var(--teal)] py-3 font-semibold text-white transition-all shadow-lg shadow-[rgba(22,124,128,0.2)] hover:bg-[var(--teal-deep)]"
            >
              Join Game
            </button>
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-[var(--line)]"></div>
              <span className="mx-4 flex-shrink text-sm text-[var(--muted)]">OR</span>
              <div className="flex-grow border-t border-[var(--line)]"></div>
            </div>
            <button
              type="button"
              onClick={handleGuestLogin}
              className="w-full rounded-2xl bg-[var(--surface-muted)] py-3 font-semibold text-[var(--ink)] transition-all hover:bg-[#e8dbc8]"
            >
              Continue as Guest
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (!gameMode) {
    return (
      <div className="app-shell p-6 font-sans">
        <div className="max-w-4xl mx-auto">
          <header className="flex justify-between items-center mb-12">
            <div>
              <h2 className="text-3xl font-black text-[var(--ink)]">Welcome, {playerName}</h2>
              <p className="text-[var(--muted)]">Pick a mode and jump into a cleaner, easier-to-read board.</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="soft-pill flex items-center gap-3 rounded-2xl px-4 py-2">
                <span className="text-sm text-[var(--muted)]">Your Code:</span>
                <span className="font-mono font-bold text-[var(--teal)]">{userCode}</span>
                <button onClick={copyCode} className="transition-colors hover:text-[var(--teal)]">
                  {copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button onClick={handleLogout} className="soft-pill rounded-xl p-2 text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="grid md:grid-cols-2 gap-8">
            <motion.div 
              whileHover={{ scale: 1.02 }}
              className="panel-card flex cursor-pointer flex-col items-center rounded-[2rem] p-8 text-center group"
              onClick={startSinglePlayer}
            >
              <div className="mb-6 rounded-[1.5rem] bg-[rgba(22,124,128,0.12)] p-6 transition-colors group-hover:bg-[rgba(22,124,128,0.18)]">
                <Monitor className="h-12 w-12 text-[var(--teal)]" />
              </div>
              <h3 className="mb-2 text-2xl font-black text-[var(--ink)]">Single Player</h3>
              <p className="mb-8 text-[var(--muted)]">Practice against the computer with the same upgraded board visuals.</p>
              <button className="mt-auto rounded-2xl bg-[var(--teal)] px-8 py-3 font-semibold text-white transition-all hover:bg-[var(--teal-deep)]">
                Play vs Computer
              </button>
            </motion.div>

            <motion.div 
              whileHover={{ scale: 1.02 }}
              className="panel-card flex flex-col items-center rounded-[2rem] p-8 text-center group"
            >
              <div className="mb-6 rounded-[1.5rem] bg-[rgba(217,107,79,0.12)] p-6 transition-colors group-hover:bg-[rgba(217,107,79,0.18)]">
                <Users className="h-12 w-12 text-[var(--coral)]" />
              </div>
              <h3 className="mb-2 text-2xl font-black text-[var(--ink)]">Multiplayer</h3>
              <p className="mb-6 text-[var(--muted)]">Create a room, share the code, and watch completed lines slash across the board in real time.</p>
              
              <div className="w-full space-y-4">
                <button 
                  onClick={createMultiplayer}
                  className="w-full rounded-2xl bg-[var(--coral)] px-8 py-3 font-semibold text-white transition-all hover:bg-[#c65a3f]"
                >
                  Create Room
                </button>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Enter 6-digit code"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ''))}
                    className="flex-grow rounded-2xl border border-[var(--line)] bg-white/80 px-4 py-2 text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--coral)]"
                  />
                  <button 
                    onClick={joinMultiplayer}
                    className="rounded-2xl bg-[var(--surface-muted)] px-6 py-2 font-semibold text-[var(--ink)] transition-all hover:bg-[#e8dbc8]"
                  >
                    Join
                  </button>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="panel-card mt-12 rounded-[2rem] p-6">
            <h4 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
              <Trophy className="h-5 w-5 text-[var(--gold)]" />
              Your Stats
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-white/70 p-4">
                <p className="text-sm text-[var(--muted)]">Wins</p>
                <p className="text-2xl font-black text-[var(--ink)]">{scores.player}</p>
              </div>
              <div className="rounded-2xl bg-white/70 p-4">
                <p className="text-sm text-[var(--muted)]">Losses</p>
                <p className="text-2xl font-black text-[var(--ink)]">{scores.opponent}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell p-4 font-sans flex flex-col">
      <div className="max-w-2xl mx-auto w-full flex-grow flex flex-col">
        <header className="panel-card mb-6 flex items-center justify-between rounded-[2rem] px-5 py-4">
          <button 
            onClick={() => setGameMode(null)}
            className="soft-pill rounded-xl p-2 text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <div className={`soft-pill flex items-center gap-2 rounded-full px-3 py-1.5 text-sm ${isConnected ? 'text-[var(--success)]' : 'text-[var(--coral)]'}`}>
              {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              {isConnected ? 'Connected' : 'Offline'}
            </div>
            {gameMode === 'multi' && activeRoomCode && (
              <div className="soft-pill rounded-full px-3 py-1.5 text-sm font-semibold text-[var(--teal)]">
                Room {activeRoomCode}
              </div>
            )}
            <div className="text-right">
              <p className="text-sm text-[var(--muted)]">Score</p>
              <p className="font-black text-[var(--teal)]">{scores.player} - {scores.opponent}</p>
            </div>
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="soft-pill rounded-xl p-2 text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <div className="flex flex-col items-center mb-8">
          <div className="flex gap-4 mb-6">
            {BINGO_LETTERS.map((letter) => (
              <motion.div
                key={letter}
                animate={{
                  scale: gameState.bingoLetters.includes(letter) ? 1.1 : 1,
                  backgroundColor: gameState.bingoLetters.includes(letter) ? '#167c80' : 'rgba(255,250,242,0.76)',
                  color: gameState.bingoLetters.includes(letter) ? '#ffffff' : '#7a6d5b'
                }}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--line)] text-2xl font-black shadow-lg"
              >
                {letter}
              </motion.div>
            ))}
          </div>
          
          <div className="soft-pill mb-3 rounded-full px-6 py-2">
            <p className="font-semibold text-[var(--teal)]">
              {gameState.isGameOver 
                ? (gameState.winner === playerName ? 'You Won!' : `${opponentName} Won!`)
                : (gameMode === 'multi' && players.length < 2 
                    ? 'Waiting for opponent...' 
                    : (isPlayerTurn
                        ? 'Your Turn' 
                        : `${opponentName}'s Turn`))
              }
            </p>
          </div>

          <p className="mb-4 text-center text-sm text-[var(--muted)]">
            Completed rows, columns, and diagonals now stay visibly slashed across the board.
          </p>
        </div>

        <div className="board-wrap w-full max-w-md mx-auto mb-8 p-3">
          {completedPatterns.map((pattern) => (
            <motion.div
              key={getPatternKey(pattern)}
              initial={{ opacity: 0, scaleX: 0.75 }}
              animate={{ opacity: 1, scaleX: 1 }}
              className={getPatternClassName(pattern)}
              style={getPatternStyle(pattern)}
            />
          ))}

          <div className="grid grid-cols-5 gap-2 md:gap-3 aspect-square w-full">
            {gameState.board.map((row, i) => 
              row.map((num, j) => {
                const isMarked = gameState.marked[i][j];
                const isCompletedCell = completedCellKeys.has(`${i}-${j}`);

                return (
                  <motion.button
                    key={`${i}-${j}`}
                    whileHover={!isMarked && !gameState.isGameOver ? { scale: 1.05 } : {}}
                    whileTap={!isMarked && !gameState.isGameOver ? { scale: 0.95 } : {}}
                    onClick={() => handleCellClick(num)}
                    disabled={isMarked || gameState.isGameOver || (gameMode === 'multi' && players.length < 2)}
                    className={`
                      relative z-[1] aspect-square rounded-2xl md:rounded-[1.4rem] flex items-center justify-center text-xl md:text-2xl font-black transition-all border
                      ${isMarked 
                        ? 'bg-[var(--teal)] border-[rgba(17,94,97,0.6)] text-white shadow-lg shadow-[rgba(22,124,128,0.25)]' 
                        : 'bg-white/80 border-[var(--line)] text-[var(--ink)] hover:border-[rgba(22,124,128,0.35)] hover:bg-white'}
                      ${isCompletedCell ? 'ring-2 ring-[rgba(217,107,79,0.35)]' : ''}
                      ${gameState.isGameOver ? 'cursor-default' : 'cursor-pointer'}
                    `}
                  >
                    <span className={isCompletedCell ? 'line-through decoration-[3px] decoration-[var(--gold)]' : ''}>{num}</span>
                  </motion.button>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-auto flex justify-center pb-8">
          <AnimatePresence>
            {gameState.isGameOver && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel-card-strong flex flex-col items-center rounded-[2rem] px-8 py-7"
              >
                <h3 className="mb-2 text-center text-3xl font-black text-[var(--ink)]">
                  {gameState.winner === playerName ? 'Congratulations!' : 'Better luck next time!'}
                </h3>
                <p className="mb-5 text-center text-[var(--muted)]">
                  {gameState.winner === playerName ? 'Your completed lines are locked in with a victory strike.' : 'Reset and chase a faster five-line finish.'}
                </p>
                <button
                  onClick={handlePlayAgain}
                  className="flex items-center gap-3 rounded-2xl bg-[var(--coral)] px-12 py-4 text-lg font-bold text-white shadow-xl shadow-[rgba(217,107,79,0.25)] transition-all hover:bg-[#c65a3f]"
                >
                  <RefreshCw className="h-6 w-6" />
                  Play Again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-[var(--coral)] px-6 py-3 text-white shadow-2xl">
          {error}
        </div>
      )}
    </div>
  );
}
