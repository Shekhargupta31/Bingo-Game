export interface Player {
  id: string;
  name: string;
  score: number;
}

export type GameMode = 'single' | 'multi' | null;

export interface GameState {
  board: number[][];
  marked: boolean[][];
  completedLines: number;
  bingoLetters: string[];
  isGameOver: boolean;
  winner: string | null;
  currentTurn: string | null; // ID of the player whose turn it is
}

export const BINGO_LETTERS = ['B', 'I', 'N', 'G', 'O'];
