import { BINGO_LETTERS } from './types';

export const generateBoard = (): number[][] => {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  const shuffled = numbers.sort(() => Math.random() - 0.5);
  const board: number[][] = [];
  for (let i = 0; i < 5; i++) {
    board.push(shuffled.slice(i * 5, i * 5 + 5));
  }
  return board;
};

export const checkLines = (marked: boolean[][]): number => {
  let lines = 0;

  // Rows
  for (let i = 0; i < 5; i++) {
    if (marked[i].every(val => val)) lines++;
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
    if (colComplete) lines++;
  }

  // Diagonals
  let diag1 = true;
  let diag2 = true;
  for (let i = 0; i < 5; i++) {
    if (!marked[i][i]) diag1 = false;
    if (!marked[i][4 - i]) diag2 = false;
  }
  if (diag1) lines++;
  if (diag2) lines++;

  return lines;
};

export const getBingoProgress = (lines: number): string[] => {
  const progress: string[] = [];
  for (let i = 0; i < Math.min(lines, 5); i++) {
    progress.push(BINGO_LETTERS[i]);
  }
  return progress;
};
