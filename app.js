import { html, render } from 'lit';

const streamsList = document.getElementById('streams-list');
const startStreamBtn = document.getElementById('start-stream-btn');

const room = new WebsimSocket();

function renderStreams(streams) {
    if (!streams || Object.keys(streams).length === 0) {
        render(html`<p>No one is streaming right now. Why not start one?</p>`, streamsList);
        return;
    }

    const streamCards = Object.entries(streams).map(([streamId, streamData]) => {
        if (!streamData) return ''; // Stream might be in process of being removed
        return html`
            <a href="/stream.html?id=${streamId}" class="stream-card">
                <h3>${streamData.title}</h3>
                <p>Streamed by ${streamData.ownerUsername}</p>
                <p>${streamData.isLive ? '🔴 Live' : 'Offline'}</p>
            </a>
        `;
    });

    render(html`${streamCards}`, streamsList);
}

async function init() {
    await room.initialize();
    
    room.subscribeRoomState((state) => {
        renderStreams(state.streams);
    });

    renderStreams(room.roomState.streams);

    startStreamBtn.addEventListener('click', () => {
        // Create a new stream owned by the current client
        const streamId = room.clientId;
        const myUsername = room.peers[room.clientId]?.username || 'Anonymous';
        
        room.updateRoomState({
            streams: {
                ...room.roomState.streams,
                [streamId]: {
                    id: streamId,
                    title: `${myUsername}'s Stream`,
                    owner: room.clientId,
                    ownerUsername: myUsername,
                    isLive: false,
                    chat: {}
                }
            }
        });
        
        window.location.href = `/stream.html?id=${streamId}`;
    });
}

init();