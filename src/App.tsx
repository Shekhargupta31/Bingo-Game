import { useState, useEffect, useCallback, useRef, FormEvent, useLayoutEffect, useMemo } from 'react';
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

type LineSegment = {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export default function App() {
  // User State
  const [playerName, setPlayerName] = useState<string>(localStorage.getItem('bingo_name') || '');
  const [isGuest, setIsGuest] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(!!localStorage.getItem('bingo_name'));
  const [showGuide, setShowGuide] = useState(!!localStorage.getItem('bingo_name'));
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
    isDraw: false,
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
  const [lineSegments, setLineSegments] = useState<LineSegment[]>([]);

  // Refs for state needed in socket listeners to avoid re-binding
  const stateRef = useRef({ playerName, gameMode, activeRoomCode });
  const gameStateRef = useRef(gameState);
  const victoryAudioRef = useRef<HTMLAudioElement | null>(null);
  const victoryAudioTimeoutRef = useRef<number | null>(null);
  const boardFrameRef = useRef<HTMLDivElement | null>(null);
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    stateRef.current = { playerName, gameMode, activeRoomCode };
  }, [playerName, gameMode, activeRoomCode]);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    return () => {
      if (victoryAudioTimeoutRef.current) {
        window.clearTimeout(victoryAudioTimeoutRef.current);
      }
      if (victoryAudioRef.current) {
        victoryAudioRef.current.pause();
        victoryAudioRef.current.currentTime = 0;
      }
    };
  }, []);

  const completedPatterns = useMemo(() => getCompletedPatterns(gameState.marked), [gameState.marked]);
  const completedCellKeys = useMemo(() => new Set(completedPatterns.flatMap(getPatternCells)), [completedPatterns]);
  const isPlayerTurn =
    gameState.currentTurn === (gameMode === 'single' ? 'player' : socketRef.current?.id);
  const currentPlayer = players.find(player => player.id === socketRef.current?.id);

  useLayoutEffect(() => {
    const boardFrame = boardFrameRef.current;
    if (!boardFrame) {
      setLineSegments([]);
      return;
    }

    const computeSegments = () => {
      const boardRect = boardFrame.getBoundingClientRect();
      const nextSegments: LineSegment[] = completedPatterns.flatMap((pattern) => {
        const cells = getPatternCells(pattern);
        const firstCell = cellRefs.current[cells[0]];
        const lastCell = cellRefs.current[cells[cells.length - 1]];

        if (!firstCell || !lastCell || boardRect.width === 0 || boardRect.height === 0) {
          return [];
        }

        const firstRect = firstCell.getBoundingClientRect();
        const lastRect = lastCell.getBoundingClientRect();

        const toPercentX = (value: number) => ((value - boardRect.left) / boardRect.width) * 100;
        const toPercentY = (value: number) => ((value - boardRect.top) / boardRect.height) * 100;

        if (pattern.type === 'row') {
          return [{
            key: getPatternKey(pattern),
            x1: toPercentX(firstRect.left + firstRect.width * 0.12),
            y1: toPercentY(firstRect.top + firstRect.height / 2),
            x2: toPercentX(lastRect.right - lastRect.width * 0.12),
            y2: toPercentY(lastRect.top + lastRect.height / 2),
          }];
        }

        if (pattern.type === 'col') {
          return [{
            key: getPatternKey(pattern),
            x1: toPercentX(firstRect.left + firstRect.width / 2),
            y1: toPercentY(firstRect.top + firstRect.height * 0.12),
            x2: toPercentX(lastRect.left + lastRect.width / 2),
            y2: toPercentY(lastRect.bottom - lastRect.height * 0.12),
          }];
        }

        if (pattern.index === 0) {
          return [{
            key: getPatternKey(pattern),
            x1: toPercentX(firstRect.left + firstRect.width * 0.16),
            y1: toPercentY(firstRect.top + firstRect.height * 0.16),
            x2: toPercentX(lastRect.right - lastRect.width * 0.16),
            y2: toPercentY(lastRect.bottom - lastRect.height * 0.16),
          }];
        }

        return [{
          key: getPatternKey(pattern),
          x1: toPercentX(firstRect.right - firstRect.width * 0.16),
          y1: toPercentY(firstRect.top + firstRect.height * 0.16),
          x2: toPercentX(lastRect.left + lastRect.width * 0.16),
          y2: toPercentY(lastRect.bottom - lastRect.height * 0.16),
        }];
      });

      setLineSegments(nextSegments);
    };

    computeSegments();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => computeSegments())
      : null;

    resizeObserver?.observe(boardFrame);
    Object.values(cellRefs.current).forEach((cell: HTMLButtonElement | null) => {
      if (cell) {
        resizeObserver?.observe(cell);
      }
    });
    window.addEventListener('resize', computeSegments);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', computeSegments);
    };
  }, [completedPatterns, gameState.board]);

  const resetBoard = () => {
    setGameState({
      board: generateBoard(),
      marked: Array(5).fill(null).map(() => Array(5).fill(false)),
      completedLines: 0,
      bingoLetters: [],
      isGameOver: false,
      isDraw: false,
      winner: null,
      currentTurn: null,
    });
  };

  const markNumber = useCallback((num: number, isLocal: boolean) => {
    let markSummary: { found: boolean; completedLines: number; isWinner: boolean } | null = null;

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
      markSummary = { found, completedLines: newLines, isWinner };

      if (isWinner && !prev.isGameOver) {
        if (gameMode === 'single') {
          triggerWin();
          updateScore('player');
          return {
            ...prev,
            marked: newMarked,
            completedLines: newLines,
            bingoLetters: newBingoLetters,
            isGameOver: true,
            isDraw: false,
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
        isDraw: false,
        winner: isWinner ? playerName : prev.winner
      };
    });

    return markSummary;
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

    socket.on('number-selected', ({ number, moveId }: { number: number; moveId: number }) => {
      const result = markNumber(number, false);
      if (result && stateRef.current.activeRoomCode) {
        socket.emit('move-processed', {
          roomCode: stateRef.current.activeRoomCode,
          moveId,
          completedLines: result.completedLines,
          isWinner: result.isWinner,
        });
      }
    });

    socket.on('turn-change', (nextTurnId: string) => {
      setGameState(prev => ({ ...prev, currentTurn: nextTurnId }));
    });

    socket.on('game-over', ({ winner, isTie }: { winner: string | null; isTie: boolean }) => {
      setGameState(prev => ({ ...prev, isGameOver: true, isDraw: isTie, winner }));
      if (isTie) {
        return;
      }

      if (winner === stateRef.current.playerName) {
        triggerWin();
        updateScore('player');
      } else {
        updateScore('opponent');
      }
    });

    socket.on('game-reset', ({ turn }) => {
      resetBoard();
      setGameState(prev => ({ ...prev, currentTurn: turn, isGameOver: false, isDraw: false, winner: null }));
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
        isDraw: false,
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
      setShowGuide(true);
    }
  };

  const handleGuestLogin = () => {
    const guestName = 'Guest_' + Math.floor(Math.random() * 1000);
    setPlayerName(guestName);
    setIsGuest(true);
    setIsLoggedIn(true);
    setShowGuide(true);
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
      particleCount: 220,
      spread: 100,
      startVelocity: 42,
      ticks: 220,
      origin: { y: 0.58 },
      colors: ['#33c3c8', '#ff8a66', '#f5c76b', '#ffffff']
    });
    confetti({
      particleCount: 120,
      angle: 60,
      spread: 70,
      startVelocity: 38,
      origin: { x: 0, y: 0.72 },
      colors: ['#33c3c8', '#f5c76b', '#ff8a66']
    });
    confetti({
      particleCount: 120,
      angle: 120,
      spread: 70,
      startVelocity: 38,
      origin: { x: 1, y: 0.72 },
      colors: ['#33c3c8', '#f5c76b', '#ff8a66']
    });

    if (soundEnabled) {
      if (victoryAudioTimeoutRef.current) {
        window.clearTimeout(victoryAudioTimeoutRef.current);
      }

      if (victoryAudioRef.current) {
        victoryAudioRef.current.pause();
        victoryAudioRef.current.currentTime = 0;
      }

      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/270/270-preview.mp3');
      audio.currentTime = 0;
      victoryAudioRef.current = audio;
      audio.play().catch(() => {});

      victoryAudioTimeoutRef.current = window.setTimeout(() => {
        audio.pause();
        audio.currentTime = 0;
        if (victoryAudioRef.current === audio) {
          victoryAudioRef.current = null;
        }
        victoryAudioTimeoutRef.current = null;
      }, 3000);
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
    setShowGuide(false);
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
              className="w-full rounded-2xl border border-[var(--line)] bg-[var(--surface-soft)] px-4 py-3 text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--teal)] transition-all"
              required
            />
            <button
              type="submit"
              className="interactive-glow w-full rounded-2xl bg-[var(--teal)] py-3 font-semibold text-white transition-all shadow-lg shadow-[rgba(22,124,128,0.2)] hover:bg-[var(--teal-deep)]"
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
              className="interactive-glow w-full rounded-2xl bg-[var(--surface-muted)] py-3 font-semibold text-[var(--ink)] transition-all hover:bg-[#1b4050]"
            >
              Continue as Guest
            </button>
          </form>
        </motion.div>

        <p className="pointer-events-none fixed bottom-4 right-4 text-xs tracking-[0.18em] text-[var(--muted)]/80 sm:bottom-5 sm:right-5">
          Crafted by Shekhar
        </p>
      </div>
    );
  }

  if (!gameMode) {
    if (showGuide) {
      return (
        <div className="app-shell p-6 font-sans">
          <div className="mx-auto max-w-4xl">
            <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl sm:text-3xl font-black text-[var(--ink)]">How to Play</h2>
                <p className="text-[var(--muted)]">A quick guide before you start your first round.</p>
              </div>
              <button onClick={handleLogout} className="interactive-glow soft-pill w-fit rounded-xl p-2 text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
                <LogOut className="h-5 w-5" />
              </button>
            </header>

            <div className="panel-card panel-card-strong rounded-[2rem] p-5 sm:p-8">
              <div className="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <div className="rounded-[1.25rem] bg-[var(--teal)] p-3 sm:p-4 shadow-lg shadow-[rgba(51,195,200,0.2)]">
                  <Trophy className="h-8 w-8 sm:h-10 sm:w-10 text-white" />
                </div>
                <div>
                  <h3 className="text-xl sm:text-2xl font-black text-[var(--ink)]">How to Play BINGO</h3>
                  <p className="text-[var(--muted)]">Simple rules, fast rounds, and clear win conditions.</p>
                </div>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <section className="rounded-[1.6rem] bg-[var(--surface-soft)] p-5">
                  <h4 className="mb-3 text-lg font-bold text-[var(--ink)]">How to Play BINGO</h4>
                  <ul className="space-y-2 text-sm leading-6 text-[var(--muted)]">
                    <li>You will get a 5x5 grid filled with numbers from 1 to 25.</li>
                    <li>Each player has their own separate Bingo board.</li>
                    <li>Select (click) a number to mark it on your board.</li>
                    <li>When a number is played, both players must mark that number on their own board if it exists.</li>
                    <li>You cannot see the opponent&apos;s board, only the number they played.</li>
                  </ul>
                </section>

                <section className="rounded-[1.6rem] bg-[var(--surface-soft)] p-5">
                  <h4 className="mb-3 text-lg font-bold text-[var(--ink)]">Completing Lines</h4>
                  <ul className="space-y-2 text-sm leading-6 text-[var(--muted)]">
                    <li>A line is completed when all 5 cells in a row, column, or diagonal are marked.</li>
                    <li>Each completed line will be counted and visually highlighted.</li>
                  </ul>
                </section>

                <section className="rounded-[1.6rem] bg-[var(--surface-soft)] p-5">
                  <h4 className="mb-3 text-lg font-bold text-[var(--ink)]">BINGO Letters</h4>
                  <ul className="space-y-2 text-sm leading-6 text-[var(--muted)]">
                    <li>The word "BINGO" is shown at the top.</li>
                    <li>Each completed line will cross one letter in order: B, I, N, G, O.</li>
                  </ul>
                </section>

                <section className="rounded-[1.6rem] bg-[var(--surface-soft)] p-5">
                  <h4 className="mb-3 text-lg font-bold text-[var(--ink)]">Winning the Game</h4>
                  <ul className="space-y-2 text-sm leading-6 text-[var(--muted)]">
                    <li>You win when you complete exactly 5 lines.</li>
                    <li>Once 5 lines are completed, the game stops automatically.</li>
                    <li>If both players complete 5 lines at the same time, the match is a tie.</li>
                  </ul>
                </section>
              </div>

              <div className="mt-8 flex justify-center">
                <button
                  onClick={() => setShowGuide(false)}
                  className="interactive-glow min-h-12 w-full sm:w-auto rounded-2xl bg-[var(--coral)] px-8 sm:px-10 py-4 text-base sm:text-lg font-bold text-white shadow-xl shadow-[rgba(255,138,102,0.2)] transition-all hover:bg-[#db6f4e]"
                >
                  Start Game
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="app-shell p-6 font-sans">
        <div className="max-w-4xl mx-auto">
          <header className="mb-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-3xl font-black text-[var(--ink)]">Welcome, {playerName}</h2>
              <p className="text-[var(--muted)]">Pick a mode and jump into a cleaner, easier-to-read board.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
              <div className="soft-pill flex min-w-0 items-center gap-3 rounded-2xl px-4 py-2">
                <span className="text-sm text-[var(--muted)]">Your Code:</span>
                <span className="min-w-0 truncate font-mono font-bold text-[var(--teal)]">{userCode}</span>
                <button onClick={copyCode} className="interactive-glow shrink-0 rounded-lg p-1 transition-colors hover:text-[var(--teal)]">
                  {copied ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button onClick={handleLogout} className="interactive-glow soft-pill w-fit rounded-xl p-2 text-[var(--muted)] transition-colors hover:text-[var(--ink)]">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="grid md:grid-cols-2 gap-8">
            <motion.div 
              whileHover={{ scale: 1.02 }}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className="singleplayer-hero panel-card relative flex cursor-pointer flex-col items-center rounded-[2rem] p-8 text-center group"
              onClick={startSinglePlayer}
            >
              <motion.div
                className="relative z-[1] mb-6 rounded-[1.5rem] bg-[rgba(51,195,200,0.12)] p-6 transition-colors group-hover:bg-[rgba(51,195,200,0.18)]"
                animate={{ y: [0, -4, 0], boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 16px 30px rgba(51,195,200,0.12)', '0 0 0 rgba(0,0,0,0)'] }}
                transition={{ duration: 4.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Monitor className="h-12 w-12 text-[var(--teal)]" />
              </motion.div>
              <motion.div
                className="relative z-[1] mb-6 flex items-center gap-2 rounded-full border border-[rgba(154,194,201,0.16)] bg-[rgba(11,27,35,0.7)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--gold)]"
                animate={{ opacity: [0.74, 1, 0.74], scale: [1, 1.03, 1] }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
              >
                Solo Focus
              </motion.div>
              <h3 className="relative z-[1] mb-2 text-3xl font-black text-[var(--ink)]">Single Player</h3>
              <p className="relative z-[1] mb-6 max-w-sm text-[var(--muted)]">Set the pace yourself, race the computer, and track each turn with a cleaner solo control panel.</p>
              <motion.div
                className="relative z-[1] mb-6 grid w-full gap-3 text-left sm:grid-cols-3"
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.08, delayChildren: 0.08 } },
                }}
              >
                <motion.div
                  className="rounded-2xl border border-[rgba(154,194,201,0.14)] bg-[rgba(9,22,29,0.72)] p-3"
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Mode</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Practice</p>
                </motion.div>
                <motion.div
                  className="rounded-2xl border border-[rgba(154,194,201,0.14)] bg-[rgba(9,22,29,0.72)] p-3"
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Enemy</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Computer</p>
                </motion.div>
                <motion.div
                  className="rounded-2xl border border-[rgba(154,194,201,0.14)] bg-[rgba(9,22,29,0.72)] p-3"
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Goal</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">BINGO</p>
                </motion.div>
              </motion.div>
              <button className="interactive-glow relative z-[1] mt-auto rounded-2xl bg-[var(--teal)] px-8 py-3 font-semibold text-white transition-all shadow-lg shadow-[rgba(51,195,200,0.22)] hover:bg-[var(--teal-deep)]">
                Start Solo Match
              </button>
            </motion.div>

            <motion.div 
              whileHover={{ scale: 1.02 }}
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.45, ease: 'easeOut' }}
              className="multiplayer-hero panel-card relative flex flex-col items-center rounded-[2rem] p-8 text-center group"
            >
              <motion.div
                className="relative z-[1] mb-6 rounded-[1.5rem] bg-[rgba(255,138,102,0.12)] p-6 transition-colors group-hover:bg-[rgba(255,138,102,0.18)]"
                animate={{ y: [0, -4, 0], boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 16px 30px rgba(255,138,102,0.12)', '0 0 0 rgba(0,0,0,0)'] }}
                transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Users className="h-12 w-12 text-[var(--coral)]" />
              </motion.div>
              <motion.div
                className="relative z-[1] mb-6 flex items-center gap-2 rounded-full border border-[rgba(154,194,201,0.16)] bg-[rgba(11,27,35,0.7)] px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--teal)]"
                animate={{ opacity: [0.72, 1, 0.72], scale: [1, 1.03, 1] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                Live Match
              </motion.div>
              <h3 className="relative z-[1] mb-2 text-3xl font-black text-[var(--ink)]">Multiplayer</h3>
              <p className="relative z-[1] mb-6 max-w-sm text-[var(--muted)]">Spin up a private room, invite a friend, and play on a cleaner shared match screen with stronger live turn cues.</p>
              
              <motion.div
                className="relative z-[1] mb-6 grid w-full grid-cols-3 gap-3 text-left"
                initial="hidden"
                animate="show"
                variants={{
                  hidden: {},
                  show: { transition: { staggerChildren: 0.08, delayChildren: 0.08 } },
                }}
              >
                <motion.div
                  className="rounded-2xl border border-[rgba(154,194,201,0.14)] bg-[rgba(9,22,29,0.72)] p-3"
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Step 1</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Create room</p>
                </motion.div>
                <motion.div
                  className="rounded-2xl border border-[rgba(154,194,201,0.14)] bg-[rgba(9,22,29,0.72)] p-3"
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Step 2</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Share code</p>
                </motion.div>
                <motion.div
                  className="rounded-2xl border border-[rgba(154,194,201,0.14)] bg-[rgba(9,22,29,0.72)] p-3"
                  variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
                >
                  <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Step 3</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Play live</p>
                </motion.div>
              </motion.div>

              <div className="relative z-[1] w-full space-y-4">
                <button 
                  onClick={createMultiplayer}
                  className="interactive-glow min-h-12 w-full rounded-2xl bg-[var(--coral)] px-8 py-3 font-semibold text-white transition-all shadow-lg shadow-[rgba(255,138,102,0.25)] hover:bg-[#db6f4e]"
                >
                  Create Private Room
                </button>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="text"
                    maxLength={6}
                    placeholder="Enter 6-digit code"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.replace(/\D/g, ''))}
                    className="min-h-12 flex-grow rounded-2xl border border-[var(--line)] bg-[rgba(8,20,26,0.85)] px-4 py-3 text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--coral)]"
                  />
                  <button 
                    onClick={joinMultiplayer}
                    className="interactive-glow min-h-12 rounded-2xl bg-[var(--surface-muted)] px-6 py-3 font-semibold text-[var(--ink)] transition-all hover:bg-[#1b4050]"
                  >
                    Join
                  </button>
                </div>
                <p className="text-xs text-[var(--muted)]">Tip: share the code shown in your profile chip for the fastest room join.</p>
              </div>
            </motion.div>
          </div>

          <div className="panel-card mt-12 rounded-[2rem] p-6">
            <h4 className="mb-4 flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
              <Trophy className="h-5 w-5 text-[var(--gold)]" />
              Your Stats
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
                <p className="text-sm text-[var(--muted)]">Wins</p>
                <p className="text-2xl font-black text-[var(--ink)]">{scores.player}</p>
              </div>
              <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
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
    <div className="app-shell mode-stage p-4 font-sans flex flex-col">
      <div className={`mode-atmosphere ${gameMode === 'multi' ? 'multi-atmosphere' : 'single-atmosphere'}`}>
        <div className="mode-grid" />
        <div className="mode-3d-layer">
          <div className="mode-shape shape-cube" />
          <div className="mode-shape shape-ring" />
          <div className="mode-shape shape-pyramid" />
        </div>
        <div className="mode-orb mode-orb-one" />
        <div className="mode-orb mode-orb-two" />
        <div className="mode-orb mode-orb-three" />
        <div className="mode-particle mode-particle-1" />
        <div className="mode-particle mode-particle-2" />
        <div className="mode-particle mode-particle-3" />
        <div className="mode-particle mode-particle-4" />
      </div>

      <div className="relative z-[1] max-w-2xl mx-auto w-full flex-grow flex flex-col">
        <header className="panel-card mb-6 flex flex-col gap-4 rounded-[2rem] px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <button 
            onClick={() => setGameMode(null)}
            className="interactive-glow soft-pill w-fit rounded-xl p-2 text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className={`soft-pill flex items-center gap-2 rounded-full px-3 py-1.5 text-xs sm:text-sm ${isConnected ? 'text-[var(--success)]' : 'text-[var(--coral)]'}`}>
              {isConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              {isConnected ? 'Connected' : 'Offline'}
            </div>
            {gameMode === 'multi' && activeRoomCode && (
              <div className="soft-pill rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold text-[var(--teal)]">
                Room {activeRoomCode}
              </div>
            )}
            <div className="text-left sm:text-right">
              <p className="text-xs sm:text-sm text-[var(--muted)]">Score</p>
              <p className="font-black text-[var(--teal)]">{scores.player} - {scores.opponent}</p>
            </div>
            <button 
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="soft-pill min-h-10 min-w-10 rounded-xl p-2 text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
            >
              {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
            </button>
          </div>
        </header>

        <div className="flex flex-col items-center mb-8">
          <div className="mb-6 flex flex-wrap justify-center gap-2 sm:gap-4">
            {BINGO_LETTERS.map((letter) => (
              <motion.div
                key={letter}
                animate={{
                  scale: gameState.bingoLetters.includes(letter) ? 1.1 : 1,
                  backgroundColor: gameState.bingoLetters.includes(letter) ? '#16979d' : 'rgba(19, 42, 53, 0.86)',
                  color: gameState.bingoLetters.includes(letter) ? '#ffffff' : '#93a8af'
                }}
                className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl sm:rounded-2xl border border-[var(--line)] text-xl sm:text-2xl font-black shadow-lg"
              >
                {letter}
              </motion.div>
            ))}
          </div>
          
          <div className="soft-pill mb-3 rounded-full px-6 py-2">
            <p className="font-semibold text-[var(--teal)]">
              {gameState.isGameOver 
                ? (gameState.isDraw ? "It's a Tie" : (gameState.winner === playerName ? 'You Won!' : `${opponentName} Won!`))
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

          {gameMode === 'multi' && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="multiplayer-hero panel-card mb-6 w-full max-w-xl rounded-[1.9rem] p-4 sm:p-5"
            >
              <div className="relative z-[1] mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Multiplayer Room</p>
                  <p className="text-lg font-black text-[var(--ink)]">{activeRoomCode}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="soft-pill rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold text-[var(--teal)]">
                    {players.length}/2 Players
                  </div>
                  {activeRoomCode && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(activeRoomCode);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="interactive-glow soft-pill min-h-10 rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold text-[var(--ink)] transition-colors hover:text-[var(--teal)]"
                    >
                      {copied ? 'Copied' : 'Copy code'}
                    </button>
                  )}
                </div>
              </div>

              <motion.div
                className="relative z-[1] mb-4 flex flex-col gap-3 rounded-[1.6rem] border border-[rgba(154,194,201,0.14)] bg-[rgba(8,20,26,0.68)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                animate={players.length === 2 ? { boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 0 0 1px rgba(51,195,200,0.16)', '0 0 0 rgba(0,0,0,0)'] } : { boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 0 0 1px rgba(255,138,102,0.14)', '0 0 0 rgba(0,0,0,0)'] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Match Pulse</p>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {players.length === 2
                      ? (isPlayerTurn ? 'Your move is live now.' : `${opponentName} is deciding their move.`)
                      : 'Room is ready. Waiting for one more player to join.'}
                  </p>
                </div>
                <div className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] ${players.length === 2 ? 'bg-[rgba(99,215,160,0.14)] text-[var(--success)]' : 'bg-[rgba(255,138,102,0.14)] text-[var(--coral)]'}`}>
                  {players.length === 2 ? 'Match On' : 'Standby'}
                </div>
              </motion.div>

              <div className="relative z-[1] grid gap-3">
                <motion.div
                  key={`you-${isPlayerTurn}-${players.length}`}
                  initial={{ opacity: 0.7, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  className={`rounded-[1.6rem] border px-4 py-4 ${isPlayerTurn ? 'border-[rgba(51,195,200,0.5)] bg-[rgba(51,195,200,0.12)] shadow-lg shadow-[rgba(51,195,200,0.08)]' : 'border-[var(--line)] bg-[rgba(8,20,26,0.68)]'}`}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(51,195,200,0.16)] text-lg font-black text-[var(--teal)]">
                      {(currentPlayer?.name || playerName).slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">You</p>
                      <p className="text-lg font-bold text-[var(--ink)]">{currentPlayer?.name || playerName}</p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--muted)]">{isPlayerTurn && players.length === 2 ? 'Tap any open number to keep the pressure on.' : 'Your board is synced and ready.'}</p>
                </motion.div>

                <motion.div
                  key={`opp-${isPlayerTurn}-${players.length}`}
                  initial={{ opacity: 0.7, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.28, ease: 'easeOut', delay: 0.04 }}
                  className={`rounded-[1.6rem] border px-4 py-4 ${!isPlayerTurn && players.length === 2 ? 'border-[rgba(255,138,102,0.46)] bg-[rgba(255,138,102,0.1)] shadow-lg shadow-[rgba(255,138,102,0.08)]' : 'border-[var(--line)] bg-[rgba(8,20,26,0.68)]'}`}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(255,138,102,0.14)] text-lg font-black text-[var(--coral)]">
                      {players.length === 2 ? opponentName.slice(0, 1).toUpperCase() : '?'}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Opponent</p>
                      <p className="text-lg font-bold text-[var(--ink)]">{players.length === 2 ? opponentName : 'Waiting for player'}</p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--muted)]">
                    {players.length === 2 ? (isPlayerTurn ? 'They are watching your move.' : 'Their turn is active now.') : 'Invite a friend with the room code above.'}
                  </p>
                </motion.div>
              </div>
            </motion.div>
          )}

          {gameMode === 'single' && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="singleplayer-hero panel-card mb-6 w-full max-w-xl rounded-[1.9rem] p-4 sm:p-5"
            >
              <div className="relative z-[1] mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-[var(--muted)]">Solo Match</p>
                  <p className="text-lg font-black text-[var(--ink)]">You vs Computer</p>
                </div>
                <div className="soft-pill rounded-full px-3 py-1.5 text-xs sm:text-sm font-semibold text-[var(--gold)]">
                  Best of Focus
                </div>
              </div>

              <motion.div
                className="relative z-[1] mb-4 flex flex-col gap-3 rounded-[1.6rem] border border-[rgba(154,194,201,0.14)] bg-[rgba(8,20,26,0.68)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                animate={isPlayerTurn ? { boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 0 0 1px rgba(51,195,200,0.16)', '0 0 0 rgba(0,0,0,0)'] } : { boxShadow: ['0 0 0 rgba(0,0,0,0)', '0 0 0 1px rgba(245,199,107,0.16)', '0 0 0 rgba(0,0,0,0)'] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              >
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Solo Pulse</p>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {gameState.isGameOver
                      ? (gameState.winner === playerName ? 'You closed it out. Great finish.' : 'Computer stole the round. Reset and answer back.')
                      : (isPlayerTurn ? 'Your move is active. Pick your next number.' : 'Computer is thinking through its next move.')}
                  </p>
                </div>
                <div className={`rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.2em] ${isPlayerTurn ? 'bg-[rgba(51,195,200,0.14)] text-[var(--teal)]' : 'bg-[rgba(245,199,107,0.14)] text-[var(--gold)]'}`}>
                  {isPlayerTurn ? 'Your Turn' : 'Computer'}
                </div>
              </motion.div>

              <div className="relative z-[1] grid gap-3 md:grid-cols-2">
                <motion.div
                  key={`solo-you-${isPlayerTurn}-${gameState.isGameOver}`}
                  initial={{ opacity: 0.7, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  className={`rounded-[1.6rem] border px-4 py-4 ${isPlayerTurn ? 'border-[rgba(51,195,200,0.5)] bg-[rgba(51,195,200,0.12)] shadow-lg shadow-[rgba(51,195,200,0.08)]' : 'border-[var(--line)] bg-[rgba(8,20,26,0.68)]'}`}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(51,195,200,0.16)] text-lg font-black text-[var(--teal)]">
                      {playerName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">You</p>
                      <p className="text-lg font-bold text-[var(--ink)]">{playerName}</p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--muted)]">Build lines early and keep pressure on every open lane.</p>
                </motion.div>

                <motion.div
                  key={`solo-ai-${isPlayerTurn}-${gameState.isGameOver}`}
                  initial={{ opacity: 0.7, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.28, ease: 'easeOut', delay: 0.04 }}
                  className={`rounded-[1.6rem] border px-4 py-4 ${!isPlayerTurn && !gameState.isGameOver ? 'border-[rgba(245,199,107,0.42)] bg-[rgba(245,199,107,0.1)] shadow-lg shadow-[rgba(245,199,107,0.06)]' : 'border-[var(--line)] bg-[rgba(8,20,26,0.68)]'}`}
                >
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(245,199,107,0.14)] text-lg font-black text-[var(--gold)]">
                      C
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Computer</p>
                      <p className="text-lg font-bold text-[var(--ink)]">AI Rival</p>
                    </div>
                  </div>
                  <p className="text-sm text-[var(--muted)]">Takes a short beat between turns so the solo match feels alive.</p>
                </motion.div>
              </div>
            </motion.div>
          )}
        </div>

        <div className="board-wrap w-full max-w-[min(100%,26rem)] sm:max-w-md mx-auto mb-8 p-2 sm:p-3">
          <div ref={boardFrameRef} className="relative aspect-square w-full">
            <svg
              className="pointer-events-none absolute inset-0 z-[3] h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <linearGradient id="bingoStrike" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#0b1114" />
                  <stop offset="100%" stopColor="#1b2328" />
                </linearGradient>
              </defs>
              {lineSegments.map((segment) => {
                return (
                  <g key={segment.key}>
                    <motion.line
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      x1={segment.x1}
                      y1={segment.y1}
                      x2={segment.x2}
                      y2={segment.y2}
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth="6"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <motion.line
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      x1={segment.x1}
                      y1={segment.y1}
                      x2={segment.x2}
                      y2={segment.y2}
                      stroke="url(#bingoStrike)"
                      strokeWidth="4"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
            </svg>

            <div className="grid grid-cols-5 gap-1.5 sm:gap-2 md:gap-3 aspect-square w-full">
            {gameState.board.map((row, i) => 
              row.map((num, j) => {
                const isMarked = gameState.marked[i][j];
                const isCompletedCell = completedCellKeys.has(`${i}-${j}`);

                return (
                  <motion.button
                    key={`${i}-${j}`}
                    ref={(node) => {
                      cellRefs.current[`${i}-${j}`] = node;
                    }}
                    whileHover={!isMarked && !gameState.isGameOver ? { scale: 1.05 } : {}}
                    whileTap={!isMarked && !gameState.isGameOver ? { scale: 0.95 } : {}}
                    onClick={() => handleCellClick(num)}
                    disabled={isMarked || gameState.isGameOver || (gameMode === 'multi' && players.length < 2)}
                    className={`
                      interactive-glow relative z-[1] min-h-12 aspect-square rounded-xl sm:rounded-2xl md:rounded-[1.4rem] flex items-center justify-center text-lg sm:text-xl md:text-2xl font-black transition-all border touch-manipulation
                      ${isMarked 
                        ? 'bg-[var(--teal)] border-[rgba(17,94,97,0.6)] text-white shadow-lg shadow-[rgba(22,124,128,0.25)]' 
                        : 'bg-[var(--surface-soft)] border-[var(--line)] text-[var(--ink)] hover:border-[rgba(51,195,200,0.38)] hover:bg-[#173643]'}
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
        </div>

        <div className="mt-auto flex justify-center pb-8">
          <AnimatePresence>
            {gameState.isGameOver && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="panel-card-strong flex w-full max-w-md flex-col items-center rounded-[2rem] px-5 sm:px-8 py-6 sm:py-7"
              >
                <h3 className="mb-2 text-center text-3xl font-black text-[var(--ink)]">
                  {gameState.isDraw ? "Match Draw" : (gameState.winner === playerName ? 'Congratulations!' : 'Better luck next time!')}
                </h3>
                <p className="mb-5 text-center text-[var(--muted)]">
                  {gameState.isDraw
                    ? 'Both boards hit five lines on the same move. The round ends as a tie.'
                    : (gameState.winner === playerName ? 'Your completed lines are locked in with a victory strike.' : 'Reset and chase a faster five-line finish.')}
                </p>
                <button
                  onClick={handlePlayAgain}
                  className="interactive-glow min-h-12 flex w-full sm:w-auto items-center justify-center gap-3 rounded-2xl bg-[var(--coral)] px-8 sm:px-12 py-4 text-base sm:text-lg font-bold text-white shadow-xl shadow-[rgba(217,107,79,0.25)] transition-all hover:bg-[#c65a3f]"
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
        <div className="fixed bottom-4 sm:bottom-8 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 rounded-2xl bg-[var(--coral)] px-4 sm:px-6 py-3 text-center text-white shadow-2xl">
          {error}
        </div>
      )}
    </div>
  );
}
