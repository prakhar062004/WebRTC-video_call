import express from "express";
import https from "https";
import { Server } from "socket.io";
import fs from "fs";

const app = express();

const httpsServer = https.createServer(
  {
    cert: fs.readFileSync("./cert/server.crt"),
    key: fs.readFileSync("./cert/server.key"),
  },
  app
);

app.use(express.static("public"));

const io = new Server(httpsServer, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-room", ({ username }) => {
    socket.username = username || "Guest " + socket.id.substring(0, 4);
    console.log(`${socket.username} (${socket.id}) joined the room`);

    const peers = [];
    io.sockets.sockets.forEach((s) => {
      if (s.id !== socket.id && s.username) {
        peers.push({
          id: s.id,
          username: s.username,
        });
      }
    });
    socket.emit("peers", peers);
  });

  socket.on("signal", ({ to, description, candidate }) => {
    if (to) {
      io.to(to).emit("signal", {
        from: socket.id,
        fromUsername: socket.username || "Guest",
        description,
        candidate,
      });
    }
  });

  socket.on("chat-message", (message) => {
    socket.broadcast.emit("chat-message", {
      from: socket.id,
      fromUsername: socket.username || "Guest",
      text: message,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on("media-toggle", ({ type, enabled }) => {
    socket.broadcast.emit("peer-media-toggle", {
      id: socket.id,
      type,
      enabled,
    });
  });

  socket.on("leave meeting", () => {
    socket.disconnect(true);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    socket.broadcast.emit("peer-left", socket.id);
  });
});

// IMPORTANT: use httpsServer, not app.listen
httpsServer.listen(3000, () => {
  console.log("Server running at https://localhost:3000");
});
