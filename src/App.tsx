import { useState, useEffect, useCallback, useRef, FormEvent } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Users, Monitor, Copy, Check, LogOut, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import confetti from 'canvas-confetti';
import { io, Socket } from 'socket.io-client';
import { generateBoard, checkLines, getBingoProgress } from './gameLogic';
import { Player, GameMode, GameState, BINGO_LETTERS } from './types';

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
    const socket = io({
      reconnectionAttempts: 5,
      timeout: 10000,
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
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

    socket.on('error', (msg: string) => {
      setError(msg);
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
      <div className="min-h-screen bg-[#0f172a] text-white flex items-center justify-center p-4 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[#1e293b] p-8 rounded-3xl shadow-2xl w-full max-w-md border border-slate-700"
        >
          <div className="flex justify-center mb-6">
            <div className="bg-indigo-600 p-4 rounded-2xl shadow-lg shadow-indigo-500/20">
              <Trophy className="w-12 h-12 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-center mb-2 tracking-tight">Bingo Royale</h1>
          <p className="text-slate-400 text-center mb-8">Enter your name to start the game</p>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="text"
              placeholder="Your Name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              className="w-full bg-[#0f172a] border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
              required
            />
            <button
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-indigo-600/20"
            >
              Join Game
            </button>
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-slate-700"></div>
              <span className="flex-shrink mx-4 text-slate-500 text-sm">OR</span>
              <div className="flex-grow border-t border-slate-700"></div>
            </div>
            <button
              type="button"
              onClick={handleGuestLogin}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl transition-all"
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
      <div className="min-h-screen bg-[#0f172a] text-white p-6 font-sans">
        <div className="max-w-4xl mx-auto">
          <header className="flex justify-between items-center mb-12">
            <div>
              <h2 className="text-2xl font-bold text-indigo-400">Welcome, {playerName}</h2>
              <p className="text-slate-400">Choose your game mode</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="bg-[#1e293b] px-4 py-2 rounded-xl border border-slate-700 flex items-center gap-3">
                <span className="text-sm text-slate-400">Your Code:</span>
                <span className="font-mono font-bold text-indigo-400">{userCode}</span>
                <button onClick={copyCode} className="hover:text-indigo-400 transition-colors">
                  {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={handleLogout} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </header>

          <div className="grid md:grid-cols-2 gap-8">
            <motion.div 
              whileHover={{ scale: 1.02 }}
              className="bg-[#1e293b] p-8 rounded-3xl border border-slate-700 flex flex-col items-center text-center group cursor-pointer"
              onClick={startSinglePlayer}
            >
              <div className="bg-indigo-600/10 p-6 rounded-2xl mb-6 group-hover:bg-indigo-600/20 transition-colors">
                <Monitor className="w-12 h-12 text-indigo-500" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Single Player</h3>
              <p className="text-slate-400 mb-8">Practice against the computer AI</p>
              <button className="mt-auto bg-indigo-600 hover:bg-indigo-700 px-8 py-3 rounded-xl font-semibold transition-all">
                Play vs Computer
              </button>
            </motion.div>

            <motion.div 
              whileHover={{ scale: 1.02 }}
              className="bg-[#1e293b] p-8 rounded-3xl border border-slate-700 flex flex-col items-center text-center group"
            >
              <div className="bg-emerald-600/10 p-6 rounded-2xl mb-6 group-hover:bg-emerald-600/20 transition-colors">
                <Users className="w-12 h-12 text-emerald-500" />
              </div>
              <h3 className="text-2xl font-bold mb-2">Multiplayer</h3>
              <p className="text-slate-400 mb-6">Challenge a friend in real-time</p>
              
              <div className="w-full space-y-4">
                <button 
                  onClick={createMultiplayer}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 px-8 py-3 rounded-xl font-semibold transition-all"
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
                    className="flex-grow bg-[#0f172a] border border-slate-700 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button 
                    onClick={joinMultiplayer}
                    className="bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded-xl font-semibold transition-all"
                  >
                    Join
                  </button>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="mt-12 bg-[#1e293b] p-6 rounded-2xl border border-slate-700">
            <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Your Stats
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#0f172a] p-4 rounded-xl">
                <p className="text-slate-400 text-sm">Wins</p>
                <p className="text-2xl font-bold text-white">{scores.player}</p>
              </div>
              <div className="bg-[#0f172a] p-4 rounded-xl">
                <p className="text-slate-400 text-sm">Losses</p>
                <p className="text-2xl font-bold text-white">{scores.opponent}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-white p-4 font-sans flex flex-col">
      <div className="max-w-2xl mx-auto w-full flex-grow flex flex-col">
        <header className="flex justify-between items-center mb-6">
          <button 
            onClick={() => setGameMode(null)}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm text-slate-400">Score</p>
              <p className="font-bold text-indigo-400">{scores.player} - {scores.opponent}</p>
            </div>
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400"
            >
              {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </button>
          </div>
        </header>

        <div className="flex flex-col items-center mb-8">
          <div className="flex gap-4 mb-6">
            {BINGO_LETTERS.map((letter, idx) => (
              <motion.div
                key={letter}
                animate={{
                  scale: gameState.bingoLetters.includes(letter) ? 1.1 : 1,
                  backgroundColor: gameState.bingoLetters.includes(letter) ? '#4f46e5' : '#1e293b',
                  color: gameState.bingoLetters.includes(letter) ? '#ffffff' : '#475569'
                }}
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl font-black border border-slate-700 shadow-lg"
              >
                {letter}
              </motion.div>
            ))}
          </div>
          
          <div className="bg-indigo-600/10 px-6 py-2 rounded-full border border-indigo-500/30 mb-4">
            <p className="text-indigo-400 font-semibold">
              {gameState.isGameOver 
                ? (gameState.winner === playerName ? 'You Won!' : `${opponentName} Won!`)
                : (gameMode === 'multi' && players.length < 2 
                    ? 'Waiting for opponent...' 
                    : (gameState.currentTurn === (gameMode === 'single' ? 'player' : socketRef.current?.id) 
                        ? 'Your Turn' 
                        : `${opponentName}'s Turn`))
              }
            </p>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2 md:gap-3 aspect-square w-full max-w-md mx-auto mb-8">
          {gameState.board.map((row, i) => 
            row.map((num, j) => (
              <motion.button
                key={`${i}-${j}`}
                whileHover={!gameState.marked[i][j] && !gameState.isGameOver ? { scale: 1.05 } : {}}
                whileTap={!gameState.marked[i][j] && !gameState.isGameOver ? { scale: 0.95 } : {}}
                onClick={() => handleCellClick(num)}
                disabled={gameState.marked[i][j] || gameState.isGameOver || (gameMode === 'multi' && players.length < 2)}
                className={`
                  aspect-square rounded-xl md:rounded-2xl flex items-center justify-center text-xl md:text-2xl font-bold transition-all border
                  ${gameState.marked[i][j] 
                    ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/40' 
                    : 'bg-[#1e293b] border-slate-700 text-slate-300 hover:border-indigo-500/50 hover:bg-slate-800'}
                  ${gameState.isGameOver ? 'cursor-default' : 'cursor-pointer'}
                `}
              >
                {num}
              </motion.button>
            ))
          )}
        </div>

        <div className="mt-auto flex justify-center pb-8">
          <AnimatePresence>
            {gameState.isGameOver && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center"
              >
                <h3 className="text-3xl font-bold mb-4 text-center">
                  {gameState.winner === playerName ? 'Congratulations!' : 'Better luck next time!'}
                </h3>
                <button
                  onClick={handlePlayAgain}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-12 py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-600/30 transition-all flex items-center gap-3"
                >
                  <RefreshCw className="w-6 h-6" />
                  Play Again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-red-500 text-white px-6 py-3 rounded-xl shadow-2xl z-50">
          {error}
        </div>
      )}
    </div>
  );
}
