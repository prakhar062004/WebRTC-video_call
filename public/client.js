let localStream;
let socket;
let peers = {}; // Map of peerId -> RTCPeerConnection
let peersUsernames = {}; // Map of peerId -> username
let localUsername = "";
let isAudioMuted = false;
let isVideoMuted = false;
let isScreenSharing = false;
let screenStream = null;

function updateConnectionStatus(status, detail = "") {
    const badge = document.getElementById("connection-status");
    if (!badge) return;

    badge.textContent = detail ? `${status} — ${detail}` : status;
    badge.className = "status-pill";

    if (status === "Connected") {
        badge.classList.add("connected");
    } else if (status === "Waiting for peer") {
        badge.classList.add("waiting");
    } else if (status === "Disconnected") {
        badge.classList.add("error");
    }
}

function updateIcon(elementId, iconName) {
    const btn = document.getElementById(elementId);
    if (!btn) return;
    const icon = btn.querySelector("[data-lucide]");
    if (icon) {
        icon.setAttribute("data-lucide", iconName);
    }
}

// Initialize lobby preview on page load
document.addEventListener("DOMContentLoaded", () => {
    updateConnectionStatus("Connecting…");
    initLobby();
    lucide.createIcons();
});

// Setup local camera & microphone for pre-call preview
async function initLobby() {
    try {
        console.log("Requesting camera/mic permissions for lobby preview...");
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'user' }, 
            audio: true 
        });
        
        const video = document.getElementById('lobby-video');
        if (video) {
            video.srcObject = localStream;
            video.muted = true;
            video.playsInline = true;
            video.autoplay = true;
        }
        
        // Reset mute buttons state
        isAudioMuted = false;
        isVideoMuted = false;
        
        document.getElementById("lobby-mic-btn").classList.remove("muted");
        updateIcon("lobby-mic-btn", "mic");
        
        document.getElementById("lobby-cam-btn").classList.remove("muted");
        updateIcon("lobby-cam-btn", "video");
        
        document.getElementById("lobby-placeholder").classList.add("hidden");
        document.getElementById("lobby-video").classList.remove("hidden");
    } catch (e) {
        console.error("Lobby preview media access error:", e);
        // Display fallback states
        document.getElementById("lobby-placeholder").classList.remove("hidden");
        document.getElementById("lobby-video").classList.add("hidden");
        
        document.getElementById("lobby-mic-btn").classList.add("muted");
        updateIcon("lobby-mic-btn", "mic-off");
        
        document.getElementById("lobby-cam-btn").classList.add("muted");
        updateIcon("lobby-cam-btn", "video-off");
        
        isAudioMuted = true;
        isVideoMuted = true;
    }
    lucide.createIcons();
}

function toggleLobbyMic() {
    isAudioMuted = !isAudioMuted;
    if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);
    }
    const btn = document.getElementById("lobby-mic-btn");
    btn.classList.toggle("muted", isAudioMuted);
    updateIcon("lobby-mic-btn", isAudioMuted ? "mic-off" : "mic");
    lucide.createIcons();
}

function toggleLobbyCam() {
    isVideoMuted = !isVideoMuted;
    if (localStream) {
        localStream.getVideoTracks().forEach(track => track.enabled = !isVideoMuted);
    }
    const btn = document.getElementById("lobby-cam-btn");
    btn.classList.toggle("muted", isVideoMuted);
    updateIcon("lobby-cam-btn", isVideoMuted ? "video-off" : "video");
    
    document.getElementById("lobby-placeholder").classList.toggle("hidden", !isVideoMuted);
    document.getElementById("lobby-video").classList.toggle("hidden", isVideoMuted);
    lucide.createIcons();
}

