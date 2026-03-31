import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

type Player = {
  id: string;
  name: string;
  score: number;
};

type RoomData = {
  players: Player[];
  currentTurn: number;
  gameStarted: boolean;
  selectedNumbers: number[];
  moveSequence: number;
  pendingMove: {
    moveId: number;
    responses: Map<string, { completedLines: number; isWinner: boolean }>;
    timeoutId: ReturnType<typeof setTimeout> | null;
  } | null;
};

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = Number(process.env.PORT) || 3000;

  // Socket.io logic
  const rooms = new Map<string, RoomData>();

  const finalizePendingMove = (roomCode: string, room: RoomData) => {
    if (!room.pendingMove) {
      return;
    }

    if (room.pendingMove.timeoutId) {
      clearTimeout(room.pendingMove.timeoutId);
    }

    const winners = room.players.filter((player) => room.pendingMove?.responses.get(player.id)?.isWinner);

    room.pendingMove = null;

    if (winners.length === 2) {
      room.gameStarted = false;
      io.to(roomCode).emit("gameOver", { winner: null, isTie: true });
      return;
    }

    if (winners.length === 1) {
      room.gameStarted = false;
      io.to(roomCode).emit("gameOver", { winner: winners[0].name, isTie: false });
      return;
    }

    room.currentTurn = (room.currentTurn + 1) % room.players.length;
    io.to(roomCode).emit("turn-change", room.players[room.currentTurn].id);
  };

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create-room", (roomCode, playerName) => {
      if (rooms.has(roomCode)) {
        socket.emit("room-error", "Room code already exists");
        return;
      }

      socket.join(roomCode);
      const roomData = {
        players: [{ id: socket.id, name: playerName, score: 0 }],
        currentTurn: 0,
        gameStarted: false,
        selectedNumbers: [],
        moveSequence: 0,
        pendingMove: null,
      };
      rooms.set(roomCode, roomData);
      console.log(`Room ${roomCode} created by ${playerName}`);
      
      // Send confirmation back to creator with current players
      socket.emit("room-created", {
        roomCode,
        players: roomData.players
      });
    });

    socket.on("join-room", (roomCode, playerName) => {
      const room = rooms.get(roomCode);
      if (room) {
        if (room.players.length < 2) {
          socket.join(roomCode);
          room.players.push({ id: socket.id, name: playerName, score: 0 });
          console.log(`${playerName} joined room ${roomCode}`);
          
          // Notify the joining player
          socket.emit("room-joined", {
            roomCode,
            players: room.players
          });
          
          // Notify the other player in the room
          socket.to(roomCode).emit("player-joined", room.players);
          
          if (room.players.length === 2) {
            room.gameStarted = true;
            io.to(roomCode).emit("game-start", {
              players: room.players,
              turn: room.players[room.currentTurn].id
            });
          }
        } else {
          socket.emit("room-error", "Room is full");
        }
      } else {
        socket.emit("room-error", "Room not found");
      }
    });

    socket.on("make-move", ({ roomCode, number }) => {
      const room = rooms.get(roomCode);
      if (room && room.gameStarted) {
        if (room.pendingMove) {
          socket.emit("room-error", "Wait for the current move to finish");
          return;
        }

        if (room.players[room.currentTurn]?.id !== socket.id) {
          socket.emit("room-error", "It is not your turn");
          return;
        }

        if (room.selectedNumbers.includes(number)) {
          socket.emit("room-error", "That number was already selected");
          return;
        }

        // Broadcast the selected number to everyone in the room
        room.selectedNumbers.push(number);
        room.moveSequence += 1;
        room.pendingMove = {
          moveId: room.moveSequence,
          responses: new Map(),
          timeoutId: setTimeout(() => {
            const activeRoom = rooms.get(roomCode);
            if (activeRoom) {
              finalizePendingMove(roomCode, activeRoom);
            }
          }, 1500),
        };

        io.to(roomCode).emit("number-selected", { number, moveId: room.moveSequence });
      }
    });

    socket.on("move-processed", ({ roomCode, moveId, completedLines, isWinner }) => {
      const room = rooms.get(roomCode);
      if (!room || !room.pendingMove || room.pendingMove.moveId !== moveId) {
        return;
      }

      room.pendingMove.responses.set(socket.id, { completedLines, isWinner });

      if (room.pendingMove.responses.size < room.players.length) {
        return;
      }

      finalizePendingMove(roomCode, room);
    });

    socket.on("play-again", (roomCode) => {
      const room = rooms.get(roomCode);
      if (room && room.players.length === 2) {
        room.selectedNumbers = [];
        room.gameStarted = true;
        room.currentTurn = 0;
        if (room.pendingMove?.timeoutId) {
          clearTimeout(room.pendingMove.timeoutId);
        }
        room.pendingMove = null;
        io.to(roomCode).emit("game-reset", {
          turn: room.players[room.currentTurn].id
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      // Clean up rooms if needed
      for (const [roomCode, room] of rooms.entries()) {
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          room.players.splice(playerIndex, 1);
          if (room.players.length === 0) {
            rooms.delete(roomCode);
          } else {
            io.to(roomCode).emit("player-left");
            room.gameStarted = false;
            room.currentTurn = 0;
            room.selectedNumbers = [];
            if (room.pendingMove?.timeoutId) {
              clearTimeout(room.pendingMove.timeoutId);
            }
            room.pendingMove = null;
          }
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
