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
let mediaRecorder = null;
const CHUNK_DURATION = 1000; // milliseconds

// For viewer video/audio playback
let mediaSource;
let sourceBuffer;
let mediaQueue = [];
let isAppending = false;
let viewerVideoElement;

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

async function startSharing() {
    try {
        localMediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                frameRate: 15,
                width: { ideal: 1280 },
                height: { ideal: 720 }
            },
            audio: true
        });

        streamView.innerHTML = '';
        const video = document.createElement('video');
        video.srcObject = localMediaStream;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        streamView.appendChild(video);

        localMediaStream.getVideoTracks()[0].onended = stopSharing;
        
        const mimeType = 'video/webm; codecs="vp8, opus"';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            statusText.textContent = "Error: Browser doesn't support required video format.";
            stopSharing();
            return;
        }

        mediaRecorder = new MediaRecorder(localMediaStream, { mimeType });

        mediaRecorder.ondataavailable = async (event) => {
            if (event.data.size > 0) {
                try {
                    const url = await window.websim.upload(event.data);
                    room.updatePresence({
                        mediaChunkUrl: url,
                        mediaTimestamp: Date.now()
                    });
                } catch (e) {
                    console.error("Media chunk upload failed:", e);
                }
            }
        };
        
        mediaRecorder.start(CHUNK_DURATION);
        statusText.textContent = `Streaming live! ${localMediaStream.getAudioTracks().length > 0 ? '(with audio)' : '(no audio)'}`;
        
        room.updateRoomState({ streams: { [streamId]: { ...room.roomState.streams[streamId], isLive: true } } });

        startSharingBtn.classList.add('hidden');
        stopSharingBtn.classList.remove('hidden');

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
   
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder = null;
    }

    room.updateRoomState({ streams: { [streamId]: { ...room.roomState.streams[streamId], isLive: false } } });
    room.updatePresence({ mediaChunkUrl: null, mediaTimestamp: null });

    startSharingBtn.classList.remove('hidden');
    stopSharingBtn.classList.add('hidden');
    statusText.textContent = 'Stream ended.';
    streamView.innerHTML = '<p>You have stopped sharing.</p>';
}

function setupMediaSource() {
    viewerVideoElement = document.createElement('video');
    viewerVideoElement.autoplay = true;
    viewerVideoElement.playsInline = true;
    viewerVideoElement.style.width = '100%';
    viewerVideoElement.style.height = '100%';
    viewerVideoElement.style.objectFit = 'contain';
    streamView.innerHTML = '';
    streamView.appendChild(viewerVideoElement);
    
    mediaSource = new MediaSource();
    viewerVideoElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener('sourceopen', () => {
        sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp8, opus"');
        sourceBuffer.addEventListener('updateend', () => {
            isAppending = false;
            if (mediaQueue.length > 0) {
                appendNextChunk();
            }
        });
        // Start processing queue if anything arrived early
        if (mediaQueue.length > 0) {
             appendNextChunk();
        }
    });
}

async function appendNextChunk() {
    if (isAppending || mediaQueue.length === 0 || !sourceBuffer || sourceBuffer.updating) {
        return;
    }
    isAppending = true;
    const arrayBuffer = mediaQueue.shift();
    try {
        sourceBuffer.appendBuffer(arrayBuffer);
    } catch (e) {
        console.error("Error appending buffer:", e);
        isAppending = false;
    }
}

async function playMediaChunk(url) {
    if (!mediaSource) {
        setupMediaSource();
    }
    
    try {
        const response = await fetch(url);
        if (!response.ok) return;
        const arrayBuffer = await response.arrayBuffer();
        mediaQueue.push(arrayBuffer);

        if (sourceBuffer && !sourceBuffer.updating) {
            appendNextChunk();
        }
    } catch(e) {
        console.error("Error fetching or queueing media chunk:", e);
    }
}

let lastMediaTimestamp = 0;

function updateViewer(streamerPresence) {
    const currentStream = room.roomState.streams?.[streamId];

    if (currentStream?.isLive) {
        if (streamerPresence?.mediaChunkUrl && streamerPresence.mediaTimestamp > lastMediaTimestamp) {
            lastMediaTimestamp = streamerPresence.mediaTimestamp;
            playMediaChunk(streamerPresence.mediaChunkUrl);
        } else if (!viewerVideoElement) {
             streamView.innerHTML = `<p>Stream is live, waiting for video data...</p>`;
        }
    } else {
        streamView.innerHTML = `<p>Stream is offline.</p>`;
        if(viewerVideoElement) viewerVideoElement = null;
        if(mediaSource) mediaSource = null;
        mediaQueue = [];
        lastMediaTimestamp = 0;
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
        
        window.addEventListener('beforeunload', () => {
            stopSharing();
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