// Join the WebSocket signaling server and room
async function joinMeeting() {
    const usernameInput = document.getElementById("username-input");
    const roomInput = document.getElementById("room-input");
    
    const username = usernameInput.value.trim();
    const roomId = roomInput.value.trim() || "main-room";
    
    if (!username) {
        alert("Please enter your name.");
        usernameInput.focus();
        return;
    }
    
    localUsername = username;
    
    // Toggle UI container states
    document.getElementById("lobby-container").classList.add("hidden");
    document.getElementById("call-container").classList.remove("hidden");
    
    const roomInfo = document.getElementById("header-room-info");
    roomInfo.classList.remove("hidden");
    document.getElementById("display-room-id").innerText = roomId;
    
    // Add local video tile to grid
    const video = createVideoTile(null, username, true);
    if (localStream) {
        video.srcObject = localStream;
        
        // Sync active meeting controls to lobby settings
        const micBtn = document.getElementById("mic-btn");
        micBtn.classList.toggle("muted", isAudioMuted);
        updateIcon("mic-btn", isAudioMuted ? "mic-off" : "mic");
        
        const camBtn = document.getElementById("cam-btn");
        camBtn.classList.toggle("muted", isVideoMuted);
        updateIcon("cam-btn", isVideoMuted ? "video-off" : "video");
        
        const localAvatar = document.getElementById("avatar-local");
        if (isVideoMuted) {
            video.classList.add("hidden");
            if (localAvatar) localAvatar.classList.remove("hidden");
        }
        
        const localBadgeMic = document.getElementById("badge-mic-local");
        if (localBadgeMic) {
            localBadgeMic.setAttribute("data-lucide", isAudioMuted ? "mic-off" : "mic");
            localBadgeMic.classList.toggle("active", !isAudioMuted);
        }
    }
    
    console.log(`Connecting socket.io server and joining room: ${roomId}`);
    updateConnectionStatus("Connecting…", "signaling");
    
    // Determine the Socket.IO server URL dynamically:
    // 1. If running locally (localhost, 127.0.0.1, or local IP like 192.168.x.x), connect to the current origin.
    // 2. Otherwise (e.g. deployed to Vercel/GitHub Pages), fall back to the deployed Render server.
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isLocalIP = window.location.hostname.startsWith('192.168.') || 
                      window.location.hostname.startsWith('10.') || 
                      window.location.hostname.startsWith('172.') ||
                      window.location.hostname.startsWith('127.');
    const isStaticHost = window.location.hostname.endsWith('.vercel.app') || 
                         window.location.hostname.endsWith('.github.io');

    const socketServerUrl = (isLocalhost || isLocalIP || !isStaticHost)
        ? window.location.origin
        : 'https://webrtc-video-call-1-2fds.onrender.com';

    console.log(`Using Socket.IO server: ${socketServerUrl}`);
    socket = io(socketServerUrl, {
        transports: ['websocket', 'polling']
    });
    registerSocketEvents();
    
    // Emit join event with client metadata
    socket.emit('join-room', { username: localUsername, roomId });
    lucide.createIcons();
}

