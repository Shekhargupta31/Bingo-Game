export interface Player {
  id: string;
  name: string;
  score: number;
}

export type GameMode = 'single' | 'multi' | null;

export type CompletedPattern =
  | { type: 'row'; index: number }
  | { type: 'col'; index: number }
  | { type: 'diag'; index: 0 | 1 };

export interface GameState {
  board: number[][];
  marked: boolean[][];
  completedLines: number;
  bingoLetters: string[];
  isGameOver: boolean;
  isDraw: boolean;
  winner: string | null;
  currentTurn: string | null; // ID of the player whose turn it is
}

export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
