import { html, render } from 'lit';

const room = new WebsimSocket();

const urlParams = new URLSearchParams(window.location.search);
const streamId = urlParams.get('id');

const streamTitle = document.getElementById('stream-title');
const streamView = document.getElementById('stream-view');
const streamerControls = document.getElementById('streamer-controls');
const startSharingBtn = document.getElementById('start-sharing-btn');
const stopSharingBtn = document.getElementById('stop-sharing-btn');
const statusText = document.getElementById('status-text');

const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

let localMediaStream = null;
let frameCaptureInterval = null;
const FPS = 2; // Capture 2 frames per second

function renderChat(messages) {
    const messageList = messages ? Object.values(messages).sort((a, b) => b.timestamp - a.timestamp) : [];
    
    const chatContent = messageList.map(msg => {
        const username = room.peers[msg.senderId]?.username || '...';
        return html`
            <div class="chat-message">
                <strong>${username}:</strong>
                <span>${msg.text}</span>
            </div>
        `;
    });

    render(html`${chatContent}`, chatMessages);
}

async function captureAndUploadFrame() {
    if (!localMediaStream) return;

    const videoTrack = localMediaStream.getVideoTracks()[0];
    const imageCapture = new ImageCapture(videoTrack);

    try {
        const bitmap = await imageCapture.grabFrame();
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);

        canvas.toBlob(async (blob) => {
            if (!blob) return;
            try {
                const url = await window.websim.upload(blob);
                room.updatePresence({
                    streamFrameUrl: url,
                    frameTimestamp: Date.now()
                });
            } catch (e) {
                console.error("Upload failed:", e);
                statusText.textContent = "Error: Could not upload frame.";
            }
        }, 'image/jpeg', 0.6);

    } catch (e) {
        console.error("Frame capture failed:", e);
    }
}

async function startSharing() {
    try {
        localMediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: FPS },
            audio: false
        });

        const video = document.createElement('video');
        video.srcObject = localMediaStream;
        video.muted = true;
        video.play();
        
        // Hide video element, we only need it for capturing
        video.style.display = 'none';
        document.body.appendChild(video);
        
        streamView.innerHTML = '';
        const img = document.createElement('img');
        img.alt = 'Your screen share preview';
        streamView.appendChild(img);


        localMediaStream.getVideoTracks()[0].onended = stopSharing;
        
        room.updateRoomState({ streams: { [streamId]: { ...room.roomState.streams[streamId], isLive: true } } });
        frameCaptureInterval = setInterval(captureAndUploadFrame, 1000 / FPS);

        startSharingBtn.classList.add('hidden');
        stopSharingBtn.classList.remove('hidden');
        statusText.textContent = 'Streaming live!';

    } catch (err) {
        console.error("Error starting screen share:", err);
        statusText.textContent = "Could not start screen share.";
    }
}

function stopSharing() {
    if (localMediaStream) {
        localMediaStream.getTracks().forEach(track => track.stop());
        localMediaStream = null;
    }
    if (frameCaptureInterval) {
        clearInterval(frameCaptureInterval);
        frameCaptureInterval = null;
    }
    room.updateRoomState({ streams: { [streamId]: { ...room.roomState.streams[streamId], isLive: false } } });
    room.updatePresence({ streamFrameUrl: null, frameTimestamp: null });

    startSharingBtn.classList.remove('hidden');
    stopSharingBtn.classList.add('hidden');
    statusText.textContent = 'Stream ended.';
    streamView.innerHTML = '<p>You have stopped sharing.</p>';
}

function updateViewer(streamerPresence) {
    if (streamerPresence?.streamFrameUrl) {
        let img = streamView.querySelector('img');
        if (!img) {
            streamView.innerHTML = '';
            img = document.createElement('img');
            img.alt = "Live stream feed";
            streamView.appendChild(img);
        }
        // Only update src if it's a new frame
        if (img.src !== streamerPresence.streamFrameUrl) {
            img.src = streamerPresence.streamFrameUrl;
        }
    } else {
        const currentStream = room.roomState.streams?.[streamId];
        if (currentStream && currentStream.isLive) {
            streamView.innerHTML = `<p>Stream is live, waiting for frames...</p>`;
        } else {
            streamView.innerHTML = `<p>Stream is offline.</p>`;
        }
    }
}

function handleSendChat() {
    const text = chatInput.value.trim();
    if (text === '') return;

    const messageId = `${room.clientId}-${Date.now()}`;
    room.updateRoomState({
        streams: {
            [streamId]: {
                ...room.roomState.streams[streamId],
                chat: {
                    ...room.roomState.streams[streamId]?.chat,
                    [messageId]: {
                        id: messageId,
                        senderId: room.clientId,
                        text: text,
                        timestamp: Date.now()
                    }
                }
            }
        }
    });

    chatInput.value = '';
}

async function init() {
    if (!streamId) {
        document.getElementById('app').innerHTML = '<h1>Stream not found</h1><a href="/">Go back home</a>';
        return;
    }

    await room.initialize();

    const isOwner = room.clientId === streamId;

    if (isOwner) {
        streamerControls.classList.remove('hidden');
        startSharingBtn.onclick = startSharing;
        stopSharingBtn.onclick = stopSharing;
        statusText.textContent = "Ready to stream. Click 'Start Screen Share'.";
        
        // Add a handler to clean up when the page is closed
        window.addEventListener('beforeunload', () => {
            // This attempts to remove the stream, but may not always run
            room.updateRoomState({ streams: { [streamId]: null } });
        });

    } else {
        streamView.innerHTML = '<p>Connecting to stream...</p>';
    }

    room.subscribeRoomState((state) => {
        const currentStream = state.streams?.[streamId];
        if (currentStream) {
            streamTitle.textContent = currentStream.title;
            renderChat(currentStream.chat);
        } else {
            // Stream ended
            document.getElementById('app').innerHTML = '<h1>Stream has ended</h1><a href="/">Go back home</a>';
        }
    });

    room.subscribePresence((presence) => {
        if (!isOwner) {
            updateViewer(presence[streamId]);
        } else {
             // update my own preview
            const myPresence = presence[room.clientId];
             if(myPresence?.streamFrameUrl) {
                const img = streamView.querySelector('img');
                if (img && img.src !== myPresence.streamFrameUrl) {
                    img.src = myPresence.streamFrameUrl;
                }
            }
        }
    });

    const initialStreamData = room.roomState.streams?.[streamId];
    if (initialStreamData) {
        streamTitle.textContent = initialStreamData.title;
        renderChat(initialStreamData.chat);
    } else if (!isOwner) {
         document.getElementById('app').innerHTML = '<h1>Stream not found or has ended</h1><a href="/">Go back home</a>';
         return;
    }

    if (!isOwner) {
        updateViewer(room.presence[streamId]);
    }

    sendChatBtn.onclick = handleSendChat;
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleSendChat();
        }
    });
}

init();

