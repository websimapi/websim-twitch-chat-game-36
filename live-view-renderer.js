import { TILE_TYPE } from './map-tile-types.js';
import { renderPlayer } from './player-renderer.js';

class MockPlayer {
    constructor(state) {
        this.stateData = state;
    }
    get id() { return this.stateData.id; }
    get username() { return this.stateData.username; }
    get color() { return this.stateData.color; }
    get pixelX() { return this.stateData.pixelX; }
    get pixelY() { return this.stateData.pixelY; }
    get offsetX() { return this.stateData.offsetX || 0; }
    get offsetY() { return this.stateData.offsetY || 0; }
    get state() { return this.stateData.state; }
    get actionTimer() { return this.stateData.actionTimer; }
    get actionTotalTime() { return this.stateData.actionTotalTime; }
    isPowered() { return true; } // Assume powered for rendering purposes
    render(ctx, tileSize, cameraX, cameraY) {
        // Simplified energy object for renderer
        this.energy = {
            timestamps: this.stateData.energyTimestamps || [],
            currentCellDrainRatio: 0,
            flashState: 0,
        };
        renderPlayer(ctx, this, tileSize, cameraX, cameraY);
    }
}

export class LiveViewRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.tileSize = 32;
        this.assets = {};
        this.state = null;
        this.animationFrameId = null;
    }

    async loadAssets() {
        const loadTile = (src) => new Promise((resolve) => {
            const img = new Image();
            img.src = src;
            img.onload = () => resolve(img);
        });

        const [grass, tree, logs, bushes] = await Promise.all([
            loadTile('./grass_tile.png'),
            loadTile('./tree.png'),
            loadTile('./logs.png'),
            loadTile('./bushes.png')
        ]);

        this.assets = { grass, tree, logs, bushes };
        console.log("Live View assets loaded.");
    }

    updateState(newState) {
        this.state = newState;
    }

    start() {
        this.loadAssets().then(() => {
            this.renderLoop();
        });
    }

    stop() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
    }

    renderLoop() {
        this.render();
        this.animationFrameId = requestAnimationFrame(() => this.renderLoop());
    }

    render() {
        this.canvas.width = this.canvas.clientWidth;
        this.canvas.height = this.canvas.clientHeight;

        const ctx = this.ctx;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        if (!this.state || !this.assets.grass) return;

        const { playerState, mapChunk, nearbyPlayers } = this.state;
        const mainPlayer = new MockPlayer(playerState);

        const cameraX = (mainPlayer.pixelX * this.tileSize) - (this.canvas.width / 2);
        const cameraY = (mainPlayer.pixelY * this.tileSize) - (this.canvas.height / 2);

        // Render map chunk
        if (mapChunk) {
            for (let j = 0; j < mapChunk.grid.length; j++) {
                for (let i = 0; i < mapChunk.grid[j].length; i++) {
                    const tileType = mapChunk.grid[j][i];
                    if (tileType === null) continue;

                    const worldX = mapChunk.origin.x + i;
                    const worldY = mapChunk.origin.y + j;

                    const screenX = Math.round(worldX * this.tileSize - cameraX);
                    const screenY = Math.round(worldY * this.tileSize - cameraY);

                    ctx.drawImage(this.assets.grass, screenX, screenY, this.tileSize, this.tileSize);

                    let objectImage = null;
                    if (tileType === TILE_TYPE.LOGS) objectImage = this.assets.logs;
                    else if (tileType === TILE_TYPE.BUSHES) objectImage = this.assets.bushes;

                    if (objectImage) {
                        ctx.drawImage(objectImage, screenX, screenY, this.tileSize, this.tileSize);
                    }
                }
            }
        }

        // Prepare Y-sorted render list
        const renderList = [];
        renderList.push({ y: mainPlayer.pixelY, entity: mainPlayer, type: 'player' });

        if (nearbyPlayers) {
            nearbyPlayers.forEach(pState => {
                const p = new MockPlayer(pState);
                renderList.push({ y: p.pixelY, entity: p, type: 'player' });
            });
        }

        if (mapChunk) {
            for (let j = 0; j < mapChunk.grid.length; j++) {
                for (let i = 0; i < mapChunk.grid[j].length; i++) {
                    if (mapChunk.grid[j][i] === TILE_TYPE.TREE) {
                        const worldY = mapChunk.origin.y + j;
                        renderList.push({ y: worldY + 0.5, x: mapChunk.origin.x + i, yPos: worldY, type: 'tree' });
                    }
                }
            }
        }

        renderList.sort((a, b) => a.y - b.y);

        // Render sorted list
        renderList.forEach(item => {
            if (item.type === 'player') {
                item.entity.render(ctx, this.tileSize, cameraX, cameraY);
            } else if (item.type === 'tree') {
                const screenX = Math.round(item.x * this.tileSize - cameraX);
                const screenY = Math.round(item.yPos * this.tileSize - cameraY);
                ctx.drawImage(this.assets.tree, screenX, screenY, this.tileSize, this.tileSize);
            }
        });
    }
}