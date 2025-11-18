import * as DOM from './ui/dom-elements.js';
import { LiveViewRenderer } from './live-view-renderer.js';

let room = null;
let hostClientId = null;
let linkRequested = false;
let isLinked = false;
let liveViewRenderer = null;

const STATUS = {
    INITIAL: 'initial',
    REQUESTING: 'requesting',
    RECEIVED_CODE: 'received_code',
    LINKED: 'linked',
    HOST_NOT_FOUND: 'host_not_found',
    HOST_FOUND: 'host_found',
    ERROR: 'error'
};

function renderUI(state, data = {}) {
    const contentContainer = document.getElementById('live-view-content');
    if (!contentContainer) return;

    let content = '';
    switch (state) {
        case STATUS.INITIAL:
            content = `
                <h2>View Your In-Game Inventory</h2>
                <p>If the project creator is currently hosting a game, you can link your Twitch account to view your inventory here in real-time.</p>
                <button id="request-link-btn" disabled>Waiting for Host...</button>
            `;
            break;
        case STATUS.HOST_FOUND:
            content = `
                <h2>Host is Online!</h2>
                <p>The project creator is hosting a game. You can now request a link to view your inventory.</p>
                <button id="request-link-btn">Request Link</button>
            `;
            break;
        case STATUS.REQUESTING:
            content = `
                <h2>Connecting...</h2>
                <p>Sending a link request to the host. Please wait.</p>
                <button id="request-link-btn" disabled>Requesting...</button>
            `;
            break;
        case STATUS.HOST_NOT_FOUND:
             content = `
                <h2>Host Not Found</h2>
                <p>The project creator does not appear to be hosting a game right now. Please try again later.</p>
            `;
            break;
        case STATUS.RECEIVED_CODE:
            content = `
                <h2>Link Your Account</h2>
                <p>The host has generated a pairing code for you. To finish, go to the host's Twitch channel and type the following command in chat:</p>
                <div class="code-display">${data.code}</div>
                <p><strong>!link ${data.code}</strong></p>
                <p><small>This code will expire in 5 minutes.</small></p>
            `;
            break;
        case STATUS.LINKED:
            content = `
                <h2>${data.username}'s Inventory & Skills</h2>
                <div class="inventory-display">
                    <div class="inventory-item">
                        <span class="label">🪵 Logs:</span>
                        <span class="value" id="logs-count">--</span>
                    </div>
                    <div class="inventory-item">
                        <span class="label">🌿 Leaves:</span>
                        <span class="value" id="leaves-count">--</span>
                    </div>
                    <div class="inventory-item">
                        <span class="label">🪓 Woodcutting XP:</span>
                        <span class="value" id="woodcutting-xp">--</span>
                    </div>
                    <div class="inventory-item">
                        <span class="label">🧤 Gathering XP:</span>
                        <span class="value" id="gathering-xp">--</span>
                    </div>
                </div>
                <p><small>Your inventory will update automatically.</small></p>
            `;
            if (!liveViewRenderer) {
                const canvas = document.getElementById('live-view-canvas');
                liveViewRenderer = new LiveViewRenderer(canvas);
                liveViewRenderer.start();
            }
            break;
        case STATUS.ERROR:
            content = `
                <h2>Error</h2>
                <p>An error occurred while trying to connect to the host. Please refresh and try again.</p>
                <p><small>${data.message || ''}</small></p>
            `;
            break;
    }
    contentContainer.innerHTML = content;
}

function updateInventoryDisplay(payload) {
    const { inventory, playerState } = payload;
    const logsEl = document.getElementById('logs-count');
    const leavesEl = document.getElementById('leaves-count');
    if (logsEl && leavesEl) {
        logsEl.textContent = inventory.logs.toLocaleString();
        leavesEl.textContent = inventory.leaves.toLocaleString();
    }

    if (playerState && playerState.skills) {
        const woodcuttingXpEl = document.getElementById('woodcutting-xp');
        const gatheringXpEl = document.getElementById('gathering-xp');

        if (woodcuttingXpEl) {
            const totalWcExp = Object.values(playerState.skills.woodcutting || {}).reduce((sum, amount) => sum + amount, 0);
            woodcuttingXpEl.textContent = totalWcExp.toLocaleString();
        }

        if (gatheringXpEl) {
            const totalGathExp = Object.values(playerState.skills.gathering || {}).reduce((sum, amount) => sum + amount, 0);
            gatheringXpEl.textContent = totalGathExp.toLocaleString();
        }
    }
}

async function requestLink() {
    if (linkRequested || !room || !hostClientId) return;
    linkRequested = true;
    renderUI(STATUS.REQUESTING);

    const linkTimeout = setTimeout(() => {
        if (!isLinked) {
            renderUI(STATUS.HOST_NOT_FOUND);
            linkRequested = false;
        }
    }, 5000); // 5 seconds for the host to respond with a code

    room.send({ type: 'request_link' });

    // The onmessage handler is now set in initRemoteInventory, so we don't need to re-assign it here.
    // This prevents race conditions.
}

export async function initRemoteInventory() {
    renderUI(STATUS.INITIAL);

    DOM.remoteInventoryContainer.addEventListener('click', (e) => {
        if (e.target.id === 'request-link-btn') {
            requestLink();
        }
    });

    try {
        room = new WebsimSocket();
        await room.initialize();
        console.log('Remote inventory socket initialized.');

        // Request host info as soon as we connect.
        console.log('Broadcasting request for host info...');
        room.send({ type: 'request_host_info' });

        const hostCheckTimeout = setTimeout(() => {
            if (!hostClientId && !isLinked) {
                console.log('No host responded in time.');
                renderUI(STATUS.HOST_NOT_FOUND);
            }
        }, 3000); // Wait 3 seconds for a host to respond.

        room.onmessage = (event) => {
            const data = event.data;

            // First, listen for the host to come online.
            if (data.type === 'host_online') {
                clearTimeout(hostCheckTimeout);
                hostClientId = data.hostId;
                console.log(`Host found with clientId: ${hostClientId}`);
                if (!isLinked) { // Don't change UI if already linked
                    renderUI(STATUS.HOST_FOUND);
                }
                return; // Stop processing this event.
            }

            // After host is found, process messages meant for this client.
            if (!data.forClientId || data.forClientId !== room.clientId) return;

            if (data.type === 'pairing_code') {
                renderUI(STATUS.RECEIVED_CODE, { code: data.code });
            } else if (data.type === 'link_success') {
                if (!isLinked) {
                    isLinked = true;
                    renderUI(STATUS.LINKED, { username: data.username });
                }
            } else if (data.type === 'live_view_update') {
                if (!isLinked) { // First inventory update also confirms a successful link
                    isLinked = true;
                    renderUI(STATUS.LINKED, { username: data.payload.playerState.username || 'Your' });
                }
                updateInventoryDisplay(data.payload);
                if (liveViewRenderer) {
                    liveViewRenderer.updateState(data.payload);
                }
            }
        };

        // If the host is already online, we might have missed the initial broadcast.
        // Let's check for any peers who might be the host.
        // This is a simple check; a more robust system might involve a direct "who is host" request.
        const creator = await window.websim.getCreator();
        if (room.peers[creator.id]) {
             // This check is imperfect as peer ID is not the same as clientId, but it's a good heuristic for now.
             // The creator is in the room. Assume they are the host and enable the button.
             // The proper `host_online` event will still be the primary source of truth for the clientId.
        }


    } catch (error) {
        console.error('Failed to initialize WebsimSocket for remote inventory:', error);
        renderUI(STATUS.ERROR, { message: error.message });
    }
}