function registerSocketEvents() {
    socket.on('connect', () => {
        console.log('Socket connected:', socket.id);
        updateConnectionStatus("Connected", "signaling ready");
    });

    socket.on('connect_error', (error) => {
        console.error('Socket connection error:', error);
        updateConnectionStatus("Disconnected", "connection error");
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected');
        updateConnectionStatus("Disconnected", "socket closed");
    });

    // Receive list of existing participants in room
    socket.on('peers', async (peersList) => {
        console.log("Active peers list:", peersList);
        updateConnectionStatus("Waiting for peer", peersList.length ? "peer found" : "waiting");
        for (let peer of peersList) {
            const peerConnection = makePeerConnection(peer.id, peer.username);
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            
            socket.emit('signal', { to: peer.id, description: peerConnection.localDescription });
        }
    });

    socket.on('peer-joined', async ({ id, username }) => {
        console.log("New peer joined room:", id, username);
        updateConnectionStatus("Waiting for peer", `${username || 'peer'} joined`);
        const peerConnection = makePeerConnection(id, username);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('signal', { to: id, description: peerConnection.localDescription });
    });

    // Receive RTC description / ICE candidate signals
    socket.on('signal', async ({ from, fromUsername, description, candidate }) => {
        const peerConnection = makePeerConnection(from, fromUsername);

        if (description) {
            if (description.type === 'offer') {
                updateConnectionStatus("Connecting", "offer received");
                await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
                await processIceQueue(from);
                
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                socket.emit('signal', { to: from, description: peerConnection.localDescription });
            } else if (description.type === 'answer') {
                updateConnectionStatus("Connecting", "answer received");
                await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
                await processIceQueue(from);
            }
        }

        if (candidate) {
            await handleIceCandidate(from, candidate);
        }
    });

    // Remote peer toggled audio/video
    socket.on('peer-media-toggle', ({ id, type, enabled }) => {
        console.log(`Peer ${id} toggled ${type}:`, enabled);
        if (type === 'video') {
            const video = document.getElementById("v-" + id);
            const avatar = document.getElementById("avatar-" + id);
            if (video && avatar) {
                if (enabled) {
                    video.classList.remove("hidden");
                    avatar.classList.add("hidden");
                } else {
                    video.classList.add("hidden");
                    avatar.classList.remove("hidden");
                }
            }
        } else if (type === 'audio') {
            const badgeMic = document.getElementById("badge-mic-" + id);
            if (badgeMic) {
                badgeMic.setAttribute("data-lucide", enabled ? "mic" : "mic-off");
                badgeMic.classList.toggle("active", enabled);
                lucide.createIcons();
            }
        }
    });

    // Recieve text message
    socket.on('chat-message', ({ fromUsername, text }) => {
        appendChatMessage(fromUsername, text, false);
    });

    // Participant disconnected
    socket.on('peer-left', (id) => {
        console.log("Peer left room:", id);
        removePeer(id);
    });
}

function makePeerConnection(id, username) {
    if (username) {
        peersUsernames[id] = username;
    }
    
    if (peers[id]) return peers[id];

    const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnection.iceQueue = [];

    // Add local tracks (audio/video) to this connection
    if (localStream) {
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
    }

    // Capture and emit local ICE candidate signals
    peerConnection.onicecandidate = event => {
        if (event.candidate) {
            socket.emit('signal', { to: id, candidate: event.candidate });
        }
    };

    // Mount remote media stream on track event
    peerConnection.ontrack = event => {
        console.log(`Stream track received from peer: ${id}`);
        let video = document.getElementById("v-" + id);
        if (!video) {
            video = createVideoTile(id, peersUsernames[id] || "Participant", false);
        }
        video.srcObject = event.streams[0];
    };

    peerConnection.onconnectionstatechange = () => {
        console.log(`RTC state with peer ${id}: ${peerConnection.connectionState}`);
        if (peerConnection.connectionState === 'connected') {
            updateConnectionStatus("Connected", "peer linked");
        } else if (peerConnection.connectionState === 'disconnected' || peerConnection.connectionState === 'failed') {
            removePeer(id);
            updateConnectionStatus("Waiting for peer", "reconnecting");
        }
    };

    peers[id] = peerConnection;
    return peerConnection;
}

// ICE Candidate queue processor to prevent RTCPeerConnection DOMExceptions
async function handleIceCandidate(peerId, candidate) {
    const pc = peers[peerId];
    if (!pc) return;
    
    if (pc.remoteDescription && pc.remoteDescription.type) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error(`Error adding ICE candidate for peer ${peerId}:`, e);
        }
    } else {
        pc.iceQueue.push(candidate);
    }
}

async function processIceQueue(peerId) {
    const pc = peers[peerId];
    if (!pc || !pc.iceQueue) return;
    for (const candidate of pc.iceQueue) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error(`Error adding queued ICE candidate for peer ${peerId}:`, e);
        }
    }
    pc.iceQueue = [];
}

