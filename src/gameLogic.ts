import { BINGO_LETTERS, CompletedPattern } from './types';

export const generateBoard = (): number[][] => {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  const shuffled = numbers.sort(() => Math.random() - 0.5);
  const board: number[][] = [];
  for (let i = 0; i < 5; i++) {
    board.push(shuffled.slice(i * 5, i * 5 + 5));
  }
  return board;
};

export const getCompletedPatterns = (marked: boolean[][]): CompletedPattern[] => {
  const patterns: CompletedPattern[] = [];

  // Rows
  for (let i = 0; i < 5; i++) {
    if (marked[i].every(val => val)) patterns.push({ type: 'row', index: i });
  }

  // Columns
  for (let j = 0; j < 5; j++) {
    let colComplete = true;
    for (let i = 0; i < 5; i++) {
      if (!marked[i][j]) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) patterns.push({ type: 'col', index: j });
  }

  // Diagonals
  let diag1 = true;
  let diag2 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked[i][i]) diag1 = false;
    if (!marked[i][4 - i]) diag2 = false;
  }
  if (diag1) patterns.push({ type: 'diag', index: 0 });
  if (diag2) patterns.push({ type: 'diag', index: 1 });

  return patterns;
};

export const checkLines = (marked: boolean[][]): number => {
  return getCompletedPatterns(marked).length;
};

export const getBingoProgress = (lines: number): string[] => {
  const progress: string[] = [];
  for (let i = 0; i < Math.min(lines, 5); i++) {
    progress.push(BINGO_LETTERS[i]);
  }
  return progress;
};
