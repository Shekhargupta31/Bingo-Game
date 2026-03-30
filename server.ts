import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // Socket.io logic
  const rooms = new Map();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("create-room", (roomCode, playerName) => {
      socket.join(roomCode);
      const roomData = {
        players: [{ id: socket.id, name: playerName, score: 0 }],
        currentTurn: 0,
        gameStarted: false,
        selectedNumbers: [],
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
          socket.emit("error", "Room is full");
        }
      } else {
        socket.emit("error", "Room not found");
      }
    });

    socket.on("make-move", ({ roomCode, number }) => {
      const room = rooms.get(roomCode);
      if (room && room.gameStarted) {
        // Broadcast the selected number to everyone in the room
        room.selectedNumbers.push(number);
        io.to(roomCode).emit("number-selected", number);
        
        // Switch turn
        room.currentTurn = (room.currentTurn + 1) % 2;
        io.to(roomCode).emit("turn-change", room.players[room.currentTurn].id);
      }
    });

    socket.on("bingo", ({ roomCode, playerName }) => {
      const room = rooms.get(roomCode);
      if (room) {
        io.to(roomCode).emit("game-over", { winner: playerName });
        room.gameStarted = false;
      }
    });

    socket.on("play-again", (roomCode) => {
      const room = rooms.get(roomCode);
      if (room) {
        room.selectedNumbers = [];
        room.gameStarted = true;
        room.currentTurn = 0;
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
