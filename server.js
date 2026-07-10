import express from "express";
import http from "http";
import https from "https";
import { Server } from "socket.io";
import fs from "fs";
import { fileURLToPath } from "url";

const app = express();

app.use(express.static("public"));

function createServer({ useHttps = true } = {}) {
  const certPath = "./cert/server.crt";
  const keyPath = "./cert/server.key";
  const hasCertFiles = useHttps && fs.existsSync(certPath) && fs.existsSync(keyPath);

  if (hasCertFiles) {
    return {
      server: https.createServer(
        {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath),
        },
        app
      ),
      protocol: "https",
    };
  }

  return {
    server: http.createServer(app),
    protocol: "http",
  };
}

function attachSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

socket.on("join-room", ({ username, roomId }) => {
    const room = roomId || "main-room";
    socket.join(room);
    socket.username = username || "Guest " + socket.id.substring(0, 4);
    console.log(`${socket.username} (${socket.id}) joined room ${room}`);

    const roomSockets = io.sockets.adapter.rooms.get(room) || new Set();
    const peers = [];
    roomSockets.forEach((peerId) => {
      if (peerId === socket.id) return;
      const peerSocket = io.sockets.sockets.get(peerId);
      if (peerSocket?.username) {
        peers.push({
          id: peerId,
          username: peerSocket.username,
        });
      }
    });

    socket.emit("peers", peers);
    socket.to(room).emit("peer-joined", {
      id: socket.id,
      username: socket.username,
    });
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
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
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
}

export function startServer({
  port = Number(process.env.PORT) || 3000,
  host = process.env.HOST || "0.0.0.0",
  useHttps = process.env.USE_HTTPS !== "false",
} = {}) {
  const { server, protocol } = createServer({ useHttps });
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  attachSocketHandlers(io);

  return new Promise((resolve, reject) => {
    const tryListen = (candidatePort) => {
      const onError = (error) => {
        if (error.code === "EADDRINUSE") {
          server.removeListener("error", onError);
          tryListen(candidatePort + 1);
          return;
        }

        server.removeListener("error", onError);
        reject(error);
      };

      server.once("error", onError);
      server.listen(candidatePort, host, () => {
        server.removeListener("error", onError);
        console.log(`Server running at ${protocol}://${host}:${candidatePort}`);
        resolve({ app, server, io, port: candidatePort, protocol });
      });
    };

    tryListen(port);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