// Generate structural HTML nodes for local/remote video elements
function createVideoTile(id, username, isLocal) {
    const grid = document.getElementById("video-grid");
    
    const tileId = isLocal ? "tile-local" : `tile-${id}`;
    const existing = document.getElementById(tileId);
    if (existing) existing.remove();
    
    const container = document.createElement("div");
    container.className = "tile-container" + (isLocal ? "" : " remote");
    container.id = tileId;
    
    const video = document.createElement("video");
    video.id = isLocal ? "local-video" : `v-${id}`;
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) {
        video.muted = true;
    }
    
    const avatar = document.createElement("div");
    avatar.className = "video-off-avatar hidden";
    avatar.id = isLocal ? "avatar-local" : `avatar-${id}`;
    
    const initials = (username || "G").split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
    avatar.innerHTML = `
        <div class="avatar-circle">${initials}</div>
        <div class="avatar-name">${username}</div>
    `;
    
    const badge = document.createElement("div");
    badge.className = "tile-badge";
    
    const micId = isLocal ? "badge-mic-local" : `badge-mic-${id}`;
    const isMuted = isLocal ? isAudioMuted : false;
    badge.innerHTML = `
        <span>${isLocal ? "You (" + username + ")" : username}</span>
        <i class="mic-status-icon ${isMuted ? '' : 'active'}" id="${micId}" data-lucide="${isMuted ? 'mic-off' : 'mic'}"></i>
    `;
    
    container.appendChild(video);
    container.appendChild(avatar);
    container.appendChild(badge);
    grid.appendChild(container);
    
    lucide.createIcons();
    return video;
}

function removePeer(id) {
    if (peers[id]) {
        peers[id].close();
        delete peers[id];
    }
    const tile = document.getElementById(`tile-${id}`);
    if (tile) {
        tile.remove();
    }
    const name = peersUsernames[id] || "Participant";
    addSystemMessage(`${name} left the room.`);
    delete peersUsernames[id];
}

// Active meeting controls
function toggleMic() {
    isAudioMuted = !isAudioMuted;
    if (localStream) {
        localStream.getAudioTracks().forEach(track => track.enabled = !isAudioMuted);
    }
    
    const btn = document.getElementById("mic-btn");
    btn.classList.toggle("muted", isAudioMuted);
    updateIcon("mic-btn", isAudioMuted ? "mic-off" : "mic");
    
    const localBadgeMic = document.getElementById("badge-mic-local");
    if (localBadgeMic) {
        localBadgeMic.setAttribute("data-lucide", isAudioMuted ? "mic-off" : "mic");
        localBadgeMic.classList.toggle("active", !isAudioMuted);
    }
    
    if (socket) {
        socket.emit("media-toggle", { type: 'audio', enabled: !isAudioMuted });
    }
    lucide.createIcons();
}

function toggleCam() {
    isVideoMuted = !isVideoMuted;
    if (localStream) {
        localStream.getVideoTracks().forEach(track => track.enabled = !isVideoMuted);
    }
    
    const btn = document.getElementById("cam-btn");
    btn.classList.toggle("muted", isVideoMuted);
    updateIcon("cam-btn", isVideoMuted ? "video-off" : "video");
    
    const localVideo = document.getElementById("local-video");
    const localAvatar = document.getElementById("avatar-local");
    if (localVideo && localAvatar) {
        if (isVideoMuted) {
            localVideo.classList.add("hidden");
            localAvatar.classList.remove("hidden");
        } else {
            localVideo.classList.remove("hidden");
            localAvatar.classList.add("hidden");
        }
    }
    
    if (socket) {
        socket.emit("media-toggle", { type: 'video', enabled: !isVideoMuted });
    }
    lucide.createIcons();
}

// Screen Sharing Logic (Replace Tracks dynamically)
async function toggleScreenShare() {
    const btn = document.getElementById("share-btn");
    if (!isScreenSharing) {
        try {
            console.log("Acquiring display capture stream...");
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            const screenTrack = screenStream.getVideoTracks()[0];
            
            for (let id in peers) {
                const pc = peers[id];
                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                if (sender) {
                    await sender.replaceTrack(screenTrack);
                }
            }
            
            const localVideo = document.getElementById("local-video");
            if (localVideo) {
                localVideo.srcObject = screenStream;
                localVideo.style.transform = "scaleX(1)"; // Screen share should not mirror
            }
            
            isScreenSharing = true;
            btn.classList.add("active");
            
            // Revert screen share if browser's native banner is clicked
            screenTrack.onended = () => {
                stopScreenShare();
            };
        } catch (e) {
            console.error("Screen sharing initiation failure:", e);
        }
    } else {
        stopScreenShare();
    }
}

async function stopScreenShare() {
    if (!isScreenSharing) return;
    
    if (screenStream) {
        screenStream.getTracks().forEach(t => t.stop());
        screenStream = null;
    }
    
    const cameraTrack = localStream ? localStream.getVideoTracks()[0] : null;
    
    for (let id in peers) {
        const pc = peers[id];
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && cameraTrack) {
            await sender.replaceTrack(cameraTrack);
        }
    }
    
    const localVideo = document.getElementById("local-video");
    if (localVideo && localStream) {
        localVideo.srcObject = localStream;
        localVideo.style.transform = "scaleX(-1)"; // Mirror local webcam again
    }
    
    isScreenSharing = false;
    const btn = document.getElementById("share-btn");
    btn.classList.remove("active");
}

// Chat UI Handlers
function toggleChatPanel() {
    const panel = document.getElementById("chat-panel");
    const btn = document.getElementById("chat-toggle-btn");
    panel.classList.toggle("hidden");
    btn.classList.toggle("active");
    if (!panel.classList.contains("hidden")) {
        document.getElementById("chat-input").focus();
    }
}

function sendChatMessage() {
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if (!text) return;
    
    if (socket) {
        socket.emit("chat-message", text);
    }
    appendChatMessage("You", text, true);
    input.value = "";
}

function handleChatKey(event) {
    if (event.key === "Enter") {
        sendChatMessage();
    }
}

function appendChatMessage(sender, text, isOutgoing) {
    const container = document.getElementById("chat-messages-container");
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const wrapper = document.createElement("div");
    wrapper.className = `chat-bubble-wrapper ${isOutgoing ? 'outgoing' : 'incoming'}`;
    
    wrapper.innerHTML = `
        <div class="chat-message-meta">
            <span>${sender}</span>
            <span>${time}</span>
        </div>
        <div class="chat-bubble">
            ${escapeHTML(text)}
        </div>
    `;
    
    container.appendChild(wrapper);
    container.scrollTop = container.scrollHeight;
}

function addSystemMessage(text) {
    const container = document.getElementById("chat-messages-container");
    const div = document.createElement("div");
    div.className = "system-msg";
    div.innerText = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

// Clean up peer connections and streams when leaving
function leaveMeeting() {
    if (socket) {
        socket.emit("leave meeting");
        socket.disconnect();
        socket = null;
    }
    
    if (isScreenSharing) {
        stopScreenShare();
    }
    
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
    }
    
    for (let id in peers) {
        peers[id].close();
        const tile = document.getElementById(`tile-${id}`);
        if (tile) tile.remove();
    }
    peers = {};
    peersUsernames = {};
    
    const localTile = document.getElementById("tile-local");
    if (localTile) localTile.remove();
    
    // Clear chat logs
    document.getElementById("chat-messages-container").innerHTML = '<div class="system-msg">Welcome to the room chat!</div>';
    
    isAudioMuted = false;
    isVideoMuted = false;
    isScreenSharing = false;
    
    document.getElementById("call-container").classList.add("hidden");
    document.getElementById("lobby-container").classList.remove("hidden");
    document.getElementById("header-room-info").classList.add("hidden");
    
    // Re-initialize device pre-call streams
    initLobby();
}
