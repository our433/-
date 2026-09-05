"use strict";

/*
====================================================================
 RTS V0.9 — WORLD SIMULATION

 這一版刻意保留 V0.8 的核心操作與科研樹，新增重點：

 世界：
   ・高細節草地 / 海洋像素背景
   ・Fog of War
   ・季節、天氣、溫度
   ・河流、湖泊、肥沃度
   ・森林 / 野生動物自然恢復
   ・自然災害事件

 人口：
   ・農民 / 伐木工 / 礦工 / 建築工 / 工業 / 研究 / 軍事
   ・食物維持人口
   ・人口成長
   ・人口分工面板

 城鎮：
   ・AI 聚落
   ・道路
   ・市場
   ・城市發展
   ・污染與交通

 經濟：
   ・木材 / 石頭 / 黃金 / 鐵 / 食物
   ・動態市場價格
   ・貿易
   ・工坊與工廠生產

 軍事：
   ・士兵仍保留在世界中可單獨選取
   ・HOI4 味道的「軍團」面板
   ・選取士兵 → 建立軍團
   ・點軍團 → 選取整支軍隊
   ・師級統計
   ・前線 / 編隊 / 補給簡化模型

 注意：科技樹本版不擴張，保留 V0.8。
 F1-F5 永遠不綁定功能。
====================================================================
*/

/* ================================================================
   CANVAS / DISPLAY
================================================================ */

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

let screenWidth = window.innerWidth;
let screenHeight = window.innerHeight;
let dpr = Math.max(1, window.devicePixelRatio || 1);

function resizeCanvas() {
    screenWidth = window.innerWidth;
    screenHeight = window.innerHeight;
    dpr = Math.max(1, window.devicePixelRatio || 1);

    canvas.width = Math.floor(screenWidth * dpr);
    canvas.height = Math.floor(screenHeight * dpr);
    canvas.style.width = `${screenWidth}px`;
    canvas.style.height = `${screenHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
}

window.addEventListener("resize", resizeCanvas);

/* ================================================================
   SETTINGS
================================================================ */

const GAME = {
    VERSION: "0.9.17",

    CHUNK_SIZE: 800,
    TILE_SIZE: 64,
    MIN_ZOOM: 0.35,
    MAX_ZOOM: 2.6,
    CAMERA_SPEED: 850,
    EDGE_SCROLL: 0, // 僅使用中鍵拖曳鏡頭，不再滑鼠貼邊自動移動

    BASE_POP_CAP: 20,
    HOUSE_POP_BONUS: 8,
    MAX_LOCAL_POPULATION: 100000,

    START_FOOD: 350,
    START_WOOD: 450,
    START_STONE: 120,
    START_GOLD: 80,
    START_IRON: 0,

    DAY_LENGTH: 240,
    SEASON_LENGTH: 900,
    YEAR_LENGTH: 3600,

    FARM_BASE: 1.6,
    FOOD_CONSUMPTION: 0.035,
    POP_GROWTH_FOOD_THRESHOLD: 1.15,

    RESOURCE_RESPAWN: 0.75,
    FOREST_REGEN: 0.55,
    WILDLIFE_REGEN: 0.08,

    WEATHER_CHECK: 20,
    MARKET_TICK: 6,

    FOG_RADIUS_VILLAGER: 480,
    FOG_RADIUS_SOLDIER: 560,
    FOG_RADIUS_TOWER: 780,
    FOG_CELL: 160,

    ROAD_SPEED_BONUS: 0.30,
    SUPPLY_RANGE: 1300,

    AUTO_SAVE_SECONDS: 120,

    PATH_CELL: 40,
    PATH_MAX_NODES: 850,
    PATH_REPATH_SECONDS: 0.9,
    PATH_SEARCHES_PER_FRAME: 2,
    UNIT_SOFT_SEPARATION: 0.45,
    UNIT_STUCK_SECONDS: 0.55,
    MINIMAP_UPDATE_FRAMES: 6
};

/* ================================================================
   WORLD SEED
================================================================ */

let worldSeed = Math.floor(Math.random() * 2147483647);

/* ================================================================
   CAMERA
================================================================ */

const camera = {
    x: 0,
    y: 0,
    zoom: 1,
    dragging: false,
    lastMouseX: 0,
    lastMouseY: 0
};

/* ================================================================
   PLAYER
================================================================ */

const player = {
    resources: {
        food: GAME.START_FOOD,
        wood: GAME.START_WOOD,
        stone: GAME.START_STONE,
        gold: GAME.START_GOLD,
        iron: GAME.START_IRON
    },

    population: 0,
    populationCap: GAME.BASE_POP_CAP,

    workforce: {
        farmer: 0,
        lumberjack: 0,
        miner: 0,
        builder: 0,
        industrial: 0,
        researcher: 0,
        soldier: 0
    },

    treasury: 0,
    stability: 100,
    literacy: 0.05,

    nation: {
        name: "新生國",
        flagIndex: 0,
        government: "部族議會",
        leader: "開國議長",
        legitimacy: 78,
        militaryTradition: 0,
        culture: "本土傳統",
        foundedYear: 1
    },
    foodStockpileDays: 10,

    // UI 顯示：最近幾秒資源的淨每秒變化
    resourceRates: { food: 0, wood: 0, stone: 0, gold: 0, iron: 0 }
};

/* ================================================================
   WORLD STATE
================================================================ */

const world = {
    chunks: new Map(),
    units: [],
    armies: [],
    buildings: [],
    roads: [],
    settlements: [],
    effects: [],
    enemies: [],
    factions: [],
    explored: new Map(),
    fogCache: new Map(),
    tradeRoutes: [],
    history: [],
    disasterCooldown: 0
};

/* ================================================================
   INPUT
================================================================ */

const input = {
    keys: {},
    mouse: {
        x: 0,
        y: 0,
        worldX: 0,
        worldY: 0,
        leftDown: false,
        dragStartX: 0,
        dragStartY: 0,
        hoverResource: null,
        hoverBuilding: null,
        hoverUnit: null
    }
};

/* ================================================================
   GAME STATE
================================================================ */

const state = {
    paused: false,
    time: 0,
    mode: "normal",
    buildingType: null,
    selectedBuilding: null,
    selectedSettlement: null,
    selectedFaction: null,
    populationOpen: false,
    marketOpen: false,
    historyOpen: false,
    techOpen: false,
    currentResearch: null,
    researchProgress: 0,
    researchSlots: 1,
    weather: "clear",
    weatherTimer: 0,
    weatherIntensity: 0,
    season: 0,
    temperature: 18,
    marketTimer: 0,
    autosaveTimer: 0,
    notification: "",
    notificationTimer: 0,
    battleFlash: 0,
    helpOpen: false,
    nationOpen: false,
    selectedEnemy: null,
    armyManageMode: null,
    combatStats: { kills: 0, losses: 0, damageDealt: 0, damageTaken: 0 },
    gameSpeed: 1
};

/* ================================================================
   HELPERS
================================================================ */

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

function distance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
}

function formatNumber(value) {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
    return `${Math.floor(value)}`;
}

function showMessage(text, seconds = 2.4) {
    state.notification = text;
    state.notificationTimer = seconds;
}

function seasonName() {
    return ["春", "夏", "秋", "冬"][state.season];
}

function weatherName() {
    return {
        clear: "晴",
        rain: "小雨",
        storm: "暴雨",
        snow: "降雪",
        drought: "乾旱",
        fog: "霧"
    }[state.weather] || "晴";
}

/* ================================================================
   NOISE
================================================================ */

function hash(x, y, seed) {
    let h = Math.imul(x | 0, 374761393);
    h = Math.imul(h ^ Math.imul(y | 0, 668265263), 1274126177);
    h ^= seed | 0;
    h = Math.imul(h ^ (h >>> 16), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

function noise(x, y, scale, seed) {
    const fx = x * scale;
    const fy = y * scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smoothstep(fx - x0);
    const ty = smoothstep(fy - y0);

    const a = hash(x0, y0, seed);
    const b = hash(x0 + 1, y0, seed);
    const c = hash(x0, y0 + 1, seed);
    const d = hash(x0 + 1, y0 + 1, seed);

    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function fbm(x, y, seed) {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let total = 0;

    for (let i = 0; i < 5; i++) {
        value += noise(x, y, 0.002 * frequency, seed + i * 317) * amplitude;
        total += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    return value / total;
}

/* ================================================================
   TERRAIN
================================================================ */

function terrainInfo(x, y) {
    const elevation = fbm(x, y, worldSeed);
    const moisture = fbm(x + 12000, y - 8000, worldSeed + 3000);
    const coast = noise(x + 7000, y + 11000, 0.0011, worldSeed + 800);
    const riverValue = Math.abs(coast - 0.5);

    if (elevation < 0.225) return { type: "ocean", elevation, moisture, fertility: 0.05 };
    if (riverValue < 0.009 && elevation > 0.29 && elevation < 0.73) return { type: "river", elevation, moisture, fertility: 0.98 };
    if (elevation < 0.31 && moisture > 0.73) return { type: "lake", elevation, moisture, fertility: 0.9 };
    if (elevation > 0.83) return { type: "mountain", elevation, moisture, fertility: 0.04 };
    if (elevation > 0.68) return { type: "highland", elevation, moisture, fertility: 0.55 };
    if (moisture < 0.2 && elevation > 0.35) return { type: "desert", elevation, moisture, fertility: 0.12 };
    if (moisture > 0.82 && elevation < 0.5) return { type: "swamp", elevation, moisture, fertility: 0.75 };
    if (moisture > 0.63) return { type: "forest", elevation, moisture, fertility: 0.72 };
    return { type: "plains", elevation, moisture, fertility: 0.8 };
}

function terrainAt(x, y) {
    return terrainInfo(x, y).type;
}

function terrainWalkable(type) {
    return type !== "ocean" && type !== "river" && type !== "lake" && type !== "mountain";
}

function isWalkable(x, y) {
    return terrainWalkable(terrainAt(x, y));
}

function fertilityAt(x, y) {
    const info = terrainInfo(x, y);
    let value = info.fertility;
    if (terrainAt(x, y) === "river" || terrainAt(x, y) === "lake") value = 1;

    const seasonal = [1.0, 0.9, 1.05, 0.55][state.season];
    if (state.weather === "drought") value *= 0.55;
    if (state.weather === "rain") value *= 1.08;
    if (state.weather === "storm") value *= 0.9;
    if (state.weather === "snow") value *= 0.5;

    return clamp(value * seasonal, 0.05, 1.25);
}

function terrainColor(type, x, y) {
    const h = hash(Math.floor(x / GAME.TILE_SIZE), Math.floor(y / GAME.TILE_SIZE), worldSeed + 881);

    const variants = {
        ocean: ["#2e658f", "#34739f", "#397ba8", "#2a6089"],
        river: ["#4a84a6", "#5593b5", "#4f8caf", "#407c9e"],
        lake: ["#4b86a6", "#568faf", "#467f9f", "#3d7698"],
        plains: ["#6f9e50", "#75a454", "#67954b", "#7cab57"],
        forest: ["#477d43", "#4d8547", "#3f733d", "#558d4b"],
        desert: ["#c2a866", "#c9b16e", "#bca15e", "#d0b775"],
        swamp: ["#4f704d", "#587952", "#49684a", "#5f7f54"],
        highland: ["#7c8d69", "#84956e", "#738562", "#8d9c78"],
        mountain: ["#666965", "#70736f", "#5d615e", "#787b76"]
    };

    const list = variants[type] || variants.plains;
    return list[Math.floor(h * list.length) % list.length];
}

/* ================================================================
   SCREEN / WORLD
================================================================ */

function worldToScreen(x, y) {
    return {
        x: (x - camera.x) * camera.zoom + screenWidth / 2,
        y: (y - camera.y) * camera.zoom + screenHeight / 2
    };
}

function screenToWorld(x, y) {
    return {
        x: (x - screenWidth / 2) / camera.zoom + camera.x,
        y: (y - screenHeight / 2) / camera.zoom + camera.y
    };
}

function updateMouseWorld() {
    const p = screenToWorld(input.mouse.x, input.mouse.y);
    input.mouse.worldX = p.x;
    input.mouse.worldY = p.y;
}

/* ================================================================
   CHUNKS
================================================================ */

function chunkCoords(x, y) {
    return {
        x: Math.floor(x / GAME.CHUNK_SIZE),
        y: Math.floor(y / GAME.CHUNK_SIZE)
    };
}

function chunkKey(x, y) {
    return `${x},${y}`;
}

function chunkRandom(seed, index) {
    return hash(seed, index, worldSeed);
}

function getChunk(cx, cy) {
    const key = chunkKey(cx, cy);
    if (!world.chunks.has(key)) {
        world.chunks.set(key, generateChunk(cx, cy));
    }
    return world.chunks.get(key);
}

function visibleChunks() {
    const left = camera.x - screenWidth / camera.zoom;
    const right = camera.x + screenWidth / camera.zoom;
    const top = camera.y - screenHeight / camera.zoom;
    const bottom = camera.y + screenHeight / camera.zoom;

    const min = chunkCoords(left, top);
    const max = chunkCoords(right, bottom);
    const result = [];

    for (let y = min.y - 1; y <= max.y + 1; y++) {
        for (let x = min.x - 1; x <= max.x + 1; x++) {
            result.push(getChunk(x, y));
        }
    }
    return result;
}

function generateChunk(cx, cy) {
    const seed = worldSeed + cx * 92837111 + cy * 689287499;
    const originX = cx * GAME.CHUNK_SIZE;
    const originY = cy * GAME.CHUNK_SIZE;

    const chunk = {
        cx,
        cy,
        seed,
        resources: [],
        wildlife: [],
        ruins: [],
        decorations: [],
        fertility: [],
        generatedSettlement: false
    };

    for (let i = 0; i < 18; i++) {
        const x = originX + chunkRandom(seed, 100 + i * 2) * GAME.CHUNK_SIZE;
        const y = originY + chunkRandom(seed, 200 + i * 2) * GAME.CHUNK_SIZE;

        if (!isWalkable(x, y)) continue;

        const info = terrainInfo(x, y);
        const roll = chunkRandom(seed, 500 + i);
        let type = "food";

        if (info.type === "forest") {
            type = roll < 0.78 ? "forest" : "food";
        } else if (info.type === "mountain" || info.type === "highland") {
            type = roll < 0.55 ? "stone" : roll < 0.88 ? "iron" : "gold";
        } else if (info.type === "desert") {
            type = roll < 0.48 ? "stone" : roll < 0.78 ? "gold" : "iron";
        } else {
            if (roll < 0.38) type = "food";
            else if (roll < 0.64) type = "forest";
            else if (roll < 0.84) type = "stone";
            else if (roll < 0.94) type = "iron";
            else type = "gold";
        }

        const amount = {
            food: 380,
            forest: 780,
            stone: 1250,
            iron: 1100,
            gold: 850
        }[type];

        chunk.resources.push({
            id: `r-${cx}-${cy}-${i}`,
            type,
            x,
            y,
            radius: type === "forest" ? 72 : type === "food" ? 34 : 50,
            amount,
            maxAmount: amount,
            regen: type === "forest" ? GAME.FOREST_REGEN : GAME.RESOURCE_RESPAWN
        });
    }

    for (let i = 0; i < 6; i++) {
        const x = originX + chunkRandom(seed, 1500 + i) * GAME.CHUNK_SIZE;
        const y = originY + chunkRandom(seed, 2500 + i) * GAME.CHUNK_SIZE;
        if (!isWalkable(x, y)) continue;

        chunk.wildlife.push({
            id: `animal-${cx}-${cy}-${i}`,
            type: chunkRandom(seed, 3500 + i) < 0.68 ? "deer" : "boar",
            x,
            y,
            homeX: x,
            homeY: y,
            angle: chunkRandom(seed, 4000 + i) * Math.PI * 2,
            timer: chunkRandom(seed, 5000 + i) * 4,
            age: 0,
            alive: true
        });
    }

    if (chunkRandom(seed, 7000) > 0.75) {
        const x = originX + chunkRandom(seed, 7100) * GAME.CHUNK_SIZE;
        const y = originY + chunkRandom(seed, 7200) * GAME.CHUNK_SIZE;
        if (isWalkable(x, y)) {
            chunk.ruins.push({
                x,
                y,
                searched: false,
                gold: 120 + Math.floor(chunkRandom(seed, 7300) * 420)
            });
        }
    }

    for (let i = 0; i < 80; i++) {
        const x = originX + chunkRandom(seed, 9000 + i * 2) * GAME.CHUNK_SIZE;
        const y = originY + chunkRandom(seed, 10000 + i * 2) * GAME.CHUNK_SIZE;
        if (!isWalkable(x, y)) continue;
        chunk.decorations.push({
            x,
            y,
            type: chunkRandom(seed, 11000 + i) < 0.72 ? "grass" : "flower"
        });
    }

    return chunk;
}

/* ================================================================
   RESOURCE SEARCH
================================================================ */

function nearbyResources() {
    const result = [];
    for (const chunk of visibleChunks()) {
        for (const resource of chunk.resources) {
            if (resource.amount > 0) result.push(resource);
        }
    }
    return result;
}

function getNearbyResources() {
    const result = [];
    const chunks = visibleChunks();
    for (const chunk of chunks) {
        for (const resource of chunk.resources || []) {
            if (resource.amount > 0) result.push(resource);
        }
    }
    return result;
}

function findResourceAt(x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const resource of nearbyResources()) {
        const d = distance(x, y, resource.x, resource.y);
        if (d < resource.radius + 35 && d < bestDistance) {
            best = resource;
            bestDistance = d;
        }
    }
    return best;
}

/* ================================================================
   BUILDINGS
================================================================ */

const BUILDINGS = {
    house: {
        name: "房屋",
        width: 150,
        height: 125,
        cost: { food: 0, wood: 60, stone: 0, gold: 0, iron: 0 },
        buildTime: 4,
        description: "人口上限 +8"
    },
    lumberCamp: {
        name: "伐木場",
        width: 170,
        height: 130,
        cost: { food: 0, wood: 110, stone: 0, gold: 0, iron: 0 },
        buildTime: 5,
        description: "木材效率 +30%"
    },
    miningCamp: {
        name: "採礦場",
        width: 170,
        height: 130,
        cost: { food: 0, wood: 110, stone: 0, gold: 0, iron: 0 },
        buildTime: 5,
        description: "礦產效率 +30%"
    },
    barracks: {
        name: "兵營",
        width: 205,
        height: 150,
        cost: { food: 0, wood: 170, stone: 20, gold: 0, iron: 0 },
        buildTime: 7,
        description: "訓練軍事單位"
    },
    farm: {
        name: "農田",
        width: 155,
        height: 155,
        cost: { food: 0, wood: 65, stone: 0, gold: 0, iron: 0 },
        buildTime: 3,
        description: "生產食物"
    },
    workshop: {
        name: "工坊",
        width: 220,
        height: 160,
        cost: { food: 100, wood: 220, stone: 110, gold: 90, iron: 0 },
        buildTime: 8,
        description: "工業生產"
    },
    factory: {
        name: "工廠",
        width: 250,
        height: 190,
        cost: { food: 150, wood: 260, stone: 220, gold: 180, iron: 140 },
        buildTime: 12,
        description: "大規模工業"
    },
    researchInstitute: {
        name: "研究院",
        width: 215,
        height: 175,
        cost: { food: 150, wood: 210, stone: 160, gold: 190, iron: 0 },
        buildTime: 10,
        description: "研究槽 +1"
    },
    market: {
        name: "市場",
        width: 190,
        height: 140,
        cost: { food: 50, wood: 190, stone: 80, gold: 70, iron: 0 },
        buildTime: 8,
        description: "交易與價格"
    },
    watchTower: {
        name: "瞭望塔",
        width: 95,
        height: 150,
        cost: { food: 0, wood: 120, stone: 160, gold: 30, iron: 0 },
        buildTime: 9,
        description: "增加視野"
    },
    supplyDepot: {
        name: "補給站",
        width: 180,
        height: 145,
        cost: { food: 70, wood: 150, stone: 120, gold: 80, iron: 40 },
        buildTime: 8,
        description: "延伸補給範圍"
    }
};

function createTownCenter() {
    world.buildings.push({
        id: "town-center",
        type: "townCenter",
        x: 0,
        y: 0,
        width: 260,
        height: 205,
        complete: true,
        buildProgress: 1,
        builders: [],
        queue: [],
        foodTimer: 0,
        industryTimer: 0,
        selected: false,
        hitPoints: 5000,
        maxHitPoints: 5000,
        level: 1,
        upgradeProgress: 0
    });
}

function createBuilding(type, x, y) {
    const data = BUILDINGS[type];
    const building = {
        id: `building-${Date.now()}-${Math.random()}`,
        type,
        x,
        y,
        width: data.width,
        height: data.height,
        complete: false,
        buildProgress: 0,
        builders: [],
        queue: [],
        foodTimer: 0,
        industryTimer: 0,
        selected: false,
        hitPoints: 1000,
        maxHitPoints: 1000,
        productionType: null,
        rallyX: null,
        rallyY: null,
        level: 1,
        upgradeProgress: 0
    };
    world.buildings.push(building);
    return building;
}

/* ================================================================
   UNIT DEFINITIONS
================================================================ */

const UNITS = {
    villager: {
        name: "村民",
        radius: 18,
        speed: 185,
        population: 1,
        manpower: 1,
        combat: 0
    },
    militia: {
        name: "民兵",
        radius: 21,
        speed: 220,
        population: 1,
        manpower: 1,
        combat: 9
    },
    infantry: {
        name: "步兵",
        radius: 21,
        speed: 215,
        population: 1,
        manpower: 1,
        combat: 16
    },
    scout: {
        name: "偵察兵",
        radius: 19,
        speed: 290,
        population: 1,
        manpower: 1,
        combat: 5
    },
    artillery: {
        name: "火砲",
        radius: 24,
        speed: 135,
        population: 2,
        manpower: 2,
        combat: 30
    }
};

const TRAINING = {
    villager: {
        cost: { food: 55, wood: 0, stone: 0, gold: 0, iron: 0 },
        time: 5,
        building: "townCenter"
    },
    militia: {
        cost: { food: 60, wood: 0, stone: 0, gold: 20, iron: 0 },
        time: 7,
        building: "barracks"
    },
    infantry: {
        cost: { food: 80, wood: 40, stone: 20, gold: 40, iron: 20 },
        time: 10,
        building: "barracks",
        requires: ["infantryEquipment"]
    },
    scout: {
        cost: { food: 70, wood: 40, stone: 0, gold: 30, iron: 0 },
        time: 8,
        building: "barracks"
    },
    artillery: {
        cost: { food: 130, wood: 100, stone: 160, gold: 180, iron: 180 },
        time: 22,
        building: "workshop",
        requires: ["artillery"]
    }
};

function createUnit(type, x, y, owner = "player") {
    const data = UNITS[type];
    const unit = {
        id: `${owner}-${type}-${Date.now()}-${Math.random()}`,
        owner,
        type,
        x,
        y,
        radius: data.radius,
        speed: data.speed,
        selected: false,
        state: "idle",
        targetX: x,
        targetY: y,
        targetResource: null,
        targetBuilding: null,
        targetEnemy: null,
        gatherTimer: 0,
        gatherInterval: 0.72,
        gatherAmount: 5,
        health: 100,
        maxHealth: 100,
        armyId: null,
        experience: 0,
        morale: 100,
        exhaustion: 0,
        animTime: Math.random() * 10,
        facing: 1,
        walkAmount: 0,
        movePath: [],
        pathIndex: 0,
        blockedTime: 0,
        stuckChecks: 0,
        lastX: x,
        lastY: y,
        repathTimer: 0,
        pathFailed: false,
        animFrame: 0,
        attackCooldown: 0,
        attackFlash: 0
    };
    world.units.push(unit);
    return unit;
}

function findSafeStartingPosition(preferredX, preferredY) {
    // 城鎮中心是不可通行建築；開局村民必須出生在外圍，不能生成在 TC 內部。
    if (pointIsWalkableForUnitSafe(preferredX, preferredY, 18)) {
        return { x: preferredX, y: preferredY };
    }

    const angles = [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4, Math.PI, 5 * Math.PI / 4, 3 * Math.PI / 2, 7 * Math.PI / 4];
    const radii = [185, 215, 245, 275];
    for (const radius of radii) {
        for (const angle of angles) {
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (pointIsWalkableForUnitSafe(x, y, 18)) {
                return { x, y };
            }
        }
    }
    return { x: 190, y: 0 };
}

function pointIsWalkableForUnitSafe(x, y, radius) {
    if (!isWalkable(x, y)) return false;
    for (const building of world.buildings) {
        if (!building.complete) continue;
        const halfW = building.width / 2 + radius + 14;
        const halfH = building.height / 2 + radius + 14;
        if (Math.abs(x - building.x) < halfW && Math.abs(y - building.y) < halfH) return false;
    }
    return true;
}

function createStartingUnits() {
    // 舊版村民生成在城鎮中心內，之後移動碰撞系統把 TC 視為障礙，
    // 導致「動畫會走、實際座標不動」。生產單位則是在建築外出生，所以它們正常。
    const preferred = [
        [-150, -120], [150, -120], [-150, 120], [150, 120],
        [-195, 0], [195, 0], [0, -155], [0, 155]
    ];

    for (const [x, y] of preferred) {
        const safe = findSafeStartingPosition(x, y);
        createUnit("villager", safe.x, safe.y);
    }
}

/* ================================================================
   SELECTION
================================================================ */

function clearSelection() {
    for (const unit of world.units) unit.selected = false;
    for (const building of world.buildings) building.selected = false;
    for (const settlement of world.settlements) settlement.selected = false;
    for (const army of world.armies) army.selected = false;
    state.selectedBuilding = null;
    state.selectedSettlement = null;
    state.selectedFaction = null;
}

function selectedUnits() {
    return world.units.filter(unit => unit.selected && unit.owner === "player");
}

function selectedVillagers() {
    return selectedUnits().filter(unit => unit.type === "villager");
}

function selectedSoldiers() {
    return selectedUnits().filter(unit => unit.type !== "villager");
}

function findUnitAt(x, y) {
    let result = null;
    let best = Infinity;
    for (let i = world.units.length - 1; i >= 0; i--) {
        const unit = world.units[i];
        if (unit.owner !== "player") continue;
        const d = distance(x, y, unit.x, unit.y);
        if (d < unit.radius + 15 && d < best) {
            result = unit;
            best = d;
        }
    }
    return result;
}

function findEnemyUnitAt(x, y) {
    let result = null;
    let best = Infinity;
    for (let i = world.units.length - 1; i >= 0; i--) {
        const unit = world.units[i];
        if (unit.owner !== "enemy") continue;
        const d = distance(x, y, unit.x, unit.y);
        if (d < unit.radius + 18 && d < best) {
            result = unit;
            best = d;
        }
    }
    return result;
}

function findBuildingAt(x, y) {
    for (let i = world.buildings.length - 1; i >= 0; i--) {
        const building = world.buildings[i];
        if (x >= building.x - building.width / 2 &&
            x <= building.x + building.width / 2 &&
            y >= building.y - building.height / 2 &&
            y <= building.y + building.height / 2) return building;
    }
    return null;
}

function findSettlementAt(x, y) {
    for (let i = world.settlements.length - 1; i >= 0; i--) {
        const settlement = world.settlements[i];
        if (distance(x, y, settlement.x, settlement.y) <= settlement.radius) return settlement;
    }
    return null;
}

function selectRectangle(x1, y1, x2, y2) {
    clearSelection();
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    for (const unit of world.units) {
        if (unit.owner !== "player") continue;
        if (unit.x >= minX && unit.x <= maxX && unit.y >= minY && unit.y <= maxY) unit.selected = true;
    }
}

/* ================================================================
   COST / BUILDING COLLISION
================================================================ */

function canAfford(cost) {
    return Object.keys(cost).every(key => (player.resources[key] || 0) >= cost[key]);
}

function payCost(cost) {
    for (const key of Object.keys(cost)) player.resources[key] -= cost[key];
}

function hasNearbyBuilding(type, x, y, radius) {
    return world.buildings.some(building =>
        building.type === type && building.complete && distance(building.x, building.y, x, y) <= radius
    );
}

function overlapsBuilding(type, x, y) {
    const data = BUILDINGS[type];
    for (const building of world.buildings) {
        if (Math.abs(x - building.x) < (data.width + building.width) / 2 + 24 &&
            Math.abs(y - building.y) < (data.height + building.height) / 2 + 24) return true;
    }
    return false;
}

function overlapsResource(type, x, y) {
    const data = BUILDINGS[type];
    for (const resource of nearbyResources()) {
        const nearestX = clamp(resource.x, x - data.width / 2, x + data.width / 2);
        const nearestY = clamp(resource.y, y - data.height / 2, y + data.height / 2);
        if (distance(resource.x, resource.y, nearestX, nearestY) < resource.radius) return true;
    }
    return false;
}

function overlapsRoad(x, y, width = 90) {
    return world.roads.some(road => distance(x, y, road.x, road.y) < road.radius + width * 0.5);
}

function validBuildingPosition(type, x, y) {
    const data = BUILDINGS[type];
    const points = [[0, 0], [data.width / 2, 0], [-data.width / 2, 0], [0, data.height / 2], [0, -data.height / 2]];
    for (const [px, py] of points) if (!isWalkable(x + px, y + py)) return false;
    if (overlapsBuilding(type, x, y)) return false;
    if (overlapsResource(type, x, y)) return false;
    return true;
}

/* ================================================================
   MOVEMENT / ROADS
================================================================ */

function roadSpeedMultiplier(x, y) {
    if (!overlapsRoad(x, y, 15)) return 1;
    return 1 + GAME.ROAD_SPEED_BONUS;
}

function terrainMovementMultiplier(type) {
    return {
        plains: 1,
        forest: 0.78,
        desert: 0.72,
        swamp: 0.48,
        highland: 0.82,
        mountain: 0.2,
        ocean: 0,
        river: 0,
        lake: 0
    }[type] || 1;
}

function findNearestWalkablePoint(x, y, unit) {
    if (pointIsWalkableForUnit(unit, x, y)) return { x, y };

    // 由近到遠採樣，讓河岸/建築旁的合法位置比較容易被找到。
    const radii = [18, 28, 40, 56, 72, 96, 128, 168, 220, 280];
    const steps = 24;

    for (const radius of radii) {
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (pointIsWalkableForUnit(unit, px, py)) return { x: px, y: py };
        }
    }

    return null;
}

function findNearestLandPoint(x, y, unit) {
    // 最終停留點只看自然地形；不把建築當成移動障礙。
    if (terrainWalkable(terrainAt(x, y))) return { x, y };

    const radii = [24, 40, 64, 96, 140, 190, 260, 340, 440, 560];
    const steps = 32;
    let best = null;
    let bestScore = Infinity;

    for (const radius of radii) {
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const px = x + Math.cos(angle) * radius;
            const py = y + Math.sin(angle) * radius;
            if (!terrainWalkable(terrainAt(px, py))) continue;

            // 比較偏好離玩家點近、而且本身位於平原/森林等一般陸地的位置。
            const terrain = terrainAt(px, py);
            const terrainBias = terrain === "swamp" ? 18 : terrain === "desert" ? 8 : 0;
            const score = distance(px, py, x, y) + terrainBias;
            if (score < bestScore) {
                bestScore = score;
                best = { x: px, y: py };
            }
        }
        if (best) return best;
    }

    return null;
}

function commandMove(units, x, y) {
    if (!units.length) return;

    // V0.9.9: 移動途中完全不受地形/建築阻擋。
    // 只有最終停留點必須是合法陸地。
    const previewUnit = units[0];
    const requested = findNearestLandPoint(x, y, previewUnit);
    if (!requested) {
        showMessage("找不到可停留的陸地");
        return;
    }

    const side = Math.ceil(Math.sqrt(units.length));
    const spacing = Math.max(42, Math.min(58, 46 + units.length * 0.45));

    units.forEach((unit, index) => {
        const row = Math.floor(index / side);
        const column = index % side;
        const desiredX = requested.x + (column - (side - 1) / 2) * spacing;
        const desiredY = requested.y + (row - (side - 1) / 2) * spacing;

        // 每個人只需要找到陸地上的最後落點；途中海、河、山、建築都不會擋住。
        const safeTarget = findNearestLandPoint(desiredX, desiredY, unit) || requested;
        unit.targetX = safeTarget.x;
        unit.targetY = safeTarget.y;
        unit.targetResource = null;
        unit.targetBuilding = null;
        unit.targetEnemy = null;

        unit.movePath = [];
        unit.pathIndex = 0;
        unit.blockedTime = 0;
        unit.stuckChecks = 0;
        unit.repathTimer = 0;
        unit.pathFailed = false;
        unit.lastMoveX = unit.x;
        unit.lastMoveY = unit.y;
        unit.stuckTime = 0;
        unit.state = "moving";
    });
}

function commandArmyMove(army, x, y) {
    if (!army) return;
    const units = world.units.filter(unit => unit.owner === "player" && unit.armyId === army.id);
    commandMove(units, x, y);
    army.x = x;
    army.y = y;
    army.targetX = x;
    army.targetY = y;
}

/* ================================================================
   GATHERING
================================================================ */

function enterGatherMode() {
    if (!selectedVillagers().length) {
        showMessage("請先選取村民");
        return;
    }
    state.mode = "gather";
    state.buildingType = null;
    showMessage("點擊資源開始採集");
}

function commandGather(villagers, resource) {
    if (!villagers.length || !resource) return;
    villagers.forEach((villager, index) => {
        const angle = index / Math.max(villagers.length, 1) * Math.PI * 2;
        const d = resource.radius + 48;
        villager.targetX = resource.x + Math.cos(angle) * d;
        villager.targetY = resource.y + Math.sin(angle) * d;
        villager.targetResource = resource;
        villager.state = "movingToResource";
    });
    state.mode = "normal";
}

function gatherMultiplier(resource) {
    let value = 1;
    if (resource.type === "forest") {
        if (hasTech("forestry")) value += 0.2;
        if (hasNearbyBuilding("lumberCamp", resource.x, resource.y, 280)) value += 0.3;
    }
    if (["stone", "gold", "iron"].includes(resource.type)) {
        if (hasTech("mining")) value += 0.2;
        if (hasNearbyBuilding("miningCamp", resource.x, resource.y, 280)) value += 0.3;
    }
    if (resource.type === "food") value *= fertilityAt(resource.x, resource.y);
    const nearbyCamps = resource.type === "forest" ? world.buildings.filter(b => b.complete && b.type === "lumberCamp" && distance(b.x,b.y,resource.x,resource.y) <= 280).length : ["stone","gold","iron"].includes(resource.type) ? world.buildings.filter(b => b.complete && b.type === "miningCamp" && distance(b.x,b.y,resource.x,resource.y) <= 280).length : 0;
    if (nearbyCamps > 0) value *= 1 + Math.min(0.18, nearbyCamps * 0.06);
    if (state.weather === "drought" && resource.type === "food") value *= 0.5;
    return value;
}

/* ================================================================
   BUILDING MODE / CONSTRUCTION
================================================================ */

function startBuilding(type) {
    if (!selectedVillagers().length) {
        showMessage("先選取村民");
        return;
    }
    if (!canAfford(BUILDINGS[type].cost)) {
        showMessage("資源不足");
        return;
    }
    state.buildingType = type;
    state.mode = "normal";
}

function placeBuilding() {
    const type = state.buildingType;
    if (!type) return;
    const x = input.mouse.worldX;
    const y = input.mouse.worldY;
    const data = BUILDINGS[type];

    if (!canAfford(data.cost)) {
        state.buildingType = null;
        showMessage("資源不足");
        return;
    }
    if (!validBuildingPosition(type, x, y)) {
        showMessage("這裡不能建造");
        return;
    }

    payCost(data.cost);
    const building = createBuilding(type, x, y);
    const workers = selectedVillagers();
    workers.slice(0, Math.min(workers.length, 5)).forEach(v => assignBuilder(v, building));

    clearSelection();
    building.selected = true;
    state.selectedBuilding = building;
    state.buildingType = null;
}

function assignBuilder(villager, building) {
    villager.targetBuilding = building;
    villager.targetResource = null;
    if (!building.builders.includes(villager.id)) building.builders.push(villager.id);
    villager.targetX = building.x + building.width / 2 + 60;
    villager.targetY = building.y;
    villager.state = "movingToBuilding";
}

/* ================================================================
   PRODUCTION
================================================================ */

function enqueueUnit(building, type) {
    if (!building || !building.complete) return;
    const data = TRAINING[type];
    if (!data || building.type !== data.building) {
        showMessage("這個建築不能生產此單位");
        return;
    }
    if (data.requires && !data.requires.every(hasTech)) {
        showMessage(`尚未研究：${data.requires.map(r => TECHS[r]?.name || r).join("、")}`);
        return;
    }
    const pop = unitPopulation(type);
    const queuedPop = building.queue.reduce((sum, item) => sum + unitPopulation(item.unitType), 0);
    if (usedPopulation() + queuedPop + pop > player.populationCap) {
        showMessage("人口容量不足：先建房屋或等待人口增加");
        return;
    }
    if (!canAfford(data.cost)) {
        showMessage("資源不足，無法生產");
        return;
    }

    payCost(data.cost);
    let time = data.time;
    if (type === "militia" && hasTech("militaryTraining")) time *= 0.8;
    if (hasTech("metallurgy") && type !== "villager") time *= 0.9;
    building.queue.push({ unitType: type, progress: 0, time });
    showMessage(`${UNITS[type].name} 已加入 ${building.type === "barracks" ? "兵營" : "工坊"} 生產佇列`);
}

function cycleBarracksProduction(building) {
    if (!building || building.type !== "barracks") return;
    const options = ["militia", "infantry", "scout"];
    const available = options.filter(type => !TRAINING[type].requires || TRAINING[type].requires.every(hasTech));
    if (!available.length) return;
    const current = building.productionType || available[0];
    let idx = available.indexOf(current);
    idx = (idx + 1) % available.length;
    building.productionType = available[idx];
    showMessage(`兵營生產切換：${UNITS[building.productionType].name}（Q 生產）`);
}

function queueSelectedBarracksUnit(building) {
    const type = building.productionType || (hasTech("infantryEquipment") ? "infantry" : "militia");
    enqueueUnit(building, type);
}

function unitPopulation(type) {
    return UNITS[type]?.population || 1;
}

function usedPopulation() {
    return world.units.filter(u => u.owner === "player").reduce((sum, u) => sum + unitPopulation(u.type), 0);
}

function spawnUnit(building, type) {
    const angle = Math.random() * Math.PI * 2;
    const d = Math.max(building.width, building.height) / 2 + 80;
    let x = building.x + Math.cos(angle) * d;
    let y = building.y + Math.sin(angle) * d;

    if (!isWalkable(x, y)) {
        x = building.x + building.width + 70;
        y = building.y;
    }

    const unit = createUnit(type, x, y);
    if (Number.isFinite(building.rallyX) && Number.isFinite(building.rallyY)) {
        unit.targetX = building.rallyX;
        unit.targetY = building.rallyY;
        unit.state = "moving";
    }
    recalculatePopulation();
}


function updateProduction(dt) {
    for (const building of world.buildings) {
        if (!building.complete || !building.queue.length) continue;
        const item = building.queue[0];
        const industrialBonus = hasTech("metallurgy") ? 1.1 : 1;
        item.progress += dt * industrialBonus;
        if (item.progress >= item.time) {
            if (usedPopulation() + unitPopulation(item.unitType) <= player.populationCap) {
                spawnUnit(building, item.unitType);
                building.queue.shift();
            }
        }
    }
}

/* ================================================================
   TECHNOLOGY — V0.8 KEPT
================================================================ */

const TECHS = {
    agriculture: { name: "農業", cost: { food: 100, wood: 0, stone: 0, gold: 50, iron: 0 }, time: 20, requires: [], description: "農田產量 +25%" },
    improvedFarming: { name: "改良耕作", cost: { food: 200, wood: 100, stone: 0, gold: 100, iron: 0 }, time: 35, requires: ["agriculture"], description: "農田產量再 +40%" },
    forestry: { name: "林業", cost: { food: 80, wood: 120, stone: 0, gold: 40, iron: 0 }, time: 25, requires: [], description: "木材採集 +20%" },
    mining: { name: "採礦技術", cost: { food: 80, wood: 100, stone: 0, gold: 60, iron: 0 }, time: 25, requires: [], description: "礦產採集 +20%" },
    metallurgy: { name: "冶金", cost: { food: 150, wood: 100, stone: 120, gold: 150, iron: 0 }, time: 40, requires: ["mining"], description: "工業與軍事生產 +10%" },
    workshop: { name: "工程工坊", cost: { food: 100, wood: 200, stone: 100, gold: 80, iron: 0 }, time: 30, requires: ["metallurgy"], description: "解鎖進階工業" },
    militaryTraining: { name: "軍事訓練", cost: { food: 100, wood: 100, stone: 50, gold: 100, iron: 0 }, time: 25, requires: [], description: "民兵生產速度 +20%" },
    infantryEquipment: { name: "步兵裝備", cost: { food: 150, wood: 120, stone: 100, gold: 150, iron: 40 }, time: 35, requires: ["militaryTraining"], description: "解鎖正規步兵" },
    artillery: { name: "火砲", cost: { food: 150, wood: 150, stone: 250, gold: 250, iron: 150 }, time: 50, requires: ["infantryEquipment", "workshop"], description: "解鎖火砲" },
    logistics: { name: "後勤", cost: { food: 180, wood: 100, stone: 80, gold: 180, iron: 50 }, time: 45, requires: ["militaryTraining"], description: "軍隊移動速度 +10%" },
    mobilityDoctrine: { name: "機動作戰學說", cost: { food: 250, wood: 150, stone: 100, gold: 300, iron: 80 }, time: 60, requires: ["logistics"], description: "軍隊機動效率提升" },
    firepowerDoctrine: { name: "火力優勢學說", cost: { food: 250, wood: 150, stone: 200, gold: 300, iron: 100 }, time: 60, requires: ["artillery"], description: "步兵與火砲火力提升" },
    researchInstitute: { name: "研究院", cost: { food: 250, wood: 250, stone: 200, gold: 250, iron: 50 }, time: 55, requires: ["workshop"], description: "研究槽 +1" }
};

const techState = {
    researched: new Set(),
    unlocked: new Set()
};

function hasTech(tech) {
    return techState.researched.has(tech);
}

function updateUnlockedTechs() {
    techState.unlocked.clear();
    for (const key of Object.keys(TECHS)) {
        const data = TECHS[key];
        if (!hasTech(key) && data.requires.every(req => hasTech(req))) techState.unlocked.add(key);
    }
}

function startResearch(tech) {
    if (state.currentResearch) {
        showMessage("研究槽正在使用");
        return;
    }
    const data = TECHS[tech];
    if (!data || hasTech(tech)) return;
    if (!data.requires.every(hasTech)) {
        showMessage("尚未解鎖");
        return;
    }
    if (!canAfford(data.cost)) {
        showMessage("科研資源不足");
        return;
    }
    payCost(data.cost);
    state.currentResearch = tech;
    state.researchProgress = 0;
    showMessage(`開始研究：${data.name}`);
}

function updateResearch(dt) {
    if (!state.currentResearch) return;
    const data = TECHS[state.currentResearch];
    const researchEff = 1 + player.workforce.researcher * 0.002;
    state.researchProgress += dt * researchEff / data.time;
    if (state.researchProgress >= 1) {
        const finished = state.currentResearch;
        techState.researched.add(finished);
        state.currentResearch = null;
        state.researchProgress = 0;
        if (finished === "researchInstitute") state.researchSlots++;
        updateUnlockedTechs();
        showMessage(`研究完成：${TECHS[finished].name}`);
        recordHistory(`完成科技：${TECHS[finished].name}`);
    }
}

const movementRuntime = {
    pathSearchesThisFrame: 0,
    frame: 0,
    minimapFrame: 0,
    minimapCacheKey: "",
    minimapCanvas: null
};

/* ================================================================
   UNIT AI / UPDATE
================================================================ */

function getAutoCombatRange(unit) {
    if (unit.type === "artillery") return 520;
    if (unit.type === "scout") return 340;
    if (unit.type === "infantry") return 300;
    if (unit.type === "militia") return 260;
    return 0;
}

function findNearestEnemyForUnit(unit, radius) {
    let result = null;
    let best = radius;
    for (const other of world.units) {
        if (other.owner !== "enemy" || other.health <= 0) continue;
        const d = distance(unit.x, unit.y, other.x, other.y);
        if (d < best) {
            best = d;
            result = other;
        }
    }
    return result;
}

function updateAutoCombat(unit) {
    if (unit.owner !== "player" || unit.type === "villager") return;

    // 玩家戰鬥單位預設自動索敵：不用先按攻擊快捷鍵。
    if (unit.targetEnemy && unit.targetEnemy.health > 0 && world.units.includes(unit.targetEnemy)) return;

    unit.targetEnemy = null;
    const nearest = findNearestEnemyForUnit(unit, getAutoCombatRange(unit));
    if (nearest) {
        unit.targetEnemy = nearest;
        unit.targetResource = null;
        unit.targetBuilding = null;
        unit.state = "moving";
        unit.autoCombat = true;
    } else {
        unit.autoCombat = false;
    }
}

function updateUnits(dt) {
    movementRuntime.pathSearchesThisFrame = 0;
    movementRuntime.frame++;

    for (const unit of world.units) {
        unit.animTime = (unit.animTime || 0) + dt;
        if (unit.owner === "enemy") {
            updateEnemyUnit(unit, dt);
            continue;
        }

        updateAutoCombat(unit);

        if (unit.targetEnemy && unit.type !== "villager") {
            updateCombat(unit, dt);
        } else if (["moving", "movingToResource", "movingToBuilding"].includes(unit.state)) {
            moveUnit(unit, dt);
        }

        if (unit.state === "movingToResource" && unit.targetResource) {
            if (distance(unit.x, unit.y, unit.targetResource.x, unit.targetResource.y) <= unit.targetResource.radius + 52) unit.state = "gathering";
        } else if (unit.state === "gathering") {
            updateGathering(unit, dt);
        }

        if (unit.state === "movingToBuilding" && unit.targetBuilding) {
            if (distance(unit.x, unit.y, unit.targetBuilding.x, unit.targetBuilding.y) <= Math.max(unit.targetBuilding.width, unit.targetBuilding.height) / 2 + 75) unit.state = "building";
        }

        if (unit.state === "building") updateBuildingWork(unit, dt);
    }

    resolveUnitOverlap();
    updateArmyPositions();
}

function pointIsWalkableForUnit(unit, x, y) {
    // V0.9.9：這個判定只描述「可以停留的自然地形」。
    // 移動途中不再用它阻擋單位，否則海岸/建築旁容易產生卡死。
    return terrainWalkable(terrainAt(x, y));
}

function pathCellKey(gx, gy) {
    return `${gx},${gy}`;
}

function worldToPathCell(x, y, cell = GAME.PATH_CELL) {
    return {
        x: Math.floor(x / cell),
        y: Math.floor(y / cell)
    };
}

function pathCellToWorld(gx, gy, cell = GAME.PATH_CELL) {
    return {
        x: gx * cell + cell * 0.5,
        y: gy * cell + cell * 0.5
    };
}

function pathNodeWalkable(unit, gx, gy) {
    const p = pathCellToWorld(gx, gy);
    return pointIsWalkableForUnit(unit, p.x, p.y);
}

function reconstructPath(cameFrom, currentKey, cell) {
    const path = [];
    let key = currentKey;
    while (cameFrom.has(key)) {
        const node = cameFrom.get(key);
        const [gx, gy] = key.split(',').map(Number);
        const worldPoint = pathCellToWorld(gx, gy, cell);
        path.push(worldPoint);
        key = node;
    }
    path.reverse();
    return path;
}

function findPathAStar(unit, startX, startY, targetX, targetY) {
    const cell = GAME.PATH_CELL;
    let start = worldToPathCell(startX, startY, cell);
    let goal = worldToPathCell(targetX, targetY, cell);

    // 起點若位於建築碰撞區，先找最近出口。
    if (!pathNodeWalkable(unit, start.x, start.y)) {
        let found = null;
        for (let r = 1; r <= 8 && !found; r++) {
            for (let gy = start.y - r; gy <= start.y + r && !found; gy++) {
                for (let gx = start.x - r; gx <= start.x + r; gx++) {
                    if (!pathNodeWalkable(unit, gx, gy)) continue;
                    const p = pathCellToWorld(gx, gy, cell);
                    if (distance(p.x, p.y, startX, startY) <= r * cell * 1.5) {
                        found = { x: gx, y: gy };
                        break;
                    }
                }
            }
        }
        if (found) start = found;
    }

    // 目標不可站立時，在目標附近找合法格；河流本身永遠不進去。
    if (!pathNodeWalkable(unit, goal.x, goal.y)) {
        let fallback = null;
        let best = Infinity;
        for (let r = 1; r <= 10; r++) {
            for (let gy = goal.y - r; gy <= goal.y + r; gy++) {
                for (let gx = goal.x - r; gx <= goal.x + r; gx++) {
                    if (!pathNodeWalkable(unit, gx, gy)) continue;
                    const p = pathCellToWorld(gx, gy, cell);
                    const d = distance(p.x, p.y, targetX, targetY);
                    if (d < best) {
                        best = d;
                        fallback = { x: gx, y: gy };
                    }
                }
            }
            if (fallback) break;
        }
        if (fallback) goal = fallback;
        else return [];
    }

    const open = [];
    const openSet = new Set();
    const closed = new Set();
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();

    const startKey = pathCellKey(start.x, start.y);
    const goalKey = pathCellKey(goal.x, goal.y);
    gScore.set(startKey, 0);
    fScore.set(startKey, Math.hypot(goal.x - start.x, goal.y - start.y));
    open.push({ x: start.x, y: start.y });
    openSet.add(startKey);

    const neighbors = [
        [1,0,1],[-1,0,1],[0,1,1],[0,-1,1],
        [1,1,1.414],[-1,1,1.414],[1,-1,1.414],[-1,-1,1.414]
    ];

    let visited = 0;

    while (open.length && visited < GAME.PATH_MAX_NODES) {
        let bestIndex = 0;
        let bestF = Infinity;
        for (let i = 0; i < open.length; i++) {
            const n = open[i];
            const f = fScore.get(pathCellKey(n.x, n.y)) ?? Infinity;
            if (f < bestF) {
                bestF = f;
                bestIndex = i;
            }
        }

        const current = open.splice(bestIndex, 1)[0];
        const currentKey = pathCellKey(current.x, current.y);
        if (closed.has(currentKey)) continue;
        closed.add(currentKey);
        openSet.delete(currentKey);
        visited++;

        if (currentKey === goalKey) {
            const raw = reconstructPath(cameFrom, currentKey, cell);

            // 將路徑壓成較少折點，但只在整段視線確實可走時才跳過節點。
            const simplified = [];
            let anchor = { x: startX, y: startY };
            for (const point of raw) {
                if (!canWalkSegment(unit, anchor.x, anchor.y, point.x, point.y)) {
                    const last = simplified[simplified.length - 1] || anchor;
                    if (!last || distance(last.x, last.y, point.x, point.y) > cell * 0.35) simplified.push(point);
                    anchor = point;
                }
            }
            if (!simplified.length && raw.length) simplified.push(raw[raw.length - 1]);
            return simplified;
        }

        for (const [ox, oy, moveCost] of neighbors) {
            const nx = current.x + ox;
            const ny = current.y + oy;
            const neighborKey = pathCellKey(nx, ny);
            if (closed.has(neighborKey)) continue;
            if (!pathNodeWalkable(unit, nx, ny)) continue;

            // 對角線不能切過河岸/建築拐角。
            if (ox !== 0 && oy !== 0) {
                if (!pathNodeWalkable(unit, current.x + ox, current.y) || !pathNodeWalkable(unit, current.x, current.y + oy)) continue;
            }

            // 讓靠河的路徑不會因為一個過窄格子突然貼著水邊。
            const p = pathCellToWorld(nx, ny, cell);
            const terrain = terrainAt(p.x, p.y);
            let terrainPenalty = 0;
            if (terrain === "swamp") terrainPenalty = 1.5;
            if (terrain === "desert") terrainPenalty = 0.5;
            if (terrain === "forest") terrainPenalty = 0.35;

            const tentative = (gScore.get(currentKey) ?? Infinity) + moveCost + terrainPenalty;
            if (tentative < (gScore.get(neighborKey) ?? Infinity)) {
                cameFrom.set(neighborKey, currentKey);
                gScore.set(neighborKey, tentative);
                const heuristic = Math.hypot(goal.x - nx, goal.y - ny);
                fScore.set(neighborKey, tentative + heuristic * 1.05);
                if (!openSet.has(neighborKey)) {
                    open.push({ x: nx, y: ny });
                    openSet.add(neighborKey);
                }
            }
        }
    }

    // 不再回傳「走到一半」的假路徑；那正是之前會站死的其中一個原因。
    return [];
}

function canWalkSegment(unit, x1, y1, x2, y2) {
    const d = distance(x1, y1, x2, y2);
    const samples = Math.max(2, Math.ceil(d / 20));
    for (let i = 1; i <= samples; i++) {
        const t = i / samples;
        const x = lerp(x1, x2, t);
        const y = lerp(y1, y2, t);
        if (!pointIsWalkableForUnit(unit, x, y)) return false;
    }
    return true;
}

function getSmartPath(unit) {
    const path = findPathAStar(unit, unit.x, unit.y, unit.targetX, unit.targetY);
    if (path.length) {
        unit.movePath = path;
        unit.pathIndex = 0;
        unit.pathFailed = false;
        unit.blockedTime = 0;
        return true;
    }
    unit.pathFailed = true;
    return false;
}

function canDirectlyReach(unit, x, y) {
    return canWalkSegment(unit, unit.x, unit.y, x, y);
}

function moveTowardsPoint(unit, tx, ty, dt) {
    const dx = tx - unit.x;
    const dy = ty - unit.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d <= 6) return true;

    let speed = unit.speed;

    if (hasTech("logistics") && unit.type !== "villager") speed *= 1.1;
    if (state.weather === "storm") speed *= 0.84;
    if (state.weather === "snow") speed *= 0.75;
    if (unit.exhaustion > 80) speed *= 0.75;

    // 道路只在陸地上提供加速；水上/障礙物上仍然可以穿越。
    if (terrainWalkable(terrainAt(unit.x, unit.y))) {
        speed *= roadSpeedMultiplier(unit.x, unit.y);
    }

    const step = Math.min(speed * dt, d);
    unit.x += dx / d * step;
    unit.y += dy / d * step;
    unit.facing = dx >= 0 ? 1 : -1;
    unit.walkAmount = 1;
    if (unit.type !== "villager") unit.exhaustion = clamp(unit.exhaustion + dt * 1.5, 0, 100);
    return true;
}

function chooseDetourPoint(unit) {
    const dx = unit.targetX - unit.x;
    const dy = unit.targetY - unit.y;
    const baseAngle = Math.atan2(dy, dx);
    const angles = [];
    for (let i = -5; i <= 5; i++) {
        angles.push(baseAngle + i * (Math.PI / 12));
    }
    angles.push(baseAngle + Math.PI / 2, baseAngle - Math.PI / 2, baseAngle + Math.PI);

    let best = null;
    let bestScore = Infinity;
    const radii = [48, 72, 96, 128];
    for (const r of radii) {
        for (const a of angles) {
            const p = { x: unit.x + Math.cos(a) * r, y: unit.y + Math.sin(a) * r };
            if (!pointIsWalkableForUnit(unit, p.x, p.y)) continue;
            if (!canWalkSegment(unit, unit.x, unit.y, p.x, p.y)) continue;
            const forward = Math.hypot(p.x - unit.targetX, p.y - unit.targetY);
            const turn = Math.abs(Math.atan2(Math.sin(a - baseAngle), Math.cos(a - baseAngle)));
            const score = forward + turn * 32 + r * 0.18;
            if (score < bestScore) { bestScore = score; best = p; }
        }
        if (best) break;
    }
    return best;
}

function tryEscape(unit) {
    const candidates = [];
    for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        for (const r of [32, 56, 84, 112]) {
            const p = { x: unit.x + Math.cos(a) * r, y: unit.y + Math.sin(a) * r };
            if (!pointIsWalkableForUnit(unit, p.x, p.y)) continue;
            candidates.push({ p, score: distance(p.x, p.y, unit.targetX, unit.targetY) + r * 0.25 });
            break;
        }
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0]?.p || null;
}

function requestPath(unit) {
    // V0.9.9 不再需要全局尋路；單位可以自由穿越障礙，只有落點限制為陸地。
    return false;
}

function moveUnit(unit, dt) {
    // V0.9.9 自由移動：途中不再做地形/建築碰撞，因此不會被河岸、房子或山卡死。
    if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) {
        unit.x = Number.isFinite(unit.targetX) ? unit.targetX : 0;
        unit.y = Number.isFinite(unit.targetY) ? unit.targetY : 0;
    }

    const d = distance(unit.x, unit.y, unit.targetX, unit.targetY);
    if (d <= 8) {
        unit.x = unit.targetX;
        unit.y = unit.targetY;
        unit.movePath = [];
        unit.pathIndex = 0;
        unit.blockedTime = 0;
        unit.stuckTime = 0;
        unit.repathTimer = 0;
        unit.pathFailed = false;
        unit.walkAmount = 0;
        if (unit.state === "moving") unit.state = "idle";
        return;
    }

    moveTowardsPoint(unit, unit.targetX, unit.targetY, dt);
    unit.blockedTime = 0;
    unit.stuckTime = 0;
    unit.pathFailed = false;

    // 保留舊欄位供存檔/其他系統相容，但不再使用昂貴的 A*。
    unit.movePath = [];
    unit.pathIndex = 0;
}

function updateGathering(unit, dt) {
    const resource = unit.targetResource;
    if (!resource || resource.amount <= 0) {
        unit.targetResource = null;
        unit.state = "idle";
        return;
    }

    if (distance(unit.x, unit.y, resource.x, resource.y) > resource.radius + 56) {
        unit.state = "movingToResource";
        return;
    }

    unit.gatherTimer += dt * gatherMultiplier(resource);
    if (unit.gatherTimer >= unit.gatherInterval) {
        unit.gatherTimer = 0;
        const amount = Math.min(unit.gatherAmount, resource.amount);
        resource.amount -= amount;

        if (resource.type === "forest") player.resources.wood += amount;
        else if (resource.type === "stone") player.resources.stone += amount;
        else if (resource.type === "gold") player.resources.gold += amount;
        else if (resource.type === "iron") player.resources.iron += amount;
        else player.resources.food += amount;

        createFloatingText(`+${amount}`, resource.x, resource.y - 25);
    }
}

function updateBuildingWork(villager, dt) {
    const building = villager.targetBuilding;
    if (!building) {
        villager.state = "idle";
        return;
    }
    if (building.complete) {
        villager.state = "idle";
        villager.targetBuilding = null;
        return;
    }

    const d = distance(villager.x, villager.y, building.x, building.y);
    if (d > Math.max(building.width, building.height) / 2 + 75) {
        villager.state = "movingToBuilding";
        return;
    }

    const workers = Math.max(building.builders.length, 1);
    const builderEff = 1 + Math.max(0, player.workforce.builder - workers) * 0.01;
    building.buildProgress += dt * (1 + (workers - 1) * 0.5) * builderEff / BUILDINGS[building.type].buildTime;

    if (building.buildProgress >= 1) {
        building.buildProgress = 1;
        building.complete = true;
        for (const id of building.builders) {
            const worker = world.units.find(unit => unit.id === id);
            if (worker) {
                worker.state = "idle";
                worker.targetBuilding = null;
            }
        }
        building.builders = [];
        recalculatePopulation();
        showMessage(`${BUILDINGS[building.type].name} 完成`);
        recordHistory(`建成 ${BUILDINGS[building.type].name}`);
    }
}

function resolveUnitOverlap() {
    const cellSize = 56;
    const buckets = new Map();

    for (const unit of world.units) {
        if (unit.owner !== "player") continue;
        const gx = Math.floor(unit.x / cellSize);
        const gy = Math.floor(unit.y / cellSize);
        const key = `${gx},${gy}`;
        let bucket = buckets.get(key);
        if (!bucket) { bucket = []; buckets.set(key, bucket); }
        bucket.push(unit);
    }

    for (const [key, bucket] of buckets) {
        const [gx, gy] = key.split(',').map(Number);
        const nearby = [];
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                const b = buckets.get(`${gx + ox},${gy + oy}`);
                if (b) nearby.push(...b);
            }
        }

        for (const a of bucket) {
            for (const b of nearby) {
                if (a.id >= b.id) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d2 = dx * dx + dy * dy;
                const minimum = a.radius + b.radius;
                if (d2 <= 0.01 || d2 >= minimum * minimum) continue;
                const d = Math.sqrt(d2);
                const push = Math.min((minimum - d) * 0.30, 7);
                const nx = dx / d;
                const ny = dy / d;
                const ax = a.x - nx * push;
                const ay = a.y - ny * push;
                const bx = b.x + nx * push;
                const by = b.y + ny * push;
                if (pointIsWalkableForUnit(a, ax, ay)) { a.x = ax; a.y = ay; }
                if (pointIsWalkableForUnit(b, bx, by)) { b.x = bx; b.y = by; }
            }
        }
    }
}

/* ================================================================
   FARM / POPULATION / WORKFORCE
================================================================ */

function updateFarms(dt) {
    let multiplier = 1;
    if (hasTech("agriculture")) multiplier += 0.25;
    if (hasTech("improvedFarming")) multiplier += 0.4;

    for (const building of world.buildings) {
        if (!building.complete || building.type !== "farm") continue;
        building.foodTimer += dt;
        if (building.foodTimer >= 1) {
            const local = fertilityAt(building.x, building.y);
            const weather = state.weather === "drought" ? 0.45 : state.weather === "rain" ? 1.12 : state.weather === "storm" ? 0.82 : state.weather === "snow" ? 0.55 : 1;
            const levelBonus = 1 + Math.max(0, (building.level || 1) - 1) * 0.18;
            const food = GAME.FARM_BASE * multiplier * local * weather * levelBonus * (1 + player.workforce.farmer * 0.003) * building.foodTimer;
            player.resources.food += food;
            building.foodTimer = 0;
        }
    }
}

function recalculatePopulation() {
    let cap = GAME.BASE_POP_CAP;
    for (const building of world.buildings) if (building.complete && building.type === "house") cap += GAME.HOUSE_POP_BONUS;
    player.population = usedPopulation();
    player.populationCap = cap;
    recalculateWorkforce();
}

function recalculateWorkforce() {
    const allVillagers = world.units.filter(u => u.owner === "player" && u.type === "villager");
    const assigned = {
        farmer: 0,
        lumberjack: 0,
        miner: 0,
        builder: 0,
        industrial: 0,
        researcher: 0,
        soldier: world.units.filter(u => u.owner === "player" && u.type !== "villager").length
    };

    for (const villager of allVillagers) {
        if (!villager.job) villager.job = "farmer";
        if (!assigned.hasOwnProperty(villager.job)) villager.job = "farmer";
        assigned[villager.job]++;
    }

    player.workforce = assigned;
}

function cycleVillagerJob(job) {
    const villagers = world.units.filter(u => u.owner === "player" && u.type === "villager");
    if (!villagers.length) return;
    const target = villagers.find(v => v.selected) || villagers[0];
    target.job = job;
    recalculateWorkforce();
    showMessage(`村民職業：${jobName(job)}`);
}

function unitStateName(stateName) {
    return {
        idle: "待命",
        moving: "移動中",
        movingToResource: "前往資源",
        gathering: "採集中",
        movingToBuilding: "前往建築",
        building: "建造中",
        combat: "戰鬥中",
        retreating: "撤退中"
    }[stateName] || stateName;
}

function villagerWorkEfficiency(villager) {
    let value = 1;
    if (villager.job === "farmer" && hasTech("agriculture")) value += 0.25;
    if (villager.job === "lumberjack" && hasTech("forestry")) value += 0.20;
    if (villager.job === "miner" && hasTech("mining")) value += 0.20;
    if (villager.job === "builder") value += 0.10;
    if (villager.job === "researcher") value += 0.05;
    return value;
}

function jobName(job) {
    return {
        farmer: "農民",
        lumberjack: "伐木工",
        miner: "礦工",
        builder: "建築工",
        industrial: "工業人口",
        researcher: "研究員"
    }[job] || job;
}

function updatePopulation(dt) {
    const foodNeed = Math.max(1, player.population) * GAME.FOOD_CONSUMPTION * dt;
    player.resources.food -= foodNeed;
    if (player.resources.food < 0) {
        player.resources.food = 0;
        player.stability = clamp(player.stability - dt * 2.5, 0, 100);
    } else {
        player.stability = clamp(player.stability + dt * 0.15, 0, 100);
    }

    player.foodStockpileDays = player.population > 0 ? player.resources.food / Math.max(1, player.population * GAME.FOOD_CONSUMPTION * 60) : 99;

    if (state.time % 2 < dt && player.population < player.populationCap && player.resources.food > player.population * GAME.POP_GROWTH_FOOD_THRESHOLD) {
        const growthChance = 0.08 * (0.6 + player.stability / 100) * dt;
        if (Math.random() < growthChance) {
            const spawn = world.buildings.find(b => b.type === "townCenter" && b.complete) || world.buildings[0];
            if (spawn) createUnit("villager", spawn.x + (Math.random() - 0.5) * 180, spawn.y + (Math.random() - 0.5) * 150);
        }
    }
}

/* ================================================================
   ROADS
================================================================ */

function placeRoad() {
    const x = input.mouse.worldX;
    const y = input.mouse.worldY;
    if (!isWalkable(x, y)) return;
    if (!canAfford({ food: 0, wood: 12, stone: 0, gold: 0, iron: 0 })) {
        showMessage("木材不足");
        return;
    }
    if (distance(x, y, camera.x, camera.y) > 100000) return;
    payCost({ food: 0, wood: 12, stone: 0, gold: 0, iron: 0 });
    world.roads.push({
        id: `road-${Date.now()}-${Math.random()}`,
        x,
        y,
        radius: 34,
        life: 1
    });
}

function updateRoads(dt) {
    // 道路是永久基礎建設；這裡保留 hook 方便未來加入維護費。
    for (const road of world.roads) road.life = Math.min(1, road.life + dt * 0.01);
}


/* ================================================================
   FACTIONS / TRIBES / NATIONS
================================================================ */

const FACTION_ARCHETYPES = [
    { name: "青河部落", type: "部落", color: "#8d9d5a", attitude: "中立", description: "重視狩獵、森林與河岸聚落；不主動攻擊其他文明。", hostile: false },
    { name: "赤嶺城邦", type: "城邦", color: "#a05b4f", attitude: "中立", description: "依靠礦產、工坊與城牆生存；不主動攻擊其他文明。", hostile: false },
    { name: "雲原王國", type: "王國", color: "#607ca5", attitude: "中立", description: "擁有較大人口與農業基礎；不主動攻擊其他文明。", hostile: false },
    { name: "白沙商邦", type: "商邦", color: "#b59458", attitude: "中立", description: "靠市場與長途貿易致富；不主動攻擊其他文明。", hostile: false }
];

function seedFactions() {
    if (world.factions && world.factions.length) return;
    world.factions = FACTION_ARCHETYPES.map((a, i) => ({
        id: `faction-${i}-${Math.random()}`,
        name: a.name,
        type: a.type,
        color: a.color,
        attitude: a.attitude,
        description: a.description,
        treasury: 300 + i * 120,
        population: 600 + i * 220,
        relation: i === 0 ? 20 : i === 3 ? 5 : 0,
        techLevel: 1,
        growthTimer: 0,
        diplomacyState: "和平共處",
        hostile: !!a.hostile
    }));

    const factionSpots = [
        [1250, -700], [-1600, 900], [2100, 1400], [-2400, -1300]
    ];
    for (let i = 0; i < world.factions.length; i++) {
        const faction = world.factions[i];
        const spot = factionSpots[i];
        const existing = world.settlements.find(s => distance(s.x, s.y, spot[0], spot[1]) < 250);
        const settlement = existing || (isWalkable(spot[0], spot[1]) ? createSettlement(spot[0], spot[1], i === 2 ? "city" : i === 1 ? "town" : "village") : null);
        if (settlement) {
            settlement.owner = faction.id;
            settlement.factionId = faction.id;
            settlement.factionType = faction.type;
            settlement.name = `${faction.name}・${settlement.name}`;
            faction.capitalId = settlement.id;
        }
    }
}

function updateFactions(dt) {
    for (const faction of world.factions || []) {
        faction.growthTimer += dt;
        if (faction.growthTimer < 5) continue;
        faction.growthTimer = 0;
        const owned = world.settlements.filter(s => s.factionId === faction.id);
        const totalPop = owned.reduce((sum, s) => sum + (s.population || 0), 0);
        faction.population = Math.max(faction.population || 0, Math.floor(totalPop));
        faction.treasury += 2 + owned.length * 0.8;
        if (totalPop > 900) faction.techLevel = Math.min(5, (faction.techLevel || 1) + 0.01);
        for (const settlement of owned) {
            settlement.growth += 0.08 + owned.length * 0.01;
            settlement.population += 0.2;
        }
    }
}

function factionForSettlement(settlement) {
    return (world.factions || []).find(f => f.id === settlement?.factionId) || null;
}

function drawFactionLabels() {
    for (const settlement of world.settlements) {
        if (!settlement.factionId || !isExplored(settlement.x, settlement.y)) continue;
        const faction = factionForSettlement(settlement);
        if (!faction) continue;
        const s = worldToScreen(settlement.x, settlement.y - settlement.radius * 0.54);
        ctx.fillStyle = faction.color;
        ctx.font = "bold 10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`${faction.name} · ${faction.type}`, s.x, s.y);
        ctx.textAlign = "left";
    }
}

function drawSettlementInfo(settlement) {
    const faction = factionForSettlement(settlement);
    const w = 340;
    const x = screenWidth - w - 15;
    drawPanel(x, 15, w, 190);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px Arial";
    ctx.fillText(settlement.name, x + 12, 42);
    ctx.font = "13px Arial";
    ctx.fillStyle = "#c8ced1";
    ctx.fillText(`人口：${formatNumber(settlement.population)} · 等級 ${settlement.level}`, x + 12, 68);
    ctx.fillText(`繁榮度：${settlementProsperity(settlement).toFixed(0)}%`, x + 12, 91);
    if (faction) {
        ctx.fillStyle = faction.color;
        ctx.font = "bold 13px Arial";
        ctx.fillText(`${faction.name} · ${faction.type}`, x + 12, 116);
        ctx.fillStyle = "#c8ced1";
        ctx.font = "12px Arial";
        ctx.fillText(`外交：${faction.attitude} · 關係 ${faction.relation}`, x + 12, 138);
        ctx.fillText(faction.description, x + 12, 160);
    } else {
        ctx.fillText("目前未納入其他勢力", x + 12, 116);
    }
}

/* ================================================================
   SETTLEMENTS / AI CITIES
================================================================ */

function createSettlement(x, y, style = "village") {
    const settlement = {
        id: `settlement-${Date.now()}-${Math.random()}`,
        name: generateSettlementName(),
        x,
        y,
        radius: style === "city" ? 260 : style === "town" ? 190 : 130,
        population: style === "city" ? 4000 : style === "town" ? 1200 : 280,
        level: style === "city" ? 3 : style === "town" ? 2 : 1,
        style,
        selected: false,
        owner: "neutral",
        growth: 0
    };
    world.settlements.push(settlement);
    return settlement;
}

function generateSettlementName() {
    const a = ["青", "河", "南", "北", "石", "林", "金", "長", "新", "安", "東", "雲", "白", "山"];
    const b = ["城", "鎮", "村", "陽", "川", "原", "港", "谷", "關", "都"];
    return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)];
}

function seedNeutralSettlements() {
    const spots = [
        [1250, -700],
        [-1600, 900],
        [2100, 1400],
        [-2400, -1300]
    ];
    for (const [x, y] of spots) {
        if (isWalkable(x, y)) createSettlement(x, y, Math.random() < 0.25 ? "town" : "village");
    }
}

function updateSettlements(dt) {
    for (const settlement of world.settlements) {
        const foodPotential = nearbyResourcePotential(settlement.x, settlement.y, 600, "food");
        const marketBonus = hasNearbyBuilding("market", settlement.x, settlement.y, 700) ? 0.35 : 0;
        settlement.growth += dt * (0.015 + foodPotential * 0.00002 + marketBonus * 0.01);

        if (settlement.growth > 100 && settlement.level < 3) {
            settlement.growth = 0;
            settlement.level++;
            settlement.style = settlement.level === 3 ? "city" : "town";
            settlement.radius = settlement.level === 3 ? 260 : 190;
            settlement.population *= 1.9;
            recordHistory(`${settlement.name} 發展為${settlement.level === 3 ? "城市" : "城鎮"}`);
        }
    }
}

function nearbyResourcePotential(x, y, radius, type) {
    let total = 0;
    for (const resource of nearbyResources()) {
        if (resource.type === type && distance(x, y, resource.x, resource.y) <= radius) total += resource.amount;
    }
    return total;
}

/* ================================================================
   MARKET / TRADE
================================================================ */

const marketPrices = {
    food: 1,
    wood: 1,
    stone: 1.2,
    gold: 2.2,
    iron: 2.5
};

function updateMarket(dt) {
    state.marketTimer += dt;
    if (state.marketTimer < GAME.MARKET_TICK) return;
    state.marketTimer = 0;

    const stock = player.resources;
    const targets = { food: 500, wood: 500, stone: 300, gold: 180, iron: 160 };
    for (const key of Object.keys(marketPrices)) {
        const ratio = clamp(targets[key] / Math.max(targets[key] * 0.1, stock[key] || 0), 0.55, 2.4);
        marketPrices[key] = lerp(marketPrices[key], ratio, 0.08);
    }

    for (const route of world.tradeRoutes) updateTradeRoute(route, dt);
}

function buyResource(resource, amount = 100) {
    const market = world.buildings.find(b => b.complete && b.type === "market");
    if (!market) {
        showMessage("需要市場");
        return;
    }
    const cost = marketPrices[resource] * amount;
    if (player.treasury < cost) {
        showMessage("國庫不足");
        return;
    }
    player.treasury -= cost;
    player.resources[resource] += amount;
    showMessage(`購買 ${amount} ${resource}`);
}

function sellResource(resource, amount = 100) {
    const market = world.buildings.find(b => b.complete && b.type === "market");
    if (!market || (player.resources[resource] || 0) < amount) {
        showMessage("無法交易");
        return;
    }
    const value = marketPrices[resource] * amount * 0.85;
    player.resources[resource] -= amount;
    player.treasury += value;
    showMessage(`出售 ${amount} ${resource}`);
}

function createTradeRoute(from, to, resource) {
    const route = { id: `trade-${Date.now()}`, from, to, resource, timer: 0, income: 0 };
    world.tradeRoutes.push(route);
    return route;
}

function updateTradeRoute(route, dt) {
    route.timer += dt;
    if (route.timer < 20) return;
    route.timer = 0;
    const value = Math.max(2, marketPrices[route.resource] * 8);
    player.treasury += value;
    route.income += value;
}

/* ================================================================
   INDUSTRY
================================================================ */

function updateIndustry(dt) {
    for (const building of world.buildings) {
        if (!building.complete) continue;
        if (building.type !== "workshop" && building.type !== "factory") continue;
        const workers = Math.max(0, player.workforce.industrial);
        building.industryTimer += dt * (1 + workers * 0.004);
        if (building.industryTimer < 10) continue;
        building.industryTimer = 0;

        if (building.type === "workshop") {
            if (player.resources.iron >= 5 && player.resources.wood >= 3) {
                player.resources.iron -= 5;
                player.resources.wood -= 3;
                player.treasury += 1.2;
            }
        } else {
            if (player.resources.iron >= 10 && player.resources.wood >= 5) {
                player.resources.iron -= 10;
                player.resources.wood -= 5;
                player.treasury += 3.2;
            }
        }
    }
}

/* ================================================================
   MILITARY — ARMIES
================================================================ */

function nextArmyNumber() {
    return world.armies.length + 1;
}

function createArmyFromSelected() {
    const soldiers = selectedSoldiers();
    if (!soldiers.length) {
        showMessage("先選取士兵");
        return;
    }

    const army = {
        id: `army-${Date.now()}-${Math.random()}`,
        name: `第${nextArmyNumber()}軍`,
        x: soldiers.reduce((s, u) => s + u.x, 0) / soldiers.length,
        y: soldiers.reduce((s, u) => s + u.y, 0) / soldiers.length,
        targetX: soldiers.reduce((s, u) => s + u.x, 0) / soldiers.length,
        targetY: soldiers.reduce((s, u) => s + u.y, 0) / soldiers.length,
        doctrine: "standard",
        order: "待命",
        frontline: null,
        supply: 100,
        organization: 100,
        morale: 100,
        selected: true,
        colorVariant: world.armies.length % 4
    };

    for (const soldier of soldiers) soldier.armyId = army.id;
    world.armies.push(army);
    state.selectedArmy = army;
    clearSelection();
    state.selectedArmy = army;
    showMessage(`${army.name} 已建立，共 ${soldiers.length} 個單位`);
    recordHistory(`建立${army.name}`);
}

function dissolveSelectedArmy() {
    const army = state.selectedArmy;
    if (!army) return;
    for (const unit of world.units) if (unit.armyId === army.id) unit.armyId = null;
    world.armies = world.armies.filter(a => a !== army);
    showMessage("軍團已解散");
}

function selectArmy(army) {
    clearSelection();
    state.selectedArmy = army;
    army.selected = true;
    for (const other of world.armies) if (other !== army) other.selected = false;
}

function updateArmyPositions() {
    for (const army of world.armies) {
        const members = world.units.filter(unit => unit.owner === "player" && unit.armyId === army.id);
        if (!members.length) {
            army.strength = 0;
            continue;
        }
        army.strength = members.reduce((sum, unit) => sum + UNITS[unit.type].combat, 0);
        army.manpower = members.reduce((sum, unit) => sum + unitPopulation(unit.type) * 100, 0);
        army.divisions = Math.max(1, Math.ceil(members.length / 6));
        army.organization = clamp(army.organization + 0.03, 0, 100);

        if (members.length && distance(army.x, army.y, army.targetX, army.targetY) > 30) {
            const avgX = members.reduce((sum, unit) => sum + unit.x, 0) / members.length;
            const avgY = members.reduce((sum, unit) => sum + unit.y, 0) / members.length;
            army.x = avgX;
            army.y = avgY;
        }

        army.supply = computeArmySupply(army);
        if (army.supply < 35) army.organization = clamp(army.organization - 0.04, 0, 100);
    }
}

function computeArmySupply(army) {
    let best = Infinity;
    for (const building of world.buildings) {
        if (!building.complete) continue;
        if (building.type !== "townCenter" && building.type !== "supplyDepot") continue;
        const d = distance(army.x, army.y, building.x, building.y);
        const range = building.type === "supplyDepot" ? GAME.SUPPLY_RANGE * 1.5 : GAME.SUPPLY_RANGE;
        if (d < range) best = Math.min(best, d / range);
    }
    if (best === Infinity) return 15;
    return clamp(100 - best * 70, 30, 100);
}

function assignFrontline(army, x1, y1, x2, y2) {
    if (!army) return;
    army.frontline = { x1, y1, x2, y2 };
    army.order = "前線部署";
    showMessage(`${army.name} 已建立前線`);
}

function setArmyOrder(order) {
    if (!state.selectedArmy) return;
    state.selectedArmy.order = order;
    showMessage(`${state.selectedArmy.name}：${order}`);
}

/* ================================================================
   COMBAT / ENEMY SIMULATION
================================================================ */

function ensureEnemyForces() {
    if (world.enemies.length > 0) return;
    const spots = [[5200, 0], [-5400, 3600], [6100, -4300]];
    for (const [x, y] of spots) {
        if (!isWalkable(x, y)) continue;
        const enemy = {
            id: `enemy-army-${Math.random()}`,
            x,
            y,
            strength: 120,
            morale: 85,
            targetX: x,
            targetY: y,
            timer: Math.random() * 10,
            hostile: true,
            label: "野人"
        };
        world.enemies.push(enemy);
        for (let i = 0; i < 5; i++) createEnemyUnit(x + i * 35, y + (i % 2) * 30);
    }
}

function createEnemyUnit(x, y) {
    const type = Math.random() < 0.75 ? "infantry" : "militia";
    const unit = createUnit(type, x, y, "enemy");
    unit.health = 100;
    unit.maxHealth = 100;
    return unit;
}

function updateEnemyUnit(unit, dt) {
    unit.timer = (unit.timer || 0) + dt;
    const nearest = findNearestPlayerUnit(unit.x, unit.y, 900);
    if (nearest && distance(unit.x, unit.y, nearest.x, nearest.y) < 500) {
        unit.targetEnemy = nearest;
        updateCombat(unit, dt);
    } else {
        const enemy = world.enemies.find(e => e.id === unit.enemyArmyId) || world.enemies[0];
        if (enemy) {
            if (unit.timer > 8) {
                unit.timer = 0;
                unit.targetX = enemy.x + (Math.random() - 0.5) * 300;
                unit.targetY = enemy.y + (Math.random() - 0.5) * 300;
            }
            unit.state = "moving";
            moveUnit(unit, dt);
        }
    }
}

function findNearestPlayerUnit(x, y, radius) {
    let result = null;
    let best = radius;
    for (const unit of world.units) {
        if (unit.owner !== "player") continue;
        const d = distance(x, y, unit.x, unit.y);
        if (d < best) {
            best = d;
            result = unit;
        }
    }
    return result;
}

function updateCombat(unit, dt) {
    const target = unit.targetEnemy;
    if (!target || target.health <= 0 || !world.units.includes(target)) {
        unit.targetEnemy = null;
        unit.autoCombat = false;
        if (unit.owner === "player") unit.state = "idle";
        return;
    }

    const d = distance(unit.x, unit.y, target.x, target.y);
    const attackRange = unit.type === "artillery" ? 240 : unit.type === "scout" ? 82 : 76;
    if (d > attackRange) {
        unit.targetX = target.x;
        unit.targetY = target.y;
        unit.state = "moving";
        moveUnit(unit, dt);
        return;
    }

    unit.attackCooldown = Math.max(0, (unit.attackCooldown || 0) - dt);
    if (unit.attackCooldown > 0) return;

    const baseDamage = UNITS[unit.type]?.combat || 1;
    const army = unit.armyId && world.armies.find(a => a.id === unit.armyId);
    let damage = baseDamage;
    if (hasTech("firepowerDoctrine")) damage *= 1.2;
    if (army && army.order === "進攻") damage *= 1.12;
    if (unit.type === "artillery") damage *= 1.8;
    damage *= 0.75 + unitLevel(unit) * 0.07;
    if (target.type === "artillery" && unit.type === "scout") damage *= 1.12;

    target.health -= damage;
    unit.attackCooldown = unit.type === "artillery" ? 2.6 : 1.15;
    unit.attackFlash = 0.18;
    unit.experience = Math.min(1200, (unit.experience || 0) + 0.5);
    state.battleFlash = 0.18;
    state.combatStats.damageDealt += damage;

    createFloatingText(`-${Math.ceil(damage)}`, target.x, target.y - target.radius - 12);

    if (target.health <= 0) {
        const index = world.units.indexOf(target);
        if (index >= 0) world.units.splice(index, 1);
        if (unit.owner === "player") {
            state.combatStats.kills++;
            createFloatingText("擊破敵軍", target.x, target.y - 30);
            recordHistory(`${unit.type === "artillery" ? "火砲" : "部隊"} 擊破敵軍`);
        } else {
            state.combatStats.losses++;
        }
        if (target.armyId) {
            const targetArmy = world.armies.find(a => a.id === target.armyId);
            if (targetArmy) targetArmy.morale = clamp(targetArmy.morale - 8, 0, 100);
        }
    }
}

function commandAttack(units, target) {
    const attackers = units.filter(unit => unit.owner === "player" && unit.type !== "villager");
    if (!attackers.length || !target || target.owner !== "enemy") {
        showMessage("選取民兵、步兵、偵察兵或火砲後再點敵人");
        return;
    }
    attackers.forEach((unit, index) => {
        unit.targetEnemy = target;
        unit.targetResource = null;
        unit.targetBuilding = null;
        unit.autoCombat = false;
        unit.state = "moving";
        unit.targetX = target.x + Math.cos(index * 1.7) * 55;
        unit.targetY = target.y + Math.sin(index * 1.7) * 55;
    });
    state.selectedEnemy = target;
    showMessage(`已下達攻擊命令：${attackers.length} 個單位 → 敵軍`);
    registerCommandFeedback(target.x, target.y, "攻擊");
}

/* ================================================================
   FOG OF WAR
================================================================ */

function fogKey(x, y) {
    return `${Math.floor(x / GAME.FOG_CELL)},${Math.floor(y / GAME.FOG_CELL)}`;
}

function markExplored(x, y, radius) {
    const minX = Math.floor((x - radius) / GAME.FOG_CELL);
    const maxX = Math.floor((x + radius) / GAME.FOG_CELL);
    const minY = Math.floor((y - radius) / GAME.FOG_CELL);
    const maxY = Math.floor((y + radius) / GAME.FOG_CELL);
    const r2 = radius * radius;

    for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
            const cx = gx * GAME.FOG_CELL + GAME.FOG_CELL / 2;
            const cy = gy * GAME.FOG_CELL + GAME.FOG_CELL / 2;
            if ((cx - x) ** 2 + (cy - y) ** 2 <= r2) world.explored.set(`${gx},${gy}`, state.time);
        }
    }
}

function updateExploration() {
    for (const unit of world.units) {
        if (unit.owner !== "player") continue;
        markExplored(unit.x, unit.y, unit.type === "villager" ? GAME.FOG_RADIUS_VILLAGER : GAME.FOG_RADIUS_SOLDIER);
    }
    for (const building of world.buildings) {
        if (!building.complete) continue;
        if (building.type === "watchTower") markExplored(building.x, building.y, GAME.FOG_RADIUS_TOWER);
    }
}

function isExplored(x, y) {
    return world.explored.has(fogKey(x, y));
}

/* ================================================================
   SEASONS / WEATHER / TEMPERATURE
================================================================ */

function updateClimate(dt) {
    const previousSeason = state.season;
    state.season = Math.floor((state.time % GAME.YEAR_LENGTH) / GAME.SEASON_LENGTH);
    if (state.season !== previousSeason) {
        recordHistory(`進入${seasonName()}`);
        showMessage(`季節變化：${seasonName()}`);
    }

    const latitude = clamp(Math.abs(camera.y) / 9000, 0, 1);
    const seasonBase = [16, 25, 19, 6][state.season];
    state.temperature = seasonBase - latitude * 9 - (terrainInfo(camera.x, camera.y).elevation - 0.4) * 18;

    state.weatherTimer -= dt;
    if (state.weatherTimer <= 0) {
        state.weatherTimer = GAME.WEATHER_CHECK;
        rollWeather();
    }

    if (state.disasterCooldown > 0) state.disasterCooldown -= dt;
}

function rollWeather() {
    const latitude = clamp(Math.abs(camera.y) / 12000, 0, 1);
    const roll = Math.random();
    if (state.season === 3 && (latitude > 0.35 || roll < 0.25)) state.weather = roll < 0.18 ? "storm" : "snow";
    else if (state.season === 1 && roll < 0.15) state.weather = "drought";
    else if (roll < 0.18) state.weather = "rain";
    else if (roll < 0.22) state.weather = "storm";
    else if (roll < 0.28) state.weather = "fog";
    else state.weather = "clear";
    state.weatherIntensity = Math.random();
}

function updateNaturalResources(dt) {
    for (const chunk of visibleChunks()) {
        for (const resource of chunk.resources) {
            if (resource.amount >= resource.maxAmount) continue;
            if (resource.type === "forest") resource.amount = Math.min(resource.maxAmount, resource.amount + resource.regen * dt);
            else resource.amount = Math.min(resource.maxAmount, resource.amount + resource.regen * dt * 0.15);
        }
        for (const animal of chunk.wildlife) {
            if (!animal.alive) continue;
            animal.timer += dt;
            animal.age += dt / 86400;
            if (animal.timer > 5) {
                animal.timer = 0;
                const angle = animal.angle + (Math.random() - 0.5) * 1.5;
                const distanceHome = distance(animal.x, animal.y, animal.homeX, animal.homeY);
                animal.angle = distanceHome > 160 ? Math.atan2(animal.homeY - animal.y, animal.homeX - animal.x) : angle;
                const speed = 22 * dt;
                const nx = animal.x + Math.cos(animal.angle) * speed;
                const ny = animal.y + Math.sin(animal.angle) * speed;
                if (isWalkable(nx, ny)) {
                    animal.x = nx;
                    animal.y = ny;
                }
            }
        }
    }
}

/* ================================================================
   DISASTERS / EVENTS
================================================================ */

function updateDisasters(dt) {
    if (state.disasterCooldown > 0) return;
    if (Math.random() > 0.00055 * dt) return;
    state.disasterCooldown = 90;

    const roll = Math.random();
    if (roll < 0.28) {
        for (const building of world.buildings) {
            if (building.complete && building.type === "farm" && Math.random() < 0.35) building.foodTimer *= 0.25;
        }
        showMessage("乾旱造成農業損失");
        player.stability = clamp(player.stability - 5, 0, 100);
        recordHistory("發生乾旱，農業受損");
    } else if (roll < 0.52) {
        const resource = nearbyResources().find(r => r.type === "forest" && r.amount > 100);
        if (resource) resource.amount *= 0.45;
        showMessage("森林火災發生");
        recordHistory("森林火災發生");
    } else if (roll < 0.76) {
        for (const road of world.roads) road.life *= 0.7;
        showMessage("暴洪破壞部分道路");
        recordHistory("洪水破壞交通");
    } else {
        player.stability = clamp(player.stability - 3, 0, 100);
        showMessage("地震！建築受到輕微損害");
        for (const building of world.buildings) {
            if (building.complete && Math.random() < 0.15) building.hitPoints *= 0.75;
        }
        recordHistory("地震造成建築損害");
    }
}

/* ================================================================
   HISTORY
================================================================ */

function recordHistory(text) {
    const year = Math.floor(state.time / GAME.YEAR_LENGTH) + 1;
    world.history.push({ year, time: state.time, text });
    if (world.history.length > 300) world.history.shift();
}

/* ================================================================
   RUINS
================================================================ */

function searchRuin() {
    const villagers = selectedVillagers();
    if (!villagers.length) {
        showMessage("選一個村民");
        return;
    }
    let nearest = null;
    let best = Infinity;
    for (const chunk of visibleChunks()) {
        for (const ruin of chunk.ruins) {
            if (ruin.searched) continue;
            const d = distance(villagers[0].x, villagers[0].y, ruin.x, ruin.y);
            if (d < best) {
                best = d;
                nearest = ruin;
            }
        }
    }
    if (!nearest || best > 90) {
        showMessage("附近沒有可探索的遺跡");
        return;
    }
    nearest.searched = true;
    player.resources.gold += nearest.gold;
    createFloatingText(`+${nearest.gold} 金幣`, nearest.x, nearest.y);
    showMessage(`發現 ${nearest.gold} 金幣`);
    recordHistory(`探索遺跡，獲得 ${nearest.gold} 金幣`);
}

/* ================================================================
   FLOATING EFFECTS
================================================================ */

function createFloatingText(text, x, y) {
    world.effects.push({ text, x, y, life: 1, maxLife: 1 });
}

function updateEffects(dt) {
    for (const effect of world.effects) {
        effect.life -= dt;
        effect.y -= 25 * dt;
    }
    world.effects = world.effects.filter(effect => effect.life > 0);
}

/* ================================================================
   ARMIES UI ACTIONS
================================================================ */

function createArmyPanelButtons() {
    // 保留成 hook；畫面按鈕由 drawArmyPanel / mouse hit-test 處理。
}

function armyAtPanel(x, y) {
    const panel = armyPanelRect();
    const rowH = 34;
    for (let i = 0; i < Math.min(world.armies.length, 2); i++) {
        const ry = panel.y + 42 + i * rowH;
        if (x >= panel.x + 8 && x <= panel.x + panel.width - 8 && y >= ry && y <= ry + rowH - 4) return world.armies[i];
    }
    return null;
}

function armyPanelRect() {
    return {
        x: 16,
        y: screenHeight - 285,
        width: Math.min(300, screenWidth - 32),
        height: 120
    };
}

function armyPanelClick(x, y) {
    const army = armyAtPanel(x, y);
    if (army) {
        selectArmy(army);
        return true;
    }

    const panel = armyPanelRect();
    if (x >= panel.x + 8 && x <= panel.x + 140 && y >= panel.y + panel.height - 28 && y <= panel.y + panel.height - 5) {
        createArmyFromSelected();
        return true;
    }
    return false;
}

/* ================================================================
   POPULATION PANEL
================================================================ */

function populationPanelRect() {
    return { x: 90, y: 95, width: Math.min(610, screenWidth - 180), height: 430 };
}

function drawPopulationPanel() {
    if (!state.populationOpen) return;
    const p = populationPanelRect();
    drawPanel(p.x, p.y, p.width, p.height);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 21px Arial";
    ctx.fillText("人口 / Workforce", p.x + 25, p.y + 34);

    ctx.font = "14px Arial";
    ctx.fillStyle = "#aaa";
    ctx.fillText(`人口 ${player.population}/${player.populationCap}`, p.x + 25, p.y + 62);
    ctx.fillText(`穩定度 ${player.stability.toFixed(0)}% · 糧食約 ${player.foodStockpileDays.toFixed(1)} 天`, p.x + 170, p.y + 62);

    const jobs = [
        ["farmer", "農民"],
        ["lumberjack", "伐木工"],
        ["miner", "礦工"],
        ["builder", "建築工"],
        ["industrial", "工業"],
        ["researcher", "研究員"],
        ["soldier", "軍事"]
    ];

    for (let i = 0; i < jobs.length; i++) {
        const [key, name] = jobs[i];
        const yy = p.y + 100 + i * 38;
        ctx.fillStyle = "#d8d8d8";
        ctx.fillText(name, p.x + 30, yy);
        ctx.fillStyle = "#78b8e6";
        ctx.fillRect(p.x + 130, yy - 13, 300, 16);
        const value = player.workforce[key] || 0;
        const total = Math.max(1, player.workforce.soldier + world.units.filter(u => u.owner === "player" && u.type === "villager").length);
        ctx.fillStyle = "#4a6f8c";
        ctx.fillRect(p.x + 130, yy - 13, 300 * clamp(value / total, 0, 1), 16);
        ctx.fillStyle = "#fff";
        ctx.fillText(`${value}`, p.x + 448, yy);
    }

    ctx.fillStyle = "#8db8f0";
    ctx.font = "12px Arial";
    ctx.fillText("選取村民後點擊快捷職業按鈕可重新分工", p.x + 25, p.y + p.height - 22);
}

/* ================================================================
   MARKET PANEL
================================================================ */

function marketPanelRect() {
    return { x: screenWidth - 360, y: 105, width: 335, height: 270 };
}

function drawMarketPanel() {
    if (!state.marketOpen) return;
    const p = marketPanelRect();
    drawPanel(p.x, p.y, p.width, p.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 20px Arial";
    ctx.fillText("市場 / Economy", p.x + 20, p.y + 32);
    ctx.font = "13px Arial";
    ctx.fillStyle = "#aaa";
    ctx.fillText(`國庫 ${player.treasury.toFixed(1)}`, p.x + 20, p.y + 55);

    const list = ["food", "wood", "stone", "iron", "gold"];
    for (let i = 0; i < list.length; i++) {
        const key = list[i];
        const yy = p.y + 88 + i * 30;
        ctx.fillStyle = "#ddd";
        ctx.fillText(`${key}`, p.x + 20, yy);
        ctx.fillStyle = "#e5c960";
        ctx.fillText(`${marketPrices[key].toFixed(2)}`, p.x + 105, yy);
        ctx.fillStyle = "#75c989";
        ctx.fillText(`現有 ${formatNumber(player.resources[key])}`, p.x + 170, yy);
    }

    ctx.fillStyle = "#999";
    ctx.fillText("滑鼠點擊資源列：左買、右賣 100", p.x + 20, p.y + p.height - 13);
}

/* ================================================================
   HISTORY PANEL
================================================================ */

function historyPanelRect() {
    return { x: 100, y: 70, width: Math.min(720, screenWidth - 200), height: Math.min(590, screenHeight - 130) };
}

function drawHistoryPanel() {
    if (!state.historyOpen) return;
    const p = historyPanelRect();
    drawPanel(p.x, p.y, p.width, p.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Arial";
    ctx.fillText("📜 歷史", p.x + 24, p.y + 36);

    const start = Math.max(0, world.history.length - 18);
    ctx.font = "13px Arial";
    for (let i = start; i < world.history.length; i++) {
        const item = world.history[i];
        const yy = p.y + 70 + (i - start) * 27;
        ctx.fillStyle = "#d6ba64";
        ctx.fillText(`第 ${item.year} 年`, p.x + 25, yy);
        ctx.fillStyle = "#ddd";
        ctx.fillText(item.text, p.x + 115, yy);
    }

    ctx.fillStyle = "#888";
    ctx.fillText("H：關閉歷史", p.x + 24, p.y + p.height - 13);
}

/* ================================================================
   UI DRAW HELPERS
================================================================ */

function drawPanel(x, y, width, height) {
    ctx.fillStyle = "rgba(8,10,12,0.95)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "#636a6c";
    ctx.strokeRect(x, y, width, height);
}

/* ================================================================
   TERRAIN RENDERING — HIGH DETAIL PIXEL STYLE
================================================================ */

function drawTerrain() {
    const left = camera.x - screenWidth / camera.zoom;
    const right = camera.x + screenWidth / camera.zoom;
    const top = camera.y - screenHeight / camera.zoom;
    const bottom = camera.y + screenHeight / camera.zoom;

    const startX = Math.floor(left / GAME.TILE_SIZE) - 1;
    const endX = Math.ceil(right / GAME.TILE_SIZE) + 1;
    const startY = Math.floor(top / GAME.TILE_SIZE) - 1;
    const endY = Math.ceil(bottom / GAME.TILE_SIZE) + 1;

    for (let ty = startY; ty <= endY; ty++) {
        for (let tx = startX; tx <= endX; tx++) {
            const wx = tx * GAME.TILE_SIZE;
            const wy = ty * GAME.TILE_SIZE;
            const info = terrainInfo(wx + GAME.TILE_SIZE / 2, wy + GAME.TILE_SIZE / 2);
            const type = info.type;
            const screen = worldToScreen(wx, wy);
            const size = Math.ceil(GAME.TILE_SIZE * camera.zoom) + 1;

            ctx.fillStyle = terrainColor(type, wx, wy);
            ctx.fillRect(Math.floor(screen.x), Math.floor(screen.y), size, size);

            drawTerrainPixels(type, tx, ty, screen.x, screen.y, size, info);
        }
    }
}

function drawTerrainPixels(type, tx, ty, sx, sy, size, info) {
    const seed = hash(tx, ty, worldSeed + 9000);
    const px = Math.max(2, Math.floor(size / 14));
    const count = camera.zoom > 0.55 ? 5 : 2;

    if (type === "ocean" || type === "river" || type === "lake") {
        for (let i = 0; i < count; i++) {
            const hx = hash(tx * 17 + i, ty * 13 + i, worldSeed + 6000);
            const hy = hash(tx * 11 + i, ty * 19 + i, worldSeed + 6100);
            ctx.fillStyle = i % 2 ? "rgba(180,220,235,0.22)" : "rgba(20,70,105,0.25)";
            ctx.fillRect(Math.floor(sx + hx * Math.max(3, size - px * 3)), Math.floor(sy + hy * Math.max(3, size - px * 2)), Math.max(2, px * 3), px);
        }
        if (seed > 0.68) {
            ctx.fillStyle = "rgba(210,240,245,0.14)";
            ctx.fillRect(Math.floor(sx + size * 0.15), Math.floor(sy + size * 0.34), Math.max(3, Math.floor(size * 0.35)), px);
        }
        return;
    }

    for (let i = 0; i < count; i++) {
        const hx = hash(tx * 31 + i, ty * 23 + i, worldSeed + 5000);
        const hy = hash(tx * 7 + i, ty * 29 + i, worldSeed + 5100);
        let fill = "rgba(30,60,25,0.16)";
        if (type === "desert") fill = "rgba(115,80,35,0.15)";
        if (type === "mountain") fill = "rgba(20,25,25,0.20)";
        if (type === "forest") fill = "rgba(20,55,22,0.18)";
        if (type === "highland") fill = "rgba(35,65,35,0.15)";
        ctx.fillStyle = fill;
        ctx.fillRect(Math.floor(sx + hx * size), Math.floor(sy + hy * size), px, Math.max(px, Math.floor(px * 0.55)));
    }

    if (type === "mountain") {
        ctx.fillStyle = "rgba(220,225,218,0.25)";
        ctx.fillRect(Math.floor(sx + size * 0.22), Math.floor(sy + size * 0.15), Math.max(2, Math.floor(size * 0.14)), Math.max(2, Math.floor(size * 0.22)));
        ctx.fillStyle = "rgba(40,45,42,0.2)";
        ctx.fillRect(Math.floor(sx + size * 0.64), Math.floor(sy + size * 0.48), Math.max(2, Math.floor(size * 0.16)), Math.max(2, Math.floor(size * 0.2)));
    }

    if (type === "swamp") {
        ctx.fillStyle = "rgba(20,30,25,0.25)";
        ctx.fillRect(Math.floor(sx + size * 0.3), Math.floor(sy + size * 0.62), Math.max(2, Math.floor(size * 0.25)), px);
        ctx.fillRect(Math.floor(sx + size * 0.58), Math.floor(sy + size * 0.22), Math.max(2, Math.floor(size * 0.18)), px);
    }
}

/* ================================================================
   DECORATION / RESOURCES
================================================================ */

function drawTerrainDecorations() {
    for (const chunk of visibleChunks()) {
        for (const d of chunk.decorations) {
            const s = worldToScreen(d.x, d.y);
            if (s.x < -30 || s.x > screenWidth + 30 || s.y < -30 || s.y > screenHeight + 30) continue;
            if (d.type === "grass") {
                ctx.fillStyle = "rgba(43,88,43,0.65)";
                ctx.fillRect(Math.floor(s.x), Math.floor(s.y), 2 * camera.zoom, 8 * camera.zoom);
            } else {
                ctx.fillStyle = "rgba(220,195,80,0.65)";
                ctx.fillRect(Math.floor(s.x), Math.floor(s.y), 3 * camera.zoom, 3 * camera.zoom);
            }
        }
    }
}

function drawResources() {
    for (const resource of nearbyResources()) {
        if (!isExplored(resource.x, resource.y)) continue;

        const screen = worldToScreen(resource.x, resource.y);
        if (screen.x < -160 || screen.x > screenWidth + 160 || screen.y < -160 || screen.y > screenHeight + 160) continue;

        if (resource.type === "forest") drawForest(resource, screen);
        else if (resource.type === "stone") drawStone(resource, screen, "stone");
        else if (resource.type === "gold") drawStone(resource, screen, "gold");
        else if (resource.type === "iron") drawStone(resource, screen, "iron");
        else drawFood(resource, screen);

        drawResourceMarker(resource, screen);
    }
}

function drawResourceMarker(resource, screen) {
    const s = camera.zoom;
    const radius = Math.max(26 * s, 22);
    const pulse = 0.75 + Math.sin(state.time * 3 + resource.x * 0.01 + resource.y * 0.013) * 0.12;
    const info = resourceDisplayInfo(resource.type);
    const depleted = resource.amount <= 0;
    const amountRatio = clamp(resource.amount / Math.max(resource.maxAmount || 1, 1), 0, 1);

    // 外圈：讓低解析地圖上的資源不會和背景混在一起
    ctx.save();
    ctx.globalAlpha = depleted ? 0.22 : pulse;
    ctx.strokeStyle = resource.type === "gold" ? "#ffe45d" : resource.type === "iron" ? "#d7e0e5" : resource.type === "forest" ? "#9be36d" : resource.type === "stone" ? "#e2e5e7" : "#f3ed9a";
    ctx.lineWidth = Math.max(2, 3 * s);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 頂部標籤：只要看見資源就知道那是什麼
    const label = `${info.short} ${Math.max(0, Math.floor(resource.amount))}`;
    ctx.font = "bold 11px Arial";
    const labelWidth = Math.max(48, ctx.measureText(label).width + 14);
    const labelX = screen.x - labelWidth / 2;
    const labelY = screen.y - radius - 22;

    ctx.fillStyle = "rgba(12,12,12,0.82)";
    ctx.fillRect(Math.floor(labelX), Math.floor(labelY), Math.ceil(labelWidth), 18);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(Math.floor(labelX), Math.floor(labelY), Math.ceil(labelWidth), 18);

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(label, screen.x, labelY + 13);
    ctx.textAlign = "left";

    // 明顯的資源點小圖標
    const badge = Math.max(18 * s, 18);
    ctx.fillStyle = "rgba(8,8,8,0.76)";
    ctx.fillRect(screen.x - badge / 2, screen.y - badge / 2, badge, badge);
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.strokeRect(screen.x - badge / 2, screen.y - badge / 2, badge, badge);
    ctx.font = "bold 12px Arial";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(info.icon, screen.x, screen.y + 4);
    ctx.textAlign = "left";

    // 資源存量條
    const barW = Math.max(42 * s, 34);
    const barH = Math.max(5, 5 * s);
    const barX = screen.x - barW / 2;
    const barY = screen.y + radius + 7;
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = resource.type === "gold" ? "#e4bd32" : resource.type === "iron" ? "#a9b2ba" : resource.type === "forest" ? "#65b957" : resource.type === "stone" ? "#9ca2a5" : "#d6cc67";
    ctx.fillRect(barX, barY, barW * amountRatio, barH);
}

function drawForest(resource, screen) {
    const s = 44 * camera.zoom;
    const density = 6;
    for (let i = 0; i < density; i++) {
        const angle = resource.id.length * 0.13 + i * 2.3;
        const x = screen.x + Math.cos(angle) * s * 0.7;
        const y = screen.y + Math.sin(angle) * s * 0.55;
        ctx.fillStyle = "#543a24";
        ctx.fillRect(x - s * 0.07, y, s * 0.14, s * 0.65);
        ctx.fillStyle = i % 2 ? "#245f2d" : "#1d5728";
        ctx.fillRect(x - s * 0.42, y - s * 0.42, s * 0.84, s * 0.7);
        ctx.fillStyle = "#438c45";
        ctx.fillRect(x - s * 0.22, y - s * 0.5, s * 0.44, s * 0.25);
    }
}

function drawStone(resource, screen, type) {
    const s = 60 * camera.zoom;
    const body = type === "gold" ? "#655323" : type === "iron" ? "#454c52" : "#666865";
    const highlight = type === "gold" ? "#f4d23d" : type === "iron" ? "#a9b2b8" : "#a7aaa7";

    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(screen.x - s * 0.55, screen.y + s * 0.25);
    ctx.lineTo(screen.x - s * 0.3, screen.y - s * 0.45);
    ctx.lineTo(screen.x + s * 0.1, screen.y - s * 0.6);
    ctx.lineTo(screen.x + s * 0.58, screen.y);
    ctx.lineTo(screen.x + s * 0.28, screen.y + s * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = highlight;
    ctx.fillRect(screen.x - s * 0.2, screen.y - s * 0.12, s * 0.15, s * 0.15);
    ctx.fillRect(screen.x + s * 0.1, screen.y + s * 0.05, s * 0.13, s * 0.13);
}

function drawFood(resource, screen) {
    const s = 32 * camera.zoom;
    ctx.fillStyle = "#eee9cf";
    ctx.fillRect(screen.x - s * 0.45, screen.y - s * 0.15, s * 0.42, s * 0.42);
    ctx.fillRect(screen.x + s * 0.02, screen.y - s * 0.2, s * 0.4, s * 0.4);
    ctx.fillStyle = "#8eb35a";
    ctx.fillRect(screen.x - s * 0.08, screen.y - s * 0.44, s * 0.16, s * 0.24);
}

/* ================================================================
   WILDLIFE / RUINS
================================================================ */

function drawWildlife() {
    for (const chunk of visibleChunks()) {
        for (const animal of chunk.wildlife) {
            if (!animal.alive || !isExplored(animal.x, animal.y)) continue;
            const screen = worldToScreen(animal.x, animal.y);
            const s = 18 * camera.zoom;
            if (screen.x < -50 || screen.x > screenWidth + 50 || screen.y < -50 || screen.y > screenHeight + 50) continue;
            ctx.fillStyle = animal.type === "deer" ? "#8f613d" : "#5f3e2d";
            ctx.fillRect(screen.x - s * 0.65, screen.y - s * 0.35, s * 1.3, s * 0.7);
            ctx.fillRect(screen.x + s * 0.45, screen.y - s * 0.5, s * 0.45, s * 0.45);
        }
    }
}

function drawRuins() {
    for (const chunk of visibleChunks()) {
        for (const ruin of chunk.ruins) {
            if (ruin.searched || !isExplored(ruin.x, ruin.y)) continue;
            const screen = worldToScreen(ruin.x, ruin.y);
            const s = camera.zoom;
            ctx.fillStyle = "#716f69";
            ctx.fillRect(screen.x - 25 * s, screen.y - 20 * s, 50 * s, 40 * s);
            ctx.fillStyle = "#aaa398";
            ctx.fillRect(screen.x - 18 * s, screen.y - 33 * s, 11 * s, 28 * s);
            ctx.fillRect(screen.x + 7 * s, screen.y - 28 * s, 10 * s, 24 * s);
            ctx.fillStyle = "#d1b238";
            ctx.fillRect(screen.x - 5 * s, screen.y + 2 * s, 10 * s, 10 * s);
        }
    }
}

/* ================================================================
   ROADS / SETTLEMENT ART
================================================================ */

function drawRoads() {
    for (const road of world.roads) {
        const s = worldToScreen(road.x, road.y);
        ctx.fillStyle = "rgba(121,96,68,0.78)";
        ctx.fillRect(s.x - 28 * camera.zoom, s.y - 8 * camera.zoom, 56 * camera.zoom, 16 * camera.zoom);
        ctx.fillStyle = "rgba(195,161,115,0.3)";
        ctx.fillRect(s.x - 18 * camera.zoom, s.y - 2 * camera.zoom, 36 * camera.zoom, 4 * camera.zoom);
    }
}

function drawSettlements() {
    for (const settlement of world.settlements) {
        if (!isExplored(settlement.x, settlement.y)) continue;
        const s = worldToScreen(settlement.x, settlement.y);
        const r = settlement.radius * camera.zoom;
        ctx.fillStyle = settlement.level === 3 ? "rgba(165,105,63,0.45)" : "rgba(145,125,90,0.35)";
        ctx.fillRect(s.x - r * 0.45, s.y - r * 0.25, r * 0.9, r * 0.5);
        ctx.fillStyle = "#8d6948";
        const count = settlement.level * 3 + 2;
        for (let i = 0; i < count; i++) {
            const ox = ((i * 47) % 100) / 100 - 0.5;
            const oy = ((i * 31) % 70) / 100 - 0.35;
            ctx.fillRect(s.x + ox * r, s.y + oy * r, Math.max(4, 12 * camera.zoom), Math.max(4, 9 * camera.zoom));
        }
        ctx.fillStyle = "#eee";
        ctx.font = `${Math.max(10, Math.floor(12 * camera.zoom))}px Arial`;
        ctx.textAlign = "center";
        ctx.fillText(settlement.name, s.x, s.y - r * 0.36);
        ctx.textAlign = "left";
    }
}

/* ================================================================
   BUILDING ART
================================================================ */

function drawBuildings() {
    for (const building of world.buildings) {
        const screen = worldToScreen(building.x, building.y);
        const width = building.width * camera.zoom;
        const height = building.height * camera.zoom;

        if (screen.x < -width || screen.x > screenWidth + width || screen.y < -height || screen.y > screenHeight + height) continue;

        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(screen.x - width * 0.42, screen.y + height * 0.34, width * 0.84, height * 0.14);
        drawBuildingArt(building, screen, width, height);

        if (building.selected) {
            ctx.strokeStyle = "#ffe83d";
            ctx.lineWidth = 3;
            ctx.strokeRect(screen.x - width / 2 - 8, screen.y - height / 2 - 8, width + 16, height + 16);
        }

        if (!building.complete) {
            ctx.fillStyle = "#151515";
            ctx.fillRect(screen.x - width * 0.4, screen.y + height * 0.52, width * 0.8, 8);
            ctx.fillStyle = "#dcca41";
            ctx.fillRect(screen.x - width * 0.4, screen.y + height * 0.52, width * 0.8 * building.buildProgress, 8);
        }
    }
}

function drawBuildingArt(building, screen, width, height) {
    let base = "#876646";
    let roof = "#6f3838";
    if (building.type === "townCenter") { base = "#a87b4f"; roof = "#8d3030"; }
    if (building.type === "barracks") { base = "#7d4242"; roof = "#533131"; }
    if (building.type === "miningCamp") { base = "#757775"; roof = "#505252"; }
    if (building.type === "lumberCamp") { base = "#98673e"; roof = "#5d3d25"; }
    if (building.type === "farm") { base = "#7a552e"; roof = "#6a4626"; }
    if (building.type === "workshop") { base = "#6d6f6e"; roof = "#4d504e"; }
    if (building.type === "factory") { base = "#515a5b"; roof = "#32393b"; }
    if (building.type === "researchInstitute") { base = "#746958"; roof = "#3f5167"; }
    if (building.type === "market") { base = "#846746"; roof = "#4b6b55"; }
    if (building.type === "watchTower") { base = "#756b5b"; roof = "#5b4f40"; }
    if (building.type === "supplyDepot") { base = "#6f665b"; roof = "#4e5960"; }

    ctx.fillStyle = base;
    ctx.fillRect(screen.x - width / 2, screen.y - height / 2, width, height);

    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(screen.x - width * 0.57, screen.y - height * 0.27);
    ctx.lineTo(screen.x, screen.y - height * 0.73);
    ctx.lineTo(screen.x + width * 0.57, screen.y - height * 0.27);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#39281d";
    ctx.fillRect(screen.x - width * 0.11, screen.y + height * 0.04, width * 0.22, height * 0.42);

    ctx.fillStyle = "#e0c96c";
    ctx.fillRect(screen.x - width * 0.31, screen.y - height * 0.16, width * 0.13, height * 0.12);
    ctx.fillRect(screen.x + width * 0.18, screen.y - height * 0.16, width * 0.13, height * 0.12);

    if (building.type === "farm") {
        ctx.strokeStyle = "#ad7c4e";
        ctx.lineWidth = Math.max(2, 4 * camera.zoom);
        for (let i = 0; i < 5; i++) {
            const y = screen.y - height * 0.33 + i * height * 0.17;
            ctx.beginPath();
            ctx.moveTo(screen.x - width * 0.4, y);
            ctx.lineTo(screen.x + width * 0.4, y);
            ctx.stroke();
        }
    }

    if (building.type === "researchInstitute") {
        ctx.fillStyle = "#8eb7dc";
        ctx.fillRect(screen.x - width * 0.1, screen.y - height * 0.34, width * 0.2, height * 0.2);
    }

    if (building.type === "factory") {
        ctx.fillStyle = "#777";
        ctx.fillRect(screen.x - width * 0.12, screen.y - height * 0.15, width * 0.24, height * 0.5);
        ctx.fillStyle = "#8a8a8a";
        ctx.fillRect(screen.x + width * 0.18, screen.y - height * 0.35, width * 0.09, height * 0.45);
    }

    if (building.type === "watchTower") {
        ctx.fillStyle = "#42392f";
        ctx.fillRect(screen.x - width * 0.08, screen.y - height * 0.55, width * 0.16, height * 0.25);
    }
}

/* ================================================================
   UNITS / ARMIES RENDER
================================================================ */

function drawUnits() {
    for (const unit of world.units) {
        if (unit.owner === "enemy" && !isExplored(unit.x, unit.y)) continue;
        const screen = worldToScreen(unit.x, unit.y);
        const s = unit.radius * camera.zoom * 1.10;
        if (screen.x < -60 || screen.x > screenWidth + 60 || screen.y < -60 || screen.y > screenHeight + 60) continue;

        if (unit.selected) {
            ctx.strokeStyle = "#fff000";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.ellipse(screen.x, screen.y + s, s * 1.5, s * 0.55, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        if (unit.type === "villager") drawVillager(screen, s, unit);
        else drawSoldier(screen, s, unit);

        if (unit.selected) {
            drawSelectedUnitLabel(screen, unit);
        }

        if (unit.health < unit.maxHealth) {
            ctx.fillStyle = "#222";
            ctx.fillRect(screen.x - s, screen.y - s * 1.45, s * 2, 4);
            ctx.fillStyle = "#69bb69";
            ctx.fillRect(screen.x - s, screen.y - s * 1.45, s * 2 * clamp(unit.health / unit.maxHealth, 0, 1), 4);
        }
    }
}

function drawSelectedUnitLabel(screen, unit) {
    let label = unit.type === "villager" ? jobName(unit.job || "farmer") : unit.type === "militia" ? "民兵" : unit.type === "infantry" ? "步兵" : unit.type === "scout" ? "偵察兵" : unit.type === "artillery" ? "火砲" : unit.type;
    const text = unit.owner === "enemy" ? `敵方 · ${label}` : label;
    ctx.font = "bold 11px Arial";
    const width = Math.max(46, ctx.measureText(text).width + 12);
    ctx.fillStyle = unit.owner === "enemy" ? "rgba(85,24,24,0.92)" : "rgba(8,20,28,0.88)";
    ctx.fillRect(Math.round(screen.x - width / 2), Math.round(screen.y - unit.radius * 1.85), Math.round(width), 18);
    ctx.strokeStyle = unit.owner === "enemy" ? "#d96b6b" : "#83c5ef";
    ctx.strokeRect(Math.round(screen.x - width / 2), Math.round(screen.y - unit.radius * 1.85), Math.round(width), 18);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(text, screen.x, screen.y - unit.radius * 1.85 + 13);
    ctx.textAlign = "left";
}

function pixelBlock(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

function drawVillager(screen, s, unit) {
    const moving = ["moving", "movingToResource", "movingToBuilding"].includes(unit.state);
    const walk = moving ? Math.sin(unit.animTime * 10) : Math.sin(unit.animTime * 2) * 0.12;
    const bob = moving ? Math.abs(walk) * s * 0.05 : Math.sin(unit.animTime * 2) * s * 0.025;
    const facing = unit.facing || 1;
    const coat = unit.job === "farmer" ? "#4f78b2" : unit.job === "researcher" ? "#67569b" : unit.job === "miner" ? "#6c7077" : unit.job === "lumberjack" ? "#4f6f4b" : "#3e6fae";

    // 腳
    pixelBlock(screen.x - s * 0.62 + walk * s * 0.25, screen.y + s * 0.78, s * 0.42, s * 0.24, "#29231f");
    pixelBlock(screen.x + s * 0.20 - walk * s * 0.25, screen.y + s * 0.78, s * 0.42, s * 0.24, "#29231f");

    // 身體、腰帶、手臂
    pixelBlock(screen.x - s * 0.68, screen.y + bob, s * 1.36, s * 0.92, coat);
    pixelBlock(screen.x - s * 0.70, screen.y + s * 0.18 + bob + walk * s * 0.06, s * 0.22, s * 0.58, "#d49c76");
    pixelBlock(screen.x + s * 0.48, screen.y + s * 0.18 + bob - walk * s * 0.06, s * 0.22, s * 0.58, "#d49c76");
    pixelBlock(screen.x - s * 0.63, screen.y + s * 0.66 + bob, s * 1.26, s * 0.14, "#49352a");

    // 頭、頭髮、帽沿
    pixelBlock(screen.x - s * 0.50, screen.y - s * 0.98 + bob, s * 1.00, s * 0.88, "#e1ad85");
    pixelBlock(screen.x - s * 0.53, screen.y - s * 1.04 + bob, s * 1.06, s * 0.22, unit.job === "researcher" ? "#3d315e" : "#453325");
    pixelBlock(screen.x - s * 0.56, screen.y - s * 0.83 + bob, s * 0.16, s * 0.16, "#25201d");
    pixelBlock(screen.x + s * 0.28 * facing, screen.y - s * 0.83 + bob, s * 0.12, s * 0.12, "#25201d");
    // 臉部像素、衣服縫線、鞋面，增加近距離辨識度
    pixelBlock(screen.x - s * 0.25, screen.y - s * 0.58 + bob, s * 0.11, s * 0.08, "#2d2020");
    pixelBlock(screen.x + s * 0.14 * facing, screen.y - s * 0.58 + bob, s * 0.08, s * 0.08, "#2d2020");
    pixelBlock(screen.x - s * 0.48, screen.y + s * 0.23 + bob, s * 0.96, s * 0.06, "#2a4054");
    pixelBlock(screen.x - s * 0.58 + facing * s * 0.08, screen.y + s * 0.72, s * 0.28, s * 0.09, "#171717");
    pixelBlock(screen.x + s * 0.26 + facing * s * 0.08, screen.y + s * 0.72, s * 0.28, s * 0.09, "#171717");

    // 職業徽記：不是只靠衣服區分，選取時也能一眼看出職業
    const jobBadge = { farmer: "#80ad53", lumberjack: "#79a85f", miner: "#b2b8be", builder: "#d6a94e", industrial: "#8e9ca6", researcher: "#a98ae8" }[unit.job || "farmer"] || "#8db7d9";
    pixelBlock(screen.x - s * 0.12, screen.y + s * 0.04 + bob, s * 0.24, s * 0.14, jobBadge);

    // 工具／工作動畫
    if (unit.state === "gathering") {
        const swing = Math.sin(unit.animTime * 11) * s * 0.22;
        if (unit.job === "miner") {
            ctx.save();
            ctx.translate(screen.x + facing * s * 0.15, screen.y + s * 0.1);
            ctx.rotate(-0.65 + swing / s);
            pixelBlock(-s * 0.12, -s * 0.02, s * 0.24, s * 1.15, "#6f4b2e");
            pixelBlock(-s * 0.55, -s * 0.16, s * 0.95, s * 0.18, "#8b8d90");
            ctx.restore();
        } else {
            pixelBlock(screen.x + facing * (s * 0.55 + swing), screen.y + s * 0.18, s * 0.14, s * 0.95, "#6b4327");
            pixelBlock(screen.x + facing * (s * 0.75 + swing), screen.y + s * 0.12, s * 0.28, s * 0.15, "#78604b");
        }
    }
}

function drawSoldier(screen, s, unit) {
    const moving = ["moving", "movingToResource", "movingToBuilding"].includes(unit.state);
    const walk = moving ? Math.sin(unit.animTime * 10) : Math.sin(unit.animTime * 2) * 0.08;
    const bob = moving ? Math.abs(walk) * s * 0.04 : 0;
    const facing = unit.facing || 1;
    const enemy = unit.owner === "enemy";
    const body = enemy ? "#7b3838" : unit.type === "artillery" ? "#5c6067" : "#5f5047";
    const helmet = enemy ? "#493033" : "#868c92";

    pixelBlock(screen.x - s * 0.58 + walk * s * 0.22, screen.y + s * 0.85, s * 0.40, s * 0.25, "#252525");
    pixelBlock(screen.x + s * 0.18 - walk * s * 0.22, screen.y + s * 0.85, s * 0.40, s * 0.25, "#252525");
    pixelBlock(screen.x - s * 0.68, screen.y + bob, s * 1.36, s * 0.92, body);
    pixelBlock(screen.x - s * 0.70, screen.y + s * 0.18 + bob + walk * s * 0.05, s * 0.20, s * 0.60, "#d09b77");
    pixelBlock(screen.x + s * 0.50, screen.y + s * 0.18 + bob - walk * s * 0.05, s * 0.20, s * 0.60, "#d09b77");

    // 軍裝細節
    pixelBlock(screen.x - s * 0.48, screen.y + s * 0.08 + bob, s * 0.20, s * 0.52, "#d3d4d6");
    pixelBlock(screen.x - s * 0.16, screen.y + s * 0.25 + bob, s * 0.32, s * 0.12, "#31343a");
    pixelBlock(screen.x + s * 0.20, screen.y + s * 0.25 + bob, s * 0.18, s * 0.12, "#31343a");

    pixelBlock(screen.x - s * 0.50, screen.y - s * 1.00 + bob, s * 1.00, s * 0.86, "#dfad85");
    pixelBlock(screen.x - s * 0.55, screen.y - s * 1.03 + bob, s * 1.10, s * 0.25, helmet);
    pixelBlock(screen.x - s * 0.15, screen.y - s * 0.82 + bob, s * 0.12, s * 0.12, "#222");
    pixelBlock(screen.x - s * 0.40, screen.y + s * 0.44 + bob, s * 0.80, s * 0.08, "#20242a");
    pixelBlock(screen.x - s * 0.30, screen.y + s * 0.34 + bob, s * 0.16, s * 0.16, unit.type === "infantry" ? "#a48c5c" : "#8799a7");
    pixelBlock(screen.x - s * 0.44 + facing * s * 0.10, screen.y - s * 0.66 + bob, s * 0.18, s * 0.08, "#d8dbdc");

    if (unit.type === "artillery") {
        pixelBlock(screen.x + facing * s * 0.15, screen.y + s * 0.08, s * 0.95, s * 0.18, "#454a50");
        pixelBlock(screen.x - s * 0.20, screen.y + s * 0.65, s * 0.40, s * 0.18, "#252525");
    } else {
        const swing = Math.sin(unit.animTime * 10) * s * 0.12;
        pixelBlock(screen.x + facing * (s * 0.42 + swing), screen.y - s * 0.05 + bob, s * 0.14, s * 1.02, "#7b5639");
        pixelBlock(screen.x + facing * (s * 0.48 + swing), screen.y - s * 0.08 + bob, s * 0.13, s * 1.12, "#d0d4d6");
    }
}

function drawArmyIndicators() {
    for (const army of world.armies) {
        const screen = worldToScreen(army.x, army.y);
        if (screen.x < -100 || screen.x > screenWidth + 100 || screen.y < -60 || screen.y > screenHeight + 60) continue;
        ctx.fillStyle = army.selected ? "#ffe44b" : "#d9d9d9";
        ctx.font = "bold 12px Arial";
        ctx.textAlign = "center";
        ctx.fillText(army.name, screen.x, screen.y - 28 * camera.zoom);
        ctx.textAlign = "left";
    }
}

/* ================================================================
   MOVE MARKERS / BUILD PREVIEW / SELECTION BOX
================================================================ */

function drawMoveMarkers() {
    for (const unit of world.units) {
        if (!unit.selected || !["moving", "movingToResource", "movingToBuilding"].includes(unit.state)) continue;
        const screen = worldToScreen(unit.targetX, unit.targetY);
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.fillRect(screen.x - 4 * camera.zoom, screen.y - 4 * camera.zoom, 8 * camera.zoom, 8 * camera.zoom);
    }
}

function drawBuildingPreview() {
    if (!state.buildingType) return;
    const type = state.buildingType;
    const data = BUILDINGS[type];
    const valid = validBuildingPosition(type, input.mouse.worldX, input.mouse.worldY);
    const screen = worldToScreen(input.mouse.worldX, input.mouse.worldY);
    const width = data.width * camera.zoom;
    const height = data.height * camera.zoom;

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = valid ? "#65d86e" : "#db5757";
    ctx.fillRect(screen.x - width / 2, screen.y - height / 2, width, height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = valid ? "#d1ffd1" : "#ffd0d0";
    ctx.strokeRect(screen.x - width / 2, screen.y - height / 2, width, height);
}

function drawSelectionBox() {
    if (!input.mouse.leftDown) return;
    if (distance(input.mouse.dragStartX, input.mouse.dragStartY, input.mouse.x, input.mouse.y) < 8) return;
    const x = Math.min(input.mouse.dragStartX, input.mouse.x);
    const y = Math.min(input.mouse.dragStartY, input.mouse.y);
    const width = Math.abs(input.mouse.x - input.mouse.dragStartX);
    const height = Math.abs(input.mouse.y - input.mouse.dragStartY);
    ctx.fillStyle = "rgba(255,255,0,0.1)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "#fff000";
    ctx.strokeRect(x, y, width, height);
}

/* ================================================================
   FOG RENDER
================================================================ */

function drawFog() {
    const cell = GAME.FOG_CELL * camera.zoom;
    const left = Math.floor((camera.x - screenWidth / camera.zoom) / GAME.FOG_CELL) - 1;
    const right = Math.ceil((camera.x + screenWidth / camera.zoom) / GAME.FOG_CELL) + 1;
    const top = Math.floor((camera.y - screenHeight / camera.zoom) / GAME.FOG_CELL) - 1;
    const bottom = Math.ceil((camera.y + screenHeight / camera.zoom) / GAME.FOG_CELL) + 1;

    ctx.fillStyle = "rgba(8,12,16,0.90)";
    for (let gy = top; gy <= bottom; gy++) {
        for (let gx = left; gx <= right; gx++) {
            if (world.explored.has(`${gx},${gy}`)) continue;
            const wx = gx * GAME.FOG_CELL;
            const wy = gy * GAME.FOG_CELL;
            const s = worldToScreen(wx, wy);
            ctx.fillRect(Math.floor(s.x), Math.floor(s.y), Math.ceil(cell) + 1, Math.ceil(cell) + 1);
        }
    }
}

/* ================================================================
   DAY / WEATHER OVERLAY
================================================================ */

function drawClimateOverlay() {
    const phase = (state.time % GAME.DAY_LENGTH) / GAME.DAY_LENGTH;
    const light = (Math.sin(phase * Math.PI * 2) + 1) / 2;
    const darkness = 0.32 * (1 - light);

    if (darkness > 0.01) {
        ctx.fillStyle = `rgba(13,19,45,${darkness})`;
        ctx.fillRect(0, 0, screenWidth, screenHeight);
    }

    if (state.weather === "rain" || state.weather === "storm") drawRainOverlay();
    if (state.weather === "snow") drawSnowOverlay();
    if (state.weather === "fog") {
        ctx.fillStyle = "rgba(220,225,220,0.14)";
        ctx.fillRect(0, 0, screenWidth, screenHeight);
    }
}

function drawRainOverlay() {
    ctx.strokeStyle = "rgba(180,210,235,0.35)";
    ctx.lineWidth = 1;
    const intensity = state.weather === "storm" ? 65 : 32;
    for (let i = 0; i < intensity; i++) {
        const x = (i * 83 + Math.floor(state.time * 130)) % screenWidth;
        const y = (i * 47 + Math.floor(state.time * 170)) % screenHeight;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 5, y + 14);
        ctx.stroke();
    }
}

function drawSnowOverlay() {
    ctx.fillStyle = "rgba(230,240,250,0.55)";
    for (let i = 0; i < 55; i++) {
        const x = (i * 71 + Math.floor(state.time * 22)) % screenWidth;
        const y = (i * 97 + Math.floor(state.time * 28)) % screenHeight;
        ctx.fillRect(x, y, 3, 3);
    }
}

/* ================================================================
   MINIMAP
================================================================ */

function minimapRect() {
    return { x: screenWidth - 225, y: screenHeight - 365, width: 210, height: 210 };
}

function getMinimapTerrainCanvas(rect, range, left, top, size) {
    const cacheKey = `${Math.floor(left / 240)},${Math.floor(top / 240)},${Math.floor(camera.zoom * 10)}`;
    if (!movementRuntime.minimapCanvas || movementRuntime.minimapCacheKey !== cacheKey || movementRuntime.frame % GAME.MINIMAP_UPDATE_FRAMES === 0) {
        const off = document.createElement('canvas');
        off.width = 210; off.height = 210;
        const octx = off.getContext('2d');
        octx.imageSmoothingEnabled = false;
        const cellW = off.width / size;
        const cellH = off.height / size;
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const wx = left + (x / size) * range;
                const wy = top + (y / size) * range;
                let color = terrainColor(terrainAt(wx, wy), wx, wy);
                if (!isExplored(wx, wy)) color = '#11161a';
                octx.fillStyle = color;
                octx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
            }
        }
        movementRuntime.minimapCanvas = off;
        movementRuntime.minimapCacheKey = cacheKey;
    }
    return movementRuntime.minimapCanvas;
}

function drawMinimap() {
    const rect = minimapRect();
    ctx.fillStyle = "rgba(8,8,8,0.96)";
    ctx.fillRect(rect.x - 5, rect.y - 5, rect.width + 10, rect.height + 10);

    const range = 4200;
    const left = camera.x - range / 2;
    const top = camera.y - range / 2;
    const size = 42;

    const terrainCanvas = getMinimapTerrainCanvas(rect, range, left, top, size);
    ctx.drawImage(terrainCanvas, rect.x, rect.y, rect.width, rect.height);

    for (const settlement of world.settlements) {
        if (!isExplored(settlement.x, settlement.y)) continue;
        const px = (settlement.x - left) / range;
        const py = (settlement.y - top) / range;
        if (px < 0 || px > 1 || py < 0 || py > 1) continue;
        ctx.fillStyle = "#d2aa72";
        ctx.fillRect(rect.x + px * rect.width - 2, rect.y + py * rect.height - 2, 5, 5);
    }

    for (const building of world.buildings) {
        const px = (building.x - left) / range;
        const py = (building.y - top) / range;
        if (px < 0 || px > 1 || py < 0 || py > 1) continue;
        ctx.fillStyle = building.type === "townCenter" ? "#e04a4a" : "#c59b64";
        ctx.fillRect(rect.x + px * rect.width - 2, rect.y + py * rect.height - 2, 4, 4);
    }

    for (const army of world.armies) {
        const px = (army.x - left) / range;
        const py = (army.y - top) / range;
        if (px < 0 || px > 1 || py < 0 || py > 1) continue;
        ctx.fillStyle = "#66a5df";
        ctx.fillRect(rect.x + px * rect.width - 2, rect.y + py * rect.height - 2, 5, 5);
    }
}

/* ================================================================
   RESOURCE RATE / ECONOMY FEEDBACK
================================================================ */

function resourceRateText(rate) {
    const sign = rate > 0.05 ? "+" : rate < -0.05 ? "−" : "±";
    return `${sign}${Math.abs(rate).toFixed(1)}/s`;
}

function totalProductionFor(key) {
    let rate = 0;
    if (key === "food") {
        for (const farm of world.buildings) {
            if (farm.type === "farm" && farm.complete) {
                const local = fertilityAt(farm.x, farm.y);
                const weather = state.weather === "drought" ? 0.45 : state.weather === "rain" ? 1.12 : state.weather === "storm" ? 0.82 : state.weather === "snow" ? 0.55 : 1;
                let mult = 1 + (hasTech("agriculture") ? 0.25 : 0) + (hasTech("improvedFarming") ? 0.4 : 0);
                rate += GAME.FARM_BASE * mult * local * weather * (1 + player.workforce.farmer * 0.003);
            }
        }
    } else if (key === "wood") {
        rate = player.workforce.lumberjack * GAME.GATHER_AMOUNT / 0.72 * (1 + (hasTech("forestry") ? 0.2 : 0));
        rate *= 0.08;
    } else if (key === "stone" || key === "gold" || key === "iron") {
        rate = player.workforce.miner * GAME.GATHER_AMOUNT / 0.72 * (1 + (hasTech("mining") ? 0.2 : 0));
        rate *= 0.07;
    }
    return rate;
}

function updateResourceRates(dt, before) {
    if (dt <= 0) return;

    const keys = ["food", "wood", "stone", "gold", "iron"];
    const alpha = 1 - Math.pow(0.001, dt);

    for (const key of keys) {
        const now = Number(player.resources[key] || 0);
        const previous = Number(before[key] || 0);
        const instantRate = (now - previous) / dt;
        const oldRate = Number(player.resourceRates[key] || 0);
        player.resourceRates[key] = oldRate + (instantRate - oldRate) * alpha;
    }
}

function resourceDisplayInfo(type) {
    switch (type) {
        case "food": return { icon: "🍎", name: "食物", short: "食" };
        case "forest": return { icon: "🌲", name: "木材", short: "木" };
        case "stone": return { icon: "🪨", name: "石頭", short: "石" };
        case "gold": return { icon: "🟡", name: "黃金", short: "金" };
        case "iron": return { icon: "🔩", name: "鐵", short: "鐵" };
        default: return { icon: "?", name: type, short: "?" };
    }
}


/* ================================================================
   NATION / GOVERNMENT
================================================================ */

const GOVERNMENTS = [
    { name: "部族議會", leaderTitle: "議長", stability: 6, research: 2, military: 0, economy: 1 },
    { name: "君主制", leaderTitle: "國王", stability: 4, research: 1, military: 5, economy: 2 },
    { name: "共和制", leaderTitle: "執政官", stability: 3, research: 5, military: 1, economy: 4 },
    { name: "軍政政府", leaderTitle: "最高統帥", stability: 1, research: -1, military: 9, economy: 1 }
];

const FLAG_DESIGNS = [
    { name: "原野", a: "#687c47", b: "#e5dfb3", c: "#8e3f36" },
    { name: "赤日", a: "#9b493d", b: "#ead9a0", c: "#334f72" },
    { name: "青河", a: "#3d6f91", b: "#dfe5d0", c: "#6e8b55" },
    { name: "金穗", a: "#8b6e37", b: "#f0dfa8", c: "#4c714b" },
    { name: "玄甲", a: "#34383b", b: "#b6bdc1", c: "#8b3f35" },
    { name: "白山", a: "#c7c1ac", b: "#66809b", c: "#405b43" }
];

function nationPanelRect() {
    return { x: 20, y: 140, width: Math.min(420, screenWidth - 40), height: Math.min(420, screenHeight - 210) };
}

function drawFlag(x, y, w, h, index, selected = false) {
    const d = FLAG_DESIGNS[index % FLAG_DESIGNS.length];
    ctx.fillStyle = d.a; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = d.b; ctx.fillRect(x + w * 0.34, y, w * 0.22, h);
    ctx.fillStyle = d.c; ctx.fillRect(x + w * 0.55, y + h * 0.26, w * 0.45, h * 0.48);
    ctx.fillStyle = d.b; ctx.fillRect(x + w * 0.08, y + h * 0.22, w * 0.12, h * 0.56);
    if (selected) { ctx.strokeStyle = "#f0db55"; ctx.lineWidth = 2; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4); }
}

function governmentData() {
    return GOVERNMENTS.find(g => g.name === player.nation.government) || GOVERNMENTS[0];
}

function nationStats() {
    const g = governmentData();
    const pop = player.population || world.units.filter(u => u.owner === "player").length;
    const military = world.units.filter(u => u.owner === "player" && u.type !== "villager").length;
    const buildings = world.buildings.filter(b => b.complete).length;
    const settlements = world.settlements.filter(s => s.owner === "player").length;
    const economy = Math.max(0, player.treasury + player.resources.food * 0.2 + player.resources.wood * 0.12 + player.resources.iron * 0.5 + player.resources.gold * 0.8);
    const development = clamp(20 + buildings * 3 + settlements * 8 + (pop / 20) + g.economy * 2, 0, 100);
    const legitimacy = clamp(player.nation.legitimacy + g.stability * 0.15 + player.stability * 0.1, 0, 100);
    return { pop, military, buildings, settlements, economy, development, legitimacy, g };
}

function cycleGovernment() {
    const idx = Math.max(0, GOVERNMENTS.findIndex(g => g.name === player.nation.government));
    const next = GOVERNMENTS[(idx + 1) % GOVERNMENTS.length];
    player.nation.government = next.name;
    player.nation.leader = `新任${next.leaderTitle}`;
    player.nation.legitimacy = clamp(player.nation.legitimacy - 4, 0, 100);
    recordHistory(`政府體制改為${next.name}`);
    showMessage(`政府體制：${next.name} · ${next.leaderTitle}`);
}

function cycleFlag() {
    player.nation.flagIndex = (player.nation.flagIndex + 1) % FLAG_DESIGNS.length;
    showMessage(`國旗：${FLAG_DESIGNS[player.nation.flagIndex].name}`);
}

function drawNationPanel() {
    if (!state.nationOpen) return;
    const p = nationPanelRect();
    drawPanel(p.x, p.y, p.width, p.height);
    const stats = nationStats();
    ctx.fillStyle = "#fff"; ctx.font = "bold 20px Arial";
    ctx.fillText("國家 / NATION", p.x + 18, p.y + 30);
    drawFlag(p.x + 18, p.y + 48, 100, 60, player.nation.flagIndex, true);
    ctx.fillStyle = "#fff"; ctx.font = "bold 17px Arial";
    ctx.fillText(player.nation.name, p.x + 136, p.y + 68);
    ctx.fillStyle = "#aeb5b8"; ctx.font = "12px Arial";
    ctx.fillText(`成立：第 ${player.nation.foundedYear} 年`, p.x + 136, p.y + 88);
    ctx.fillText(`文化：${player.nation.culture}`, p.x + 136, p.y + 106);

    const rows = [
        ["人口", formatNumber(stats.pop)], ["軍事人口", formatNumber(stats.military)],
        ["建築", formatNumber(stats.buildings)], ["聚落", formatNumber(stats.settlements)],
        ["發展度", `${stats.development.toFixed(0)}%`], ["合法性", `${stats.legitimacy.toFixed(0)}%`],
        ["國庫", player.treasury.toFixed(1)], ["穩定度", `${player.stability.toFixed(0)}%`]
    ];
    let yy = p.y + 140;
    for (const [label, value] of rows) {
        ctx.fillStyle = "#cfd5d7"; ctx.fillText(label, p.x + 20, yy);
        ctx.fillStyle = "#fff"; ctx.font = "bold 12px Arial"; ctx.fillText(value, p.x + 125, yy);
        ctx.font = "12px Arial"; yy += 22;
    }
    ctx.fillStyle = "#e2c95d"; ctx.font = "bold 13px Arial";
    ctx.fillText(`政府：${stats.g.name}`, p.x + 215, p.y + 145);
    ctx.fillStyle = "#d0d6d8"; ctx.font = "12px Arial";
    ctx.fillText(`首腦：${player.nation.leader}`, p.x + 215, p.y + 168);
    ctx.fillText(`軍事傳統：${player.nation.militaryTradition}`, p.x + 215, p.y + 190);
    ctx.fillText(`外交原則：文明勢力預設中立`, p.x + 215, p.y + 212);

    drawButton(p.x + 20, p.y + p.height - 58, 150, 32, `🚩 換國旗 [點擊]`);
    drawButton(p.x + 182, p.y + p.height - 58, 190, 32, `🏛 改政府：${stats.g.name}`);
    ctx.fillStyle = "#8f989c"; ctx.font = "11px Arial";
    ctx.fillText("國旗與政府都直接點擊，不需要快捷鍵", p.x + 20, p.y + p.height - 15);
}

function nationPanelClick(x, y) {
    if (!state.nationOpen) return false;
    const p = nationPanelRect();
    if (x < p.x || x > p.x + p.width || y < p.y || y > p.y + p.height) return false;
    if (x >= p.x + 20 && x <= p.x + 170 && y >= p.y + p.height - 58 && y <= p.y + p.height - 26) {
        cycleFlag(); return true;
    }
    if (x >= p.x + 182 && x <= p.x + 372 && y >= p.y + p.height - 58 && y <= p.y + p.height - 26) {
        cycleGovernment(); return true;
    }
    return true;
}

/* ================================================================
   TOP UI
================================================================ */

function drawTopUI() {
    const panelW = Math.min(screenWidth - 30, 900);
    const panelH = 112;
    ctx.fillStyle = "rgba(10,10,10,0.93)";
    ctx.fillRect(15, 15, panelW, panelH);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.strokeRect(15, 15, panelW, panelH);

    const resources = [
        ["🍎", "食物", "food"],
        ["🌲", "木材", "wood"],
        ["🪨", "石頭", "stone"],
        ["🔩", "鐵", "iron"],
        ["🟡", "黃金", "gold"]
    ];

    const xPositions = [28, 160, 292, 424, 556];
    ctx.font = "bold 15px Arial";
    for (let i = 0; i < resources.length; i++) {
        const [icon, label, key] = resources[i];
        const x = xPositions[i];
        ctx.fillStyle = "#fff";
        ctx.fillText(`${icon} ${formatNumber(player.resources[key])}`, x, 43);
        const rate = player.resourceRates[key] || 0;
        ctx.fillStyle = rate > 0.05 ? "#7fe07f" : rate < -0.05 ? "#e27a6f" : "#9fa5a8";
        ctx.font = "11px Arial";
        ctx.fillText(resourceRateText(rate), x + 3, 61);
        ctx.fillStyle = "#757b7e";
        ctx.font = "10px Arial";
        ctx.fillText(label, x + 78, 61);
        ctx.font = "bold 15px Arial";
    }

    ctx.fillStyle = "#fff";
    ctx.fillText(`👥 ${player.population}/${player.populationCap}`, 690, 43);
    ctx.fillText(`💰 ${player.treasury.toFixed(0)}`, 805, 43);

    ctx.font = "11px Arial";
    ctx.fillStyle = "#8e969d";
    ctx.fillText(`勞動力：農${player.workforce.farmer} 木${player.workforce.lumberjack} 礦${player.workforce.miner} 工${player.workforce.industrial} 研${player.workforce.researcher}`, 28, 104);

    ctx.font = "13px Arial";
    ctx.fillStyle = "#bdbdbd";
    const year = Math.floor(state.time / GAME.YEAR_LENGTH) + 1;
    ctx.fillText(`第 ${year} 年 · ${civilizationEraName()} · ${seasonName()} · ${weatherName()} · ${state.temperature.toFixed(1)}°C`, 28, 88);
    ctx.fillText(state.paused ? "⏸ 暫停" : "▶ 運行", 310, 88);
    ctx.fillText(`穩定 ${player.stability.toFixed(0)}%`, 390, 88);
    ctx.fillText("T 科技", 485, 88);
    ctx.fillText("P 人口", 555, 88);
    ctx.fillText("M 市場", 625, 88);
    ctx.fillText("H 歷史", 700, 88);

    ctx.fillStyle = state.nationOpen ? "#667a4b" : "#30363a";
    ctx.fillRect(15, 120, 86, 24);
    ctx.strokeStyle = state.nationOpen ? "#e4d151" : "#60676a";
    ctx.strokeRect(15, 120, 86, 24);
    ctx.fillStyle = "#fff"; ctx.font = "11px Arial";
    ctx.fillText("🏳 國家", 34, 137);

    if (state.currentResearch) {
        const data = TECHS[state.currentResearch];
        ctx.fillStyle = "#e1ca4f";
        ctx.fillText(`研究：${data.name} ${Math.floor(state.researchProgress * 100)}%`, 770, 88);
    }
}

/* ================================================================
   BOTTOM BUILD MENU
================================================================ */

function drawBottomUI() {
    const panelY = screenHeight - 174;
    ctx.fillStyle = "rgba(12,12,12,0.97)";
    ctx.fillRect(0, panelY, screenWidth, 174);

    ctx.fillStyle = state.mode === "gather" ? "#61753f" : "#303030";
    ctx.fillRect(16, panelY + 18, 110, 70);
    ctx.strokeStyle = state.mode === "gather" ? "#eddc4f" : "#666";
    ctx.strokeRect(16, panelY + 18, 110, 70);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 15px Arial";
    ctx.fillText("採集", 48, panelY + 47);
    ctx.font = "11px Arial";
    ctx.fillStyle = "#bfc5c8";
    ctx.fillText("點擊 / G", 41, panelY + 70);

    const keys = Object.keys(BUILDINGS);
    const width = 118;
    const startX = 136;
    const cols = Math.max(1, Math.floor((screenWidth - startX - 20) / (width + 7)));
    const visible = Math.min(keys.length, cols * 2);
    for (let i = 0; i < visible; i++) {
        const type = keys[i];
        const data = BUILDINGS[type];
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = startX + col * (width + 7);
        const y = panelY + 10 + row * 76;
        const affordable = canAfford(data.cost);
        ctx.fillStyle = state.buildingType === type ? "#60763d" : affordable ? "#303030" : "#202020";
        ctx.fillRect(x, y, width, 68);
        ctx.strokeStyle = state.buildingType === type ? "#ebdd4e" : "#666";
        ctx.strokeRect(x, y, width, 68);
        ctx.fillStyle = affordable ? "#fff" : "#777";
        ctx.font = "bold 12px Arial";
        ctx.fillText(data.name, x + 7, y + 17);
        ctx.font = "10px Arial";
        ctx.fillStyle = "#92d492";
        ctx.fillText(`快捷：${i < 10 ? (i === 9 ? "0" : String(i + 1)) : "—"}`, x + 7, y + 34);
        ctx.fillStyle = "#aeb5b8";
        ctx.fillText(`木${data.cost.wood||0} 石${data.cost.stone||0} 金${data.cost.gold||0}`, x + 7, y + 50);
        ctx.fillStyle = "#7f878b";
        ctx.fillText("左鍵點擊建造", x + 7, y + 63);
    }

    const helpY = screenHeight - 17;
    ctx.fillStyle = "#9aa1a4";
    ctx.font = "11px Arial";
    ctx.fillText("左鍵：選取/建造/攻擊敵人 · 右鍵：移動 · 中鍵：拖曳鏡頭 · G：採集 · Q：生產 · V：兵營換兵 · C：建軍團 · U：加入軍團 · O：操作說明", 18, helpY);
}

/* ================================================================
   BUILDING / UNIT INFO
================================================================ */

function drawProgressBar(x, y, w, h, progress, fill, label) {
    const pct = clamp(Number(progress) || 0, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w * pct, h);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.strokeRect(x, y, w, h);
    if (label) {
        ctx.fillStyle = "#f1f3f4";
        ctx.font = "10px Arial";
        ctx.fillText(label, x + 6, y + h - 4);
    }
}

function buildingProgressSummary(building) {
    const rows = [];
    if (building && !building.complete) {
        rows.push({ label: `建造 ${Math.floor(clamp(building.buildProgress,0,1)*100)}%`, value: building.buildProgress, fill: "#d4ae3f" });
    }
    if (building && building.upgradeProgress > 0 && building.upgradeProgress < 1) {
        const nextLevel = (building.level || 1) + 1;
        rows.push({ label: `升級 Lv.${nextLevel} ${Math.floor(clamp(building.upgradeProgress,0,1)*100)}%`, value: building.upgradeProgress, fill: "#69a7d8" });
    }
    if (building && building.queue && building.queue.length) {
        const item = building.queue[0];
        const unitName = UNITS[item.unitType]?.name || item.unitType;
        const label = `${unitName} 生產 ${Math.floor(clamp(item.progress/(item.time||1),0,1)*100)}%`;
        rows.push({ label, value: item.progress/(item.time||1), fill: "#72c87a" });
    }
    return rows;
}

function drawSelectedBuildingProgress() {
    const building = state.selectedBuilding;
    if (!building) return;
    const rows = buildingProgressSummary(building);
    if (!rows.length) return;
    const x = Math.max(15, screenWidth - 350);
    let y = 250;
    const w = 320;
    ctx.fillStyle = "rgba(8,10,12,0.90)";
    ctx.fillRect(x, y - 22, w, rows.length * 22 + 28);
    ctx.fillStyle = "#d7dcdf";
    ctx.font = "bold 11px Arial";
    ctx.fillText("即時進度", x + 10, y - 6);
    for (const row of rows) {
        drawProgressBar(x + 10, y, w - 20, 15, row.value, row.fill, row.label);
        y += 22;
    }
}


function drawSelectionInfo() {
    if (state.selectedBuilding) {
        drawBuildingInfo(state.selectedBuilding);
        return;
    }

    const selected = selectedUnits();
    if (!selected.length) return;

    const width = 305;
    drawPanel(screenWidth - width - 15, 15, width, 160);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 17px Arial";
    ctx.fillText(`選取 ${selected.length} 單位`, screenWidth - width, 42);

    const villagers = selected.filter(u => u.type === "villager").length;
    const militia = selected.filter(u => u.type === "militia").length;
    const infantry = selected.filter(u => u.type === "infantry").length;
    const scout = selected.filter(u => u.type === "scout").length;
    const artillery = selected.filter(u => u.type === "artillery").length;

    ctx.font = "13px Arial";
    ctx.fillStyle = "#ddd";
    ctx.fillText(`村民 ${villagers} · 民兵 ${militia} · 步兵 ${infantry}`, screenWidth - width, 70);
    ctx.fillText(`偵察 ${scout} · 火砲 ${artillery}`, screenWidth - width, 95);
    ctx.fillStyle = "#aaa";
    ctx.fillText("右鍵：移動", screenWidth - width, 122);

    if (villagers > 0) {
        ctx.fillStyle = "#83c5ef";
        ctx.fillText("J農業 K伐木 L採礦 B建造 N科研", screenWidth - width, 146);

        const selectedVill = selected.filter(u => u.type === "villager");
        const jobCounts = {};
        for (const villager of selectedVill) jobCounts[villager.job || "farmer"] = (jobCounts[villager.job || "farmer"] || 0) + 1;
        const summary = Object.entries(jobCounts).map(([job, count]) => `${jobName(job)} ${count}`).join(" · ");
        ctx.fillStyle = "#f0e3b0";
        ctx.fillText(summary || "尚未分配職業", screenWidth - width, 169);
    }

    if (selected.length === 1 && selected[0].type === "villager") {
        const villager = selected[0];
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px Arial";
        ctx.fillText(`職業：${jobName(villager.job || "farmer")}`, screenWidth - width, 195);
        ctx.font = "13px Arial";
        ctx.fillStyle = "#b8c5cf";
        ctx.fillText(`狀態：${unitStateName(villager.state)} · 工作效率 ${Math.round(villagerWorkEfficiency(villager) * 100)}%`, screenWidth - width, 216);
    }
}

function drawArmyInfo(army) {
    const width = 350;
    const height = 250;
    const x = screenWidth - width - 15;
    drawPanel(x, 15, width, height);
    const members = world.units.filter(u => u.owner === "player" && u.armyId === army.id);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 19px Arial";
    ctx.fillText(army.name, x + 12, 42);
    ctx.font = "12px Arial";
    ctx.fillStyle = "#c6cdd0";
    ctx.fillText(`兵力 ${army.manpower || 0} · ${army.divisions || 0} 師 · ${members.length} 單位`, x + 12, 66);
    ctx.fillText(`組織 ${army.organization.toFixed(0)}% · 士氣 ${army.morale.toFixed(0)}% · 補給 ${army.supply.toFixed(0)}%`, x + 12, 88);
    ctx.fillText(`命令：${army.order} · 位置：${Math.round(army.x)}, ${Math.round(army.y)}`, x + 12, 110);

    const status = clamp(((army.organization || 0) + (army.morale || 0) + (army.supply || 0)) / 3, 0, 100);
    drawProgressBar(x + 12, 122, width - 24, 17, status / 100, "#6caf73", `戰備度 ${status.toFixed(0)}%`);
    ctx.fillStyle = "#b9c0c4";
    ctx.fillText("點軍團：選整軍 · 右鍵：移動整軍", x + 12, 158);
    ctx.fillText("A 進攻  ·  D 防守  ·  S 待命  ·  F 建立前線", x + 12, 180);
    ctx.fillText("C 新建軍團  ·  U 加入軍團  ·  X 解散軍團", x + 12, 202);
    ctx.fillStyle = "#8d969b";
    ctx.fillText("軍團只管理已加入的士兵；新兵可選取後再加入", x + 12, 224);
}

function productionRateLabel(building) {
    if (!building || !building.queue || !building.queue.length) return "待命";
    const item = building.queue[0];
    if (!item.time) return "—";
    const percent = clamp(item.progress / item.time, 0, 1) * 100;
    return `${Math.round(percent)}% / ${item.time.toFixed(1)}s`;
}

function drawBuildingInfo(building) {
    const width = 350;
    const height = 360;
    const panelX = screenWidth - width - 15;
    drawPanel(panelX, 15, width, height);
    const name = building.type === "townCenter" ? "城鎮中心" : BUILDINGS[building.type]?.name || building.type;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 19px Arial";
    ctx.fillText(name, panelX + 12, 42);
    ctx.font = "12px Arial";
    ctx.fillStyle = building.complete ? "#7add7a" : "#dfc84c";
    ctx.fillText(building.complete ? `狀態：完成 · Lv.${building.level || 1}` : `狀態：建造中`, panelX + 12, 66);

    const hp = building.maxHitPoints ? `${Math.ceil(building.hitPoints)}/${building.maxHitPoints}` : "—";
    ctx.fillStyle = "#c7cdd0";
    ctx.fillText(`耐久：${hp}`, panelX + 12, 87);

    let yy = 112;
    if (!building.complete) {
        drawProgressBar(panelX + 12, yy, width - 24, 18, building.buildProgress, "#d4ae3f", `建造進度 ${Math.floor(clamp(building.buildProgress,0,1)*100)}%`);
        yy += 31;
    }

    if (building.upgradeProgress > 0 && building.upgradeProgress < 1) {
        drawProgressBar(panelX + 12, yy, width - 24, 18, building.upgradeProgress, "#69a7d8", `升級進度 ${Math.floor(clamp(building.upgradeProgress,0,1)*100)}%`);
        yy += 31;
    }

    if (building.type === "townCenter") {
        ctx.fillStyle = "#fff";
        ctx.fillText("村民：Q 生產", panelX + 12, yy);
        yy += 22;
    } else if (building.type === "barracks") {
        const prod = UNITS[building.productionType || "militia"]?.name || "民兵";
        ctx.fillText(`目前生產：${prod}`, panelX + 12, yy); yy += 22;
        ctx.fillStyle = "#aab2b7";
        ctx.fillText("Q 生產目前兵種 · 點擊下方切換兵種", panelX + 12, yy); yy += 22;
        if (building.queue.length) {
            const item = building.queue[0];
            drawProgressBar(panelX + 12, yy, width - 24, 18, item.progress / Math.max(1,item.time), "#72c87a", `${UNITS[item.unitType]?.name || item.unitType} 生產 ${Math.floor(clamp(item.progress/item.time,0,1)*100)}%`);
            yy += 29;
        }
        drawButton(panelX + 12, yy, 150, 28, "🔄 切換兵種 [V]");
        yy += 40;
    } else if (building.type === "workshop" || building.type === "factory") {
        ctx.fillText("工業：持續轉化原料與工業人口", panelX + 12, yy); yy += 22;
        if (building.queue.length) {
            const item = building.queue[0];
            drawProgressBar(panelX + 12, yy, width - 24, 18, item.progress / Math.max(1,item.time), "#72c87a", `${UNITS[item.unitType]?.name || "產品"} ${Math.floor(clamp(item.progress/item.time,0,1)*100)}%`);
            yy += 29;
        }
    } else {
        ctx.fillText(BUILDINGS[building.type]?.description || "", panelX + 12, yy); yy += 22;
    }

    ctx.fillStyle = "#c1c7ca";
    ctx.fillText(`生產佇列：${building.queue?.length || 0}`, panelX + 12, yy);
    yy += 24;

    if (building.complete && canUpgradeBuilding(building)) {
        const cost = buildingUpgradeCost(building);
        const parts = Object.entries(cost).filter(([,v]) => v > 0).map(([k,v]) => `${resourceDisplayInfo(k).short}${v}`).join("  ");
        drawButton(panelX + 12, yy, 150, 30, `⬆ 升級 Lv.${(building.level || 1) + 1}`);
        ctx.fillStyle = "#c3c9cc";
        ctx.font = "11px Arial";
        ctx.fillText(`升級成本：${parts || "無"}`, panelX + 175, yy + 12);
        ctx.fillText("直接點按鈕即可，不需要快捷鍵", panelX + 12, yy + 47);
        yy += 66;
    }

    ctx.fillStyle = "#9fa7ab";
    ctx.font = "11px Arial";
    ctx.fillText("滑鼠點擊資訊區可執行可用操作；O 查看完整操作說明", panelX + 12, Math.min(panelYSafe(), 15 + height - 16));
}

function panelYSafe() { return 15 + 345; }

function drawButton(x, y, w, h, text) {
    ctx.fillStyle = "rgba(45,52,56,0.96)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#6d777c";
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#eef2f3";
    ctx.font = "11px Arial";
    ctx.fillText(text, x + 8, y + 19);
}

/* ================================================================
   ARMY PANEL
================================================================ */

function drawArmyPanel() {
    const p = armyPanelRect();
    ctx.fillStyle = "rgba(8,10,12,0.94)";
    ctx.fillRect(p.x, p.y, p.width, p.height);
    ctx.strokeStyle = "#555d61";
    ctx.strokeRect(p.x, p.y, p.width, p.height);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px Arial";
    ctx.fillText("軍團 / ARMIES", p.x + 12, p.y + 26);

    ctx.font = "11px Arial";
    ctx.fillStyle = "#888";
    ctx.fillText("", p.x + 138, p.y + 24);

    const rowH = 34;
    for (let i = 0; i < Math.min(world.armies.length, 2); i++) {
        const army = world.armies[i];
        const y = p.y + 42 + i * rowH;
        ctx.fillStyle = army.selected ? "#4c5235" : "#252a2d";
        ctx.fillRect(p.x + 8, y, p.width - 16, rowH - 4);
        ctx.strokeStyle = army.selected ? "#e5d64d" : "#4b5255";
        ctx.strokeRect(p.x + 8, y, p.width - 16, rowH - 4);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px Arial";
        ctx.fillText(army.name, p.x + 18, y + 17);
        ctx.font = "10px Arial";
        ctx.fillStyle = "#b9c1c4";
        ctx.fillText(`${army.divisions || 0}師 · 補給${army.supply.toFixed(0)}% · ${army.order}`, p.x + 18, y + 34);
    }

    ctx.fillStyle = "#344b3a";
    ctx.fillRect(p.x + 8, p.y + p.height - 28, 112, 22);
    ctx.strokeStyle = "#719f77";
    ctx.strokeRect(p.x + 8, p.y + p.height - 28, 112, 22);
    ctx.fillStyle = "#dcebdc";
    ctx.font = "11px Arial";
    ctx.fillText("＋ 新建軍團", p.x + 35, p.y + p.height - 13);
}

/* ================================================================
   CONTROLS / NOTIFICATION
================================================================ */

function drawMessage() {
    if (state.notificationTimer <= 0) return;
    const width = Math.min(450, screenWidth - 40);
    const x = (screenWidth - width) / 2;
    const y = 112;
    ctx.fillStyle = "rgba(8,8,8,0.94)";
    ctx.fillRect(x, y, width, 48);
    ctx.fillStyle = "#fff";
    ctx.font = "15px Arial";
    ctx.textAlign = "center";
    ctx.fillText(state.notification, screenWidth / 2, y + 30);
    ctx.textAlign = "left";
}

/* ================================================================
   TECH TREE UI — V0.8 STYLE PRESERVED
================================================================ */

function techPanelRect() {
    return { x: 70, y: 65, width: Math.min(screenWidth - 140, 1040), height: Math.min(screenHeight - 120, 650) };
}

function techNodeRect(index) {
    const panel = techPanelRect();
    const columns = 4;
    const width = 200;
    const height = 82;
    const col = index % columns;
    const row = Math.floor(index / columns);
    return {
        x: panel.x + 20 + col * 215,
        y: panel.y + 85 + row * 96,
        width,
        height
    };
}

function drawTechTree() {
    if (!state.techOpen) return;
    const p = techPanelRect();
    drawPanel(p.x, p.y, p.width, p.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 24px Arial";
    ctx.fillText("科研 / Technology", p.x + 25, p.y + 37);
    ctx.font = "13px Arial";
    ctx.fillStyle = "#aaa";
    ctx.fillText(`研究槽 ${state.currentResearch ? 1 : 0}/${state.researchSlots}`, p.x + 25, p.y + 62);
    if (state.currentResearch) {
        const data = TECHS[state.currentResearch];
        ctx.fillStyle = "#e0c548";
        ctx.fillText(`研究中：${data.name} ${Math.floor(state.researchProgress * 100)}%`, p.x + 190, p.y + 62);
    }

    const keys = Object.keys(TECHS);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const data = TECHS[key];
        const r = techNodeRect(i);
        if (r.y + r.height > p.y + p.height - 20) continue;
        const researched = hasTech(key);
        const unlocked = techState.unlocked.has(key);
        const researching = state.currentResearch === key;

        ctx.fillStyle = researched ? "#365f3a" : researching ? "#625726" : unlocked ? "#303d55" : "#202020";
        ctx.fillRect(r.x, r.y, r.width, r.height);
        ctx.strokeStyle = researched ? "#71d678" : researching ? "#dfc84c" : unlocked ? "#6b8fc7" : "#555";
        ctx.strokeRect(r.x, r.y, r.width, r.height);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px Arial";
        ctx.fillText(data.name, r.x + 10, r.y + 21);
        ctx.font = "11px Arial";
        ctx.fillStyle = "#bcbcbc";
        ctx.fillText(data.description, r.x + 10, r.y + 40);
        ctx.fillText(`研究 ${data.time}s`, r.x + 10, r.y + 58);
        ctx.fillStyle = researched ? "#78d77a" : unlocked ? "#8db8f0" : "#777";
        ctx.fillText(researched ? "已完成" : unlocked ? "左鍵研究" : "未解鎖", r.x + 10, r.y + 73);
    }
}

function handleTechClick(mx, my) {
    const keys = Object.keys(TECHS);
    for (let i = 0; i < keys.length; i++) {
        const r = techNodeRect(i);
        if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height) {
            startResearch(keys[i]);
            return true;
        }
    }
    return false;
}

/* ================================================================
   SAVE / LOAD
================================================================ */

const SAVE_KEY = "rts_v0921_civilization_no_army";

function serializeSet(set) {
    return Array.from(set);
}

function saveGame() {
    try {
        const data = {
            version: GAME.VERSION,
            worldSeed,
            player,
            nation: player.nation,
            camera: { x: camera.x, y: camera.y, zoom: camera.zoom },
            units: world.units,
            buildings: world.buildings,
            roads: world.roads,
            settlements: world.settlements,
            factions: world.factions,
            tradeRoutes: world.tradeRoutes,
            history: world.history,
            explored: Array.from(world.explored.entries()),
            chunks: Array.from(world.chunks.entries()),
            time: state.time,
            gameSpeed: state.gameSpeed,
            weather: state.weather,
            season: state.season,
            temperature: state.temperature,
            currentResearch: state.currentResearch,
            researchProgress: state.researchProgress,
            researchSlots: state.researchSlots,
            researched: serializeSet(techState.researched),
            treasury: player.treasury
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
        showMessage("世界已儲存");
    } catch (error) {
        console.error(error);
        showMessage("儲存失敗");
    }
}

function loadGame() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) {
            showMessage("沒有存檔");
            return;
        }
        const data = JSON.parse(raw);
        worldSeed = data.worldSeed;
        Object.assign(player, data.player || {});
        camera.x = data.camera?.x || 0;
        camera.y = data.camera?.y || 0;
        camera.zoom = data.camera?.zoom || 1;

        world.units = data.units || [];
        for (const unit of world.units) {
            unit.movePath = [];
            unit.pathIndex = 0;
            unit.blockedTime = 0;
            unit.repathTimer = 0;
            unit.pathFailed = false;
            unit.animTime = Number.isFinite(unit.animTime) ? unit.animTime : 0;
        }
        world.buildings = data.buildings || [];
        world.roads = data.roads || [];
        world.settlements = data.settlements || [];
        world.factions = data.factions || [];
        // V0.9.21：軍團系統已暫時移除；舊存檔的軍團關聯直接清空。
        for (const unit of world.units) {
            unit.armyId = null;
            unit.stance = null;
        }
        world.tradeRoutes = data.tradeRoutes || [];
        world.history = data.history || [];
        world.explored = new Map(data.explored || []);
        world.chunks.clear();
        for (const [key, chunk] of data.chunks || []) world.chunks.set(key, chunk);

        state.time = data.time || 0;
        state.gameSpeed = clamp(data.gameSpeed || 1, 0.5, 2);
        state.weather = data.weather || "clear";
        state.season = data.season || 0;
        state.temperature = data.temperature || 18;
        state.currentResearch = data.currentResearch || null;
        state.researchProgress = data.researchProgress || 0;
        state.researchSlots = data.researchSlots || 1;
        techState.researched = new Set(data.researched || []);
        updateUnlockedTechs();
        clearSelection();
            showMessage("世界已載入");
    } catch (error) {
        console.error(error);
        showMessage("讀取失敗");
    }
}

/* ================================================================
   FORMATIONS
================================================================ */
// 數字編隊快捷鍵已移除，避免和其他瀏覽器 / 工作流程快捷鍵衝突。

/* ================================================================
   V0.9.14 — QUALITY OF LIFE / BUILDING & COMMAND SYSTEM

   這一版在不改自由移動與自動戰鬥核心的前提下，增加：
   1. 建築等級與升級
   2. 生產佇列取消 / 部分退款
   3. 閒置村民快速選取
   4. 選取目標聚焦鏡頭
   5. 軍團姿態：進攻 / 防守 / 待命
   6. 軍團重新命名
   7. 軍團休整（恢復士氣、降低疲勞）
   8. 遊戲速度 0.5x / 1x / 2x
   9. 建築生命資訊條
   10. 生產資訊總覽
   11. 單位狀態標籤
   12. 建築/單位資訊更清楚
================================================================ */

function buildingUpgradeCost(building) {
    const level = Math.max(1, building.level || 1);
    const base = BUILDINGS[building.type]?.cost || {food:0,wood:0,stone:0,gold:0,iron:0};
    const mult = level === 1 ? 1 : level * 0.9;
    return {
        food: Math.ceil((base.food || 0) * 0.65 * mult),
        wood: Math.ceil((base.wood || 0) * 0.75 * mult),
        stone: Math.ceil((base.stone || 0) * 0.75 * mult),
        gold: Math.ceil((base.gold || 0) * 0.75 * mult),
        iron: Math.ceil((base.iron || 0) * 0.75 * mult)
    };
}

function canUpgradeBuilding(building) {
    if (!building || !building.complete) return false;
    if (building.type === "townCenter") return (building.level || 1) < 4;
    return (building.level || 1) < 3;
}

function upgradeSelectedBuilding() {
    const building = state.selectedBuilding;
    if (!building) { showMessage("先選取要升級的建築"); return; }
    if (!canUpgradeBuilding(building)) { showMessage("這個建築已達目前最高等級"); return; }
    if (building.upgradeProgress > 0 && building.upgradeProgress < 1) { showMessage("建築正在升級"); return; }
    const cost = buildingUpgradeCost(building);
    if (!canAfford(cost)) { showMessage(`升級資源不足：木 ${cost.wood} 石 ${cost.stone} 鐵 ${cost.iron} 金 ${cost.gold}`); return; }
    payCost(cost);
    building.upgradeProgress = 0.0001;
    building.upgradeTime = 8 + (building.level || 1) * 4;
    showMessage(`${BUILDINGS[building.type]?.name || building.type} 開始升級`);
}

function updateBuildingUpgrades(dt) {
    for (const building of world.buildings) {
        if (!building.complete || !(building.upgradeProgress > 0)) continue;
        building.upgradeProgress += dt / Math.max(1, building.upgradeTime || 10);
        if (building.upgradeProgress >= 1) {
            building.upgradeProgress = 0;
            building.level = Math.min(building.type === "townCenter" ? 4 : 3, (building.level || 1) + 1);
            building.maxHitPoints = Math.round((building.maxHitPoints || 1000) * 1.15);
            building.hitPoints = building.maxHitPoints;
            recordHistory(`${BUILDINGS[building.type]?.name || building.type} 升至 Lv.${building.level}`);
            showMessage(`${BUILDINGS[building.type]?.name || building.type} 升級完成：Lv.${building.level}`);
        }
    }
}

function cancelSelectedProduction() {
    const building = state.selectedBuilding;
    if (!building || !building.queue?.length) { showMessage("目前沒有生產佇列"); return; }
    const item = building.queue.pop();
    const data = TRAINING[item.unitType];
    if (data) {
        const refund = {};
        for (const key of ["food","wood","stone","gold","iron"]) refund[key] = Math.floor((data.cost[key] || 0) * 0.7);
        player.resources.food += refund.food;
        player.resources.wood += refund.wood;
        player.resources.stone += refund.stone;
        player.resources.gold += refund.gold;
        player.resources.iron += refund.iron;
        showMessage(`取消 ${UNITS[item.unitType]?.name || item.unitType}，退回 70% 資源`);
    }
}

function selectIdleVillager() {
    const idle = world.units.find(u => u.owner === "player" && u.type === "villager" && u.state === "idle");
    if (!idle) { showMessage("沒有閒置村民"); return; }
    clearSelection();
    idle.selected = true;
    camera.x = idle.x;
    camera.y = idle.y;
    showMessage("已選取一名閒置村民");
}

function focusSelection() {
    const units = selectedUnits();
    if (!units.length) { showMessage("沒有選取單位"); return; }
    const avgX = units.reduce((sum, u) => sum + u.x, 0) / units.length;
    const avgY = units.reduce((sum, u) => sum + u.y, 0) / units.length;
    camera.x = avgX;
    camera.y = avgY;
}

function cycleSelectedArmyStance() {
    if (!state.selectedArmy) { showMessage("先選取軍團"); return; }
    const army = state.selectedArmy;
    const stances = ["進攻","防守","待命"];
    const idx = Math.max(0, stances.indexOf(army.order));
    army.order = stances[(idx + 1) % stances.length];
    army.stance = army.order;
    const members = world.units.filter(u => u.owner === "player" && u.armyId === army.id);
    for (const unit of members) unit.stance = army.order;
    showMessage(`${army.name} 姿態：${army.order}`);
}

function renameSelectedArmy() {
    if (!state.selectedArmy) { showMessage("先選取軍團"); return; }
    const army = state.selectedArmy;
    const next = prompt("輸入新的軍團名稱：", army.name || "第1軍");
    if (next && next.trim()) {
        army.name = next.trim().slice(0, 24);
        recordHistory(`軍團更名為 ${army.name}`);
    }
}

function restSelectedArmy() {
    if (!state.selectedArmy) { showMessage("先選取軍團"); return; }
    const members = world.units.filter(u => u.owner === "player" && u.armyId === state.selectedArmy.id);
    if (!members.length) return;
    state.selectedArmy.order = "待命";
    state.selectedArmy.stance = "待命";
    for (const u of members) {
        u.targetEnemy = null;
        u.state = "idle";
        u.exhaustion = Math.max(0, (u.exhaustion || 0) - 18);
        u.morale = clamp((u.morale || 100) + 6, 0, 100);
    }
    showMessage(`${state.selectedArmy.name} 開始休整`);
}

function drawBuildingHealthBars() {
    for (const building of world.buildings) {
        if (building.hitPoints == null || building.maxHitPoints == null || building.hitPoints >= building.maxHitPoints) continue;
        const p = worldToScreen(building.x, building.y - building.height * 0.58);
        if (p.x < -150 || p.x > screenWidth + 150 || p.y < -30 || p.y > screenHeight - 150) continue;
        const w = Math.max(36, building.width * camera.zoom * 0.7);
        ctx.fillStyle = "rgba(0,0,0,0.82)";
        ctx.fillRect(p.x-w/2,p.y,w,5);
        ctx.fillStyle = building.hitPoints / building.maxHitPoints > 0.55 ? "#67c96d" : building.hitPoints / building.maxHitPoints > 0.25 ? "#d5c451" : "#db5d59";
        ctx.fillRect(p.x-w/2,p.y,w*clamp(building.hitPoints/building.maxHitPoints,0,1),5);
    }
}

function drawUnitStatusLabels() {
    if (camera.zoom < 0.85) return;
    for (const unit of world.units) {
        if (!unit.selected) continue;
        const p = worldToScreen(unit.x, unit.y - unit.radius - 22);
        if (p.x < -100 || p.x > screenWidth + 100 || p.y < -30 || p.y > screenHeight - 150) continue;
        const name = unit.type === "villager" ? jobName(unit.job || "farmer") : (UNITS[unit.type]?.name || unit.type);
        const text = `${name} · Lv.${unitLevel(unit)} · ${unitStateName(unit.state)}`;
        ctx.font = "10px Arial";
        const w = ctx.measureText(text).width + 10;
        ctx.fillStyle = "rgba(7,8,10,0.82)";
        ctx.fillRect(p.x-w/2,p.y-9,w,15);
        ctx.fillStyle = "#eef1f2";
        ctx.textAlign = "center";
        ctx.fillText(text,p.x,p.y+2);
        ctx.textAlign = "left";
    }
}

function drawProductionOverview() {
    const active = world.buildings.filter(b => b.complete && b.queue?.length);
    if (!active.length) return;
    const topReserved = state.selectedBuilding ? 285 : 118;
    const x = Math.max(15, screenWidth - 315);
    let y = topReserved;
    const rows = Math.min(active.length, 5);
    const h = 32 + rows * 28;
    ctx.fillStyle = "rgba(8,10,12,0.92)";
    ctx.fillRect(x, y, 300, h);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(x, y, 300, h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Arial";
    ctx.fillText("生產總覽 / PRODUCTION", x + 10, y + 18);
    for (let i = 0; i < rows; i++) {
        const b = active[i], item = b.queue[0];
        const name = BUILDINGS[b.type]?.name || b.type;
        const unitName = UNITS[item.unitType]?.name || item.unitType;
        const pct = clamp(item.progress / Math.max(1,item.time), 0, 1);
        const yy = y + 24 + i * 28;
        ctx.fillStyle = "#cbd1d4";
        ctx.font = "10px Arial";
        ctx.fillText(`${name} · ${unitName}`, x + 10, yy + 9);
        drawProgressBar(x + 120, yy, 165, 14, pct, "#72c87a", `${Math.floor(pct*100)}%`);
    }
}

function drawGameSpeed() {
    ctx.fillStyle = "#aeb5b8";
    ctx.font = "11px Arial";
    ctx.fillText(`速度 ${state.gameSpeed.toFixed(1)}x  [ / ]`, 805, 104);
}

/* ================================================================
   INPUT — KEYBOARD
================================================================ */

window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();
    input.keys[key] = true;

    if (event.key === "Escape") {
        state.mode = "normal";
        state.buildingType = null;
        state.techOpen = false;
        state.populationOpen = false;
        state.marketOpen = false;
        state.historyOpen = false;
        state.nationOpen = false;
        return;
    }

    if (event.key === " ") {
        event.preventDefault();
        state.paused = !state.paused;
        showMessage(state.paused ? "遊戲已暫停" : "遊戲繼續");
        return;
    }

    if (key === "t") {
        state.techOpen = !state.techOpen;
        state.buildingType = null;
        return;
    }

    if (key === "p") {
        state.populationOpen = !state.populationOpen;
        return;
    }

    if (key === "m") {
        state.marketOpen = !state.marketOpen;
        return;
    }

    if (key === "h") {
        state.historyOpen = !state.historyOpen;
        return;
    }

    if (key === "i") {
        world.runtimeStats.infoOpen = !world.runtimeStats.infoOpen;
        state.techOpen = false;
        state.populationOpen = false;
        state.marketOpen = false;
        state.historyOpen = false;
        state.nationOpen = false;
        return;
    }

    if (key === "g") {
        enterGatherMode();
        return;
    }

    if (key === "e") {
        searchRuin();
        return;
    }

    if (key === "j") { cycleVillagerJob("farmer"); return; }
    if (key === "k") { cycleVillagerJob("lumberjack"); return; }
    if (key === "l") { cycleVillagerJob("miner"); return; }
    if (key === "b" && !state.techOpen) { cycleVillagerJob("builder"); return; }
    if (key === "n") { cycleVillagerJob("researcher"); return; }

    if (!event.ctrlKey && !event.altKey && !state.techOpen && !state.populationOpen && !state.marketOpen && !state.historyOpen) {
        if (key === "1") { startBuilding("house"); return; }
        if (key === "2") { startBuilding("lumberCamp"); return; }
        if (key === "3") { startBuilding("miningCamp"); return; }
        if (key === "4") { startBuilding("barracks"); return; }
        if (key === "5") { startBuilding("farm"); return; }
        if (key === "6") { startBuilding("workshop"); return; }
        if (key === "7") { startBuilding("factory"); return; }
        if (key === "8") { startBuilding("market"); return; }
        if (key === "9") { startBuilding("watchTower"); return; }
        if (key === "0") { startBuilding("supplyDepot"); return; }
        if (key === "r") { placeRoad(); return; }
    }

    if (key === "q") {
        const building = state.selectedBuilding;
        if (!building) return;
        if (building.type === "townCenter") enqueueUnit(building, "villager");
        else if (building.type === "barracks") queueSelectedBarracksUnit(building);
        else if (building.type === "workshop") {
            if (hasTech("artillery")) enqueueUnit(building, "artillery");
            else showMessage("先研究火砲科技");
        }
        else showMessage("這個建築目前沒有 Q 生產功能");
        return;
    }

    if (key === "v") {
        if (state.selectedBuilding?.type === "barracks") cycleBarracksProduction(state.selectedBuilding);
        else showMessage("先選取兵營，再按 V 切換生產兵種");
        return;
    }

    if (key === "u") {
        joinSelectedSoldiersToArmy();
        return;
    }

    if (key === "o") {
        state.helpOpen = !state.helpOpen;
        return;
    }

    if (key === "y") {
        setSelectedBuildingRally();
        return;
    }

    if (key === "c" && selectedSoldiers().length) createArmyFromSelected();

    if (key === ",") { selectIdleVillager(); return; }
    if (key === "z") { cycleSelectedArmyStance(); return; }
    if (key === "backspace") { event.preventDefault(); cancelSelectedProduction(); return; }
    if (event.shiftKey && key === "f") { focusSelection(); return; }
    if (event.shiftKey && key === "n") { renameSelectedArmy(); return; }
    if (event.shiftKey && key === "h") { restSelectedArmy(); return; }
    if (key === "[" || key === "]") {
        state.gameSpeed = clamp(state.gameSpeed + (key === "]" ? 0.5 : -0.5), 0.5, 2);
        showMessage(`遊戲速度：${state.gameSpeed.toFixed(1)}x`);
        return;
    }

    if (event.ctrlKey && key === "s") {
        event.preventDefault();
        saveGame();
        return;
    }

    if (event.ctrlKey && key === "l") {
        event.preventDefault();
        loadGame();
        return;
    }

});

window.addEventListener("keyup", event => {
    input.keys[event.key.toLowerCase()] = false;
});

function joinSelectedSoldiersToArmy() {
    const soldiers = selectedSoldiers();
    if (!soldiers.length) { showMessage("先選取要加入軍團的士兵"); return; }
    const army = state.selectedArmy || world.armies[0];
    if (!army) { showMessage("目前沒有軍團；先用 C 建立軍團"); return; }
    let added = 0;
    for (const soldier of soldiers) {
        if (soldier.armyId !== army.id) { soldier.armyId = army.id; added++; }
    }
    state.selectedArmy = army;
    updateArmyPositions();
    showMessage(`${added} 個單位已加入 ${army.name}`);
}

function setSelectedBuildingRally() {
    const building = state.selectedBuilding;
    if (!building || !["barracks", "workshop", "townCenter"].includes(building.type)) {
        showMessage("先選兵營、工坊或城鎮中心，再按 Y");
        return;
    }
    building.rallyX = input.mouse.worldX;
    building.rallyY = input.mouse.worldY;
    showMessage(`${building.type === "barracks" ? "兵營" : building.type === "workshop" ? "工坊" : "城鎮中心"} 集結點已設定`);
}

function drawHelpPanel() {
    if (!state.helpOpen) return;
    const w = Math.min(760, screenWidth - 80);
    const h = Math.min(560, screenHeight - 100);
    const x = (screenWidth - w) / 2;
    const y = 50;
    drawPanel(x, y, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 23px Arial";
    ctx.fillText("操作說明 / QUICK GUIDE", x + 24, y + 36);
    const lines = [
        "基本：WASD / 方向鍵 移動鏡頭 · 中鍵拖曳 · 滾輪縮放",
        "選取：左鍵單選 · 拖曳框選 · Shift 可加入選取",
        "移動：右鍵任何方向；途中可穿越海、河、山、建築，最終停在陸地",
        "採集：G → 點資源；再用右鍵可以讓村民離開採集",
        "建造：1~9 / 0 選建築；左鍵放置；Esc 取消",
        "生產：選城鎮中心/兵營/工坊 → Q 生產",
        "兵營：V 切換生產兵種；Q 生產目前兵種；Y 設定新兵集結點",
        "戰鬥：選民兵/步兵/偵察/火砲 → 左鍵點敵人攻擊；右鍵仍然是移動",
        "建築：選取建築後直接點右上『升級』按鈕 · Backspace 取消佇列（退回 70%）",
        "其他：, 選閒置村民 · Shift+F 鏡頭聚焦 · [ ] 遊戲速度 0.5~2x",
        "科研：T 科技樹 · P 人口 · M 市場 · H 歷史 · I 資訊總覽 · O 本說明",
        "存檔：Ctrl+S · 讀檔：Ctrl+L · 暫停：Space · Esc 關閉模式",
        "⚠ Ctrl+1~5 編隊快捷鍵已移除，不會再和其他軟體衝突。"
    ];
    ctx.font = "13px Arial";
    for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = i === lines.length - 1 ? "#e0c85c" : "#d4d8dc";
        ctx.fillText(lines[i], x + 24, y + 72 + i * 30);
    }
    ctx.fillStyle = "#888";
    ctx.fillText("O：關閉", x + 24, y + h - 18);
}

function drawCombatOverlay() {
    const army = state.selectedArmy;
    if (army) {
        const members = world.units.filter(u => u.owner === "player" && u.armyId === army.id);
        const active = members.filter(u => u.targetEnemy && u.targetEnemy.health > 0).length;
        if (active > 0) {
            ctx.fillStyle = "rgba(135,35,30,0.88)";
            ctx.fillRect(screenWidth - 260, 245, 235, 32);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 12px Arial";
            ctx.fillText(`⚔ 戰鬥中：${active}/${members.length} 單位交戰`, screenWidth - 248, 266);
        }
    }
}

/* ================================================================
   SMART HOVER / FEEDBACK
================================================================ */

function updateHoverTargets() {
    input.mouse.hoverResource = findResourceAt(input.mouse.worldX, input.mouse.worldY);
    input.mouse.hoverBuilding = findBuildingAt(input.mouse.worldX, input.mouse.worldY);
    input.mouse.hoverUnit = findUnitAt(input.mouse.worldX, input.mouse.worldY);
}

function drawHoverInfo() {
    const resource = input.mouse.hoverResource;
    const building = input.mouse.hoverBuilding;
    const unit = input.mouse.hoverUnit;
    if (!resource && !building && !unit) return;
    if (input.mouse.x < 8 || input.mouse.y < 8 || input.mouse.y > screenHeight - 150) return;

    let lines = [];
    if (resource) {
        const info = resourceDisplayInfo(resource.type);
        const remain = Math.max(0, resource.amount);
        const rate = gatherMultiplier(resource) * GAME.GATHER_AMOUNT / 0.72;
        lines = [
            `${info.icon} ${info.name}`,
            `剩餘：${formatNumber(remain)} / ${formatNumber(resource.maxAmount)}`,
            `單人基礎採集：約 ${rate.toFixed(1)} /s`,
            `附近建築/科技會影響效率`
        ];
    } else if (building) {
        const name = building.type === 'townCenter' ? '城鎮中心' : (BUILDINGS[building.type]?.name || building.type);
        const desc = building.type === 'townCenter' ? '訓練村民、人口核心' : (BUILDINGS[building.type]?.description || '');
        lines = [name, building.complete ? `狀態：完成 · ${desc}` : `建造：${Math.floor((building.buildProgress || 0) * 100)}%`];
        if (building.queue?.length) lines.push(`生產佇列：${building.queue.length} · ${productionRateLabel(building)}`);
    } else if (unit && unit.owner === 'player') {
        lines = [
            `${unit.type === 'villager' ? '村民' : unit.type === 'infantry' ? '步兵' : unit.type === 'militia' ? '民兵' : unit.type === 'scout' ? '偵察兵' : '火砲'}`,
            `狀態：${unitStateName(unit.state)}`,
            `生命：${Math.ceil(unit.health || 100)} / ${unit.maxHealth || 100}`
        ];
    }
    const width = 245;
    const height = 18 + lines.length * 17;
    const x = Math.min(input.mouse.x + 14, screenWidth - width - 8);
    const y = Math.min(input.mouse.y + 14, screenHeight - 150 - height - 8);
    ctx.fillStyle = 'rgba(8,10,12,0.94)';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.strokeRect(x, y, width, height);
    ctx.font = '12px Arial';
    for (let i = 0; i < lines.length; i++) {
        ctx.fillStyle = i === 0 ? '#fff' : '#c7ced1';
        ctx.font = i === 0 ? 'bold 12px Arial' : '11px Arial';
        ctx.fillText(lines[i], x + 9, y + 16 + i * 17);
    }
}

function drawIdleWorkerMarkers() {
    for (const unit of world.units) {
        if (unit.owner !== 'player' || unit.type !== 'villager' || unit.state !== 'idle') continue;
        const p = worldToScreen(unit.x, unit.y - 28);
        if (p.x < 0 || p.x > screenWidth || p.y < 0 || p.y > screenHeight - 150) continue;
        ctx.fillStyle = '#f0c84b';
        ctx.fillRect(Math.floor(p.x - 3), Math.floor(p.y - 8), 6, 3);
        ctx.fillRect(Math.floor(p.x - 1), Math.floor(p.y - 11), 2, 3);
    }
}

function drawUnitHealthBars() {
    for (const unit of world.units) {
        if (unit.owner !== 'player' && !unit.selected) continue;
        if (unit.health >= unit.maxHealth && !unit.selected) continue;
        const p = worldToScreen(unit.x, unit.y - unit.radius - 8);
        if (p.x < -40 || p.x > screenWidth + 40 || p.y < 0 || p.y > screenHeight - 150) continue;
        const w = Math.max(18, unit.radius * camera.zoom * 2.2);
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(p.x - w/2, p.y, w, 4);
        ctx.fillStyle = unit.health / unit.maxHealth > 0.55 ? '#65c96a' : unit.health / unit.maxHealth > 0.25 ? '#d9c44b' : '#d95d56';
        ctx.fillRect(p.x - w/2, p.y, w * clamp(unit.health / unit.maxHealth, 0, 1), 4);
    }
}

function drawEconomyWarnings() {
    const foodDays = player.foodStockpileDays || 0;
    if (foodDays < 1.5 && player.population > 0) {
        ctx.fillStyle = 'rgba(120,35,25,0.88)';
        ctx.fillRect(15, 115, 255, 28);
        ctx.fillStyle = '#fff1e8';
        ctx.font = 'bold 12px Arial';
        ctx.fillText(`⚠ 食物庫存僅約 ${foodDays.toFixed(1)} 天`, 26, 134);
    }
}

/* ================================================================
   MOUSE
================================================================ */

canvas.addEventListener("mousemove", event => {
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = event.clientX - rect.left;
    input.mouse.y = event.clientY - rect.top;

    if (camera.dragging) {
        const dx = event.clientX - camera.lastMouseX;
        const dy = event.clientY - camera.lastMouseY;
        camera.x -= dx / camera.zoom;
        camera.y -= dy / camera.zoom;
        camera.lastMouseX = event.clientX;
        camera.lastMouseY = event.clientY;
    }
    updateMouseWorld();
    updateHoverTargets();
});

canvas.addEventListener("mousedown", event => {
    event.preventDefault();
    if (event.button === 0) {
        input.mouse.leftDown = true;
        input.mouse.dragStartX = input.mouse.x;
        input.mouse.dragStartY = input.mouse.y;
    }
    if (event.button === 1) {
        camera.dragging = true;
        camera.lastMouseX = event.clientX;
        camera.lastMouseY = event.clientY;
    }
});

canvas.addEventListener("mouseup", event => {
    event.preventDefault();
    if (event.button === 0) {
        input.mouse.leftDown = false;
        handleLeftRelease();
    }
    if (event.button === 1) camera.dragging = false;
    if (event.button === 2) handleRightClick();
});

canvas.addEventListener("wheel", event => {
    event.preventDefault();
    if (state.techOpen || state.populationOpen || state.marketOpen || state.historyOpen) return;
    const before = screenToWorld(input.mouse.x, input.mouse.y);
    camera.zoom *= event.deltaY < 0 ? 1.1 : 1 / 1.1;
    camera.zoom = clamp(camera.zoom, GAME.MIN_ZOOM, GAME.MAX_ZOOM);
    const after = screenToWorld(input.mouse.x, input.mouse.y);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
}, { passive: false });



function bottomBuildMenuClick(x, y) {
    const panelY = screenHeight - 174;
    if (y < panelY + 8 || y > panelY + 166) return false;
    if (x >= 16 && x <= 126 && y >= panelY + 18 && y <= panelY + 88) {
        enterGatherMode();
        return true;
    }
    const keys = Object.keys(BUILDINGS);
    const width = 118;
    const startX = 136;
    const cols = Math.max(1, Math.floor((screenWidth - startX - 20) / (width + 7)));
    const visible = Math.min(keys.length, cols * 2);
    for (let i=0;i<visible;i++) {
        const col=i%cols, row=Math.floor(i/cols);
        const bx=startX+col*(width+7), by=panelY+10+row*76;
        if (x>=bx && x<=bx+width && y>=by && y<=by+68) {
            startBuilding(keys[i]);
            return true;
        }
    }
    return false;
}

function buildingInfoUpgradeButtonRect(building) {
    const width = 350;
    const panelX = screenWidth - width - 15;
    let yy = 112;

    if (!building.complete) yy += 31;

    if (building.upgradeProgress > 0 && building.upgradeProgress < 1) yy += 31;

    if (building.type === "townCenter") {
        yy += 22;
    } else if (building.type === "barracks") {
        yy += 22;
        yy += 22;
        if (building.queue && building.queue.length) yy += 29;
        yy += 40;
    } else if (building.type === "workshop" || building.type === "factory") {
        yy += 22;
        if (building.queue && building.queue.length) yy += 29;
        yy += 0;
    } else {
        yy += 22;
    }

    yy += 24; // 生產佇列文字

    return { x: panelX + 12, y: yy, width: 150, height: 30 };
}

function buildingActionClick(x, y) {
    const b = state.selectedBuilding;
    if (!b || !b.complete) return false;
    const width = 350;
    const panelX = screenWidth - width - 15;

    if (b.type === "barracks") {
        // 與 drawBuildingInfo 的實際按鈕位置一致
        let yy = 112;
        if (b.upgradeProgress > 0 && b.upgradeProgress < 1) yy += 31;
        yy += 22 + 22;
        if (b.queue && b.queue.length) yy += 29;
        if (x >= panelX + 12 && x <= panelX + 162 && y >= yy && y <= yy + 28) {
            cycleBarracksProduction(b);
            return true;
        }
    }

    if (canUpgradeBuilding(b)) {
        const r = buildingInfoUpgradeButtonRect(b);
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) {
            upgradeSelectedBuilding();
            return true;
        }
    }
    return false;
}

function handleLeftRelease() {
    if (state.nationOpen && nationPanelClick(input.mouse.x, input.mouse.y)) return;
    if (input.mouse.x >= 15 && input.mouse.x <= 101 && input.mouse.y >= 120 && input.mouse.y <= 144) {
        state.nationOpen = !state.nationOpen;
        return;
    }
    if (state.techOpen) {
        handleTechClick(input.mouse.x, input.mouse.y);
        return;
    }

    if (state.populationOpen) return;
    if (state.marketOpen) {
        handleMarketClick(input.mouse.x, input.mouse.y, false);
        return;
    }
    if (state.historyOpen) return;


    if (buildingActionClick(input.mouse.x, input.mouse.y)) return;

    if (bottomBuildMenuClick(input.mouse.x, input.mouse.y)) return;

    if (state.buildingType) {
        placeBuilding();
        return;
    }

    if (state.mode === "gather") {
        const resource = findResourceAt(input.mouse.worldX, input.mouse.worldY);
        if (resource) commandGather(selectedVillagers(), resource);
        else showMessage("這裡沒有資源");
        state.mode = "normal";
        return;
    }

    const enemy = findEnemyUnitAt(input.mouse.worldX, input.mouse.worldY);
    if (enemy && selectedSoldiers().length) {
        commandAttack(selectedSoldiers(), enemy);
        return;
    }

    const drag = distance(input.mouse.dragStartX, input.mouse.dragStartY, input.mouse.x, input.mouse.y);
    if (drag > 8) {
        const start = screenToWorld(input.mouse.dragStartX, input.mouse.dragStartY);
        const end = screenToWorld(input.mouse.x, input.mouse.y);
        selectRectangle(start.x, start.y, end.x, end.y);
        return;
    }

    const settlement = findSettlementAt(input.mouse.worldX, input.mouse.worldY);
    if (settlement) {
        clearSelection();
        settlement.selected = true;
        state.selectedSettlement = settlement;
        return;
    }

    const building = findBuildingAt(input.mouse.worldX, input.mouse.worldY);
    if (building) {
        clearSelection();
        building.selected = true;
        state.selectedBuilding = building;
        return;
    }

    const unit = findUnitAt(input.mouse.worldX, input.mouse.worldY);
    if (unit) {
        if (!input.keys["shift"]) clearSelection();
        unit.selected = true;
        return;
    }

    clearSelection();
}

function handleRightClick() {
    state.mode = "normal";
    if (state.buildingType) {
        state.buildingType = null;
        return;
    }

    const selected = selectedUnits();
    if (!selected.length) return;
    commandMove(selected, input.mouse.worldX, input.mouse.worldY);
    registerCommandFeedback(input.mouse.worldX, input.mouse.worldY, "移動命令");
}

function handleMarketClick(x, y, rightClick) {
    const p = marketPanelRect();
    const list = ["food", "wood", "stone", "iron", "gold"];
    for (let i = 0; i < list.length; i++) {
        const yy = p.y + 68 + i * 30;
        if (y >= yy && y <= yy + 26 && x >= p.x + 10 && x <= p.x + p.width - 10) {
            if (rightClick) sellResource(list[i], 100);
            else buyResource(list[i], 100);
            return;
        }
    }
}

canvas.addEventListener("contextmenu", event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    input.mouse.x = event.clientX - rect.left;
    input.mouse.y = event.clientY - rect.top;
    updateMouseWorld();
    updateHoverTargets();
    if (state.marketOpen) {
        handleMarketClick(input.mouse.x, input.mouse.y, true);
        return;
    }
    handleRightClick();
});

/* ================================================================
   CAMERA
================================================================ */

function updateCamera(dt) {
    let x = 0;
    let y = 0;
    if (input.keys["w"] || input.keys["arrowup"]) y--;
    if (input.keys["s"] || input.keys["arrowdown"]) y++;
    if (input.keys["a"] || input.keys["arrowleft"]) x--;
    if (input.keys["d"] || input.keys["arrowright"]) x++;

    // 鏡頭不再因滑鼠碰到畫面邊緣自動移動；只用 WASD／方向鍵或中鍵拖曳。

    if (x !== 0 || y !== 0) {
        const len = Math.sqrt(x * x + y * y);
        x /= len;
        y /= len;
        camera.x += x * GAME.CAMERA_SPEED * dt / camera.zoom;
        camera.y += y * GAME.CAMERA_SPEED * dt / camera.zoom;
    }
}


/* ================================================================
   V0.9.10 — SAFE QUALITY / INFORMATION SYSTEMS

   這一版不改核心移動規則，不擴充科技樹。
   新增：
   1. 文明時代名稱
   2. 資源庫存預估
   3. 生產效率摘要
   4. 閒置勞動力警報
   5. 單位熟練度 / 等級
   6. 軍團戰備度
   7. 聚落繁榮度
   8. 右鍵目的地標記
   9. 指揮回饋文字
   10. 資源枯竭提示
   11. 天氣倒數資訊
   12. 資訊總覽模式（I）
   13. 選取單位平均移速/生命摘要
   14. 建築工作狀態摘要
   15. 成就式文明里程碑
================================================================ */

if (!world.runtimeStats) {
    world.runtimeStats = {
        lastSample: 0,
        resourceHistory: [],
        destinationPing: null,
        milestoneFlags: {},
        depletionNotified: new Set(),
        infoOpen: false,
        lastIdleWarning: 0,
        commandFeedback: 0
    };
}

function civilizationEraName() {
    const year = Math.floor(state.time / GAME.YEAR_LENGTH) + 1;
    if (year < 5) return "拓荒時代";
    if (year < 15) return "早期聚落";
    if (year < 30) return "城鎮時代";
    if (year < 60) return "成熟文明";
    return "繁榮時代";
}

function selectedUnitSummary() {
    const list = selectedUnits();
    if (!list.length) return null;
    const hp = list.reduce((sum, u) => sum + (u.health || 100), 0) / list.length;
    const speed = list.reduce((sum, u) => sum + (u.speed || 0), 0) / list.length;
    const levels = list.map(u => unitLevel(u));
    const avgLevel = levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length);
    return { count: list.length, avgHp: hp, avgSpeed: speed, avgLevel };
}

function unitLevel(unit) {
    return clamp(1 + Math.floor((unit.experience || 0) / 240), 1, 5);
}

function updateUnitVeterancy(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const unit of world.units) {
        if (unit.owner !== "player") continue;
        const moving = ["moving", "movingToResource", "movingToBuilding"].includes(unit.state);
        const working = ["gathering", "building"].includes(unit.state);
        if (moving || working) unit.experience = Math.min(1200, (unit.experience || 0) + dt * (moving ? 0.7 : 0.35));
        unit.level = unitLevel(unit);
    }
}

function armyReadiness(army) {
    const members = world.units.filter(u => u.owner === "player" && u.armyId === army.id);
    if (!members.length) return 0;
    const health = members.reduce((s,u) => s + clamp((u.health || 100) / Math.max(1,u.maxHealth||100),0,1),0) / members.length;
    const exp = members.reduce((s,u) => s + (u.experience || 0),0) / members.length;
    const veteran = clamp(exp / 900, 0, 1);
    return clamp((health * 0.55 + (army.supply/100) * 0.25 + (army.morale/100) * 0.20 + veteran * 0.15) * 100, 0, 100);
}

function settlementProsperity(settlement) {
    const pop = Number(settlement.population || 0);
    const roads = world.roads.filter(r => distance(r.x1 || r.x || 0, r.y1 || r.y || 0, settlement.x, settlement.y) < 700).length;
    const nearbyBuildings = world.buildings.filter(b => distance(b.x,b.y,settlement.x,settlement.y) < 700).length;
    return clamp(35 + pop * 0.25 + roads * 2 + nearbyBuildings * 1.5 + player.stability * 0.15, 0, 100);
}

function updateResourceDepletionAlerts() {
    for (const chunk of visibleChunks()) {
        for (const resource of chunk.resources) {
            if (!resource || resource.amount <= 0) continue;
            const ratio = resource.amount / Math.max(1, resource.maxAmount || 1);
            if (ratio < 0.10 && !world.runtimeStats.depletionNotified.has(resource.id)) {
                world.runtimeStats.depletionNotified.add(resource.id);
                const info = resourceDisplayInfo(resource.type);
                createFloatingText(`${info.name}即將耗盡`, resource.x, resource.y - 55);
            }
        }
    }
}

function updateMilestones() {
    const pop = player.population;
    const marks = [20, 50, 100, 250, 500, 1000];
    for (const mark of marks) {
        const key = `pop-${mark}`;
        if (pop >= mark && !world.runtimeStats.milestoneFlags[key]) {
            world.runtimeStats.milestoneFlags[key] = true;
            recordHistory(`人口突破 ${mark}`);
            showMessage(`文明里程碑：人口突破 ${mark}！`, 3.5);
        }
    }
}

function updateDestinationPing() {
    const ping = world.runtimeStats.destinationPing;
    if (!ping) return;
    ping.life -= 1/60;
    if (ping.life <= 0) world.runtimeStats.destinationPing = null;
}

function drawDestinationPing() {
    const ping = world.runtimeStats.destinationPing;
    if (!ping) return;
    const p = worldToScreen(ping.x, ping.y);
    if (p.x < -80 || p.x > screenWidth + 80 || p.y < -80 || p.y > screenHeight + 80) return;
    const pulse = 1 + Math.sin(state.time * 8) * 0.12;
    ctx.strokeStyle = `rgba(255,245,120,${clamp(ping.life * 1.8,0,1)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10 * camera.zoom * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - 14 * camera.zoom, p.y);
    ctx.lineTo(p.x + 14 * camera.zoom, p.y);
    ctx.moveTo(p.x, p.y - 14 * camera.zoom);
    ctx.lineTo(p.x, p.y + 14 * camera.zoom);
    ctx.stroke();
}

function drawInfoMode() {
    if (!world.runtimeStats.infoOpen) return;
    const x = 15;
    const y = 150;
    const w = Math.min(360, screenWidth - 30);
    const h = 250;
    ctx.fillStyle = "rgba(7,9,11,0.94)";
    ctx.fillRect(x,y,w,h);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.strokeRect(x,y,w,h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px Arial";
    ctx.fillText("世界資訊 / INFO", x+14, y+24);
    ctx.font = "12px Arial";
    ctx.fillStyle = "#c8ced2";
    const lines = [];
    lines.push(`文明時代：${civilizationEraName()}`);
    lines.push(`第 ${Math.floor(state.time / GAME.YEAR_LENGTH)+1} 年 · ${seasonName()} · ${weatherName()} · ${state.temperature.toFixed(1)}°C`);
    const selected = selectedUnitSummary();
    if (selected) {
        lines.push(`選取：${selected.count} · 平均生命 ${selected.avgHp.toFixed(0)}% · 等級 ${selected.avgLevel.toFixed(1)}`);
        lines.push(`平均移速：${selected.avgSpeed.toFixed(0)} · 目的地：已設定`);
    } else {
        lines.push(`人口：${player.population}/${player.populationCap} · 穩定 ${player.stability.toFixed(0)}%`);
    }
    const idle = world.units.filter(u => u.owner === "player" && u.type === "villager" && u.state === "idle").length;
    lines.push(`閒置村民：${idle}`);
    const farms = world.buildings.filter(b => b.type === "farm" && b.complete).length;
    const industrial = world.buildings.filter(b => ["workshop","factory"].includes(b.type) && b.complete).length;
    lines.push(`農場：${farms} · 工業建築：${industrial}`);
    lines.push(`軍團：${world.armies.length} · 聚落：${world.settlements.length}`);
    const rates = ["food","wood","stone","iron","gold"].map(k => `${resourceDisplayInfo(k).short}${resourceRateText(player.resourceRates[k]||0)}`).join("  ");
    lines.push(`資源流量：${rates}`);
    lines.push(`自動存檔：每 ${GAME.AUTO_SAVE_SECONDS} 秒`);
    lines.push(`I：關閉資訊面板`);
    for (let i=0;i<lines.length;i++) ctx.fillText(lines[i], x+14, y+50+i*20);
}

function drawArmyReadinessBadges() {
    for (const army of world.armies) {
        if (!army.selected) continue;
        const p = worldToScreen(army.x, army.y - 55);
        if (p.x < -100 || p.x > screenWidth + 100 || p.y < 0 || p.y > screenHeight - 150) continue;
        ctx.fillStyle = "rgba(8,8,8,0.9)";
        ctx.fillRect(p.x - 55, p.y - 10, 110, 18);
        ctx.fillStyle = "#dce7ef";
        ctx.font = "10px Arial";
        ctx.textAlign = "center";
        ctx.fillText(`戰備 ${armyReadiness(army).toFixed(0)}%`, p.x, p.y + 3);
        ctx.textAlign = "left";
    }
}

function drawResourceLabels() {
    if (camera.zoom < 0.75) return;
    const resources = getNearbyResources();
    for (const resource of resources) {
        if (resource.amount <= 0) continue;
        const p = worldToScreen(resource.x, resource.y - resource.radius - 18);
        if (p.x < -100 || p.x > screenWidth+100 || p.y < -50 || p.y > screenHeight-150) continue;
        const info = resourceDisplayInfo(resource.type);
        const txt = `${info.icon} ${info.name} ${formatNumber(resource.amount)}`;
        ctx.font = "10px Arial";
        const width = ctx.measureText(txt).width + 10;
        ctx.fillStyle = "rgba(6,8,9,0.78)";
        ctx.fillRect(p.x-width/2,p.y-10,width,16);
        ctx.fillStyle = "#eef2f2";
        ctx.textAlign = "center";
        ctx.fillText(txt,p.x,p.y+2);
        ctx.textAlign = "left";
    }
}

function registerCommandFeedback(x,y,text="移動命令") {
    world.runtimeStats.destinationPing = {x,y,life:1.15};
    createFloatingText(text,x,y-24);
}

/* ================================================================
   UPDATE LOOP
================================================================ */

function update(dt) {
    const beforeResources = {
        food: player.resources.food,
        wood: player.resources.wood,
        stone: player.resources.stone,
        gold: player.resources.gold,
        iron: player.resources.iron
    };

    if (state.paused) return;

    state.time += dt;
    state.notificationTimer = Math.max(0, state.notificationTimer - dt);
    state.battleFlash = Math.max(0, state.battleFlash - dt);
    state.autosaveTimer += dt;

    updateCamera(dt);
    updateClimate(dt);
    updateNaturalResources(dt);
    updatePopulation(dt);
    updateUnits(dt);
    updateProduction(dt);
    updateBuildingUpgrades(dt);
    updateResearch(dt);
    updateFarms(dt);
    updateIndustry(dt);
    updateRoads(dt);
    updateSettlements(dt);
    updateFactions(dt);
    updateMarket(dt);
    updateDisasters(dt);
    updateEffects(dt);
    updateExploration();
    updateUnlockedTechs();
    updateUnitVeterancy(dt);
    updateResourceDepletionAlerts();
    updateMilestones();
    updateDestinationPing();
    recalculatePopulation();

    if (state.autosaveTimer >= GAME.AUTO_SAVE_SECONDS) {
        state.autosaveTimer = 0;
        try {
            localStorage.setItem(`${SAVE_KEY}_autosave`, JSON.stringify({ time: state.time, worldSeed }));
        } catch (_) {}
    }

    visibleChunks();
    updateResourceRates(dt, beforeResources);
}

/* ================================================================
   RENDER
================================================================ */

function render() {
    ctx.clearRect(0, 0, screenWidth, screenHeight);

    drawTerrain();
    drawTerrainDecorations();
    drawRoads();
    drawSettlements();
    drawFactionLabels();
    drawResources();
    drawRuins();
    drawWildlife();
    drawBuildings();
    drawBuildingHealthBars();
    drawResourceLabels();
    drawMoveMarkers();
    drawUnits();
    drawUnitHealthBars();
    drawUnitStatusLabels();
    drawDestinationPing();
    drawIdleWorkerMarkers();
    drawClimateOverlay();
    drawTerritoryOverlay();
    drawFog();

    drawTopUI();
    drawNationPanel();
    drawBottomUI();
    drawSelectionInfo();
    drawSelectedBuildingProgress();
    if (state.selectedSettlement) drawSettlementInfo(state.selectedSettlement);
    drawMinimap();
    drawEconomyWarnings();
    drawProductionOverview();
    drawGameSpeed();
    drawMessage();
    drawHoverInfo();

    drawPopulationPanel();
    drawMarketPanel();
    drawHistoryPanel();
    drawBuildingPreview();
    drawSelectionBox();
    drawInfoMode();
    drawHelpPanel();
    drawCombatOverlay();

    if (state.techOpen) drawTechTree();

    if (state.battleFlash > 0) {
        ctx.fillStyle = `rgba(255,70,45,${state.battleFlash})`;
        ctx.fillRect(0, 0, screenWidth, screenHeight);
    }
}

/* ================================================================
   INITIALIZE
================================================================ */

function initializeGame() {
    createTownCenter();
    createStartingUnits();
    for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) getChunk(x, y);
    seedNeutralSettlements();
    seedFactions();
    ensureEnemyForces();
    updateUnlockedTechs();
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1;
    recalculatePopulation();
    updateExploration();
    player.nation.foundedYear = 1;
    recordHistory("文明建立，開始新的時代");
}


/* ================================================================
   V0.9.18 — CIVILIZATION ERA + NATION DEVELOPMENT EXPANSION

   本次新增：
   ・時代進化：人口、聚落、資源、科研突破等條件共同決定
   ・歷史突破紀錄
   ・國家政策、稅率、文化方向、國家地圖色
   ・人口遷移的輕量模擬（不直接搬動遊戲單位）
   ・領土影響圈（可由國家面板開關）
   ・時代面板與進化按鈕
   ・不改動現有自由移動、自動索敵、科研樹核心
================================================================ */

GAME.VERSION = "0.9.18";

if (!player.civilization) {
    player.civilization = {
        eraIndex: 0,
        breakthroughs: [],
        migration: 0,
        urbanization: 0,
        populationPeak: 0,
        chosenCulture: player.nation?.culture || "本土傳統",
        policy: "均衡發展",
        taxRate: 0.08,
        mapColor: "#5878a6"
    };
}

if (!state.eraOpen) state.eraOpen = false;
if (!state.territoryOverlay) state.territoryOverlay = false;
if (!state.eraNotice) state.eraNotice = 0;

const CIVILIZATION_ERAS = [
    {
        name: "原始／部落時代",
        short: "部落時代",
        color: "#75634a",
        description: "以狩獵、採集與最早的定居生活為核心。",
        requirements: []
    },
    {
        name: "農業定居時代",
        short: "農業時代",
        color: "#708d52",
        description: "穩定農業與永久聚落開始支撐人口成長。",
        requirements: [
            { label: "人口至少 20", check: () => player.population >= 20 },
            { label: "至少 1 座農田", check: () => countCompleteBuildings("farm") >= 1 },
            { label: "完成農業科研", check: () => hasTech("agriculture") }
        ]
    },
    {
        name: "成熟農業／早期金屬時代",
        short: "早期金屬時代",
        color: "#98784c",
        description: "村落開始形成真正的生產分工與金屬加工。",
        requirements: [
            { label: "人口至少 60", check: () => player.population >= 60 },
            { label: "至少 2 個聚落／城鎮", check: () => world.settlements.filter(s => s.owner === "player").length >= 2 },
            { label: "完成冶金科研", check: () => hasTech("metallurgy") },
            { label: "建立工坊", check: () => countCompleteBuildings("workshop") >= 1 }
        ]
    },
    {
        name: "青銅時代",
        short: "青銅時代",
        color: "#a87f49",
        description: "青銅器、城市與更專業的行政開始出現。",
        requirements: [
            { label: "人口至少 100", check: () => player.population >= 100 },
            { label: "至少 1 座城鎮", check: () => world.settlements.some(s => s.owner === "player" && s.level >= 2) },
            { label: "累積 80 單位鐵／金屬資源", check: () => (player.resources.iron || 0) >= 80 },
            { label: "完成軍事訓練", check: () => hasTech("militaryTraining") }
        ]
    },
    {
        name: "鐵器時代",
        short: "鐵器時代",
        color: "#66727c",
        description: "鐵器成為農業、工具與軍事的核心材料。",
        requirements: [
            { label: "人口至少 180", check: () => player.population >= 180 },
            { label: "鐵資源至少 150", check: () => (player.resources.iron || 0) >= 150 },
            { label: "完成採礦科研", check: () => hasTech("mining") },
            { label: "完成冶金科研", check: () => hasTech("metallurgy") },
            { label: "建立工坊", check: () => countCompleteBuildings("workshop") >= 1 }
        ]
    },
    {
        name: "古典時代",
        short: "古典時代",
        color: "#748c98",
        implemented: false,
        description: "大型城市、道路與制度化行政全面發展。",
        requirements: [
            { label: "人口至少 500", check: () => player.population >= 500 },
            { label: "至少 2 座城市", check: () => world.settlements.filter(s => s.owner === "player" && s.level >= 3).length >= 2 },
            { label: "完成『文字』突破（下一階段科研內容）", check: () => player.civilization.breakthroughs.includes("文字") }
        ]
    },
    {
        name: "中世紀",
        short: "中世紀",
        color: "#725e59",
        implemented: false,
        description: "王國、城堡、行會與大型商路逐漸成熟。",
        requirements: [
            { label: "人口至少 1500", check: () => player.population >= 1500 },
            { label: "至少 1 座大城市", check: () => world.settlements.some(s => s.owner === "player" && s.level >= 4) },
            { label: "完成『行政制度』突破", check: () => player.civilization.breakthroughs.includes("行政制度") }
        ]
    },
    {
        name: "火藥時代",
        short: "火藥時代",
        color: "#6c6671",
        implemented: false,
        description: "火藥、遠程武器與中央集權國家成為主流。",
        requirements: [
            { label: "人口至少 5000", check: () => player.population >= 5000 },
            { label: "完成『火藥』突破", check: () => player.civilization.breakthroughs.includes("火藥") }
        ]
    },
    {
        name: "工業時代",
        short: "工業時代",
        color: "#555f68",
        implemented: false,
        description: "機械化生產、工廠與現代國家體制出現。",
        requirements: [
            { label: "人口至少 20000", check: () => player.population >= 20000 },
            { label: "完成『蒸汽機』突破", check: () => player.civilization.breakthroughs.includes("蒸汽機") }
        ]
    },
    {
        name: "現代時代",
        short: "現代",
        color: "#536f84",
        implemented: false,
        description: "現代工業、交通、教育與大規模行政體系。",
        requirements: [
            { label: "人口至少 100000", check: () => player.population >= 100000 },
            { label: "完成『現代國家』突破", check: () => player.civilization.breakthroughs.includes("現代國家") }
        ]
    },
    {
        name: "未來時代",
        short: "未來",
        color: "#506b8f",
        implemented: false,
        description: "尚未開放：留給未來的完整科技時代更新。",
        requirements: [
            { label: "完成『未來科技』突破", check: () => player.civilization.breakthroughs.includes("未來科技") }
        ]
    }
];

const NATION_POLICIES = [
    { name: "均衡發展", desc: "沒有明顯偏向。", treasury: 0, stability: 0, food: 0, research: 0 },
    { name: "農業優先", desc: "食物產出與人口成長較快。", treasury: -0.15, stability: 1.5, food: 0.12, research: -0.02 },
    { name: "貿易自由", desc: "國庫收入較高，穩定略受市場波動影響。", treasury: 0.45, stability: -0.5, food: 0.02, research: 0.02 },
    { name: "軍事優先", desc: "軍事傳統成長較快，但內政成本增加。", treasury: -0.2, stability: 0.2, food: -0.02, research: -0.02 },
    { name: "學術優先", desc: "研究更快，但國庫收入略低。", treasury: -0.2, stability: 0.1, food: 0, research: 0.08 }
];

const CULTURE_PATHS = [
    { name: "本土傳統", food: 0, wood: 0, stone: 0, gold: 0 },
    { name: "河谷農耕", food: 0.10, wood: 0, stone: 0, gold: 0 },
    { name: "森林傳統", food: 0, wood: 0.10, stone: 0, gold: 0 },
    { name: "山地工藝", food: 0, wood: 0, stone: 0.10, gold: 0 },
    { name: "商貿文化", food: 0, wood: 0, stone: 0, gold: 0.10 }
];

const MAP_COLORS = ["#5878a6", "#688c62", "#9a6b58", "#917b4d", "#765e8e", "#4d7f7d"];

function countCompleteBuildings(type) {
    return world.buildings.filter(b => b.type === type && b.complete).length;
}

function civilizationEra() {
    return CIVILIZATION_ERAS[clamp(player.civilization?.eraIndex || 0, 0, CIVILIZATION_ERAS.length - 1)];
}

function civilizationEraName() {
    return civilizationEra().short;
}

function eraRequirementStatus(index) {
    const era = CIVILIZATION_ERAS[index];
    return era.requirements.map(r => ({ ...r, ok: !!r.check() }));
}

function canAdvanceCivilizationEra() {
    const index = (player.civilization?.eraIndex || 0) + 1;
    if (index >= CIVILIZATION_ERAS.length) return false;
    const era = CIVILIZATION_ERAS[index];
    if (era.implemented === false) return false;
    return era.requirements.every(r => r.check());
}

function advanceCivilizationEra() {
    const current = player.civilization.eraIndex || 0;
    const next = current + 1;
    if (next >= CIVILIZATION_ERAS.length) return;
    const era = CIVILIZATION_ERAS[next];
    if (era.implemented === false) {
        showMessage("這個時代的完整內容尚未加入；先把目前時代發展完整。 ");
        return;
    }
    const failed = eraRequirementStatus(next).filter(r => !r.ok);
    if (failed.length) {
        showMessage(`尚缺：${failed[0].label}`);
        return;
    }
    player.civilization.eraIndex = next;
    player.nation.legitimacy = clamp((player.nation.legitimacy || 0) + 6, 0, 100);
    player.stability = clamp((player.stability || 0) + 5, 0, 100);
    recordHistory(`文明進入${era.name}`);
    showMessage(`文明進化：${era.name}`);
    state.eraNotice = 4;
}

function cycleNationPolicy() {
    const current = player.civilization.policy || "均衡發展";
    const idx = NATION_POLICIES.findIndex(p => p.name === current);
    const next = NATION_POLICIES[(idx + 1) % NATION_POLICIES.length];
    player.civilization.policy = next.name;
    recordHistory(`國家政策改為「${next.name}」`);
    showMessage(`國家政策：${next.name}`);
}

function cycleNationCulture() {
    const current = player.civilization.chosenCulture || "本土傳統";
    const idx = CULTURE_PATHS.findIndex(p => p.name === current);
    const next = CULTURE_PATHS[(idx + 1) % CULTURE_PATHS.length];
    player.civilization.chosenCulture = next.name;
    player.nation.culture = next.name;
    recordHistory(`文化方向改為「${next.name}」`);
    showMessage(`文化方向：${next.name}`);
}

function cycleNationMapColor() {
    const idx = Math.max(0, MAP_COLORS.indexOf(player.civilization.mapColor));
    player.civilization.mapColor = MAP_COLORS[(idx + 1) % MAP_COLORS.length];
    showMessage("國家地圖色已更換");
}

function updateNationDevelopment(dt) {
    if (!player.civilization) return;
    player.civilization.populationPeak = Math.max(player.civilization.populationPeak || 0, player.population || 0);

    const urban = world.settlements.filter(s => s.owner === "player").reduce((sum, s) => sum + (s.population || 0), 0);
    const targetUrban = player.population > 0 ? clamp((urban / player.population) * 100, 0, 100) : 0;
    player.civilization.urbanization = lerp(player.civilization.urbanization || 0, targetUrban, clamp(dt * 0.06, 0, 1));

    const foodPressure = player.foodStockpileDays < 3 ? -0.5 : player.foodStockpileDays > 12 ? 0.1 : 0;
    player.civilization.migration = clamp((player.civilization.migration || 0) + (targetUrban - 35) * dt * 0.002 + foodPressure * dt * 0.05, -100, 100);

    const policy = NATION_POLICIES.find(p => p.name === player.civilization.policy) || NATION_POLICIES[0];
    const tax = clamp(player.civilization.taxRate || 0.08, 0, 0.3);
    player.treasury = Math.max(0, player.treasury + ((player.population || 0) * tax * 0.01 + policy.treasury * 0.35) * dt);
    player.stability = clamp((player.stability || 0) + (0.55 - tax * 2.2 + policy.stability * 0.03) * dt, 0, 100);

    if (state.eraNotice > 0) state.eraNotice -= dt;
}

function cycleTaxRate() {
    const rates = [0.03, 0.08, 0.12, 0.18, 0.25];
    const current = player.civilization.taxRate ?? 0.08;
    let idx = rates.findIndex(v => Math.abs(v - current) < 0.001);
    idx = (idx + 1) % rates.length;
    player.civilization.taxRate = rates[idx];
    showMessage(`稅率：${Math.round(rates[idx] * 100)}%`);
}

function recordBreakthroughOnce(name, text) {
    if (!player.civilization.breakthroughs.includes(name)) {
        player.civilization.breakthroughs.push(name);
        recordHistory(`文明突破：${text || name}`);
    }
}

function updateCivilizationBreakthroughs() {
    if (hasTech("agriculture")) recordBreakthroughOnce("農業革命", "農業革命");
    if (hasTech("metallurgy")) recordBreakthroughOnce("冶金", "冶金突破");
    if (hasTech("infantryEquipment")) recordBreakthroughOnce("專業軍備", "專業軍備");
    if (hasTech("workshop")) recordBreakthroughOnce("工程學", "工程學");
    if ((player.resources.iron || 0) >= 200) recordBreakthroughOnce("鐵器普及", "鐵器開始普及");
}

function drawTerritoryOverlay() {
    if (!state.territoryOverlay) return;
    const color = player.civilization?.mapColor || "#5878a6";
    ctx.save();
    ctx.globalAlpha = 0.12;
    for (const b of world.buildings) {
        if (!b.complete) continue;
        const p = worldToScreen(b.x, b.y);
        const radius = Math.max(40, (b.type === "townCenter" ? 520 : 300) * camera.zoom);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
    }
    for (const s of world.settlements) {
        if (s.owner !== "player") continue;
        const p = worldToScreen(s.x, s.y);
        const radius = Math.max(50, s.radius * 1.5 * camera.zoom);
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
}

function drawEraPanel() {
    if (!state.eraOpen) return;
    const w = Math.min(560, screenWidth - 40);
    const h = Math.min(560, screenHeight - 190);
    const x = 20;
    const y = 150;
    drawPanel(x, y, w, h);
    const current = civilizationEra();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Arial";
    ctx.fillText("文明時代 / ERA", x + 18, y + 32);
    ctx.fillStyle = current.color;
    ctx.font = "bold 18px Arial";
    ctx.fillText(current.name, x + 18, y + 62);
    ctx.fillStyle = "#bac1c4";
    ctx.font = "12px Arial";
    ctx.fillText(current.description, x + 18, y + 83);

    const nextIndex = (player.civilization.eraIndex || 0) + 1;
    if (nextIndex < CIVILIZATION_ERAS.length) {
        const next = CIVILIZATION_ERAS[nextIndex];
        ctx.fillStyle = "#e6d35a";
        ctx.font = "bold 14px Arial";
        ctx.fillText(`下一階段：${next.name}`, x + 18, y + 114);
        const status = eraRequirementStatus(nextIndex);
        let yy = y + 140;
        ctx.font = "12px Arial";
        for (const r of status) {
            ctx.fillStyle = r.ok ? "#75d37a" : "#e07d72";
            ctx.fillText(`${r.ok ? "✓" : "×"} ${r.label}`, x + 24, yy);
            yy += 24;
        }
        ctx.fillStyle = canAdvanceCivilizationEra() ? "#4f7248" : "#292d30";
        ctx.fillRect(x + 18, y + h - 66, 230, 34);
        ctx.strokeStyle = canAdvanceCivilizationEra() ? "#8fd987" : "#555b5f";
        ctx.strokeRect(x + 18, y + h - 66, 230, 34);
        ctx.fillStyle = canAdvanceCivilizationEra() ? "#fff" : "#8d9396";
        ctx.font = "bold 13px Arial";
        ctx.fillText(next.implemented === false ? "此時代尚未開放" : "進入下一時代", x + 82, y + h - 44);
    }

    ctx.fillStyle = "#cfd5d7";
    ctx.font = "12px Arial";
    ctx.fillText(`人口峰值：${formatNumber(player.civilization.populationPeak || 0)}`, x + 300, y + 55);
    ctx.fillText(`都市化：${(player.civilization.urbanization || 0).toFixed(1)}%`, x + 300, y + 77);
    ctx.fillText(`遷移指數：${(player.civilization.migration || 0).toFixed(1)}`, x + 300, y + 99);
    ctx.fillText(`文化：${player.civilization.chosenCulture || player.nation.culture}`, x + 300, y + 121);
    ctx.fillText(`突破：${player.civilization.breakthroughs.length}`, x + 300, y + 143);
    ctx.fillStyle = "#8f999d";
    ctx.fillText("時代會依人口、聚落、資源與科研突破逐步解鎖。", x + 18, y + h - 18);
}

function drawNationPolicyStrip() {
    if (!state.nationOpen) return;
    const p = nationPanelRect();
    const policy = NATION_POLICIES.find(v => v.name === player.civilization.policy) || NATION_POLICIES[0];
    const y = p.y + 244;
    ctx.fillStyle = "#cdd4d7"; ctx.font = "12px Arial";
    ctx.fillText(`政策：${policy.name}`, p.x + 20, y);
    ctx.fillText(`稅率：${Math.round((player.civilization.taxRate || 0) * 100)}%`, p.x + 220, y);
    ctx.fillText(`文化：${player.civilization.chosenCulture || player.nation.culture}`, p.x + 20, y + 22);
    ctx.fillText(`國家色：`, p.x + 220, y + 22);
    ctx.fillStyle = player.civilization.mapColor || "#5878a6";
    ctx.fillRect(p.x + 276, y + 13, 26, 12);

    drawButton(p.x + 20, y + 36, 112, 30, "改政策");
    drawButton(p.x + 142, y + 36, 112, 30, "調稅率");
    drawButton(p.x + 264, y + 36, 112, 30, "換文化");
    drawButton(p.x + 20, y + 70, 180, 28, state.territoryOverlay ? "關閉領土顯示" : "顯示領土");
    drawButton(p.x + 210, y + 70, 166, 28, "換國家地圖色");
}

const __oldDrawTopUI0918 = drawTopUI;
drawTopUI = function() {
    __oldDrawTopUI0918();
    ctx.fillStyle = state.eraOpen ? "#667a4b" : "#30363a";
    ctx.fillRect(109, 120, 88, 24);
    ctx.strokeStyle = state.eraOpen ? "#e4d151" : "#60676a";
    ctx.strokeRect(109, 120, 88, 24);
    ctx.fillStyle = "#fff";
    ctx.font = "11px Arial";
    ctx.fillText("🏛 時代", 130, 137);
};

const __oldDrawNationPanel0918 = drawNationPanel;
drawNationPanel = function() {
    __oldDrawNationPanel0918();
    drawNationPolicyStrip();
};

const __oldNationPanelClick0918 = nationPanelClick;
nationPanelClick = function(x, y) {
    if (!state.nationOpen) return false;
    const p = nationPanelRect();
    const yy = p.y + 244;
    if (x >= p.x + 20 && x <= p.x + 132 && y >= yy + 36 && y <= yy + 66) { cycleNationPolicy(); return true; }
    if (x >= p.x + 142 && x <= p.x + 254 && y >= yy + 36 && y <= yy + 66) { cycleTaxRate(); return true; }
    if (x >= p.x + 264 && x <= p.x + 376 && y >= yy + 36 && y <= yy + 66) { cycleNationCulture(); return true; }
    if (x >= p.x + 20 && x <= p.x + 200 && y >= yy + 70 && y <= yy + 98) { state.territoryOverlay = !state.territoryOverlay; return true; }
    if (x >= p.x + 210 && x <= p.x + 376 && y >= yy + 70 && y <= yy + 98) { cycleNationMapColor(); return true; }
    return __oldNationPanelClick0918(x, y);
};

function handleEraPanelClick0918(mx, my) {
    if (!state.eraOpen) return false;
    const w = Math.min(560, screenWidth - 40);
    const h = Math.min(560, screenHeight - 190);
    const x = 20;
    const y = 150;
    if (mx < x || mx > x + w || my < y || my > y + h) return true;
    const nextIndex = (player.civilization.eraIndex || 0) + 1;
    if (nextIndex < CIVILIZATION_ERAS.length && mx >= x + 18 && mx <= x + 248 && my >= y + h - 66 && my <= y + h - 32) {
        advanceCivilizationEra();
        return true;
    }
    return true;
}

canvas.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    if (state.eraOpen) return;
    // 保持原有滑鼠邏輯，不接管左鍵。
});

const __oldHandleLeftRelease0918 = handleLeftRelease;
handleLeftRelease = function() {
    if (state.eraOpen) {
        handleEraPanelClick0918(input.mouse.x, input.mouse.y);
        return;
    }
    return __oldHandleLeftRelease0918();
};

// 在原本 render 後補上文明資訊，不改動地圖/單位主渲染順序。
const __oldRender0918 = render;
render = function() {
    __oldRender0918();
    drawEraPanel();
    if (state.eraOpen) {
        // 時代面板應蓋住領土層的畫面細節
    }
};

// 在既有 update 後掛上新系統；若遊戲暫停，不額外推進。
const __oldUpdate0918 = update;
update = function(dt) {
    const result = __oldUpdate0918(dt);
    if (!state.paused) {
        updateNationDevelopment(dt);
        updateCivilizationBreakthroughs();
    }
    return result;
};

// Save/Load 擴充：保留舊存檔的主體，同時新增文明資料。
const EX_SAVE_KEY0918 = "rts_v0918_civilization_expansion";
const __oldSaveGame0918 = saveGame;
saveGame = function() {
    __oldSaveGame0918();
    try {
        localStorage.setItem(EX_SAVE_KEY0918, JSON.stringify({
            civilization: player.civilization,
            nation: player.nation,
            territoryOverlay: state.territoryOverlay
        }));
    } catch (error) { console.error(error); }
};

const __oldLoadGame0918 = loadGame;
loadGame = function() {
    __oldLoadGame0918();
    try {
        const raw = localStorage.getItem(EX_SAVE_KEY0918);
        if (raw) {
            const extra = JSON.parse(raw);
            if (extra.civilization) player.civilization = { ...player.civilization, ...extra.civilization };
            if (extra.nation) player.nation = { ...player.nation, ...extra.nation };
            state.territoryOverlay = !!extra.territoryOverlay;
        }
    } catch (error) { console.error(error); }
};

// 幫新系統與舊存檔保持相容。
player.civilization = {
    eraIndex: clamp(player.civilization?.eraIndex || 0, 0, CIVILIZATION_ERAS.length - 1),
    breakthroughs: Array.isArray(player.civilization?.breakthroughs) ? player.civilization.breakthroughs : [],
    migration: Number.isFinite(player.civilization?.migration) ? player.civilization.migration : 0,
    urbanization: Number.isFinite(player.civilization?.urbanization) ? player.civilization.urbanization : 0,
    populationPeak: Number.isFinite(player.civilization?.populationPeak) ? player.civilization.populationPeak : (player.population || 0),
    chosenCulture: player.civilization?.chosenCulture || player.nation.culture || "本土傳統",
    policy: player.civilization?.policy || "均衡發展",
    taxRate: Number.isFinite(player.civilization?.taxRate) ? player.civilization.taxRate : 0.08,
    mapColor: player.civilization?.mapColor || "#5878a6"
};


canvas.addEventListener("click", event => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (x >= 109 && x <= 197 && y >= 120 && y <= 144 && !state.techOpen) {
        state.eraOpen = !state.eraOpen;
        state.nationOpen = false;
        state.populationOpen = false;
        state.marketOpen = false;
        state.historyOpen = false;
        return;
    }
});

/* ================================================================
   END V0.9.18 EXPANSION
================================================================ */


/* ================================================================
   V0.9.19 — GRAND CIVILIZATION EXPANSION
   目標：把先前暫存的文明、國家、人口、城市、經濟、貿易、
   歷史、文化、時代等系統正式落地，同時不改自由移動與自動索敵。
================================================================ */

GAME.VERSION = "0.9.19";

/* ---------------------------
   19.1 安全初始化
--------------------------- */

function CIV19_num(v, fallback = 0) {
    return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

function CIV19_arr(v) {
    return Array.isArray(v) ? v : [];
}

function CIV19_obj(v) {
    return v && typeof v === "object" ? v : {};
}

player.treasury = CIV19_num(player.treasury, 0);
player.stability = clamp(CIV19_num(player.stability, 100), 0, 100);
player.literacy = clamp(CIV19_num(player.literacy, 0.05), 0, 1);
player.foodStockpileDays = Math.max(0, CIV19_num(player.foodStockpileDays, 10));

if (!player.nation) player.nation = {};
Object.assign(player.nation, {
    name: player.nation.name || "新生國",
    flagIndex: CIV19_num(player.nation.flagIndex, 0),
    government: player.nation.government || "部族議會",
    leader: player.nation.leader || "開國議長",
    legitimacy: CIV19_num(player.nation.legitimacy, 78),
    militaryTradition: CIV19_num(player.nation.militaryTradition, 0),
    culture: player.nation.culture || "本土傳統",
    foundedYear: CIV19_num(player.nation.foundedYear, 1),
    capitalId: player.nation.capitalId || "town-center"
});

if (!player.civilization) player.civilization = {};
Object.assign(player.civilization, {
    eraIndex: CIV19_num(player.civilization.eraIndex, 0),
    breakthroughs: CIV19_arr(player.civilization.breakthroughs),
    migration: CIV19_num(player.civilization.migration, 0),
    urbanization: CIV19_num(player.civilization.urbanization, 0),
    populationPeak: CIV19_num(player.civilization.populationPeak, player.population || 0),
    chosenCulture: player.civilization.chosenCulture || player.nation.culture || "本土傳統",
    policy: player.civilization.policy || "均衡發展",
    taxRate: CIV19_num(player.civilization.taxRate, 0.08),
    mapColor: player.civilization.mapColor || "#5878a6",
    culturePower: CIV19_num(player.civilization.culturePower, 0),
    administrativeCapacity: CIV19_num(player.civilization.administrativeCapacity, 20),
    institutions: CIV19_obj(player.civilization.institutions)
});

if (!world.runtimeStats) {
    world.runtimeStats = {
        destinationPing: null,
        resourceRates: { food: 0, wood: 0, stone: 0, gold: 0, iron: 0 },
        selectedInfo: null,
        economyPulse: 0,
        eventTimer: 0
    };
}

if (!world.merchantUnits) world.merchantUnits = [];
if (!world.worldEvents) world.worldEvents = [];
if (!world.cityProjects) world.cityProjects = [];
if (!world.livestock) world.livestock = [];
if (!world.diplomacy) world.diplomacy = {};
if (!world.cityStats) world.cityStats = {};
if (!world.priceHistory) world.priceHistory = {};

if (!state.civ19Open) state.civ19Open = false;
if (!state.economyOpen) state.economyOpen = false;
if (!state.worldEventOpen) state.worldEventOpen = false;
if (!state.civ19Tab) state.civ19Tab = "nation";
if (!state.civ19Tooltip) state.civ19Tooltip = "";

/* ---------------------------
   19.2 國家身份 / 國旗 / 政府
--------------------------- */

const CIV19_FLAGS = [
    "🏴", "🚩", "🏳️", "🟥", "🟦", "🟩", "🟨", "🟪", "⬜", "⬛", "🟧", "🟫"
];

const CIV19_GOVERNMENTS = [
    { name: "部族議會", stability: 0.45, treasury: 0.25, research: 0.05, admin: 0.30 },
    { name: "酋長政體", stability: 0.20, treasury: 0.45, research: 0.05, admin: 0.45 },
    { name: "君主制", stability: 0.30, treasury: 0.40, research: 0.12, admin: 0.65 },
    { name: "城邦共和", stability: 0.25, treasury: 0.55, research: 0.22, admin: 0.58 },
    { name: "長老院", stability: 0.55, treasury: 0.18, research: 0.28, admin: 0.42 },
    { name: "軍事議會", stability: -0.10, treasury: 0.35, research: 0.04, admin: 0.60 }
];

const CIV19_LAWS = [
    { name: "土地公有", effect: "農業效率 +6%，稅收 -4%" },
    { name: "土地私有", effect: "稅收 +8%，農業效率 -2%" },
    { name: "部落習慣法", effect: "穩定度 +4，行政效率 -6%" },
    { name: "成文法", effect: "行政效率 +10%，需要識字率 12%" }
];

if (!player.nation.law) player.nation.law = CIV19_LAWS[0].name;

function CIV19_currentGovernment() {
    return CIV19_GOVERNMENTS.find(g => g.name === player.nation.government) || CIV19_GOVERNMENTS[0];
}

function CIV19_cycleFlag() {
    player.nation.flagIndex = ((player.nation.flagIndex || 0) + 1) % CIV19_FLAGS.length;
    recordHistory(`國旗更換為 ${CIV19_FLAGS[player.nation.flagIndex]}`);
}

function CIV19_cycleGovernment() {
    const idx = CIV19_GOVERNMENTS.findIndex(g => g.name === player.nation.government);
    const next = CIV19_GOVERNMENTS[(idx + 1 + CIV19_GOVERNMENTS.length) % CIV19_GOVERNMENTS.length];
    player.nation.government = next.name;
    const leaders = {
        "部族議會": "部族議長",
        "酋長政體": "大酋長",
        "君主制": "開國君主",
        "城邦共和": "首席執政官",
        "長老院": "最高長老",
        "軍事議會": "統帥"
    };
    player.nation.leader = leaders[next.name] || "國家首腦";
    player.stability = clamp(player.stability + next.stability * 2, 0, 100);
    recordHistory(`政府改組為「${next.name}」，首腦：${player.nation.leader}`);
    showMessage(`政府：${next.name}`);
}

function CIV19_cycleLaw() {
    const current = player.nation.law;
    const idx = CIV19_LAWS.findIndex(l => l.name === current);
    const next = CIV19_LAWS[(idx + 1 + CIV19_LAWS.length) % CIV19_LAWS.length];
    player.nation.law = next.name;
    recordHistory(`法律制度改為「${next.name}」`);
    showMessage(`法律：${next.name}`);
}

function CIV19_editNationName() {
    const value = prompt("輸入國號：", player.nation.name || "新生國");
    if (!value) return;
    const clean = value.trim().slice(0, 24);
    if (!clean) return;
    player.nation.name = clean;
    recordHistory(`國號改為「${clean}」`);
    showMessage(`國號：${clean}`);
}

function CIV19_editLeader() {
    const value = prompt("輸入政府首腦：", player.nation.leader || "國家首腦");
    if (!value) return;
    const clean = value.trim().slice(0, 18);
    if (!clean) return;
    player.nation.leader = clean;
    recordHistory(`政府首腦更換為「${clean}」`);
}

/* ---------------------------
   19.3 人口群體與行政容量
--------------------------- */

function CIV19_populationGroups() {
    const total = Math.max(0, player.population || 0);
    const w = player.workforce || {};
    const employed = Object.values(w).reduce((sum, n) => sum + Math.max(0, CIV19_num(n)), 0);
    const soldiers = world.units.filter(u => u.owner === "player" && u.type !== "villager").length;
    const villagers = world.units.filter(u => u.owner === "player" && u.type === "villager").length;
    const urban = world.settlements.filter(s => s.owner === "player").reduce((sum, s) => sum + CIV19_num(s.population), 0);
    const children = Math.round(total * 0.20);
    const elders = Math.round(total * 0.08);
    const adults = Math.max(0, total - children - elders);
    const students = Math.round(adults * clamp(player.literacy * 0.6, 0, 0.3));
    const unemployed = Math.max(0, adults - employed);
    return {
        total,
        children,
        adults,
        elders,
        students,
        employed,
        unemployed,
        urban,
        rural: Math.max(0, total - urban),
        villagers,
        soldiers
    };
}

function CIV19_updatePopulationEconomy(dt) {
    const groups = CIV19_populationGroups();
    const gov = CIV19_currentGovernment();
    const policy = (typeof NATION_POLICIES !== "undefined" && NATION_POLICIES.find(p => p.name === player.civilization.policy)) || { treasury: 0, stability: 0 };
    const cap = Math.max(10, (player.populationCap || 10) + (player.civilization.administrativeCapacity || 0) * 2);
    const adminPressure = Math.max(0, groups.total - cap) / Math.max(1, cap);
    const urbanTarget = groups.total > 0 ? clamp((groups.urban / groups.total) * 100, 0, 100) : 0;
    player.civilization.urbanization = lerp(player.civilization.urbanization || 0, urbanTarget, clamp(dt * 0.05, 0, 1));
    player.civilization.populationPeak = Math.max(player.civilization.populationPeak || 0, groups.total);

    const literacyGain = (0.0008 + groups.students / Math.max(1, groups.total) * 0.004) * dt;
    player.literacy = clamp(player.literacy + literacyGain, 0, 1);

    const tax = clamp(player.civilization.taxRate || 0.08, 0, 0.30);
    const taxIncome = groups.adults * tax * 0.006;
    const tradeIncome = (world.tradeRoutes || []).reduce((sum, r) => sum + CIV19_num(r.income, 0), 0);
    const cityIncome = world.settlements.filter(s => s.owner === "player").reduce((sum, s) => sum + CIV19_num(s.taxIncome, 0), 0);
    player.treasury = Math.max(0, player.treasury + (taxIncome + tradeIncome + cityIncome + gov.treasury * 0.02 + CIV19_num(policy.treasury) * 0.01) * dt);

    const stabilityDelta = (0.012 * gov.stability + 0.008 * CIV19_num(policy.stability) - tax * 0.08 - adminPressure * 0.04 - (player.foodStockpileDays < 2 ? 0.06 : 0)) * dt;
    player.stability = clamp(player.stability + stabilityDelta, 0, 100);
    player.nation.legitimacy = clamp(CIV19_num(player.nation.legitimacy, 78) + (player.stability - 50) * 0.001 * dt, 0, 100);

    player.civilization.administrativeCapacity = Math.max(20, 20 + world.settlements.filter(s => s.owner === "player").length * 8 + countCompleteBuildings("researchInstitute") * 5);

    const migrationPressure = (player.civilization.urbanization - 35) * 0.008 + (player.stability - 50) * 0.001;
    player.civilization.migration = clamp((player.civilization.migration || 0) + migrationPressure * dt, -100, 100);
}

/* ---------------------------
   19.4 城市發展 / 專業化
--------------------------- */

const CIV19_CITY_SPECIALIZATIONS = [
    { key: "agriculture", name: "農業城", bonus: "農業產出 +15%", color: "#889c55" },
    { key: "mining", name: "礦業城", bonus: "礦產收入 +15%", color: "#777873" },
    { key: "trade", name: "商業城", bonus: "貿易收入 +20%", color: "#b8944c" },
    { key: "military", name: "軍事城", bonus: "部隊訓練 +10%", color: "#8a5454" },
    { key: "research", name: "學術城", bonus: "科研速度 +15%", color: "#627b9b" },
    { key: "balanced", name: "綜合城", bonus: "所有發展小幅提升", color: "#806c58" }
];

function CIV19_ensureSettlementData(s) {
    if (!s) return;
    s.level = Math.max(1, CIV19_num(s.level, 1));
    s.population = Math.max(20, CIV19_num(s.population, 30));
    s.food = Math.max(0, CIV19_num(s.food, 100));
    s.stability = clamp(CIV19_num(s.stability, 70), 0, 100);
    s.prosperity = clamp(CIV19_num(s.prosperity, 40), 0, 100);
    s.fertility = clamp(CIV19_num(s.fertility, 70), 0, 100);
    s.specialization = s.specialization || "balanced";
    s.taxIncome = CIV19_num(s.taxIncome, 0);
    s.culture = s.culture || (s.owner === "player" ? player.civilization.chosenCulture : "本地傳統");
    s.foundationYear = CIV19_num(s.foundationYear, Math.floor((state.time || 0) / GAME.DAY_LENGTH) + 1);
}

function CIV19_settlementSpecialization(s) {
    if (!s || s.owner !== "player") return;
    const idx = CIV19_CITY_SPECIALIZATIONS.findIndex(v => v.key === s.specialization);
    const next = CIV19_CITY_SPECIALIZATIONS[(idx + 1 + CIV19_CITY_SPECIALIZATIONS.length) % CIV19_CITY_SPECIALIZATIONS.length];
    s.specialization = next.key;
    recordHistory(`${s.name || "聚落"} 定位為${next.name}`);
    showMessage(`${s.name || "聚落"}：${next.name}`);
}

function CIV19_updateCities(dt) {
    for (const s of world.settlements) {
        CIV19_ensureSettlementData(s);
        if (s.owner !== "player") continue;
        const farms = world.buildings.filter(b => b.complete && b.type === "farm" && distance(b.x, b.y, s.x, s.y) < Math.max(280, s.radius * 1.3)).length;
        const markets = world.buildings.filter(b => b.complete && b.type === "market" && distance(b.x, b.y, s.x, s.y) < Math.max(320, s.radius * 1.5)).length;
        const barracks = world.buildings.filter(b => b.complete && b.type === "barracks" && distance(b.x, b.y, s.x, s.y) < Math.max(300, s.radius * 1.4)).length;
        const workshops = world.buildings.filter(b => b.complete && (b.type === "workshop" || b.type === "factory") && distance(b.x, b.y, s.x, s.y) < Math.max(360, s.radius * 1.5)).length;
        const research = world.buildings.filter(b => b.complete && b.type === "researchInstitute" && distance(b.x, b.y, s.x, s.y) < Math.max(380, s.radius * 1.5)).length;
        const roads = world.roads.filter(r => distance(r.x1 || 0, r.y1 || 0, s.x, s.y) < s.radius * 1.2).length;
        const growth = 0.006 + farms * 0.002 + markets * 0.001 + Math.max(0, s.stability - 50) * 0.00008;
        const decline = s.food < 30 ? 0.008 : 0;
        s.population = Math.max(20, s.population + (growth - decline) * s.population * dt);
        s.food += (farms * 0.6 + (s.level || 1) * 0.2 - s.population * 0.002) * dt;
        s.food = clamp(s.food, 0, 10000);
        s.prosperity = clamp(s.prosperity + (markets * 0.08 + workshops * 0.06 + roads * 0.03 + research * 0.03 - (s.food < 30 ? 0.15 : 0.02)) * dt, 0, 100);
        s.stability = clamp(s.stability + (player.stability - s.stability) * 0.004 * dt, 0, 100);
        s.taxIncome = Math.max(0, s.population * (player.civilization.taxRate || 0.08) * 0.0025 * (0.7 + s.prosperity / 100));

        const oldLevel = s.level;
        if (s.level < 5) {
            const thresholds = [0, 40, 120, 350, 900, 2500];
            if (s.population >= thresholds[Math.min(s.level + 1, thresholds.length - 1)] && s.prosperity >= 30 + s.level * 8) {
                s.level++;
                recordHistory(`${s.name || "聚落"} 發展為 ${CIV19_cityLevelName(s.level)}`);
                showMessage(`${s.name || "聚落"} 發展為${CIV19_cityLevelName(s.level)}`);
            }
        }
        if (oldLevel !== s.level) s.lastUpgradeTime = state.time;
    }
}

function CIV19_cityLevelName(level) {
    return ["營地", "村莊", "城鎮", "城市", "大城市", "都城"][clamp(level, 1, 5)] || "聚落";
}

/* ---------------------------
   19.5 畜牧 / 肥力 / 農業統計
--------------------------- */

function CIV19_seedLivestock() {
    if (world.livestock.length) return;
    for (const s of world.settlements.filter(v => v.owner === "player").slice(0, 6)) {
        world.livestock.push({ id: `herd-${s.id}`, settlementId: s.id, type: "牛", count: 12, foodUse: 0.4, timer: 0 });
        world.livestock.push({ id: `herd-${s.id}-2`, settlementId: s.id, type: "羊", count: 18, foodUse: 0.25, timer: 0 });
    }
}

function CIV19_updateLivestock(dt) {
    CIV19_seedLivestock();
    for (const herd of world.livestock) {
        herd.timer += dt;
        const settlement = world.settlements.find(s => s.id === herd.settlementId);
        if (!settlement) continue;
        if (herd.timer >= 20) {
            herd.timer = 0;
            const growth = Math.max(0, Math.floor(herd.count * 0.01 * (settlement.prosperity / 60)));
            herd.count = clamp(herd.count + growth, 0, 9999);
            if (herd.count > 0) {
                const foodYield = herd.type === "牛" ? 1.2 : 0.8;
                player.resources.food += Math.min(4, herd.count * 0.01) * foodYield;
            }
        }
        settlement.food = Math.max(0, settlement.food - herd.count * herd.foodUse * dt * 0.01);
    }
}

function CIV19_updateFarmFertility(dt) {
    for (const b of world.buildings) {
        if (b.type !== "farm" || !b.complete) continue;
        if (!Number.isFinite(b.fertility)) b.fertility = 75;
        const season = state.season || 0;
        const moisture = season === 0 ? 8 : season === 1 ? 4 : season === 2 ? -3 : -8;
        const rain = state.weather === "rain" ? 6 : state.weather === "storm" ? 4 : state.weather === "drought" ? -10 : 0;
        b.fertility = clamp(b.fertility + (0.18 + moisture + rain) * dt * 0.01, 10, 100);
        b.foodMultiplier = 0.7 + b.fertility / 250;
    }
}

/* ---------------------------
   19.6 市場 / 價格歷史 / 商品
--------------------------- */

const CIV19_GOODS = [
    { key: "food", name: "食物", base: 4 },
    { key: "wood", name: "木材", base: 3 },
    { key: "stone", name: "石材", base: 4 },
    { key: "gold", name: "金幣", base: 10 },
    { key: "iron", name: "鐵", base: 8 }
];

function CIV19_updatePrices(dt) {
    if (!world.priceHistory) world.priceHistory = {};
    for (const good of CIV19_GOODS) {
        const supply = Math.max(0, CIV19_num(player.resources[good.key], 0));
        const pop = Math.max(1, player.population || 1);
        const demand = good.key === "food" ? pop * 8 : pop * 2.5;
        const scarcity = clamp(1 + (demand - supply) / Math.max(50, demand * 2), 0.45, 3.2);
        const specializationBonus = world.settlements.filter(s => s.owner === "player" && s.specialization === (good.key === "food" ? "agriculture" : good.key === "gold" || good.key === "iron" ? "mining" : "trade")).length * 0.04;
        const price = good.base * scarcity * (1 - specializationBonus);
        world.priceHistory[good.key] = CIV19_num(world.priceHistory[good.key], price) + (price - CIV19_num(world.priceHistory[good.key], price)) * clamp(dt * 0.4, 0, 1);
    }
}

function CIV19_getPrice(key) {
    return Math.max(0.1, CIV19_num(world.priceHistory?.[key], CIV19_GOODS.find(g => g.key === key)?.base || 1));
}

function CIV19_tradeGoods() {
    const goods = ["food", "wood", "stone", "iron"];
    const from = world.settlements.find(s => s.owner === "player" && s.specialization === "trade") || world.settlements.find(s => s.owner === "player");
    if (!from) return;
    const foreign = world.settlements.find(s => s.owner !== "player");
    if (!foreign) return;
    const key = goods[Math.floor(Math.random() * goods.length)];
    const amount = 10 + Math.floor(Math.random() * 25);
    if (CIV19_num(player.resources[key], 0) < amount) return;
    player.resources[key] -= amount;
    const price = CIV19_getPrice(key);
    const income = amount * price * 0.28;
    player.treasury += income;
    recordHistory(`商隊出售${key} ${amount}，獲得 ${income.toFixed(1)} 國庫`);
}

/* ---------------------------
   19.7 商隊在地圖上活動
--------------------------- */

function CIV19_spawnMerchant() {
    const origin = world.settlements.find(s => s.owner === "player");
    const foreign = world.settlements.find(s => s.owner !== "player");
    if (!origin || !foreign) return;
    world.merchantUnits.push({
        id: `merchant-${Date.now()}-${Math.random()}`,
        x: origin.x,
        y: origin.y,
        from: { x: origin.x, y: origin.y },
        to: { x: foreign.x, y: foreign.y },
        targetFaction: foreign.factionId || null,
        goods: CIV19_GOODS[Math.floor(Math.random() * CIV19_GOODS.length)].key,
        progress: 0,
        direction: 1,
        life: 100
    });
}

function CIV19_updateMerchants(dt) {
    if (world.merchantUnits.length < Math.min(4, 1 + Math.floor(world.settlements.length / 3))) CIV19_spawnMerchant();
    for (let i = world.merchantUnits.length - 1; i >= 0; i--) {
        const m = world.merchantUnits[i];
        const tx = m.direction > 0 ? m.to.x : m.from.x;
        const ty = m.direction > 0 ? m.to.y : m.from.y;
        const dx = tx - m.x;
        const dy = ty - m.y;
        const d = Math.hypot(dx, dy);
        if (d < 24) {
            if (m.direction > 0) {
                m.direction = -1;
                CIV19_tradeGoods();
            } else {
                world.merchantUnits.splice(i, 1);
            }
            continue;
        }
        const step = 80 * dt;
        m.x += dx / d * Math.min(step, d);
        m.y += dy / d * Math.min(step, d);
        m.life -= dt * 0.3;
        if (m.life <= 0) world.merchantUnits.splice(i, 1);
    }
}

function CIV19_drawMerchants() {
    for (const m of world.merchantUnits) {
        const p = worldToScreen(m.x, m.y);
        if (p.x < -40 || p.x > screenWidth + 40 || p.y < -40 || p.y > screenHeight - 140) continue;
        const s = Math.max(1, camera.zoom);
        ctx.fillStyle = "#765334";
        ctx.fillRect(p.x - 14 * s, p.y - 7 * s, 28 * s, 12 * s);
        ctx.fillStyle = "#b89a6c";
        ctx.fillRect(p.x - 10 * s, p.y - 12 * s, 20 * s, 7 * s);
        ctx.fillStyle = "#eee";
        ctx.fillRect(p.x - 16 * s, p.y + 5 * s, 7 * s, 7 * s);
        ctx.fillRect(p.x + 9 * s, p.y + 5 * s, 7 * s, 7 * s);
        ctx.fillStyle = "#fff";
        ctx.font = "10px Arial";
        ctx.fillText("商隊", p.x - 12 * s, p.y - 17 * s);
    }
}

/* ---------------------------
   19.8 外交關係（文明預設中立）
--------------------------- */

function CIV19_initDiplomacy() {
    for (const faction of world.factions) {
        if (!faction.id) faction.id = faction.name || `faction-${Math.random()}`;
        if (!world.diplomacy[faction.id]) {
            world.diplomacy[faction.id] = {
                relation: 0,
                status: "中立",
                treaties: [],
                trade: 0,
                tension: 0
            };
        }
    }
}

function CIV19_updateDiplomacy(dt) {
    CIV19_initDiplomacy();
    for (const faction of world.factions) {
        const d = world.diplomacy[faction.id];
        if (!d) continue;
        const hostile = faction.type === "野人" || faction.hostile === true;
        if (hostile) {
            d.status = "敵對";
            d.tension = clamp((d.tension || 0) + dt * 0.01, 0, 100);
        } else {
            d.tension = clamp((d.tension || 0) - dt * 0.008, 0, 100);
            d.status = d.relation >= 60 ? "友好" : d.relation <= -40 ? "冷淡" : "中立";
        }
    }
}

function CIV19_findFactionRelation(faction) {
    if (!faction) return null;
    return world.diplomacy?.[faction.id] || null;
}

/* ---------------------------
   19.9 野人遠離出生點 + 巡邏營地
--------------------------- */

function CIV19_distanceFromStart(x, y) {
    return Math.hypot(x, y);
}

function CIV19_spawnBarbarianCamp() {
    const min = 4200;
    const max = 9000;
    const angle = Math.random() * Math.PI * 2;
    const dist = min + Math.random() * (max - min);
    const x = Math.cos(angle) * dist;
    const y = Math.sin(angle) * dist;
    if (!isWalkable(x, y)) return;
    const faction = world.factions.find(f => f.type === "野人" && f.hostile);
    if (faction) {
        faction.camps = faction.camps || [];
        if (faction.camps.length < 6) faction.camps.push({ x, y, strength: 20 + Math.random() * 30 });
    }
}

function CIV19_updateBarbarianSafety(dt) {
    for (const faction of world.factions.filter(f => f.type === "野人" && f.hostile)) {
        faction.camps = faction.camps || [];
        faction.camps = faction.camps.filter(c => CIV19_distanceFromStart(c.x, c.y) >= 3000);
        while (faction.camps.length < 2) CIV19_spawnBarbarianCamp();
    }
}

/* ---------------------------
   19.10 世界事件
--------------------------- */

const CIV19_WORLD_EVENTS = [
    { key: "goodHarvest", title: "豐收", text: "今年的農業條件良好。", effect: () => player.resources.food += 40 },
    { key: "marketBoom", title: "商業繁榮", text: "商隊帶來額外收入。", effect: () => player.treasury += 30 },
    { key: "scholarly", title: "學術交流", text: "外來知識促進識字與研究。", effect: () => player.literacy = clamp(player.literacy + 0.02, 0, 1) },
    { key: "localFlood", title: "河谷洪水", text: "部分農田肥力下降。", effect: () => { for (const b of world.buildings.filter(v => v.type === "farm").slice(0, 5)) b.fertility = clamp((b.fertility || 70) - 8, 10, 100); } },
    { key: "festival", title: "地方節慶", text: "民眾穩定度提升。", effect: () => player.stability = clamp(player.stability + 4, 0, 100) },
    { key: "migrationWave", title: "人口遷移", text: "部分人口向繁榮聚落集中。", effect: () => player.civilization.migration = clamp(player.civilization.migration + 8, -100, 100) }
];

function CIV19_triggerEvent() {
    const event = CIV19_WORLD_EVENTS[Math.floor(Math.random() * CIV19_WORLD_EVENTS.length)];
    event.effect();
    world.worldEvents.push({
        year: Math.floor(state.time / GAME.DAY_LENGTH) + 1,
        title: event.title,
        text: event.text,
        time: state.time
    });
    recordHistory(`世界事件：${event.title}——${event.text}`);
    showMessage(`世界事件：${event.title}`);
    state.worldEventOpen = true;
}

function CIV19_updateWorldEvents(dt) {
    world.runtimeStats.eventTimer = CIV19_num(world.runtimeStats.eventTimer, 0) + dt;
    if (world.runtimeStats.eventTimer >= 45) {
        world.runtimeStats.eventTimer = 0;
        if (Math.random() < 0.35) CIV19_triggerEvent();
    }
}

/* ---------------------------
   19.11 歷史資料索引
--------------------------- */

function CIV19_historyStats() {
    const years = Math.max(1, Math.floor(state.time / GAME.DAY_LENGTH) + 1);
    const battles = (world.history || []).filter(h => /戰|攻擊|擊殺/.test(h.text || h)).length;
    const development = world.settlements.filter(s => s.owner === "player").length + countCompleteBuildings("market") + countCompleteBuildings("workshop");
    return {
        years,
        events: (world.history || []).length,
        battles,
        development,
        breakthroughs: player.civilization.breakthroughs.length,
        populationPeak: player.civilization.populationPeak || player.population || 0
    };
}

/* ---------------------------
   19.12 國家資料面板
--------------------------- */

function CIV19_panelRect() {
    return {
        x: Math.max(18, Math.floor(screenWidth / 2 - 360)),
        y: 120,
        width: Math.min(720, screenWidth - 36),
        height: Math.min(600, screenHeight - 180)
    };
}

function CIV19_drawPanelBackground(r, title) {
    ctx.fillStyle = "rgba(8,10,12,0.97)";
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = "#687176";
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 21px Arial";
    ctx.fillText(title, r.x + 18, r.y + 30);
    ctx.fillStyle = "#7d878b";
    ctx.font = "11px Arial";
    ctx.fillText("ESC 關閉", r.x + r.width - 68, r.y + 28);
}

function CIV19_drawNationTab(r) {
    const x = r.x + 20;
    let y = r.y + 64;
    const groups = CIV19_populationGroups();
    const gov = CIV19_currentGovernment();
    const hist = CIV19_historyStats();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px Arial";
    ctx.fillText(`${CIV19_FLAGS[player.nation.flagIndex || 0]} ${player.nation.name}`, x, y);
    ctx.font = "12px Arial";
    ctx.fillStyle = "#c5cccf";
    ctx.fillText(`政府：${player.nation.government}   首腦：${player.nation.leader}`, x, y + 24);
    ctx.fillText(`法律：${player.nation.law}   文化：${player.civilization.chosenCulture}`, x, y + 44);

    ctx.fillStyle = "#e3d06d";
    ctx.fillText(`人口 ${formatNumber(groups.total)}   峰值 ${formatNumber(hist.populationPeak)}`, x, y + 70);
    ctx.fillStyle = "#8fd18d";
    ctx.fillText(`國庫 ${player.treasury.toFixed(1)}   稅率 ${Math.round((player.civilization.taxRate || 0) * 100)}%`, x, y + 92);
    ctx.fillStyle = "#b7c5d2";
    ctx.fillText(`穩定 ${player.stability.toFixed(1)}   合法性 ${CIV19_num(player.nation.legitimacy, 0).toFixed(1)}   識字 ${(player.literacy * 100).toFixed(1)}%`, x, y + 114);
    ctx.fillText(`都市化 ${(player.civilization.urbanization || 0).toFixed(1)}%   行政容量 ${Math.round(player.civilization.administrativeCapacity || 0)}`, x, y + 136);
    ctx.fillText(`發展聚落 ${world.settlements.filter(s => s.owner === "player").length}   歷史事件 ${hist.events}   突破 ${hist.breakthroughs}`, x, y + 158);

    const buttons = [
        { label: "改國號", x: x, y: y + 184, w: 110, fn: CIV19_editNationName },
        { label: "換國旗", x: x + 120, y: y + 184, w: 110, fn: CIV19_cycleFlag },
        { label: "換政府", x: x + 240, y: y + 184, w: 110, fn: CIV19_cycleGovernment },
        { label: "換法律", x: x + 360, y: y + 184, w: 110, fn: CIV19_cycleLaw },
        { label: "改首腦", x: x + 480, y: y + 184, w: 110, fn: CIV19_editLeader }
    ];
    for (const b of buttons) {
        ctx.fillStyle = "#2f383d";
        ctx.fillRect(b.x, b.y, b.w, 30);
        ctx.strokeStyle = "#69747a";
        ctx.strokeRect(b.x, b.y, b.w, 30);
        ctx.fillStyle = "#fff";
        ctx.font = "12px Arial";
        ctx.fillText(b.label, b.x + 27, b.y + 20);
    }

    ctx.fillStyle = "#c8ced0";
    ctx.font = "bold 13px Arial";
    ctx.fillText("人口結構", x, y + 244);
    ctx.font = "12px Arial";
    const lines = [
        `成年 ${formatNumber(groups.adults)}   兒童 ${formatNumber(groups.children)}   老年 ${formatNumber(groups.elders)}`,
        `就業 ${formatNumber(groups.employed)}   失業 ${formatNumber(groups.unemployed)}   學習人口 ${formatNumber(groups.students)}`,
        `都市 ${formatNumber(groups.urban)}   農村 ${formatNumber(groups.rural)}   士兵 ${formatNumber(groups.soldiers)}`,
        `遷移指數 ${(player.civilization.migration || 0).toFixed(1)}   文化力量 ${(player.civilization.culturePower || 0).toFixed(1)}`
    ];
    y += 266;
    for (const line of lines) { ctx.fillText(line, x, y); y += 21; }

    ctx.fillStyle = "#8f989c";
    ctx.fillText(`政府修正：穩定 ${gov.stability >= 0 ? "+" : ""}${gov.stability.toFixed(2)}  國庫 ${gov.treasury.toFixed(2)}  科研 ${gov.research.toFixed(2)}  行政 ${gov.admin.toFixed(2)}`, x, r.y + r.height - 26);
}

function CIV19_drawEconomyTab(r) {
    const x = r.x + 20;
    let y = r.y + 68;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 17px Arial";
    ctx.fillText("經濟 / ECONOMY", x, y);
    y += 30;
    ctx.font = "12px Arial";
    for (const good of CIV19_GOODS) {
        const value = CIV19_num(player.resources[good.key], 0);
        const rate = CIV19_num(player.resourceRates?.[good.key], 0);
        ctx.fillStyle = "#d8dde0";
        ctx.fillText(`${good.name.padEnd(3, " ")} ${formatNumber(value)}`, x, y);
        ctx.fillStyle = rate >= 0 ? "#83d383" : "#df7b72";
        ctx.fillText(`${rate >= 0 ? "+" : ""}${rate.toFixed(2)}/s`, x + 115, y);
        ctx.fillStyle = "#d5bf68";
        ctx.fillText(`價格 ${CIV19_getPrice(good.key).toFixed(1)}`, x + 210, y);
        y += 26;
    }
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Arial";
    ctx.fillText(`國庫：${player.treasury.toFixed(1)}`, x, y + 8);
    ctx.fillText(`商隊：${world.merchantUnits.length}`, x + 180, y + 8);
    ctx.fillText(`貿易路線：${world.tradeRoutes.length}`, x + 340, y + 8);

    y += 50;
    ctx.font = "bold 13px Arial";
    ctx.fillText("主要聚落", x, y);
    y += 24;
    ctx.font = "11px Arial";
    const cities = world.settlements.filter(s => s.owner === "player").slice(0, 12);
    for (const s of cities) {
        CIV19_ensureSettlementData(s);
        const spec = CIV19_CITY_SPECIALIZATIONS.find(v => v.key === s.specialization) || CIV19_CITY_SPECIALIZATIONS[CIV19_CITY_SPECIALIZATIONS.length - 1];
        ctx.fillStyle = "#d0d6d8";
        ctx.fillText(`${s.name || "聚落"} · ${CIV19_cityLevelName(s.level)} · ${formatNumber(s.population)} 人 · ${spec.name}`, x, y);
        ctx.fillStyle = "#8ac787";
        ctx.fillText(`繁榮 ${s.prosperity.toFixed(0)}  穩定 ${s.stability.toFixed(0)}`, x + 430, y);
        y += 20;
        if (y > r.y + r.height - 40) break;
    }
}

function CIV19_drawCityTab(r) {
    const x = r.x + 20;
    let y = r.y + 66;
    const cities = world.settlements.filter(s => s.owner === "player");
    ctx.fillStyle = "#fff";
    ctx.font = "bold 17px Arial";
    ctx.fillText("城市 / SETTLEMENTS", x, y);
    y += 30;
    ctx.font = "12px Arial";
    ctx.fillStyle = "#aeb7bb";
    ctx.fillText("每座城市可以逐步成長，並形成不同專業方向。", x, y);
    y += 30;
    for (const s of cities.slice(0, 10)) {
        CIV19_ensureSettlementData(s);
        const spec = CIV19_CITY_SPECIALIZATIONS.find(v => v.key === s.specialization) || CIV19_CITY_SPECIALIZATIONS[5];
        ctx.fillStyle = "#e1e5e6";
        ctx.font = "bold 13px Arial";
        ctx.fillText(`${s.name || "聚落"} · ${CIV19_cityLevelName(s.level)}`, x, y);
        ctx.font = "11px Arial";
        ctx.fillStyle = "#aab3b7";
        ctx.fillText(`人口 ${formatNumber(s.population)} | 繁榮 ${s.prosperity.toFixed(0)} | 穩定 ${s.stability.toFixed(0)} | 肥力 ${s.fertility.toFixed(0)} | 專業：${spec.name}`, x, y + 18);
        ctx.fillText(`稅收 ${s.taxIncome.toFixed(2)}/秒 | 建立年份 ${s.foundationYear} | 文化：${s.culture}`, x, y + 36);
        y += 65;
    }
    ctx.fillStyle = "#858e92";
    ctx.fillText("點選聚落後，可使用下方『專業化』按鈕循環切換城市方向。", x, r.y + r.height - 22);
}

function CIV19_drawHistoryTab(r) {
    const x = r.x + 20;
    let y = r.y + 66;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 17px Arial";
    ctx.fillText("歷史 / HISTORY", x, y);
    y += 30;
    ctx.font = "11px Arial";
    const recent = (world.history || []).slice(-18).reverse();
    for (const item of recent) {
        const text = typeof item === "string" ? item : item.text || item.title || JSON.stringify(item);
        ctx.fillStyle = "#cfd4d6";
        ctx.fillText(text.slice(0, 92), x, y);
        y += 22;
        if (y > r.y + r.height - 26) break;
    }
}

function CIV19_drawWorldEventsTab(r) {
    const x = r.x + 20;
    let y = r.y + 66;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 17px Arial";
    ctx.fillText("世界事件 / WORLD EVENTS", x, y);
    y += 32;
    for (const e of world.worldEvents.slice(-10).reverse()) {
        ctx.fillStyle = "#e6d274";
        ctx.font = "bold 12px Arial";
        ctx.fillText(`第 ${e.year} 年 · ${e.title}`, x, y);
        ctx.fillStyle = "#bbc3c7";
        ctx.font = "11px Arial";
        ctx.fillText(e.text, x + 5, y + 18);
        y += 44;
        if (y > r.y + r.height - 30) break;
    }
}

function CIV19_drawMainPanel() {
    if (!state.civ19Open && !state.economyOpen && !state.worldEventOpen) return;
    const r = CIV19_panelRect();
    const title = state.worldEventOpen ? "世界事件" : state.economyOpen ? "國家經濟資料" : "文明總覽";
    CIV19_drawPanelBackground(r, title);
    if (state.worldEventOpen) CIV19_drawWorldEventsTab(r);
    else if (state.economyOpen) CIV19_drawEconomyTab(r);
    else if (state.civ19Tab === "city") CIV19_drawCityTab(r);
    else if (state.civ19Tab === "history") CIV19_drawHistoryTab(r);
    else CIV19_drawNationTab(r);

    if (!state.worldEventOpen && !state.economyOpen) {
        const tabs = [
            ["國家", "nation", r.x + 20],
            ["城市", "city", r.x + 90],
            ["歷史", "history", r.x + 160],
            ["經濟", "economy", r.x + 230]
        ];
        for (const [label, key, bx] of tabs) {
            ctx.fillStyle = (state.civ19Tab === key || (key === "economy" && state.economyOpen)) ? "#56644a" : "#292f33";
            ctx.fillRect(bx, r.y + r.height - 55, 62, 28);
            ctx.strokeStyle = "#606a6f";
            ctx.strokeRect(bx, r.y + r.height - 55, 62, 28);
            ctx.fillStyle = "#fff";
            ctx.font = "11px Arial";
            ctx.fillText(label, bx + 20, r.y + r.height - 36);
        }
    }
}

/* ---------------------------
   19.13 聚落選擇小面板
--------------------------- */

function CIV19_drawSettlementAction() {
    const s = state.selectedSettlement;
    if (!s || state.civ19Open || state.economyOpen || state.worldEventOpen) return;
    const w = 300;
    const h = 118;
    const x = 18;
    const y = 116;
    CIV19_ensureSettlementData(s);
    ctx.fillStyle = "rgba(9,10,11,0.94)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#687075";
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px Arial";
    ctx.fillText(`${s.name || "聚落"} · ${CIV19_cityLevelName(s.level)}`, x + 12, y + 23);
    ctx.font = "11px Arial";
    ctx.fillStyle = "#bfc8ca";
    ctx.fillText(`人口 ${formatNumber(s.population)} · 繁榮 ${s.prosperity.toFixed(0)} · 穩定 ${s.stability.toFixed(0)}`, x + 12, y + 45);
    ctx.fillText(`方向：${(CIV19_CITY_SPECIALIZATIONS.find(v => v.key === s.specialization) || CIV19_CITY_SPECIALIZATIONS[5]).name}`, x + 12, y + 64);
    ctx.fillStyle = "#334047";
    ctx.fillRect(x + 12, y + 76, 120, 28);
    ctx.strokeStyle = "#6c7a80";
    ctx.strokeRect(x + 12, y + 76, 120, 28);
    ctx.fillStyle = "#fff";
    ctx.fillText("循環城市專業", x + 28, y + 95);
    ctx.fillStyle = "#737d82";
    ctx.fillText("點擊後切換方向", x + 152, y + 95);
}

/* ---------------------------
   19.14 國家快速入口
--------------------------- */

function CIV19_drawQuickButtons() {
    const y = 15;
    const buttons = [
        { key: "nation", x: 715, w: 104, label: "🏳 國家" },
        { key: "economy", x: 825, w: 104, label: "💰 經濟" },
        { key: "events", x: 935, w: 104, label: "📜 事件" }
    ];
    for (const b of buttons) {
        if (b.x + b.w > screenWidth - 10) continue;
        const active = b.key === "nation" ? state.civ19Open : b.key === "economy" ? state.economyOpen : state.worldEventOpen;
        ctx.fillStyle = active ? "#53684c" : "rgba(14,17,19,0.92)";
        ctx.fillRect(b.x, y, b.w, 30);
        ctx.strokeStyle = active ? "#d7cb55" : "#596268";
        ctx.strokeRect(b.x, y, b.w, 30);
        ctx.fillStyle = "#fff";
        ctx.font = "12px Arial";
        ctx.fillText(b.label, b.x + 22, y + 20);
    }
}

/* ---------------------------
   19.15 城市 / 商隊 / 牲畜視覺
--------------------------- */

function CIV19_drawLivestock() {
    for (const herd of world.livestock) {
        const s = world.settlements.find(v => v.id === herd.settlementId);
        if (!s) continue;
        const offset = (hash(herd.id.length, Math.floor(state.time), worldSeed) - 0.5) * 2;
        const x = s.x + offset * 25;
        const y = s.y + Math.sin(state.time * 0.4 + herd.id.length) * 18;
        const p = worldToScreen(x, y);
        if (p.x < -30 || p.x > screenWidth + 30 || p.y < -30 || p.y > screenHeight - 140) continue;
        const scale = Math.max(0.7, camera.zoom);
        ctx.fillStyle = herd.type === "牛" ? "#c4b69f" : "#e7e1d7";
        ctx.fillRect(p.x - 7 * scale, p.y - 4 * scale, 14 * scale, 8 * scale);
        ctx.fillRect(p.x + 5 * scale, p.y - 7 * scale, 5 * scale, 5 * scale);
    }
}

/* ---------------------------
   19.16 時代 UI 強化
--------------------------- */

function CIV19_drawEraBadge() {
    const era = civilizationEra();
    const nextIndex = (player.civilization.eraIndex || 0) + 1;
    const next = CIVILIZATION_ERAS[nextIndex];
    const x = Math.max(18, screenWidth - 265);
    const y = 242;
    ctx.fillStyle = "rgba(8,10,11,0.88)";
    ctx.fillRect(x, y, 245, 54);
    ctx.strokeStyle = era.color || "#6f777b";
    ctx.strokeRect(x, y, 245, 54);
    ctx.fillStyle = "#e6e9ea";
    ctx.font = "bold 13px Arial";
    ctx.fillText(`時代：${era.short || era.name}`, x + 12, y + 19);
    ctx.font = "10px Arial";
    ctx.fillStyle = "#9fa8ac";
    ctx.fillText(next ? `下一階段：${next.short || next.name}` : "已達最後時代", x + 12, y + 36);
    ctx.fillStyle = "#7dd47d";
    ctx.fillText(`突破 ${player.civilization.breakthroughs.length}`, x + 170, y + 19);
}

/* ---------------------------
   19.17 UI 事件
--------------------------- */

function CIV19_toggleMain(kind) {
    state.civ19Open = kind === "nation" ? !state.civ19Open : false;
    state.economyOpen = kind === "economy" ? !state.economyOpen : false;
    state.worldEventOpen = kind === "events" ? !state.worldEventOpen : false;
    if (state.civ19Open) state.civ19Tab = "nation";
}

function CIV19_handleClick(mx, my) {
    const r = CIV19_panelRect();

    if (!state.civ19Open && !state.economyOpen && !state.worldEventOpen) {
        if (my >= 15 && my <= 45) {
            if (mx >= 710 && mx <= 825) { CIV19_toggleMain("nation"); return true; }
            if (mx >= 825 && mx <= 935) { CIV19_toggleMain("economy"); return true; }
            if (mx >= 935 && mx <= 1045) { CIV19_toggleMain("events"); return true; }
        }
        const s = state.selectedSettlement;
        if (s && mx >= 30 && mx <= 150 && my >= 192 && my <= 220) {
            CIV19_settlementSpecialization(s);
            return true;
        }
        return false;
    }

    if (mx < r.x || mx > r.x + r.width || my < r.y || my > r.y + r.height) return false;

    if (my >= r.y + r.height - 55 && !state.economyOpen && !state.worldEventOpen) {
        if (mx >= r.x + 20 && mx <= r.x + 82) { state.civ19Tab = "nation"; return true; }
        if (mx >= r.x + 90 && mx <= r.x + 152) { state.civ19Tab = "city"; return true; }
        if (mx >= r.x + 160 && mx <= r.x + 222) { state.civ19Tab = "history"; return true; }
        if (mx >= r.x + 230 && mx <= r.x + 292) { state.economyOpen = true; state.civ19Open = false; return true; }
    }

    if (state.civ19Open && state.civ19Tab === "nation") {
        const baseY = r.y + 64 + 184;
        const actions = [
            [r.x + 20, CIV19_editNationName],
            [r.x + 140, CIV19_cycleFlag],
            [r.x + 260, CIV19_cycleGovernment],
            [r.x + 380, CIV19_cycleLaw],
            [r.x + 500, CIV19_editLeader]
        ];
        for (const [bx, fn] of actions) if (mx >= bx && mx <= bx + 110 && my >= baseY && my <= baseY + 30) { fn(); return true; }
    }
    return true;
}

canvas.addEventListener("click", event => {
    const rect = canvas.getBoundingClientRect();
    CIV19_handleClick(event.clientX - rect.left, event.clientY - rect.top);
});

window.addEventListener("keydown", event => {
    if (event.key === "Escape") {
        state.civ19Open = false;
        state.economyOpen = false;
        state.worldEventOpen = false;
    }
    if (event.key.toLowerCase() === "n" && !event.ctrlKey && !event.altKey) {
        if (!state.techOpen) CIV19_toggleMain("nation");
    }
    if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.altKey) {
        if (!state.techOpen) CIV19_toggleMain("economy");
    }
}
);

/* ---------------------------
   19.18 包裝 UPDATE / RENDER
--------------------------- */

const CIV19_oldUpdate = update;
update = function(dt) {
    CIV19_oldUpdate(dt);
    if (state.paused) return;

    // 這些系統全部是低頻／輕量計算，避免像舊版尋路那樣造成尖峰。
    CIV19_updatePopulationEconomy(dt);
    CIV19_updateCities(dt);
    CIV19_updateLivestock(dt);
    CIV19_updateFarmFertility(dt);
    CIV19_updatePrices(dt);
    CIV19_updateMerchants(dt);
    CIV19_updateDiplomacy(dt);
    CIV19_updateBarbarianSafety(dt);
    CIV19_updateWorldEvents(dt);
    player.civilization.culturePower = Math.max(0, player.civilization.culturePower || 0) + Math.max(0, player.literacy) * dt * 0.02;
};

const CIV19_oldRender = render;
render = function() {
    CIV19_oldRender();
    CIV19_drawMerchants();
    CIV19_drawLivestock();
    CIV19_drawEraBadge();
    CIV19_drawSettlementAction();
    CIV19_drawQuickButtons();
    CIV19_drawMainPanel();
};

/* ---------------------------
   19.19 存檔擴充
--------------------------- */

const CIV19_SAVE_KEY = `${SAVE_KEY}_v0919_civilization`;
const CIV19_oldSave = saveGame;
saveGame = function() {
    CIV19_oldSave();
    try {
        localStorage.setItem(CIV19_SAVE_KEY, JSON.stringify({
            nation: player.nation,
            civilization: player.civilization,
            livestock: world.livestock,
            merchantUnits: world.merchantUnits,
            worldEvents: world.worldEvents,
            diplomacy: world.diplomacy,
            priceHistory: world.priceHistory,
            cityStats: world.cityStats
        }));
    } catch (error) {
        console.error("V0.9.19 save extension failed", error);
    }
};

const CIV19_oldLoad = loadGame;
loadGame = function() {
    CIV19_oldLoad();
    try {
        const raw = localStorage.getItem(CIV19_SAVE_KEY);
        if (!raw) return;
        const extra = JSON.parse(raw);
        if (extra.nation) Object.assign(player.nation, extra.nation);
        if (extra.civilization) Object.assign(player.civilization, extra.civilization);
        world.livestock = Array.isArray(extra.livestock) ? extra.livestock : [];
        world.merchantUnits = Array.isArray(extra.merchantUnits) ? extra.merchantUnits : [];
        world.worldEvents = Array.isArray(extra.worldEvents) ? extra.worldEvents : [];
        world.diplomacy = extra.diplomacy && typeof extra.diplomacy === "object" ? extra.diplomacy : {};
        world.priceHistory = extra.priceHistory && typeof extra.priceHistory === "object" ? extra.priceHistory : {};
        world.cityStats = extra.cityStats && typeof extra.cityStats === "object" ? extra.cityStats : {};
        CIV19_seedLivestock();
        CIV19_initDiplomacy();
    } catch (error) {
        console.error("V0.9.19 load extension failed", error);
    }
};

/* ---------------------------
   19.20 舊資料相容：聚落與勢力
--------------------------- */

function CIV19_normalizeAll() {
    for (const s of world.settlements) CIV19_ensureSettlementData(s);
    CIV19_initDiplomacy();
    CIV19_seedLivestock();
    for (const f of world.factions) {
        if (f.type && f.type !== "野人" && typeof f.hostile === "undefined") f.hostile = false;
    }
}

CIV19_normalizeAll();
recordHistory("文明資料系統升級至 V0.9.19");

/* ================================================================
   V0.9.19 END
================================================================ */



/* ================================================================
   V0.9.20 — COMPLETE ERA CONTENT EXPANSION

   核心：
   ・所有時代都正式建立科技與建築內容
   ・時代是解鎖門檻，不直接修改 V0.9.19 科研樹的核心邏輯
   ・鐵器時代前不得使用鐵器科技/建築
   ・提供「時代內容」面板，可以預覽全部時代
   ・目前時代內容可以直接由面板操作
   ・未來時代也有完整資料，但受前置條件鎖定
   ・保留 V0.9.19 自由移動與自動索敵
================================================================ */

GAME.VERSION = "0.9.20";

/* ---------------------------------------------------------------
   ERA STATE
---------------------------------------------------------------- */

if (!state.eraCatalogOpen) state.eraCatalogOpen = false;
if (!state.eraCatalogIndex) state.eraCatalogIndex = 0;

if (!player.civilization) {
    player.civilization = {};
}

player.civilization.eraIndex = clamp(
    Number.isFinite(player.civilization.eraIndex) ? player.civilization.eraIndex : 0,
    0,
    10
);

if (!Array.isArray(player.civilization.breakthroughs)) {
    player.civilization.breakthroughs = [];
}

/* ---------------------------------------------------------------
   FULL ERA DEFINITION
---------------------------------------------------------------- */

const ERA20 = [
    {
        name: "原始／部落時代",
        short: "部落",
        color: "#79634b",
        description: "以採集、狩獵、火與最早的定居活動為核心。",
        breakthrough: "火的控制"
    },
    {
        name: "農業定居時代",
        short: "農業",
        color: "#6e8e50",
        description: "穩定農耕、畜牧與糧食儲存讓永久聚落迅速成長。",
        breakthrough: "農業革命"
    },
    {
        name: "早期金屬時代",
        short: "早期金屬",
        color: "#9a774a",
        description: "人類開始掌握金屬加工、陶器與車輪。",
        breakthrough: "初步冶金"
    },
    {
        name: "青銅時代",
        short: "青銅",
        color: "#ac8047",
        description: "青銅工具、城市制度與更專業的軍隊開始出現。",
        breakthrough: "青銅冶煉"
    },
    {
        name: "鐵器時代",
        short: "鐵器",
        color: "#68747c",
        description: "鐵成為工具、農具與武器的主流材料。",
        breakthrough: "鐵器革命"
    },
    {
        name: "古典時代",
        short: "古典",
        color: "#738b96",
        description: "大城市、道路、文字、數學與制度化行政成熟。",
        breakthrough: "制度文明"
    },
    {
        name: "中世紀",
        short: "中世紀",
        color: "#74615a",
        description: "城堡、行會、封建行政與長距離商路成為主體。",
        breakthrough: "中世紀制度"
    },
    {
        name: "火藥時代",
        short: "火藥",
        color: "#706b75",
        description: "火藥、火器、印刷與更強的中央行政體系出現。",
        breakthrough: "火藥革命"
    },
    {
        name: "工業時代",
        short: "工業",
        color: "#59636c",
        description: "機械化、蒸汽、鋼鐵、工廠與大規模生產全面崛起。",
        breakthrough: "工業革命"
    },
    {
        name: "現代時代",
        short: "現代",
        color: "#4f7087",
        description: "電力、醫療、化學、大眾教育與現代國家制度成熟。",
        breakthrough: "現代國家"
    },
    {
        name: "未來時代",
        short: "未來",
        color: "#526b93",
        description: "計算、機器人、聚變、太空與高階材料主導文明。",
        breakthrough: "未來科技"
    }
];

/* 將 0.9.19 的時代物件同步到完整內容版本。 */
for (let i = 0; i < ERA20.length && i < CIVILIZATION_ERAS.length; i++) {
    Object.assign(CIVILIZATION_ERAS[i], ERA20[i]);
    CIVILIZATION_ERAS[i].implemented = true;
}

/* ---------------------------------------------------------------
   ERA REQUIREMENTS
---------------------------------------------------------------- */

const ERA_REQUIREMENTS20 = [
    [],
    [
        { label: "人口至少 12", check: () => player.population >= 12 },
        { label: "建立至少 1 座農田", check: () => countCompleteBuildings("farm") >= 1 },
        { label: "完成「農耕實踐」", check: () => hasTech("fieldAgriculture") }
    ],
    [
        { label: "人口至少 30", check: () => player.population >= 30 },
        { label: "至少 2 個己方聚落", check: () => world.settlements.filter(s => s.owner === "player").length >= 2 },
        { label: "完成「初步冶金」", check: () => hasTech("basicMetallurgy") },
        { label: "建立石器／金屬工坊", check: () => countCompleteBuildings("smithy") + countCompleteBuildings("workshop") >= 1 }
    ],
    [
        { label: "人口至少 65", check: () => player.population >= 65 },
        { label: "完成「青銅冶煉」", check: () => hasTech("bronzeSmelting") },
        { label: "至少 1 個城鎮", check: () => world.settlements.some(s => s.owner === "player" && s.level >= 2) },
        { label: "建立青銅工坊", check: () => countCompleteBuildings("bronzeWorkshop") >= 1 }
    ],
    [
        { label: "人口至少 110", check: () => player.population >= 110 },
        { label: "鐵資源至少 100", check: () => (player.resources.iron || 0) >= 100 },
        { label: "完成「鐵器革命」", check: () => hasTech("ironSmelting") && hasTech("ironTools") },
        { label: "建立鐵匠鋪", check: () => countCompleteBuildings("ironSmithy") >= 1 }
    ],
    [
        { label: "人口至少 260", check: () => player.population >= 260 },
        { label: "至少 1 個城市", check: () => world.settlements.some(s => s.owner === "player" && s.level >= 3) },
        { label: "完成文字", check: () => hasTech("writing") },
        { label: "完成數學", check: () => hasTech("mathematics") },
        { label: "建立學院", check: () => countCompleteBuildings("academy") >= 1 }
    ],
    [
        { label: "人口至少 650", check: () => player.population >= 650 },
        { label: "至少 2 座城市", check: () => world.settlements.filter(s => s.owner === "player" && s.level >= 3).length >= 2 },
        { label: "完成中世紀制度", check: () => hasTech("feudalAdministration") },
        { label: "完成城防工程", check: () => hasTech("fortification") }
    ],
    [
        { label: "人口至少 1400", check: () => player.population >= 1400 },
        { label: "完成火藥", check: () => hasTech("blackPowder") },
        { label: "完成印刷術", check: () => hasTech("printingPress") },
        { label: "建立火藥工坊", check: () => countCompleteBuildings("powderWorkshop") >= 1 }
    ],
    [
        { label: "人口至少 3500", check: () => player.population >= 3500 },
        { label: "建立工廠", check: () => countCompleteBuildings("industrialFactory") >= 1 },
        { label: "完成蒸汽機", check: () => hasTech("steamEngine") },
        { label: "完成機械化生產", check: () => hasTech("mechanizedProduction") }
    ],
    [
        { label: "人口至少 8000", check: () => player.population >= 8000 },
        { label: "完成電力", check: () => hasTech("electricity") },
        { label: "完成現代國家", check: () => hasTech("modernState") },
        { label: "建立現代大學", check: () => countCompleteBuildings("modernUniversity") >= 1 }
    ],
    [
        { label: "人口至少 20000", check: () => player.population >= 20000 },
        { label: "完成計算機", check: () => hasTech("computing") },
        { label: "完成高階材料", check: () => hasTech("advancedMaterials") },
        { label: "建立未來研究中心", check: () => countCompleteBuildings("futureResearchCenter") >= 1 }
    ]
];

for (let i = 0; i < CIVILIZATION_ERAS.length; i++) {
    CIVILIZATION_ERAS[i].requirements = ERA_REQUIREMENTS20[i] || [];
}

/* ---------------------------------------------------------------
   FULL TECHNOLOGY CATALOG
---------------------------------------------------------------- */

function addEraTech(key, data) {
    TECHS[key] = {
        name: data.name,
        cost: Object.assign({ food: 0, wood: 0, stone: 0, gold: 0, iron: 0 }, data.cost || {}),
        time: data.time || 20,
        requires: data.requires || [],
        eraRequired: data.eraRequired || 0,
        description: data.description || "文明科技突破",
        breakthrough: data.breakthrough || null,
        effect: data.effect || {}
    };
}

/* 0：原始 */
addEraTech("controlledFire", { name: "火種控制", eraRequired: 0, cost: { food: 25, wood: 20 }, time: 8, description: "改善野外生存與食物處理。", breakthrough: "火的控制", effect: { food: 0.03 } });
addEraTech("stoneWorking", { name: "石器加工", eraRequired: 0, cost: { food: 30, wood: 20 }, time: 10, description: "更有效率的石器工具。", effect: { stone: 0.05, build: 0.03 } });
addEraTech("huntingCraft", { name: "狩獵技藝", eraRequired: 0, cost: { food: 35, wood: 15 }, time: 10, description: "改善狩獵與野外採集。", effect: { food: 0.05 } });
addEraTech("foragingKnowledge", { name: "採集知識", eraRequired: 0, cost: { food: 20, wood: 10 }, time: 7, description: "提高早期食物與野生資源利用率。", effect: { food: 0.04, wood: 0.02 } });
addEraTech("tribalOrganization", { name: "部落組織", eraRequired: 0, cost: { food: 50, wood: 40 }, time: 15, description: "提高人口管理與建設能力。", requires: ["controlledFire"], effect: { build: 0.05, stability: 2 } });

/* 1：農業 */
addEraTech("fieldAgriculture", { name: "農耕實踐", eraRequired: 1, cost: { food: 80, wood: 40 }, time: 15, description: "建立穩定的耕作制度。", breakthrough: "農業革命", effect: { food: 0.10 } });
addEraTech("animalHusbandry", { name: "畜牧", eraRequired: 1, cost: { food: 90, wood: 50 }, time: 18, description: "馴養牲畜並建立穩定肉奶來源。", effect: { food: 0.08 } });
addEraTech("pottery", { name: "陶器", eraRequired: 1, cost: { food: 70, wood: 60, stone: 20 }, time: 18, description: "改善儲藏、烹煮與商品保存。", effect: { food: 0.04, gold: 0.02 } });
addEraTech("irrigation", { name: "灌溉", eraRequired: 1, cost: { food: 100, wood: 80, stone: 40 }, time: 22, description: "提高農田在乾旱時期的穩定度。", requires: ["fieldAgriculture"], effect: { food: 0.12 } });
addEraTech("grainStorage", { name: "穀物保存", eraRequired: 1, cost: { food: 100, wood: 100 }, time: 18, description: "減少糧食損耗並提高儲備效率。", requires: ["pottery"], effect: { food: 0.05, stability: 1 } });
addEraTech("calendar", { name: "曆法", eraRequired: 1, cost: { food: 90, gold: 30 }, time: 20, description: "更準確地安排農耕季節。", requires: ["fieldAgriculture"], effect: { food: 0.05, research: 0.02 } });

/* 2：早期金屬 */
addEraTech("basicMetallurgy", { name: "初步冶金", eraRequired: 2, cost: { food: 120, wood: 100, stone: 80, gold: 60 }, time: 28, description: "掌握基本金屬冶煉。", breakthrough: "初步冶金", effect: { stone: 0.05, iron: 0.05, build: 0.05 } });
addEraTech("copperWorking", { name: "銅器加工", eraRequired: 2, cost: { food: 110, wood: 100, stone: 70, gold: 80 }, time: 25, description: "開始製造早期金屬工具。", requires: ["basicMetallurgy"], effect: { build: 0.07 } });
addEraTech("wheel", { name: "車輪", eraRequired: 2, cost: { food: 100, wood: 150, stone: 50 }, time: 22, description: "提高運輸與農業工具效率。", effect: { wood: 0.05, stone: 0.04 } });
addEraTech("earlyWriting", { name: "早期記錄", eraRequired: 2, cost: { food: 120, wood: 80, gold: 70 }, time: 24, description: "建立可靠的記錄與帳目制度。", effect: { research: 0.04, gold: 0.03 } });
addEraTech("metalTools", { name: "金屬工具", eraRequired: 2, cost: { food: 150, wood: 100, stone: 100, gold: 90 }, time: 30, description: "提高採礦、伐木與建造效率。", requires: ["basicMetallurgy", "copperWorking"], effect: { wood: 0.08, stone: 0.08, iron: 0.05 } });
addEraTech("earlyTradeLaw", { name: "早期貿易法", eraRequired: 2, cost: { food: 140, gold: 100 }, time: 26, description: "建立更穩定的市場與商業規則。", requires: ["earlyWriting"], effect: { gold: 0.08, stability: 1 } });

/* 3：青銅 */
addEraTech("bronzeSmelting", { name: "青銅冶煉", eraRequired: 3, cost: { food: 180, wood: 120, stone: 140, gold: 120 }, time: 36, description: "掌握銅錫配比並大量製造青銅器。", requires: ["basicMetallurgy", "metalTools"], breakthrough: "青銅冶煉", effect: { build: 0.08, combat: 0.06 } });
addEraTech("bronzeWeapons", { name: "青銅武器", eraRequired: 3, cost: { food: 180, wood: 120, stone: 120, gold: 150 }, time: 35, description: "解鎖專業青銅武器。", requires: ["bronzeSmelting"], effect: { combat: 0.10 } });
addEraTech("bronzeArmor", { name: "青銅甲胄", eraRequired: 3, cost: { food: 160, wood: 80, stone: 100, gold: 170 }, time: 35, description: "提高近戰部隊生存能力。", requires: ["bronzeWeapons"], effect: { combat: 0.08, stability: 1 } });
addEraTech("chariot", { name: "戰車", eraRequired: 3, cost: { food: 220, wood: 250, stone: 80, gold: 180 }, time: 42, description: "解鎖快速的早期戰車部隊概念。", requires: ["bronzeWeapons", "wheel"], effect: { combat: 0.08 } });
addEraTech("masonry", { name: "石工技術", eraRequired: 3, cost: { food: 140, wood: 120, stone: 220, gold: 100 }, time: 32, description: "解鎖大型石造建築與城防。", effect: { build: 0.12 } });
addEraTech("currency", { name: "貨幣", eraRequired: 3, cost: { food: 180, gold: 220 }, time: 30, description: "市場不再完全依賴以物易物。", requires: ["earlyTradeLaw"], effect: { gold: 0.15 } });

/* 4：鐵器 */
addEraTech("ironSmelting", { name: "鐵器冶煉", eraRequired: 4, cost: { food: 220, wood: 180, stone: 260, gold: 180, iron: 50 }, time: 45, description: "掌握高溫冶鐵，正式進入鐵器時代。", requires: ["bronzeSmelting", "masonry"], breakthrough: "鐵器革命", effect: { iron: 0.15, build: 0.08 } });
addEraTech("ironTools", { name: "鐵製工具", eraRequired: 4, cost: { food: 220, wood: 150, stone: 180, gold: 170, iron: 100 }, time: 40, description: "鐵斧、鐵鎬與鐵製農具全面提高生產力。", requires: ["ironSmelting"], effect: { wood: 0.15, stone: 0.15, food: 0.12, iron: 0.05 } });
addEraTech("ironWeapons", { name: "鐵製武器", eraRequired: 4, cost: { food: 240, wood: 160, stone: 180, gold: 200, iron: 160 }, time: 43, description: "解鎖真正的鐵器時代軍備。", requires: ["ironSmelting"], effect: { combat: 0.16 } });
addEraTech("ironArmor", { name: "鐵製甲胄", eraRequired: 4, cost: { food: 250, wood: 130, stone: 180, gold: 230, iron: 220 }, time: 46, description: "重裝步兵裝備正式成形。", requires: ["ironWeapons"], effect: { combat: 0.14 } });
addEraTech("engineering", { name: "工程學", eraRequired: 4, cost: { food: 220, wood: 200, stone: 250, gold: 160, iron: 100 }, time: 42, description: "提高橋樑、城門與大型工程效率。", requires: ["masonry", "ironSmelting"], effect: { build: 0.15 } });
addEraTech("coinMinting", { name: "鑄幣", eraRequired: 4, cost: { food: 200, gold: 300, iron: 80 }, time: 36, description: "建立標準貨幣制度。", requires: ["currency"], effect: { gold: 0.18, stability: 1 } });

/* 5：古典 */
addEraTech("writing", { name: "文字", eraRequired: 5, cost: { food: 240, wood: 160, gold: 260 }, time: 42, description: "知識可以跨世代保存，行政能力顯著提升。", requires: ["earlyWriting"], breakthrough: "文字", effect: { research: 0.12, stability: 2 } });
addEraTech("mathematics", { name: "數學", eraRequired: 5, cost: { food: 260, gold: 260 }, time: 46, description: "計算、建築與天文觀測進入制度化階段。", requires: ["writing"], effect: { research: 0.10, build: 0.05 } });
addEraTech("classicalArchitecture", { name: "古典建築", eraRequired: 5, cost: { food: 240, wood: 220, stone: 400, gold: 220, iron: 100 }, time: 48, description: "解鎖大型公共建築。", requires: ["masonry", "mathematics"], effect: { build: 0.18 } });
addEraTech("roadEngineering", { name: "道路工程", eraRequired: 5, cost: { food: 220, wood: 260, stone: 260, gold: 160, iron: 100 }, time: 44, description: "改善長距離運輸與城市連接。", requires: ["engineering"], effect: { wood: 0.04, gold: 0.08 } });
addEraTech("professionalArmy", { name: "專業軍隊", eraRequired: 5, cost: { food: 300, wood: 180, stone: 160, gold: 300, iron: 220 }, time: 50, description: "軍隊由臨時徵召逐漸轉向制度化。", requires: ["ironWeapons", "writing"], effect: { combat: 0.18 } });
addEraTech("aqueduct", { name: "引水工程", eraRequired: 5, cost: { food: 260, wood: 160, stone: 500, gold: 180, iron: 100 }, time: 52, description: "改善城市供水與公共衛生。", requires: ["classicalArchitecture"], effect: { food: 0.05, stability: 3 } });

/* 6：中世紀 */
addEraTech("feudalAdministration", { name: "中世紀行政", eraRequired: 6, cost: { food: 350, wood: 260, stone: 220, gold: 340, iron: 180 }, time: 60, description: "建立領地、封臣與中央行政的層級制度。", requires: ["writing", "professionalArmy"], breakthrough: "中世紀制度", effect: { stability: 4, gold: 0.12 } });
addEraTech("guilds", { name: "行會", eraRequired: 6, cost: { food: 320, wood: 250, gold: 420 }, time: 52, description: "提高工匠、生產與城市商業效率。", requires: ["feudalAdministration"], effect: { gold: 0.16, build: 0.08 } });
addEraTech("fortification", { name: "城防工程", eraRequired: 6, cost: { food: 300, wood: 260, stone: 500, gold: 300, iron: 250 }, time: 64, description: "完善城牆、城門與防禦建築。", requires: ["engineering", "feudalAdministration"], effect: { combat: 0.12, stability: 4 } });
addEraTech("cropRotation", { name: "輪作", eraRequired: 6, cost: { food: 320, wood: 170, gold: 200 }, time: 48, description: "長期提高土地生產能力。", requires: ["irrigation", "calendar"], effect: { food: 0.16 } });
addEraTech("banking", { name: "早期銀行", eraRequired: 6, cost: { food: 300, gold: 550 }, time: 54, description: "提高大型貿易與國庫資金運轉效率。", requires: ["currency", "guilds"], effect: { gold: 0.22 } });
addEraTech("university", { name: "大學制度", eraRequired: 6, cost: { food: 360, wood: 300, stone: 260, gold: 500 }, time: 62, description: "研究與知識傳承效率大幅提升。", requires: ["writing", "mathematics", "guilds"], effect: { research: 0.25 } });

/* 7：火藥 */
addEraTech("blackPowder", { name: "火藥", eraRequired: 7, cost: { food: 420, wood: 260, stone: 180, gold: 500, iron: 260 }, time: 70, description: "解鎖早期火藥武器與攻城技術。", requires: ["engineering", "university"], breakthrough: "火藥革命", effect: { combat: 0.20 } });
addEraTech("printingPress", { name: "印刷術", eraRequired: 7, cost: { food: 360, wood: 420, gold: 480 }, time: 62, description: "知識與行政文件可以大量複製。", requires: ["university"], effect: { research: 0.22, stability: 3 } });
addEraTech("firearms", { name: "火器", eraRequired: 7, cost: { food: 450, wood: 260, stone: 260, gold: 620, iron: 380 }, time: 74, description: "解鎖早期火槍與火炮裝備。", requires: ["blackPowder", "ironWeapons"], effect: { combat: 0.24 } });
addEraTech("bureaucracy", { name: "官僚制度", eraRequired: 7, cost: { food: 420, wood: 240, gold: 600 }, time: 66, description: "更有效率地管理大型國家。", requires: ["feudalAdministration", "printingPress"], effect: { stability: 6, gold: 0.12 } });
addEraTech("oceanicNavigation", { name: "遠洋航海", eraRequired: 7, cost: { food: 400, wood: 500, gold: 600 }, time: 68, description: "支援長距離海上貿易與探索。", requires: ["roadEngineering"], effect: { gold: 0.18 } });
addEraTech("logisticsAdministration", { name: "後勤行政", eraRequired: 7, cost: { food: 450, wood: 260, gold: 550, iron: 250 }, time: 60, description: "改善軍隊與補給的制度化管理。", requires: ["professionalArmy", "bureaucracy"], effect: { combat: 0.12, gold: 0.06 } });

/* 8：工業 */
addEraTech("steamEngine", { name: "蒸汽機", eraRequired: 8, cost: { food: 600, wood: 500, stone: 500, gold: 900, iron: 700 }, time: 90, description: "機械化生產的核心動力。", requires: ["engineering", "firearms"], breakthrough: "工業革命", effect: { build: 0.18, iron: 0.15, wood: 0.10 } });
addEraTech("mechanizedProduction", { name: "機械化生產", eraRequired: 8, cost: { food: 650, wood: 420, stone: 420, gold: 950, iron: 800 }, time: 88, description: "工廠生產效率大幅提升。", requires: ["steamEngine", "guilds"], effect: { build: 0.25, gold: 0.18 } });
addEraTech("steelMaking", { name: "鋼鐵冶煉", eraRequired: 8, cost: { food: 620, wood: 300, stone: 600, gold: 800, iron: 900 }, time: 84, description: "鋼鐵成為工業與軍事基礎材料。", requires: ["ironSmelting", "steamEngine"], effect: { iron: 0.25, combat: 0.12, build: 0.12 } });
addEraTech("railway", { name: "鐵路", eraRequired: 8, cost: { food: 550, wood: 600, stone: 500, gold: 1100, iron: 1000 }, time: 96, description: "大幅提升長距離運輸能力。", requires: ["steamEngine", "steelMaking"], effect: { gold: 0.18, food: 0.08 } });
addEraTech("industrialChemistry", { name: "工業化學", eraRequired: 8, cost: { food: 500, wood: 320, stone: 380, gold: 1000, iron: 600 }, time: 82, description: "肥料、材料與化學工業全面發展。", requires: ["steamEngine"], effect: { food: 0.16, build: 0.12 } });
addEraTech("massEducation", { name: "大眾教育", eraRequired: 8, cost: { food: 500, wood: 360, gold: 900 }, time: 78, description: "普及教育並擴大科研人才來源。", requires: ["university", "printingPress"], effect: { research: 0.32, stability: 4 } });

/* 9：現代 */
addEraTech("electricity", { name: "電力", eraRequired: 9, cost: { food: 750, wood: 400, stone: 500, gold: 1400, iron: 1000 }, time: 105, description: "現代工業、城市與通信的能源核心。", requires: ["mechanizedProduction", "industrialChemistry"], breakthrough: "電氣化", effect: { build: 0.30, gold: 0.20, research: 0.10 } });
addEraTech("modernState", { name: "現代國家", eraRequired: 9, cost: { food: 700, wood: 380, gold: 1600 }, time: 100, description: "建立現代官僚、教育與公共服務體系。", requires: ["bureaucracy", "massEducation"], breakthrough: "現代國家", effect: { stability: 8, research: 0.18, gold: 0.12 } });
addEraTech("medicine", { name: "現代醫療", eraRequired: 9, cost: { food: 800, wood: 300, stone: 300, gold: 1500 }, time: 98, description: "改善公共衛生與人口健康。", requires: ["industrialChemistry", "modernState"], effect: { food: 0.05, stability: 8 } });
addEraTech("massProduction", { name: "大規模生產", eraRequired: 9, cost: { food: 800, wood: 420, stone: 400, gold: 1500, iron: 1000 }, time: 100, description: "標準化生產與現代製造業。", requires: ["mechanizedProduction", "steelMaking"], effect: { build: 0.35, gold: 0.20 } });
addEraTech("aviation", { name: "航空", eraRequired: 9, cost: { food: 650, wood: 350, gold: 1700, iron: 1000 }, time: 108, description: "解鎖現代航空技術。", requires: ["massProduction", "electricity"], effect: { combat: 0.16 } });
addEraTech("telecommunications", { name: "遠距通信", eraRequired: 9, cost: { food: 600, wood: 250, gold: 1600 }, time: 92, description: "提高國家行政與情報效率。", requires: ["electricity", "modernState"], effect: { research: 0.22, stability: 5 } });

/* 10：未來 */
addEraTech("computing", { name: "計算機", eraRequired: 10, cost: { food: 1000, wood: 300, stone: 400, gold: 2200, iron: 1200 }, time: 125, description: "資訊處理進入計算機時代。", requires: ["electricity", "telecommunications"], effect: { research: 0.40 }, breakthrough: "計算革命" });
addEraTech("automation", { name: "自動化", eraRequired: 10, cost: { food: 950, wood: 300, stone: 500, gold: 2300, iron: 1500 }, time: 130, description: "大量生產與行政流程自動化。", requires: ["computing", "massProduction"], effect: { build: 0.45, gold: 0.25 } });
addEraTech("advancedMaterials", { name: "高階材料", eraRequired: 10, cost: { food: 900, stone: 700, gold: 2400, iron: 1800 }, time: 120, description: "新型材料支撐未來工業。", requires: ["steelMaking", "computing"], effect: { iron: 0.30, build: 0.20 }, breakthrough: "未來科技" });
addEraTech("robotics", { name: "機器人學", eraRequired: 10, cost: { food: 1000, wood: 200, stone: 400, gold: 2600, iron: 1600 }, time: 135, description: "機器人開始承擔高強度與高精度工作。", requires: ["automation", "advancedMaterials"], effect: { build: 0.35, iron: 0.20 } });
addEraTech("fusionPower", { name: "聚變能源", eraRequired: 10, cost: { food: 1200, stone: 900, gold: 3200, iron: 2000 }, time: 150, description: "高密度能源技術。", requires: ["advancedMaterials", "electricity"], effect: { gold: 0.30, research: 0.20 } });
addEraTech("spaceIndustry", { name: "太空工業", eraRequired: 10, cost: { food: 1300, wood: 300, stone: 1200, gold: 3600, iron: 2200 }, time: 170, description: "文明開始建立太空基礎設施。", requires: ["fusionPower", "robotics"], effect: { gold: 0.35, research: 0.25 }, breakthrough: "太空時代" });

/* ---------------------------------------------------------------
   ERA-SPECIFIC BUILDINGS
---------------------------------------------------------------- */

function addEraBuilding(key, data) {
    BUILDINGS[key] = Object.assign({
        name: key,
        width: 160,
        height: 130,
        cost: { food: 0, wood: 100, stone: 0, gold: 0, iron: 0 },
        buildTime: 6,
        description: "時代建築",
        eraRequired: 0,
        requiresTechs: [],
        maxLevel: 3,
        effect: {}
    }, data);
}

/* 原始 */
addEraBuilding("tribalCamp", { name: "部落營地", width: 180, height: 130, cost: { wood: 60 }, buildTime: 3, eraRequired: 0, description: "早期聚落核心。", effect: { housing: 4 } });
addEraBuilding("firePit", { name: "火塘", width: 110, height: 90, cost: { wood: 30, stone: 20 }, buildTime: 2, eraRequired: 0, requiresTechs: ["controlledFire"], description: "提供早期生活與食物加成。", effect: { food: 0.03 } });
addEraBuilding("storagePit", { name: "儲藏坑", width: 120, height: 100, cost: { wood: 50, stone: 30 }, buildTime: 3, eraRequired: 0, description: "增加早期儲存能力。", effect: { food: 0.03 } });
addEraBuilding("stoneWorkshop", { name: "石器工坊", width: 170, height: 125, cost: { wood: 100, stone: 90 }, buildTime: 5, eraRequired: 0, requiresTechs: ["stoneWorking"], description: "加工石器工具。", effect: { build: 0.04 } });
addEraBuilding("hunterLodge", { name: "獵人小屋", width: 150, height: 110, cost: { wood: 90, food: 20 }, buildTime: 4, eraRequired: 0, requiresTechs: ["huntingCraft"], description: "提高野外食物利用。", effect: { food: 0.06 } });

/* 農業 */
addEraBuilding("granary", { name: "穀倉", width: 180, height: 135, cost: { wood: 150, stone: 40 }, buildTime: 6, eraRequired: 1, requiresTechs: ["grainStorage"], description: "提高糧食儲備與農業效率。", effect: { food: 0.10, housing: 4 } });
addEraBuilding("animalPen", { name: "畜欄", width: 190, height: 135, cost: { wood: 150, food: 50 }, buildTime: 6, eraRequired: 1, requiresTechs: ["animalHusbandry"], description: "畜牧生產建築。", effect: { food: 0.09 } });
addEraBuilding("potteryKiln", { name: "陶窯", width: 145, height: 120, cost: { wood: 120, stone: 100 }, buildTime: 5, eraRequired: 1, requiresTechs: ["pottery"], description: "生產陶器與儲藏用品。", effect: { gold: 0.03 } });
addEraBuilding("irrigationStation", { name: "灌溉站", width: 155, height: 110, cost: { wood: 180, stone: 160 }, buildTime: 6, eraRequired: 1, requiresTechs: ["irrigation"], description: "提高農田穩定度。", effect: { food: 0.12 } });
addEraBuilding("villageHall", { name: "村落會所", width: 210, height: 150, cost: { wood: 200, stone: 80, gold: 60 }, buildTime: 8, eraRequired: 1, requiresTechs: ["tribalOrganization"], description: "聚落行政與人口管理。", effect: { housing: 8, stability: 2 } });

/* 早期金屬 */
addEraBuilding("smeltingFurnace", { name: "初級冶煉爐", width: 180, height: 140, cost: { wood: 160, stone: 180, gold: 60 }, buildTime: 7, eraRequired: 2, requiresTechs: ["basicMetallurgy"], description: "加工早期金屬。", effect: { iron: 0.08, build: 0.06 } });
addEraBuilding("copperWorkshop", { name: "銅匠作坊", width: 185, height: 140, cost: { wood: 180, stone: 140, gold: 100 }, buildTime: 7, eraRequired: 2, requiresTechs: ["copperWorking"], description: "製造銅器與早期工具。", effect: { build: 0.08 } });
addEraBuilding("wheelwright", { name: "車輪工坊", width: 175, height: 130, cost: { wood: 220, stone: 70, gold: 50 }, buildTime: 6, eraRequired: 2, requiresTechs: ["wheel"], description: "改善運輸設備。", effect: { gold: 0.05 } });
addEraBuilding("recordHouse", { name: "記錄所", width: 180, height: 135, cost: { wood: 170, stone: 70, gold: 120 }, buildTime: 6, eraRequired: 2, requiresTechs: ["earlyWriting"], description: "保存帳目與知識。", effect: { research: 0.07 } });
addEraBuilding("smithy", { name: "早期鐵／金屬工坊", width: 200, height: 145, cost: { wood: 220, stone: 200, gold: 100 }, buildTime: 8, eraRequired: 2, requiresTechs: ["metalTools"], description: "早期金屬工具生產。", effect: { build: 0.10, stone: 0.05 } });

/* 青銅 */
addEraBuilding("bronzeWorkshop", { name: "青銅工坊", width: 215, height: 155, cost: { wood: 240, stone: 240, gold: 180 }, buildTime: 9, eraRequired: 3, requiresTechs: ["bronzeSmelting"], description: "生產青銅工具與武器。", effect: { build: 0.12, combat: 0.06 } });
addEraBuilding("cityWall", { name: "石城牆", width: 260, height: 150, cost: { wood: 80, stone: 500, gold: 180 }, buildTime: 12, eraRequired: 3, requiresTechs: ["masonry"], description: "城市防禦建築。", effect: { stability: 4 } });
addEraBuilding("marketplace", { name: "大型市集", width: 210, height: 150, cost: { wood: 280, stone: 150, gold: 160 }, buildTime: 8, eraRequired: 3, requiresTechs: ["currency"], description: "提高商業與交易效率。", effect: { gold: 0.15 } });
addEraBuilding("stables", { name: "馬廄", width: 200, height: 145, cost: { wood: 260, stone: 100, gold: 140 }, buildTime: 7, eraRequired: 3, requiresTechs: ["chariot"], description: "軍用牲口與機動單位。", effect: { combat: 0.08 } });
addEraBuilding("administrationHall", { name: "行政廳", width: 220, height: 160, cost: { wood: 220, stone: 240, gold: 260 }, buildTime: 10, eraRequired: 3, requiresTechs: ["earlyWriting", "currency"], description: "提高城市行政能力。", effect: { stability: 5, gold: 0.06 } });

/* 鐵器 */
addEraBuilding("ironSmithy", { name: "鐵匠鋪", width: 210, height: 150, cost: { wood: 260, stone: 260, gold: 220, iron: 160 }, buildTime: 9, eraRequired: 4, requiresTechs: ["ironSmelting"], description: "鐵器時代核心生產建築。", effect: { iron: 0.16, combat: 0.08, build: 0.10 } });
addEraBuilding("bloomery", { name: "煉鐵爐", width: 190, height: 150, cost: { wood: 240, stone: 320, gold: 200, iron: 100 }, buildTime: 10, eraRequired: 4, requiresTechs: ["ironSmelting"], description: "提高鐵資源加工效率。", effect: { iron: 0.22 } });
addEraBuilding("armory", { name: "軍械庫", width: 220, height: 165, cost: { wood: 250, stone: 300, gold: 300, iron: 240 }, buildTime: 11, eraRequired: 4, requiresTechs: ["ironWeapons"], description: "鐵製武器與甲胄儲備。", effect: { combat: 0.16 } });
addEraBuilding("stoneGate", { name: "石城門", width: 180, height: 190, cost: { wood: 100, stone: 600, gold: 260, iron: 100 }, buildTime: 13, eraRequired: 4, requiresTechs: ["engineering"], description: "強化聚落防禦。", effect: { stability: 5 } });
addEraBuilding("forgeComplex", { name: "大型鍛造場", width: 250, height: 180, cost: { wood: 300, stone: 380, gold: 300, iron: 300 }, buildTime: 13, eraRequired: 4, requiresTechs: ["engineering", "ironTools"], description: "大型工具與建材生產中心。", effect: { build: 0.20, iron: 0.12 } });

/* 古典 */
addEraBuilding("academy", { name: "學院", width: 230, height: 170, cost: { food: 220, wood: 260, stone: 300, gold: 350 }, buildTime: 12, eraRequired: 5, requiresTechs: ["writing", "mathematics"], description: "科研與知識中心。", effect: { research: 0.20 } });
addEraBuilding("forum", { name: "公共廣場", width: 240, height: 170, cost: { wood: 180, stone: 400, gold: 300 }, buildTime: 11, eraRequired: 5, requiresTechs: ["classicalArchitecture"], description: "提高城市穩定與行政。", effect: { stability: 7, gold: 0.05 } });
addEraBuilding("greatMarket", { name: "大市場", width: 250, height: 180, cost: { wood: 340, stone: 220, gold: 350 }, buildTime: 11, eraRequired: 5, requiresTechs: ["roadEngineering"], description: "大型商業中心。", effect: { gold: 0.20 } });
addEraBuilding("aqueductBuilding", { name: "大型引水道", width: 270, height: 150, cost: { wood: 200, stone: 700, gold: 260, iron: 120 }, buildTime: 14, eraRequired: 5, requiresTechs: ["aqueduct"], description: "改善城市人口與穩定。", effect: { food: 0.06, stability: 8 } });
addEraBuilding("legionBarracks", { name: "軍團營地", width: 240, height: 170, cost: { wood: 360, stone: 300, gold: 320, iron: 260 }, buildTime: 12, eraRequired: 5, requiresTechs: ["professionalArmy"], description: "專業軍隊的常設駐地。", effect: { combat: 0.18 } });

/* 中世紀 */
addEraBuilding("castle", { name: "城堡", width: 320, height: 260, cost: { wood: 420, stone: 900, gold: 500, iron: 400 }, buildTime: 20, eraRequired: 6, requiresTechs: ["fortification", "feudalAdministration"], description: "大型領地防禦與行政中心。", effect: { stability: 12, combat: 0.15, housing: 15 } });
addEraBuilding("guildHall", { name: "行會大廳", width: 240, height: 180, cost: { wood: 360, stone: 220, gold: 500 }, buildTime: 12, eraRequired: 6, requiresTechs: ["guilds"], description: "工匠與商人中心。", effect: { gold: 0.22, build: 0.10 } });
addEraBuilding("monastery", { name: "修道院", width: 230, height: 180, cost: { food: 280, wood: 280, stone: 360, gold: 400 }, buildTime: 13, eraRequired: 6, requiresTechs: ["university"], description: "知識、文化與公共服務中心。", effect: { research: 0.16, stability: 8 } });
addEraBuilding("waterMill", { name: "水車磨坊", width: 200, height: 150, cost: { wood: 360, stone: 260, gold: 180 }, buildTime: 10, eraRequired: 6, requiresTechs: ["cropRotation"], description: "穀物加工效率提高。", effect: { food: 0.18 } });
addEraBuilding("bank", { name: "銀行", width: 210, height: 160, cost: { wood: 300, stone: 220, gold: 700 }, buildTime: 12, eraRequired: 6, requiresTechs: ["banking"], description: "提高國庫與金融效率。", effect: { gold: 0.28 } });

/* 火藥 */
addEraBuilding("powderWorkshop", { name: "火藥工坊", width: 220, height: 165, cost: { wood: 300, stone: 260, gold: 650, iron: 300 }, buildTime: 13, eraRequired: 7, requiresTechs: ["blackPowder"], description: "火藥與早期火器生產。", effect: { combat: 0.18 } });
addEraBuilding("foundry", { name: "鑄炮廠", width: 260, height: 185, cost: { wood: 320, stone: 420, gold: 800, iron: 650 }, buildTime: 16, eraRequired: 7, requiresTechs: ["firearms"], description: "大型火炮與金屬軍備生產。", effect: { combat: 0.25 } });
addEraBuilding("printingHouse", { name: "印刷所", width: 210, height: 155, cost: { wood: 360, stone: 180, gold: 500 }, buildTime: 10, eraRequired: 7, requiresTechs: ["printingPress"], description: "大量製作書籍與行政文件。", effect: { research: 0.22 } });
addEraBuilding("customsHouse", { name: "關卡／海關", width: 190, height: 150, cost: { wood: 280, stone: 280, gold: 520 }, buildTime: 9, eraRequired: 7, requiresTechs: ["bureaucracy"], description: "提高貿易收入與行政管理。", effect: { gold: 0.24, stability: 3 } });
addEraBuilding("navalPort", { name: "遠洋港", width: 280, height: 180, cost: { wood: 620, stone: 420, gold: 650 }, buildTime: 17, eraRequired: 7, requiresTechs: ["oceanicNavigation"], description: "支援遠洋貿易與探索。", effect: { gold: 0.26 } });

/* 工業 */
addEraBuilding("industrialFactory", { name: "工業工廠", width: 300, height: 220, cost: { food: 350, wood: 420, stone: 500, gold: 1000, iron: 800 }, buildTime: 18, eraRequired: 8, requiresTechs: ["mechanizedProduction"], description: "大規模機械化生產。", effect: { build: 0.30, gold: 0.18 } });
addEraBuilding("steelMill", { name: "鋼鐵廠", width: 300, height: 220, cost: { wood: 380, stone: 650, gold: 900, iron: 900 }, buildTime: 20, eraRequired: 8, requiresTechs: ["steelMaking"], description: "鋼鐵工業中心。", effect: { iron: 0.30, build: 0.16 } });
addEraBuilding("railStation", { name: "鐵路車站", width: 300, height: 170, cost: { wood: 480, stone: 500, gold: 1100, iron: 1200 }, buildTime: 19, eraRequired: 8, requiresTechs: ["railway"], description: "大幅提高長距離物流。", effect: { gold: 0.22, food: 0.08 } });
addEraBuilding("coalPowerPlant", { name: "煤炭發電站", width: 280, height: 210, cost: { wood: 420, stone: 600, gold: 1100, iron: 850 }, buildTime: 18, eraRequired: 8, requiresTechs: ["steamEngine"], description: "為工業城市提供能源。", effect: { build: 0.18 } });
addEraBuilding("technicalSchool", { name: "技術學校", width: 250, height: 190, cost: { food: 300, wood: 380, stone: 300, gold: 900 }, buildTime: 14, eraRequired: 8, requiresTechs: ["massEducation"], description: "培養現代技術人才。", effect: { research: 0.28 } });

/* 現代 */
addEraBuilding("powerPlant", { name: "現代發電廠", width: 300, height: 230, cost: { wood: 400, stone: 650, gold: 1400, iron: 1200 }, buildTime: 20, eraRequired: 9, requiresTechs: ["electricity"], description: "現代城市核心能源。", effect: { build: 0.28, gold: 0.20 } });
addEraBuilding("modernUniversity", { name: "現代大學", width: 300, height: 220, cost: { food: 500, wood: 450, stone: 500, gold: 1500 }, buildTime: 18, eraRequired: 9, requiresTechs: ["modernState", "electricity"], description: "現代科研與教育中心。", effect: { research: 0.45 } });
addEraBuilding("hospital", { name: "醫院", width: 260, height: 200, cost: { food: 450, wood: 420, stone: 350, gold: 1300 }, buildTime: 16, eraRequired: 9, requiresTechs: ["medicine"], description: "提高人口健康與穩定。", effect: { stability: 15 } });
addEraBuilding("modernFactory", { name: "現代工廠", width: 320, height: 230, cost: { wood: 500, stone: 600, gold: 1800, iron: 1500 }, buildTime: 22, eraRequired: 9, requiresTechs: ["massProduction"], description: "現代大規模生產中心。", effect: { build: 0.40, gold: 0.25 } });
addEraBuilding("airport", { name: "機場", width: 340, height: 210, cost: { wood: 620, stone: 800, gold: 2200, iron: 1700 }, buildTime: 24, eraRequired: 9, requiresTechs: ["aviation"], description: "支援航空運輸。", effect: { gold: 0.28 } });

/* 未來 */
addEraBuilding("futureResearchCenter", { name: "未來研究中心", width: 340, height: 250, cost: { food: 700, wood: 500, stone: 700, gold: 2800, iron: 2200 }, buildTime: 28, eraRequired: 10, requiresTechs: ["computing"], description: "未來科技總研究中心。", effect: { research: 0.55 } });
addEraBuilding("dataCenter", { name: "資料中心", width: 300, height: 220, cost: { wood: 450, stone: 500, gold: 2600, iron: 1900 }, buildTime: 22, eraRequired: 10, requiresTechs: ["computing"], description: "高速資訊處理核心。", effect: { research: 0.35, gold: 0.15 } });
addEraBuilding("roboticsLab", { name: "機器人實驗室", width: 300, height: 230, cost: { food: 500, wood: 420, stone: 520, gold: 3000, iron: 2000 }, buildTime: 25, eraRequired: 10, requiresTechs: ["robotics"], description: "自動化與機器人研究。", effect: { build: 0.45, research: 0.20 } });
addEraBuilding("fusionPlant", { name: "聚變能源站", width: 360, height: 280, cost: { stone: 900, gold: 3600, iron: 2600 }, buildTime: 32, eraRequired: 10, requiresTechs: ["fusionPower"], description: "高密度未來能源。", effect: { gold: 0.35, research: 0.22 } });
addEraBuilding("spaceCenter", { name: "太空中心", width: 400, height: 300, cost: { food: 800, wood: 400, stone: 1300, gold: 4500, iron: 3000 }, buildTime: 38, eraRequired: 10, requiresTechs: ["spaceIndustry"], description: "文明邁入太空時代的象徵。", effect: { research: 0.35, gold: 0.35 } });

/* ---------------------------------------------------------------
   EXISTING CONTENT ERA LOCKS
---------------------------------------------------------------- */

const EXISTING_TECH_ERAS20 = {
    agriculture: 1,
    improvedFarming: 1,
    forestry: 1,
    mining: 1,
    metallurgy: 2,
    workshop: 2,
    militaryTraining: 1,
    infantryEquipment: 4,
    artillery: 5,
    logistics: 5,
    mobilityDoctrine: 6,
    firepowerDoctrine: 7,
    researchInstitute: 5
};

for (const [key, era] of Object.entries(EXISTING_TECH_ERAS20)) {
    if (TECHS[key]) TECHS[key].eraRequired = era;
}

const EXISTING_BUILDING_ERAS20 = {
    house: 0,
    lumberCamp: 1,
    miningCamp: 1,
    barracks: 1,
    farm: 1,
    workshop: 2,
    researchInstitute: 5,
    market: 3,
    watchTower: 3,
    supplyDepot: 5,
    factory: 8
};

for (const [key, era] of Object.entries(EXISTING_BUILDING_ERAS20)) {
    if (BUILDINGS[key]) BUILDINGS[key].eraRequired = era;
}

/* ---------------------------------------------------------------
   ERA HELPERS
---------------------------------------------------------------- */

function currentEraIndex20() {
    return clamp(Number(player.civilization?.eraIndex || 0), 0, ERA20.length - 1);
}

function currentEra20() {
    return ERA20[currentEraIndex20()];
}

function techEra20(key) {
    return Number(TECHS[key]?.eraRequired || 0);
}

function buildingEra20(key) {
    return Number(BUILDINGS[key]?.eraRequired || 0);
}

function isTechAvailable20(key) {
    const data = TECHS[key];
    if (!data) return false;
    if (currentEraIndex20() < techEra20(key)) return false;
    return data.requires.every(req => hasTech(req));
}

function isBuildingAvailable20(key) {
    const data = BUILDINGS[key];
    if (!data) return false;
    if (currentEraIndex20() < buildingEra20(key)) return false;
    return (data.requiresTechs || []).every(hasTech);
}

function eraTechKeys20(index) {
    return Object.keys(TECHS).filter(key => techEra20(key) === index);
}

function eraBuildingKeys20(index) {
    return Object.keys(BUILDINGS).filter(key => buildingEra20(key) === index);
}

function eraRequirementStatus20(index) {
    const requirements = CIVILIZATION_ERAS[index]?.requirements || [];
    return requirements.map(r => ({ label: r.label, ok: !!r.check() }));
}

function canAdvanceEra20() {
    const next = currentEraIndex20() + 1;
    if (next >= ERA20.length) return false;
    return (CIVILIZATION_ERAS[next].requirements || []).every(r => r.check());
}

function advanceEra20() {
    const current = currentEraIndex20();
    const next = current + 1;
    if (next >= ERA20.length) return;

    const failed = eraRequirementStatus20(next).filter(r => !r.ok);
    if (failed.length) {
        showMessage(`尚缺：${failed[0].label}`);
        return;
    }

    player.civilization.eraIndex = next;
    recordBreakthroughOnce(ERA20[next].breakthrough, ERA20[next].breakthrough);
    recordHistory(`文明進入${ERA20[next].name}`);
    player.nation.legitimacy = clamp((player.nation.legitimacy || 0) + 5, 0, 100);
    player.stability = clamp((player.stability || 0) + 4, 0, 100);
    state.eraNotice = 5;
    showMessage(`文明進化：${ERA20[next].name}`);
}

/* 保留舊函式名稱給其他 UI 使用，但導向新版時代系統。 */
advanceCivilizationEra = advanceEra20;
canAdvanceCivilizationEra = canAdvanceEra20;

/* ---------------------------------------------------------------
   TECHNOLOGY GATING
---------------------------------------------------------------- */

const oldUpdateUnlockedTechs20 = updateUnlockedTechs;
updateUnlockedTechs = function() {
    techState.unlocked.clear();
    for (const key of Object.keys(TECHS)) {
        const data = TECHS[key];
        if (hasTech(key)) continue;
        if (currentEraIndex20() < techEra20(key)) continue;
        if (!data.requires.every(req => hasTech(req))) continue;
        techState.unlocked.add(key);
    }
};

const oldStartResearch20 = startResearch;
startResearch = function(key) {
    if (!TECHS[key]) return;
    if (currentEraIndex20() < techEra20(key)) {
        showMessage(`需要進入「${ERA20[techEra20(key)].name}」`);
        return;
    }
    return oldStartResearch20(key);
};

/* 完成科技時記錄突破。 */
const oldUpdateResearch20 = updateResearch;
updateResearch = function(dt) {
    const before = state.currentResearch;
    oldUpdateResearch20(dt);
    if (before && hasTech(before)) {
        const data = TECHS[before];
        if (data?.breakthrough) {
            recordBreakthroughOnce(data.breakthrough, data.breakthrough);
        }
    }
};

/* ---------------------------------------------------------------
   BUILDING GATING
---------------------------------------------------------------- */

const oldStartBuilding20 = startBuilding;
startBuilding = function(type) {
    if (!BUILDINGS[type]) return;
    if (currentEraIndex20() < buildingEra20(type)) {
        showMessage(`需要進入「${ERA20[buildingEra20(type)].name}」`);
        return;
    }
    const reqs = BUILDINGS[type].requiresTechs || [];
    const missing = reqs.find(t => !hasTech(t));
    if (missing) {
        showMessage(`需要科技：${TECHS[missing]?.name || missing}`);
        return;
    }
    return oldStartBuilding20(type);
};

/* ---------------------------------------------------------------
   GENERIC TECHNOLOGY EFFECTS
---------------------------------------------------------------- */

function getEraTechEffect20(field) {
    let total = 0;
    for (const key of techState.researched) {
        total += Number(TECHS[key]?.effect?.[field] || 0);
    }
    return total;
}

const oldGatherMultiplier20 = gatherMultiplier;
gatherMultiplier = function(resource) {
    let result = oldGatherMultiplier20(resource);
    if (resource?.type === "forest") result *= 1 + getEraTechEffect20("wood");
    if (resource?.type === "stone") result *= 1 + getEraTechEffect20("stone");
    if (resource?.type === "gold") result *= 1 + getEraTechEffect20("gold");
    if (resource?.type === "food") result *= 1 + getEraTechEffect20("food");
    if (resource?.type === "iron") result *= 1 + getEraTechEffect20("iron");
    return result;
};

/* ---------------------------------------------------------------
   ERA CONTENT UI
---------------------------------------------------------------- */

function eraCatalogRect20() {
    return {
        x: 24,
        y: 74,
        width: Math.min(980, screenWidth - 48),
        height: Math.min(650, screenHeight - 170)
    };
}

function drawEraCatalog20() {
    if (!state.eraCatalogOpen) return;

    const p = eraCatalogRect20();
    drawPanel(p.x, p.y, p.width, p.height);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 24px Arial";
    ctx.fillText("文明時代總覽", p.x + 18, p.y + 34);

    ctx.fillStyle = currentEra20().color;
    ctx.font = "bold 16px Arial";
    ctx.fillText(`目前：${currentEra20().name}`, p.x + 18, p.y + 60);

    /* 時代清單 */
    const listX = p.x + 16;
    const listY = p.y + 80;
    const listW = 190;
    const rowH = 40;

    for (let i = 0; i < ERA20.length; i++) {
        const y = listY + i * rowH;
        if (y + rowH > p.y + p.height - 18) break;

        const isCurrent = i === currentEraIndex20();
        const isPreview = i === state.eraCatalogIndex;
        const locked = i > currentEraIndex20();

        ctx.fillStyle = isPreview ? "#46515a" : isCurrent ? "#384b38" : "#24282b";
        ctx.fillRect(listX, y, listW, rowH - 4);
        ctx.strokeStyle = isPreview ? "#d9c958" : isCurrent ? "#70ce73" : "#575d61";
        ctx.strokeRect(listX, y, listW, rowH - 4);

        ctx.fillStyle = locked ? "#92979a" : "#fff";
        ctx.font = "bold 12px Arial";
        ctx.fillText(`${i + 1}. ${ERA20[i].short}`, listX + 9, y + 17);
        ctx.font = "10px Arial";
        ctx.fillStyle = "#aeb5b8";
        ctx.fillText(locked ? "尚未進入" : "已可使用／已完成", listX + 9, y + 32);
    }

    const preview = clamp(state.eraCatalogIndex || currentEraIndex20(), 0, ERA20.length - 1);
    const era = ERA20[preview];
    const rightX = p.x + 228;
    const rightW = p.width - 246;

    ctx.fillStyle = era.color;
    ctx.font = "bold 20px Arial";
    ctx.fillText(`${era.name}`, rightX, p.y + 40);

    ctx.fillStyle = "#c0c6c9";
    ctx.font = "12px Arial";
    ctx.fillText(era.description, rightX, p.y + 62);

    /* 下一時代條件 */
    if (preview === currentEraIndex20() + 1 && preview < ERA20.length) {
        const statuses = eraRequirementStatus20(preview);
        let yy = p.y + 94;
        ctx.font = "11px Arial";
        ctx.fillStyle = "#e1d054";
        ctx.fillText("進化條件", rightX, yy);
        yy += 20;
        for (const r of statuses) {
            ctx.fillStyle = r.ok ? "#76d37d" : "#e07872";
            ctx.fillText(`${r.ok ? "✓" : "×"} ${r.label}`, rightX, yy);
            yy += 19;
        }
        const bx = rightX;
        const by = p.y + p.height - 54;
        const can = canAdvanceEra20();
        ctx.fillStyle = can ? "#4f744d" : "#292d30";
        ctx.fillRect(bx, by, 205, 34);
        ctx.strokeStyle = can ? "#91dd8b" : "#555";
        ctx.strokeRect(bx, by, 205, 34);
        ctx.fillStyle = can ? "#fff" : "#858b8f";
        ctx.font = "bold 12px Arial";
        ctx.fillText(can ? `進入 ${era.short}` : "條件尚未完成", bx + 52, by + 22);
    } else {
        ctx.fillStyle = "#b8bec1";
        ctx.font = "11px Arial";
        ctx.fillText(
            preview <= currentEraIndex20() ? "這個時代的內容已經可使用。" : "這個時代可以預覽，但必須先完成前置時代。",
            rightX,
            p.y + 96
        );
    }

    /* 科技清單 */
    const techX = rightX;
    const techY = p.y + 126;
    const colW = Math.floor((rightW - 14) / 2);
    const techKeys = eraTechKeys20(preview);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Arial";
    ctx.fillText(`科技（${techKeys.length}）`, techX, techY);

    for (let i = 0; i < techKeys.length; i++) {
        const key = techKeys[i];
        const data = TECHS[key];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = techX + col * colW;
        const y = techY + 14 + row * 54;
        if (y + 48 > p.y + p.height - 82) continue;

        const researched = hasTech(key);
        const available = isTechAvailable20(key);
        const color = researched ? "#315f38" : available ? "#303c53" : "#27292b";

        ctx.fillStyle = color;
        ctx.fillRect(x, y, colW - 7, 48);
        ctx.strokeStyle = researched ? "#79d781" : available ? "#7595c6" : "#51565a";
        ctx.strokeRect(x, y, colW - 7, 48);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 11px Arial";
        ctx.fillText(data.name, x + 7, y + 15);
        ctx.font = "9px Arial";
        ctx.fillStyle = "#b6bdc0";
        ctx.fillText(data.description.slice(0, 32), x + 7, y + 29);
        ctx.fillStyle = researched ? "#83dc8a" : available ? "#98b6e8" : "#777";
        ctx.fillText(researched ? "已研究" : available ? "點擊研究" : "需要前置科技／時代", x + 7, y + 42);
    }

    /* 建築清單 */
    const buildY = Math.min(p.y + p.height - 202, techY + 54 + Math.ceil(techKeys.length / 2) * 54);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Arial";
    ctx.fillText(`建築（${eraBuildingKeys20(preview).length}）`, techX, buildY);

    const buildKeys = eraBuildingKeys20(preview);
    for (let i = 0; i < buildKeys.length; i++) {
        const key = buildKeys[i];
        const data = BUILDINGS[key];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = techX + col * colW;
        const y = buildY + 14 + row * 42;
        if (y + 36 > p.y + p.height - 18) continue;

        const available = isBuildingAvailable20(key);
        ctx.fillStyle = available ? "#303030" : "#242424";
        ctx.fillRect(x, y, colW - 7, 36);
        ctx.strokeStyle = available ? "#777" : "#4d5052";
        ctx.strokeRect(x, y, colW - 7, 36);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px Arial";
        ctx.fillText(data.name, x + 7, y + 14);
        ctx.font = "9px Arial";
        ctx.fillStyle = available ? "#91d691" : "#767b7e";
        const cost = data.cost || {};
        ctx.fillText(`木${cost.wood || 0} 石${cost.stone || 0} 金${cost.gold || 0} 鐵${cost.iron || 0}`, x + 7, y + 27);
    }

    ctx.fillStyle = "#9da4a8";
    ctx.font = "11px Arial";
    ctx.fillText("左鍵：選時代／研究科技／目前時代建造 · Esc：關閉", p.x + 18, p.y + p.height - 12);
}

function handleEraCatalogClick20(mx, my) {
    if (!state.eraCatalogOpen) return false;

    const p = eraCatalogRect20();
    if (mx < p.x || mx > p.x + p.width || my < p.y || my > p.y + p.height) return true;

    const listX = p.x + 16;
    const listY = p.y + 80;
    const listW = 190;
    const rowH = 40;

    for (let i = 0; i < ERA20.length; i++) {
        const y = listY + i * rowH;
        if (mx >= listX && mx <= listX + listW && my >= y && my <= y + rowH - 4) {
            state.eraCatalogIndex = i;
            return true;
        }
    }

    const preview = clamp(state.eraCatalogIndex || 0, 0, ERA20.length - 1);
    const rightX = p.x + 228;
    const rightW = p.width - 246;
    const techX = rightX;
    const techY = p.y + 126;
    const colW = Math.floor((rightW - 14) / 2);
    const techKeys = eraTechKeys20(preview);

    for (let i = 0; i < techKeys.length; i++) {
        const key = techKeys[i];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = techX + col * colW;
        const y = techY + 14 + row * 54;
        if (mx >= x && mx <= x + colW - 7 && my >= y && my <= y + 48) {
            if (preview > currentEraIndex20()) {
                showMessage(`需要進入「${ERA20[preview].name}」`);
                return true;
            }
            startResearch(key);
            return true;
        }
    }

    const buildY = Math.min(p.y + p.height - 202, techY + 54 + Math.ceil(techKeys.length / 2) * 54);
    const buildKeys = eraBuildingKeys20(preview);
    for (let i = 0; i < buildKeys.length; i++) {
        const key = buildKeys[i];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = techX + col * colW;
        const y = buildY + 14 + row * 42;
        if (mx >= x && mx <= x + colW - 7 && my >= y && my <= y + 36) {
            if (preview > currentEraIndex20()) {
                showMessage(`需要進入「${ERA20[preview].name}」`);
                return true;
            }
            startBuilding(key);
            state.eraCatalogOpen = false;
            return true;
        }
    }

    if (preview === currentEraIndex20() + 1 && canAdvanceEra20()) {
        const bx = rightX;
        const by = p.y + p.height - 54;
        if (mx >= bx && mx <= bx + 205 && my >= by && my <= by + 34) {
            advanceEra20();
            return true;
        }
    }

    return true;
}

/* ---------------------------------------------------------------
   TOP BUTTON + RENDER HOOK
---------------------------------------------------------------- */

const oldDrawTopUI20 = drawTopUI;
drawTopUI = function() {
    oldDrawTopUI20();

    const x = 206;
    const y = 120;
    ctx.fillStyle = state.eraCatalogOpen ? "#596b46" : "#30363a";
    ctx.fillRect(x, y, 104, 24);
    ctx.strokeStyle = state.eraCatalogOpen ? "#e1d150" : "#60676a";
    ctx.strokeRect(x, y, 104, 24);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px Arial";
    ctx.fillText(`時代內容 [B]`, x + 20, y + 16);
};

const oldRender20 = render;
render = function() {
    oldRender20();
    drawEraCatalog20();
};

/* ---------------------------------------------------------------
   INPUT HOOKS
---------------------------------------------------------------- */

const oldHandleLeftRelease20 = handleLeftRelease;
handleLeftRelease = function() {
    if (state.eraCatalogOpen) {
        handleEraCatalogClick20(input.mouse.x, input.mouse.y);
        return;
    }
    return oldHandleLeftRelease20();
};

window.addEventListener("keydown", event => {
    const key = event.key.toLowerCase();

    if (event.key === "Escape" && state.eraCatalogOpen) {
        state.eraCatalogOpen = false;
        return;
    }

    if (key === "b" && !event.ctrlKey && !event.altKey) {
        state.eraCatalogOpen = !state.eraCatalogOpen;
        state.eraCatalogIndex = currentEraIndex20();
        state.techOpen = false;
        state.buildingType = null;
        return;
    }
});

/* ---------------------------------------------------------------
   ERA AWARENESS / BREAKTHROUGHS
---------------------------------------------------------------- */

function updateEraBreakthroughs20() {
    for (const key of techState.researched) {
        const tech = TECHS[key];
        if (tech?.breakthrough) {
            recordBreakthroughOnce(tech.breakthrough, tech.breakthrough);
        }
    }

    const idx = currentEraIndex20();
    if (idx >= 1) recordBreakthroughOnce("農業革命", "農業革命");
    if (idx >= 3) recordBreakthroughOnce("青銅冶煉", "青銅冶煉");
    if (idx >= 4) recordBreakthroughOnce("鐵器革命", "鐵器革命");
    if (idx >= 8) recordBreakthroughOnce("工業革命", "工業革命");
    if (idx >= 9) recordBreakthroughOnce("現代國家", "現代國家");
    if (idx >= 10) recordBreakthroughOnce("未來科技", "未來科技");
}

const oldUpdate20 = update;
update = function(dt) {
    oldUpdate20(dt);
    updateEraBreakthroughs20();
    updateUnlockedTechs();
};

/* ---------------------------------------------------------------
   EXISTING CIVILIZATION PANEL ADDITION
---------------------------------------------------------------- */

const oldDrawNationPanel20 = drawNationPanel;
drawNationPanel = function() {
    oldDrawNationPanel20();
    if (!player.civilization) return;

    const p = nationPanelRect();
    ctx.fillStyle = currentEra20().color;
    ctx.fillRect(p.x + 20, p.y + 270, 120, 24);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px Arial";
    ctx.fillText(`時代：${currentEra20().short}`, p.x + 31, p.y + 286);

    ctx.fillStyle = "#aeb6ba";
    ctx.font = "10px Arial";
    ctx.fillText(`突破：${player.civilization.breakthroughs.length}`, p.x + 155, p.y + 286);
};

/* ---------------------------------------------------------------
   BACKWARD COMPATIBILITY NORMALIZATION
---------------------------------------------------------------- */

function normalizeV0920() {
    if (!player.civilization) player.civilization = {};

    player.civilization.eraIndex = clamp(
        Number.isFinite(player.civilization.eraIndex) ? player.civilization.eraIndex : 0,
        0,
        10
    );

    if (!Array.isArray(player.civilization.breakthroughs)) {
        player.civilization.breakthroughs = [];
    }

    if (hasTech("agriculture") && player.civilization.eraIndex === 0) {
        /* 舊存檔曾可能直接完成農業科技，允許自然映射到農業時代附近。 */
        player.civilization.eraIndex = 1;
    }

    if (hasTech("metallurgy") && hasTech("workshop") && player.civilization.eraIndex < 2) {
        player.civilization.eraIndex = 2;
    }

    if (hasTech("ironSmelting") && player.civilization.eraIndex < 4) {
        player.civilization.eraIndex = 4;
    }
}

normalizeV0920();
updateUnlockedTechs();
recordHistory("文明內容擴充至 V0.9.20：完整時代科技與建築");

/* ================================================================
   V0.9.20 END
================================================================ */


/* ================================================================
   V0.9.22 — TECHNOLOGY SPECIALIZATION LAYER

   這一層重新定義原本 V0.8 科技樹的用途：
   ・時代決定科技上限
   ・科技決定同一時代內的發展方向
   ・原始科技不刪除，改成六條發展分支
   ・科技可標示「分支／時代／用途／效果」
   ・不改動自由移動與自動索敵
================================================================ */

GAME.VERSION = "0.9.22";

const TECH_BRANCHES22 = {
    survival: { name: "🌾 生存與農業", short: "生存", color: "#b99a55" },
    resources: { name: "⛏ 資源與冶金", short: "資源", color: "#8e9aa3" },
    industry: { name: "🔨 生產與工程", short: "生產", color: "#9b7657" },
    military: { name: "⚔ 軍事", short: "軍事", color: "#9d5757" },
    society: { name: "🏛 社會與行政", short: "社會", color: "#657aa0" },
    economy: { name: "💰 經濟與貿易", short: "經濟", color: "#a98b46" }
};

const ORIGINAL_TECH_META22 = {
    agriculture: { branch: "survival", role: "提高農業穩定與糧食產量" },
    improvedFarming: { branch: "survival", role: "讓農業進入更高效率階段" },
    forestry: { branch: "resources", role: "提高森林與木材利用" },
    mining: { branch: "resources", role: "提高石材、金屬與礦產利用" },
    metallurgy: { branch: "resources", role: "把礦產轉換成更高級材料" },
    workshop: { branch: "industry", role: "建立進階工具與工程能力" },
    militaryTraining: { branch: "military", role: "提高軍事訓練與動員效率" },
    infantryEquipment: { branch: "military", role: "解鎖規模化步兵裝備" },
    artillery: { branch: "military", role: "解鎖遠程火力與攻城能力" },
    logistics: { branch: "industry", role: "提高軍隊運輸與補給效率" },
    mobilityDoctrine: { branch: "military", role: "提高部隊機動能力" },
    firepowerDoctrine: { branch: "military", role: "提高軍事火力" },
    researchInstitute: { branch: "society", role: "提升科研容量" }
};

for (const [key, meta] of Object.entries(ORIGINAL_TECH_META22)) {
    if (!TECHS[key]) continue;
    TECHS[key].branch = meta.branch;
    TECHS[key].role = meta.role;
}

const TECH_SPECIALIZATIONS22 = [
    ["cropRotation22", { name: "輪作制度", eraRequired: 1, branch: "survival", requires: ["agriculture"], cost: { food: 140, wood: 70 }, time: 24, description: "讓土地恢復更穩定，降低長期耕作造成的肥力下降。", role: "農業長期發展" }],
    ["animalBreeding22", { name: "牲畜選育", eraRequired: 1, branch: "survival", requires: ["agriculture"], cost: { food: 150, wood: 60 }, time: 22, description: "提高牲畜繁殖與畜牧產出。", role: "畜牧" }],
    ["foodPreservation22", { name: "糧食保存", eraRequired: 1, branch: "survival", requires: ["agriculture"], cost: { food: 120, wood: 90, stone: 40 }, time: 22, description: "降低糧食損耗，提高儲備安全。", role: "糧食安全" }],
    ["advancedForestry22", { name: "林地管理", eraRequired: 2, branch: "resources", requires: ["forestry"], cost: { food: 160, wood: 180, stone: 40 }, time: 26, description: "改善森林再生與木材產量。", role: "森林管理" }],
    ["prospecting22", { name: "礦脈探勘", eraRequired: 2, branch: "resources", requires: ["mining"], cost: { food: 160, wood: 100, stone: 120, gold: 80 }, time: 28, description: "提高發現與利用金屬資源的能力。", role: "礦業" }],
    ["standardTools22", { name: "標準化工具", eraRequired: 2, branch: "industry", requires: ["workshop"], cost: { food: 170, wood: 160, stone: 80, gold: 100 }, time: 30, description: "提高所有基礎生產建築的工作效率。", role: "生產效率" }],
    ["buildingEngineering22", { name: "建築工程", eraRequired: 2, branch: "industry", requires: ["workshop", "metallurgy"], cost: { food: 200, wood: 200, stone: 180, gold: 120 }, time: 34, description: "降低大型建築的建造負擔並提升升級效率。", role: "工程" }],
    ["professionalArmy22", { name: "專業軍隊", eraRequired: 3, branch: "military", requires: ["militaryTraining"], cost: { food: 220, wood: 150, stone: 100, gold: 220 }, time: 34, description: "提高戰鬥單位的訓練效率與作戰穩定。", role: "軍事組織" }],
    ["fortifiedWeapons22", { name: "武器標準化", eraRequired: 4, branch: "military", requires: ["infantryEquipment"], cost: { food: 240, wood: 170, stone: 150, gold: 260, iron: 180 }, time: 42, description: "提升步兵裝備的品質與武器生產效率。", role: "裝備" }],
    ["administrativeRecords22", { name: "行政記錄", eraRequired: 2, branch: "society", requires: [], cost: { food: 170, wood: 90, gold: 120 }, time: 28, description: "建立更可靠的人口、土地與稅收記錄。", role: "行政" }],
    ["legalTradition22", { name: "成文制度", eraRequired: 3, branch: "society", requires: ["administrativeRecords22"], cost: { food: 220, wood: 80, gold: 180 }, time: 34, description: "提高國家穩定與行政效率。", role: "法律" }],
    ["merchantGuilds22", { name: "商業行會", eraRequired: 3, branch: "economy", requires: ["currency"], cost: { food: 200, wood: 150, gold: 220 }, time: 32, description: "提高市場交易效率與商業收入。", role: "商業" }],
    ["longDistanceTrade22", { name: "長途貿易", eraRequired: 4, branch: "economy", requires: ["merchantGuilds22", "currency"], cost: { food: 260, wood: 180, stone: 80, gold: 300 }, time: 40, description: "讓商隊能承擔更遠距離的貿易活動。", role: "貿易網" }]
];

for (const [key, data] of TECH_SPECIALIZATIONS22) {
    if (!TECHS[key]) {
        TECHS[key] = {
            name: data.name,
            cost: Object.assign({ food: 0, wood: 0, stone: 0, gold: 0, iron: 0 }, data.cost || {}),
            time: data.time || 20,
            requires: data.requires || [],
            eraRequired: data.eraRequired || 0,
            description: data.description || "文明科技突破",
            effect: data.effect || {},
            branch: data.branch,
            role: data.role || "專業化科技"
        };
    }
}

/* 把舊科技補成真正的分支：同時保留原本前置條件，不強迫玩家只能走單一路線。 */
if (TECHS.improvedFarming) TECHS.improvedFarming.branch = "survival";
if (TECHS.forestry) TECHS.forestry.branch = "resources";
if (TECHS.mining) TECHS.mining.branch = "resources";
if (TECHS.metallurgy) TECHS.metallurgy.branch = "resources";
if (TECHS.workshop) TECHS.workshop.branch = "industry";
if (TECHS.militaryTraining) TECHS.militaryTraining.branch = "military";
if (TECHS.infantryEquipment) TECHS.infantryEquipment.branch = "military";
if (TECHS.artillery) TECHS.artillery.branch = "military";
if (TECHS.logistics) TECHS.logistics.branch = "industry";
if (TECHS.mobilityDoctrine) TECHS.mobilityDoctrine.branch = "military";
if (TECHS.firepowerDoctrine) TECHS.firepowerDoctrine.branch = "military";
if (TECHS.researchInstitute) TECHS.researchInstitute.branch = "society";

function techBranch22(key) {
    return TECHS[key]?.branch || "society";
}

function techBranchName22(key) {
    return TECH_BRANCHES22[techBranch22(key)]?.name || "未分類";
}

function techEraText22(key) {
    const era = Number(TECHS[key]?.eraRequired || 0);
    return CIVILIZATION_ERAS[era]?.short || `時代 ${era + 1}`;
}

/* 科技效果統一成「分支加成」，避免原本很多科技只有描述沒有真正效果。 */
const BRANCH_EFFECT_FIELDS22 = ["food", "wood", "stone", "gold", "iron", "build", "research", "combat", "stability"];
function getBranchEffect22(field) {
    let total = 0;
    for (const key of techState.researched) {
        const data = TECHS[key];
        if (!data) continue;
        total += Number(data.effect?.[field] || 0);
    }
    return total;
}

/* 研究 UI：在原科技節點上加上分支／時代資訊，不改原本點擊邏輯。 */
const oldDrawTechTree22 = drawTechTree;
drawTechTree = function() {
    oldDrawTechTree22();
    if (!state.techOpen) return;

    const p = techPanelRect();
    ctx.fillStyle = "rgba(8,8,8,0.86)";
    ctx.fillRect(p.x + 18, p.y + p.height - 62, p.width - 36, 42);
    ctx.font = "10px Arial";
    let bx = p.x + 28;
    for (const [key, branch] of Object.entries(TECH_BRANCHES22)) {
        ctx.fillStyle = branch.color;
        ctx.fillRect(bx, p.y + p.height - 49, 10, 10);
        ctx.fillStyle = "#ddd";
        ctx.fillText(branch.short, bx + 14, p.y + p.height - 40);
        bx += 105;
    }
};

/* 科技完成後的分支統計。 */
function branchTechCount22(branch) {
    let n = 0;
    for (const key of techState.researched) if (techBranch22(key) === branch) n++;
    return n;
}

function scienceSummary22() {
    return Object.keys(TECH_BRANCHES22).map(branch => ({
        branch,
        name: TECH_BRANCHES22[branch].name,
        count: branchTechCount22(branch)
    }));
}

/* 國家面板右側顯示最強科技分支。 */
const oldDrawNationPanel22 = drawNationPanel;
drawNationPanel = function() {
    oldDrawNationPanel22();
    if (!player.nation) return;
    const summary = scienceSummary22().sort((a, b) => b.count - a.count);
    const best = summary[0];
    const p = nationPanelRect();
    ctx.fillStyle = "#c7cbd0";
    ctx.font = "10px Arial";
    ctx.fillText(`主要科研方向：${best?.name || "尚未形成"}`, p.x + 20, p.y + 300);
    ctx.fillText(`已完成科技：${techState.researched.size}`, p.x + 20, p.y + 316);
};

/* 讓舊存檔中的新科技欄位安全補齊。 */
function normalizeTechnology22() {
    for (const key of Object.keys(TECHS)) {
        if (!TECHS[key].branch) TECHS[key].branch = "society";
        if (!Array.isArray(TECHS[key].requires)) TECHS[key].requires = [];
        if (!TECHS[key].cost) TECHS[key].cost = { food: 0, wood: 0, stone: 0, gold: 0, iron: 0 };
        for (const resource of ["food", "wood", "stone", "gold", "iron"]) {
            if (typeof TECHS[key].cost[resource] !== "number") TECHS[key].cost[resource] = 0;
        }
    }
}
normalizeTechnology22();
updateUnlockedTechs();

/* 防止時代要求檢查不存在的科技時把整套時代系統卡死。 */
for (const era of CIVILIZATION_ERAS) {
    for (const req of era.requirements || []) {
        const raw = req.check;
        if (typeof raw !== "function") req.check = () => true;
    }
}

recordHistory("V0.9.22：科技樹正式分化為六大發展分支");

/* ================================================================
   START
================================================================ */

resizeCanvas();
initializeGame();
updateMouseWorld();

let lastTime = performance.now();

function gameLoop(currentTime) {
    const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
    lastTime = currentTime;
    update(dt * state.gameSpeed);
    render();
    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
/* ================================================================
   V0.9.23 — DEEP ERA TECH TREE + CUSTOM FLAG

   ・移除舊版「時代：部落／下一階段／突破」浮動徽章，避免擋住其他頁面
   ・每個時代新增 120 個長期科技（12 分支 × 10 層）
   ・科技研究時間拉長，越後期越久
   ・科技有真實分支效果，並沿著同分支逐層解鎖
   ・時代內容頁加入科技分頁，120+ 科技全部可以看、可以研究
   ・國家面板新增「上傳國旗」：圖片會縮放後存進存檔/localStorage
   ・不改自由移動與自動索敵
================================================================ */

GAME.VERSION = "0.9.23";

/* ---------------------------------------------------------------
   1. 拔掉會擋 UI 的舊時代浮動徽章
---------------------------------------------------------------- */
if (typeof CIV19_drawEraBadge === "function") {
    CIV19_drawEraBadge = function() {};
}

/* ---------------------------------------------------------------
   2. 每個時代 120 科技：12 分支 × 10 層
---------------------------------------------------------------- */
const MEGA_TECH_BRANCHES23 = [
    { key: "food", name: "糧食與農業", fields: ["food"], topics: ["土地利用", "種植技術", "灌溉管理", "作物改良", "糧食保存", "農具革新", "農場制度", "農業管理", "高效農業", "糧食體系"] },
    { key: "wood", name: "森林與材料", fields: ["wood", "build"], topics: ["伐木技術", "林地管理", "木材加工", "材料分級", "木工標準", "森林培育", "複合材料", "材料工程", "先進材料", "材料體系"] },
    { key: "mining", name: "採礦與石材", fields: ["stone", "iron"], topics: ["礦脈辨識", "採石方法", "坑道工程", "礦石分選", "深層採礦", "礦山管理", "精煉流程", "大型礦業", "高效採礦", "礦產體系"] },
    { key: "industry", name: "工藝與工程", fields: ["build", "wood"], topics: ["工具製作", "工坊制度", "結構工程", "標準零件", "機械原理", "工程管理", "大型工程", "精密製造", "自動化工程", "工程體系"] },
    { key: "trade", name: "貿易與市場", fields: ["gold"], topics: ["物物交換", "集市制度", "商隊管理", "價格制度", "契約交易", "金融管理", "遠距貿易", "市場網路", "全球市場", "經濟體系"] },
    { key: "administration", name: "行政與法律", fields: ["stability", "gold"], topics: ["部落規約", "人口記錄", "土地登記", "稅收制度", "法律編纂", "官署管理", "行政標準", "公共管理", "制度改革", "治理體系"] },
    { key: "science", name: "知識與科研", fields: ["research"], topics: ["觀察方法", "記錄技術", "計算方法", "實驗制度", "學術交流", "研究方法", "科研組織", "大型研究", "跨學科研究", "科研體系"] },
    { key: "military", name: "軍事與戰術", fields: ["combat"], topics: ["戰鬥訓練", "武器操練", "隊形戰術", "軍械管理", "防禦戰術", "後勤制度", "聯合作戰", "戰場指揮", "高級戰術", "軍事體系"] },
    { key: "logistics", name: "運輸與後勤", fields: ["gold", "food"], topics: ["搬運方法", "道路維護", "補給站", "車隊管理", "倉儲制度", "運輸網", "大型物流", "快速運輸", "智慧物流", "物流體系"] },
    { key: "society", name: "人口與社會", fields: ["food", "stability"], topics: ["家庭制度", "人口統計", "社區治理", "教育制度", "城市管理", "公共服務", "人口規劃", "社會福利", "高密度城市", "社會體系"] },
    { key: "culture", name: "文化與思想", fields: ["research", "stability"], topics: ["口述傳統", "符號系統", "文字傳播", "歷史記錄", "藝術制度", "思想交流", "公共文化", "文化教育", "全球交流", "文化體系"] },
    { key: "energy", name: "能源與生產力", fields: ["build", "iron"], topics: ["火源利用", "能源儲存", "動力機械", "能源轉換", "集中供能", "高效動力", "能源網路", "先進能源", "高密度能源", "能源體系"] }
];

const MEGA_TECH_SUFFIX23 = ["基礎", "改良", "成熟", "標準化", "專業化", "制度化", "規模化", "精密化", "先進化", "大成"];
const MEGA_TECH_EFFECT_BASE23 = {
    food: 0.0028,
    wood: 0.0028,
    stone: 0.0028,
    gold: 0.0025,
    iron: 0.0025,
    build: 0.0022,
    research: 0.0025,
    combat: 0.0022,
    stability: 0.18
};

function megaTechCost23(era, level, branchIndex) {
    const scale = 1 + era * 0.48 + level * 0.17;
    const wobble = 1 + (branchIndex % 4) * 0.07;
    return {
        food: Math.round(90 * scale * wobble),
        wood: Math.round((55 + branchIndex * 7) * scale),
        stone: Math.round((30 + (branchIndex % 5) * 14) * scale),
        gold: Math.round((25 + level * 8 + branchIndex * 5) * scale),
        iron: era >= 4 ? Math.round((12 + level * 5) * scale) : 0
    };
}

function megaTechTime23(era, level) {
    // 最短約 70 秒；最高階後期科技會超過 6 分鐘。
    return Math.round(70 + era * 22 + level * 28 + era * level * 3);
}

function megaTechEffect23(branch, level) {
    const effect = {};
    const strength = 1 + level * 0.11;
    for (const field of branch.fields) {
        effect[field] = Number((MEGA_TECH_EFFECT_BASE23[field] * strength).toFixed(4));
    }
    return effect;
}

const megaLastByBranch23 = {};
for (let era = 0; era < ERA20.length; era++) {
    const eraName = ERA20[era].short || ERA20[era].name;
    for (let bi = 0; bi < MEGA_TECH_BRANCHES23.length; bi++) {
        const branch = MEGA_TECH_BRANCHES23[bi];
        for (let level = 0; level < 10; level++) {
            const key = `mega23_${era}_${branch.key}_${level}`;
            const previousSameEra = level > 0 ? `mega23_${era}_${branch.key}_${level - 1}` : null;
            const previousEra = era > 0 ? megaLastByBranch23[branch.key] : null;
            const requires = previousSameEra ? [previousSameEra] : (previousEra ? [previousEra] : []);

            TECHS[key] = {
                name: `${eraName}・${branch.name} ${MEGA_TECH_SUFFIX23[level]} ${level + 1}`,
                cost: megaTechCost23(era, level, bi),
                time: megaTechTime23(era, level),
                requires,
                eraRequired: era,
                description: `第 ${level + 1} 層的${branch.topics[level]}研究，長期提升文明的${branch.name}能力。`,
                breakthrough: null,
                effect: megaTechEffect23(branch, level),
                branch: branch.key,
                role: `${branch.name} · ${branch.topics[level]}`
            };
        }
        megaLastByBranch23[branch.key] = `mega23_${era}_${branch.key}_9`;
    }
}

/* ---------------------------------------------------------------
   3. 科技分頁 UI：每個時代至少 120 個，不再塞成一長條
---------------------------------------------------------------- */
if (typeof state.eraTechPage !== "number") state.eraTechPage = 0;

function eraTechPageSize23() { return 10; }

function clampEraTechPage23(index) {
    const keys = eraTechKeys20(index);
    const pages = Math.max(1, Math.ceil(keys.length / eraTechPageSize23()));
    state.eraTechPage = clamp(state.eraTechPage || 0, 0, pages - 1);
    return pages;
}

function drawEraCatalog23() {
    if (!state.eraCatalogOpen) return;

    const p = eraCatalogRect20();
    drawPanel(p.x, p.y, p.width, p.height);

    const preview = clamp(state.eraCatalogIndex || currentEraIndex20(), 0, ERA20.length - 1);
    const era = ERA20[preview];
    const techKeys = eraTechKeys20(preview);
    const pageSize = eraTechPageSize23();
    const pages = Math.max(1, Math.ceil(techKeys.length / pageSize));
    state.eraTechPage = clamp(state.eraTechPage || 0, 0, pages - 1);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 24px Arial";
    ctx.fillText("文明時代總覽", p.x + 18, p.y + 34);
    ctx.fillStyle = era.color;
    ctx.font = "bold 16px Arial";
    ctx.fillText(`目前：${currentEra20().name}`, p.x + 18, p.y + 60);

    const listX = p.x + 16;
    const listY = p.y + 80;
    const listW = 190;
    const rowH = 40;
    for (let i = 0; i < ERA20.length; i++) {
        const y = listY + i * rowH;
        if (y + rowH > p.y + p.height - 18) break;
        const isCurrent = i === currentEraIndex20();
        const isPreview = i === preview;
        const locked = i > currentEraIndex20();
        ctx.fillStyle = isPreview ? "#46515a" : isCurrent ? "#384b38" : "#24282b";
        ctx.fillRect(listX, y, listW, rowH - 4);
        ctx.strokeStyle = isPreview ? "#d9c958" : isCurrent ? "#70ce73" : "#575d61";
        ctx.strokeRect(listX, y, listW, rowH - 4);
        ctx.fillStyle = locked ? "#92979a" : "#fff";
        ctx.font = "bold 12px Arial";
        ctx.fillText(`${i + 1}. ${ERA20[i].short}`, listX + 9, y + 17);
        ctx.font = "10px Arial";
        ctx.fillStyle = "#aeb5b8";
        ctx.fillText(locked ? "尚未進入" : "已可使用／已完成", listX + 9, y + 32);
    }

    const rightX = p.x + 228;
    const rightW = p.width - 246;
    ctx.fillStyle = era.color;
    ctx.font = "bold 20px Arial";
    ctx.fillText(`${era.name}`, rightX, p.y + 40);
    ctx.fillStyle = "#c0c6c9";
    ctx.font = "12px Arial";
    ctx.fillText(era.description, rightX, p.y + 62);

    if (preview === currentEraIndex20() + 1 && preview < ERA20.length) {
        const statuses = eraRequirementStatus20(preview);
        let yy = p.y + 94;
        ctx.font = "11px Arial";
        ctx.fillStyle = "#e1d054";
        ctx.fillText("進化條件", rightX, yy);
        yy += 18;
        for (const r of statuses.slice(0, 5)) {
            ctx.fillStyle = r.ok ? "#76d37d" : "#e07872";
            ctx.fillText(`${r.ok ? "✓" : "×"} ${r.label}`, rightX, yy);
            yy += 17;
        }
    }

    const techTitleY = p.y + 132;
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Arial";
    ctx.fillText(`科技（${techKeys.length}） · 第 ${state.eraTechPage + 1}/${pages} 頁`, rightX, techTitleY);

    const prevX = rightX + rightW - 150;
    drawButton(prevX, techTitleY - 20, 62, 26, "‹ 上頁");
    drawButton(prevX + 68, techTitleY - 20, 62, 26, "下頁 ›");

    const start = state.eraTechPage * pageSize;
    const visible = techKeys.slice(start, start + pageSize);
    const colW = Math.floor((rightW - 14) / 2);
    const techY = techTitleY + 18;

    for (let i = 0; i < visible.length; i++) {
        const key = visible[i];
        const data = TECHS[key];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = rightX + col * colW;
        const y = techY + row * 48;
        const researched = hasTech(key);
        const available = isTechAvailable20(key);
        ctx.fillStyle = researched ? "#315f38" : available ? "#303c53" : "#27292b";
        ctx.fillRect(x, y, colW - 7, 42);
        ctx.strokeStyle = researched ? "#79d781" : available ? "#7595c6" : "#51565a";
        ctx.strokeRect(x, y, colW - 7, 42);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px Arial";
        ctx.fillText(data.name, x + 7, y + 14);
        ctx.font = "8px Arial";
        ctx.fillStyle = "#b6bdc0";
        ctx.fillText(data.description.slice(0, 30), x + 7, y + 27);
        ctx.fillStyle = researched ? "#83dc8a" : available ? "#98b6e8" : "#777";
        ctx.fillText(researched ? "已研究" : available ? `研究 ${data.time}s` : "需要前置科技／時代", x + 7, y + 38);
    }

    const buildY = p.y + p.height - 104;
    const buildKeys = eraBuildingKeys20(preview);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 13px Arial";
    ctx.fillText(`建築（${buildKeys.length}）`, rightX, buildY);
    const buildColW = Math.floor((rightW - 14) / 2);
    for (let i = 0; i < Math.min(4, buildKeys.length); i++) {
        const key = buildKeys[i];
        const data = BUILDINGS[key];
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = rightX + col * buildColW;
        const y = buildY + 12 + row * 34;
        const available = isBuildingAvailable20(key);
        ctx.fillStyle = available ? "#303030" : "#242424";
        ctx.fillRect(x, y, buildColW - 7, 30);
        ctx.strokeStyle = available ? "#777" : "#4d5052";
        ctx.strokeRect(x, y, buildColW - 7, 30);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px Arial";
        ctx.fillText(data.name, x + 7, y + 12);
        ctx.font = "8px Arial";
        const cost = data.cost || {};
        ctx.fillStyle = available ? "#91d691" : "#767b7e";
        ctx.fillText(`木${cost.wood || 0} 石${cost.stone || 0} 金${cost.gold || 0} 鐵${cost.iron || 0}`, x + 7, y + 24);
    }

    ctx.fillStyle = "#9da4a8";
    ctx.font = "10px Arial";
    ctx.fillText("左鍵：選時代／研究科技　·　Esc：關閉　·　科技研究時間會隨時代與層級增加", p.x + 18, p.y + p.height - 12);
}

const oldDrawEraCatalog23 = drawEraCatalog20;
drawEraCatalog20 = drawEraCatalog23;

function handleEraCatalogClick23(mx, my) {
    if (!state.eraCatalogOpen) return false;
    const p = eraCatalogRect20();
    if (mx < p.x || mx > p.x + p.width || my < p.y || my > p.y + p.height) return true;

    const listX = p.x + 16;
    const listY = p.y + 80;
    const listW = 190;
    const rowH = 40;
    for (let i = 0; i < ERA20.length; i++) {
        const y = listY + i * rowH;
        if (mx >= listX && mx <= listX + listW && my >= y && my <= y + rowH - 4) {
            state.eraCatalogIndex = i;
            state.eraTechPage = 0;
            return true;
        }
    }

    const preview = clamp(state.eraCatalogIndex || currentEraIndex20(), 0, ERA20.length - 1);
    const rightX = p.x + 228;
    const rightW = p.width - 246;
    const titleY = p.y + 132;
    const pages = Math.max(1, Math.ceil(eraTechKeys20(preview).length / eraTechPageSize23()));
    const prevX = rightX + rightW - 150;

    if (mx >= prevX && mx <= prevX + 62 && my >= titleY - 20 && my <= titleY + 6) {
        state.eraTechPage = Math.max(0, state.eraTechPage - 1);
        return true;
    }
    if (mx >= prevX + 68 && mx <= prevX + 130 && my >= titleY - 20 && my <= titleY + 6) {
        state.eraTechPage = Math.min(pages - 1, state.eraTechPage + 1);
        return true;
    }

    const techKeys = eraTechKeys20(preview);
    const start = state.eraTechPage * eraTechPageSize23();
    const visible = techKeys.slice(start, start + eraTechPageSize23());
    const colW = Math.floor((rightW - 14) / 2);
    const techY = titleY + 18;
    for (let i = 0; i < visible.length; i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = rightX + col * colW;
        const y = techY + row * 48;
        if (mx >= x && mx <= x + colW - 7 && my >= y && my <= y + 42) {
            const key = visible[i];
            if (preview > currentEraIndex20()) {
                showMessage(`需要進入「${ERA20[preview].name}」`);
                return true;
            }
            startResearch(key);
            return true;
        }
    }

    if (preview === currentEraIndex20() + 1 && canAdvanceEra20()) {
        // 保留原本的進時代按鈕區域，避免改動時代推進邏輯。
        const bx = rightX;
        const by = p.y + p.height - 54;
        if (mx >= bx && mx <= bx + 205 && my >= by && my <= by + 34) {
            advanceEra20();
            return true;
        }
    }
    return true;
}

const oldHandleEraCatalogClick23 = handleEraCatalogClick20;
handleEraCatalogClick20 = handleEraCatalogClick23;

/* ---------------------------------------------------------------
   4. 自訂國旗：圖片檔 → 縮圖 → 存檔
---------------------------------------------------------------- */
let customFlagImage23 = null;
let customFlagImageData23 = null;
let customFlagInput23 = null;

function ensureCustomFlagImage23() {
    const data = player?.nation?.customFlagData;
    if (!data) return null;
    if (customFlagImageData23 === data && customFlagImage23) return customFlagImage23;

    customFlagImageData23 = data;
    customFlagImage23 = new Image();
    customFlagImage23.onload = () => { customFlagImage23.__ready23 = true; };
    customFlagImage23.onerror = () => { customFlagImage23 = null; customFlagImageData23 = null; };
    customFlagImage23.src = data;
    return customFlagImage23;
}

const oldDrawFlag23 = drawFlag;
drawFlag = function(x, y, w, h, index, selected = false) {
    const img = ensureCustomFlagImage23();
    if (img && img.__ready23) {
        ctx.save();
        ctx.fillStyle = "#202427";
        ctx.fillRect(x, y, w, h);
        const iw = img.naturalWidth || img.width || 1;
        const ih = img.naturalHeight || img.height || 1;
        const scale = Math.min(w / iw, h / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
        if (selected) { ctx.strokeStyle = "#f0db55"; ctx.lineWidth = 2; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4); }
        ctx.restore();
        return;
    }
    oldDrawFlag23(x, y, w, h, index, selected);
};

function openCustomFlagPicker23() {
    if (!customFlagInput23) {
        customFlagInput23 = document.createElement("input");
        customFlagInput23.type = "file";
        customFlagInput23.accept = "image/png,image/jpeg,image/webp,image/gif";
        customFlagInput23.style.display = "none";
        document.body.appendChild(customFlagInput23);
        customFlagInput23.addEventListener("change", () => {
            const file = customFlagInput23.files?.[0];
            customFlagInput23.value = "";
            if (!file) return;
            if (!file.type.startsWith("image/")) {
                showMessage("請選擇圖片檔案。");
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const maxW = 512, maxH = 307;
                    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
                    const w = Math.max(1, Math.round(img.width * scale));
                    const h = Math.max(1, Math.round(img.height * scale));
                    const c = document.createElement("canvas");
                    c.width = w; c.height = h;
                    const cctx = c.getContext("2d");
                    cctx.drawImage(img, 0, 0, w, h);
                    try {
                        const data = c.toDataURL("image/jpeg", 0.88);
                        player.nation.customFlagData = data;
                        player.nation.customFlagName = file.name;
                        customFlagImage23 = null;
                        customFlagImageData23 = null;
                        ensureCustomFlagImage23();
                        showMessage(`已設定自訂國旗：${file.name}`);
                        recordHistory(`自訂國旗：${file.name}`);
                        if (typeof saveGame === "function") saveGame();
                    } catch (error) {
                        console.error("Custom flag save failed", error);
                        showMessage("國旗圖片太大，無法保存。請換較小的圖片。 ");
                    }
                };
                img.onerror = () => showMessage("這張圖片無法讀取。");
                img.src = reader.result;
            };
            reader.onerror = () => showMessage("讀取圖片失敗。");
            reader.readAsDataURL(file);
        });
    }
    customFlagInput23.click();
}

/* 國家面板：旗幟下方加上傳按鈕，不擠掉原本政府／政策 UI。 */
const oldDrawNationPanel23 = drawNationPanel;
drawNationPanel = function() {
    oldDrawNationPanel23();
    if (!state.nationOpen) return;
    const p = nationPanelRect();
    drawButton(p.x + 18, p.y + 113, 102, 22, "📤 上傳國旗");
    ctx.fillStyle = "#858e92";
    ctx.font = "9px Arial";
    ctx.fillText(player.nation.customFlagName ? `目前：${player.nation.customFlagName.slice(0, 20)}` : "PNG / JPG / WEBP", p.x + 126, p.y + 127);
};

const oldNationPanelClick23 = nationPanelClick;
nationPanelClick = function(x, y) {
    if (state.nationOpen) {
        const p = nationPanelRect();
        if (x >= p.x + 18 && x <= p.x + 120 && y >= p.y + 113 && y <= p.y + 135) {
            openCustomFlagPicker23();
            return true;
        }
    }
    return oldNationPanelClick23(x, y);
};

/* 主文明總覽裡也顯示自訂旗幟；沒有自訂旗幟則完全保留原 UI。 */
const oldCIV19DrawNationTab23 = CIV19_drawNationTab;
CIV19_drawNationTab = function(r) {
    oldCIV19DrawNationTab23(r);
    if (!player.nation?.customFlagData) return;
    const x = r.x + 20;
    const y = r.y + 64;
    const img = ensureCustomFlagImage23();
    if (!img || !img.__ready23) return;
    ctx.fillStyle = "rgba(8,10,12,0.98)";
    ctx.fillRect(x - 3, y - 18, 150, 38);
    ctx.drawImage(img, x, y - 14, 48, 29);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px Arial";
    ctx.fillText(player.nation.name, x + 58, y + 4);
};

/* ---------------------------------------------------------------
   5. 讓 B 開啟時代內容時，頁碼跟著目前時代重設
---------------------------------------------------------------- */
window.addEventListener("keydown", event => {
    if (event.key.toLowerCase() === "b" && !event.ctrlKey && !event.altKey) {
        if (!state.eraCatalogOpen) state.eraTechPage = 0;
    }
});

recordHistory("V0.9.23：每時代 120 科技、長期研究與自訂國旗");

/* ================================================================
   V0.9.24 — PLAYABILITY / RESEARCH WORKFLOW PASS
================================================================ */
GAME.VERSION = "0.9.24";
if (!Array.isArray(state.researchQueue)) state.researchQueue = [];
if (typeof state.techSearch !== "string") state.techSearch = "";

function techEffect24(field) {
    let total = 0;
    for (const key of techState.researched) total += Number(TECHS[key]?.effect?.[field] || 0);
    return total;
}
function filteredTechKeys24() {
    const q = state.techSearch.trim().toLowerCase();
    const keys = Object.keys(TECHS);
    if (!q) return keys;
    return keys.filter(k => {
        const d = TECHS[k];
        return (k + " " + (d.name||"") + " " + (d.description||"") + " " + (d.role||"") + " " + (d.branch||"")).toLowerCase().includes(q);
    });
}
function startResearch24Direct(key) {
    const data = TECHS[key];
    if (!data || hasTech(key) || state.currentResearch || !isTechAvailable20(key)) return false;
    state.currentResearch = key; state.researchProgress = 0;
    showMessage("開始研究：" + data.name); return true;
}
const oldStartResearch24 = startResearch;
startResearch = function(key) {
    if (!TECHS[key] || hasTech(key)) return;
    if (!isTechAvailable20(key)) { showMessage("尚未滿足時代／前置條件"); return; }
    if (state.currentResearch) {
        if (state.currentResearch === key || state.researchQueue.includes(key)) return;
        if (state.researchQueue.length >= 8) { showMessage("研究佇列已滿（8項）"); return; }
        if (!canAfford(TECHS[key].cost)) { showMessage("科研資源不足"); return; }
        payCost(TECHS[key].cost);
        state.researchQueue.push(key);
        showMessage("已加入研究佇列：" + TECHS[key].name);
        return;
    }
    oldStartResearch24(key);
};
const oldUpdateResearch24 = updateResearch;
updateResearch = function(dt) {
    if (state.currentResearch && TECHS[state.currentResearch]) {
        const data = TECHS[state.currentResearch];
        const researchEff = 1 + player.workforce.researcher * 0.002 + techEffect24("research");
        state.researchProgress += dt * researchEff / Math.max(1, data.time);
        if (state.researchProgress >= 1) {
            const finished = state.currentResearch;
            techState.researched.add(finished);
            state.currentResearch = null; state.researchProgress = 0;
            if (finished === "researchInstitute") state.researchSlots++;
            updateUnlockedTechs();
            showMessage("研究完成：" + TECHS[finished].name);
            recordHistory("完成科技：" + TECHS[finished].name);
            while (!state.currentResearch && state.researchQueue.length) {
                const next = state.researchQueue.shift();
                if (TECHS[next] && !hasTech(next) && isTechAvailable20(next)) startResearch24Direct(next);
            }
        }
        return;
    }
    if (!state.currentResearch && state.researchQueue.length) {
        while (!state.currentResearch && state.researchQueue.length) {
            const next = state.researchQueue.shift();
            if (TECHS[next] && !hasTech(next) && isTechAvailable20(next)) startResearch24Direct(next);
        }
        return;
    }
    oldUpdateResearch24(dt);
};
const oldUpdateBuildingWork24 = updateBuildingWork;
updateBuildingWork = function(villager, dt) {
    const b = villager?.targetBuilding;
    oldUpdateBuildingWork24(villager, b && !b.complete ? dt * (1 + techEffect24("build")) : dt);
};
const oldUpdateBuildingUpgrades24 = updateBuildingUpgrades;
updateBuildingUpgrades = function(dt) { oldUpdateBuildingUpgrades24(dt * (1 + techEffect24("build"))); };
const oldDrawTechTree24 = drawTechTree;
drawTechTree = function() {
    oldDrawTechTree24();
    if (!state.techOpen) return;
    const p = techPanelRect(), keys = filteredTechKeys24(), q = state.researchQueue || [];
    ctx.fillStyle = "rgba(8,8,8,0.96)";
    ctx.fillRect(p.x+18,p.y+72,390,30); ctx.strokeStyle="#555"; ctx.strokeRect(p.x+18,p.y+72,390,30);
    ctx.fillStyle = state.techSearch ? "#fff" : "#888"; ctx.font="12px Arial";
    ctx.fillText(state.techSearch ? "搜尋："+state.techSearch : "搜尋科技（按 / 開始輸入，Esc 清除）",p.x+30,p.y+92);
    ctx.fillStyle="#d9dfe2"; ctx.font="10px Arial";
    ctx.fillText("符合 " + keys.length + "/" + Object.keys(TECHS).length + " 項",p.x+18,p.y+p.height-30);
    ctx.fillText("研究佇列 " + q.length + "/8",p.x+150,p.y+p.height-30);
    if (q.length) ctx.fillText(q.slice(0,3).map(k=>TECHS[k]?.name||k).join(" → ").slice(0,55),p.x+285,p.y+p.height-30);
};
const oldHandleTechClick24 = handleTechClick;
handleTechClick = function(mx,my) {
    const keys=filteredTechKeys24();
    for(let i=0;i<keys.length;i++){ const r=techNodeRect(i); if(mx>=r.x&&mx<=r.x+r.width&&my>=r.y&&my<=r.y+r.height){startResearch(keys[i]);return true;} }
    return oldHandleTechClick24(mx,my);
};
window.addEventListener("keydown", event => {
    if (!state.techOpen) return;
    if (event.key === "/") { state.techSearch=""; event.preventDefault(); showMessage("科技搜尋：直接輸入關鍵字"); return; }
    if (event.key === "Backspace") { if(state.techSearch){state.techSearch=state.techSearch.slice(0,-1);event.preventDefault();} return; }
    if (event.key === "Escape" && state.techSearch) { state.techSearch=""; event.preventDefault(); return; }
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key.length===1 && /[\w\u3400-\u9fff\- ]/.test(event.key)) { state.techSearch += event.key; event.preventDefault(); }
});
recordHistory("V0.9.24：研究佇列、科技搜尋、科研與工程效果優化");

/* ================================================================
   V0.9.25 — UI CLEANUP / FOCUS MODE

   ・大型頁面開啟時，隱藏建造列、迷你地圖、次要資訊，避免互相遮擋
   ・科技樹改成中央主面板：搜尋 / 分頁 / 研究佇列 / 目前研究集中顯示
   ・科技一次顯示 20 項，避免 1000+ 科技全部擠在畫面底部
   ・重新整理頂部 HUD，只保留資源／人口／國庫／年代／研究等重要資訊
   ・移除遊戲畫面上的舊時代浮動資訊與多餘提示
================================================================ */
GAME.VERSION = "0.9.25";
if (!Number.isInteger(state.techPage25)) state.techPage25 = 0;

function uiFocus25() {
    return !!(
        state.techOpen ||
        state.eraCatalogOpen ||
        state.populationOpen ||
        state.marketOpen ||
        state.historyOpen ||
        state.helpOpen ||
        state.civ19Open ||
        state.economyOpen ||
        state.worldEventOpen ||
        state.eraOpen
    );
}

/* 大面板開啟時，不再讓低優先級 HUD 堆在一起。 */
const drawBottomUI25_old = drawBottomUI;
drawBottomUI = function() {
    if (uiFocus25()) return;
    drawBottomUI25_old();
};
const drawMinimap25_old = drawMinimap;
drawMinimap = function() {
    if (state.techOpen || state.eraCatalogOpen || state.helpOpen || state.populationOpen || state.marketOpen || state.historyOpen || state.civ19Open || state.economyOpen || state.worldEventOpen) return;
    drawMinimap25_old();
};
const drawProductionOverview25_old = drawProductionOverview;
drawProductionOverview = function() {
    if (uiFocus25()) return;
    drawProductionOverview25_old();
};
const drawGameSpeed25_old = drawGameSpeed;
drawGameSpeed = function() {
    if (uiFocus25()) return;
    drawGameSpeed25_old();
};
const drawSelectionInfo25_old = drawSelectionInfo;
drawSelectionInfo = function() {
    if (uiFocus25()) return;
    drawSelectionInfo25_old();
};
const drawSelectedBuildingProgress25_old = drawSelectedBuildingProgress;
drawSelectedBuildingProgress = function() {
    if (uiFocus25()) return;
    drawSelectedBuildingProgress25_old();
};
const CIV19_drawQuickButtons25_old = CIV19_drawQuickButtons;
CIV19_drawQuickButtons = function() {
    if (state.techOpen || state.eraCatalogOpen || state.helpOpen || state.populationOpen || state.marketOpen || state.historyOpen) return;
    CIV19_drawQuickButtons25_old();
};
const CIV19_drawSettlementAction25_old = CIV19_drawSettlementAction;
CIV19_drawSettlementAction = function() {
    if (uiFocus25()) return;
    CIV19_drawSettlementAction25_old();
};
const CIV19_drawMainPanel25_old = CIV19_drawMainPanel;
CIV19_drawMainPanel = function() {
    if (state.techOpen || state.eraCatalogOpen || state.helpOpen || state.populationOpen || state.marketOpen || state.historyOpen) return;
    CIV19_drawMainPanel25_old();
};

/* 頂部只留真正重要的資訊；快捷功能仍由原本點擊區負責。 */
const drawTopUI25_old = drawTopUI;
drawTopUI = function() {
    const w = Math.min(screenWidth - 30, 1120);
    const h = 76;
    ctx.fillStyle = "rgba(8,10,11,0.94)";
    ctx.fillRect(15, 15, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(15, 15, w, h);

    const resources = [
        ["🍎", "食", "food"],
        ["🌲", "木", "wood"],
        ["🪨", "石", "stone"],
        ["🔩", "鐵", "iron"],
        ["🟡", "金", "gold"]
    ];
    const gap = 108;
    for (let i = 0; i < resources.length; i++) {
        const [icon, short, key] = resources[i];
        const x = 28 + i * gap;
        const rate = player.resourceRates[key] || 0;
        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px Arial";
        ctx.fillText(`${icon} ${formatNumber(player.resources[key])}`, x, 39);
        ctx.font = "10px Arial";
        ctx.fillStyle = rate > 0.05 ? "#76d37d" : rate < -0.05 ? "#e07a72" : "#a2a8ab";
        ctx.fillText(`${short} ${resourceRateText(rate)}`, x + 2, 56);
    }

    ctx.fillStyle = "#dfe4e6";
    ctx.font = "bold 13px Arial";
    ctx.fillText(`👥 ${player.population}/${player.populationCap}`, 575, 39);
    ctx.fillText(`💰 ${player.treasury.toFixed(0)}`, 690, 39);

    const year = Math.floor(state.time / GAME.YEAR_LENGTH) + 1;
    ctx.font = "11px Arial";
    ctx.fillStyle = "#c1c7ca";
    ctx.fillText(`第 ${year} 年`, 575, 57);
    ctx.fillText(`時代：${currentEra20().short}`, 650, 57);
    ctx.fillText(`${seasonName()} · ${weatherName()}`, 745, 57);
    ctx.fillText(`穩定 ${player.stability.toFixed(0)}%`, 850, 57);

    if (state.currentResearch && TECHS[state.currentResearch]) {
        const tech = TECHS[state.currentResearch];
        const pct = Math.floor(clamp(state.researchProgress, 0, 1) * 100);
        ctx.fillStyle = "#e1ca4f";
        ctx.font = "bold 11px Arial";
        ctx.fillText(`🔬 ${tech.name} ${pct}%`, 965, 39);
        ctx.fillStyle = "#8f999d";
        ctx.font = "10px Arial";
        ctx.fillText(`佇列 ${(state.researchQueue || []).length}`, 965, 57);
    }

    /* 原本頂部的 T/P/M/H 不再佔據 HUD；直接保留必要入口。 */
    if (!uiFocus25()) {
        ctx.fillStyle = "#8f989c";
        ctx.font = "10px Arial";
        ctx.fillText("T 科技 · P 人口 · M 市場 · H 歷史", 28, 80);
    }
};

/* 科技頁尺寸：以「主內容頁」處理，不再貼著畫面最下面。 */
techPanelRect = function() {
    return {
        x: Math.max(24, Math.floor(screenWidth * 0.055)),
        y: 92,
        width: Math.min(screenWidth - 48, 1380),
        height: Math.max(520, Math.min(screenHeight - 126, 720))
    };
};

function techPageKeys25() {
    const keys = filteredTechKeys24();
    const perPage = 20;
    const maxPage = Math.max(0, Math.ceil(keys.length / perPage) - 1);
    state.techPage25 = clamp(state.techPage25, 0, maxPage);
    return { keys, page: state.techPage25, maxPage, pageKeys: keys.slice(state.techPage25 * perPage, state.techPage25 * perPage + perPage) };
}

techNodeRect = function(index) {
    const p = techPanelRect();
    const cols = 5;
    const gapX = 12;
    const gapY = 10;
    const top = p.y + 152;
    const footer = 76;
    const innerW = p.width - 36;
    const nodeW = Math.floor((innerW - gapX * (cols - 1)) / cols);
    const nodeH = 94;
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
        x: p.x + 18 + col * (nodeW + gapX),
        y: top + row * (nodeH + gapY),
        width: nodeW,
        height: nodeH
    };
};

function drawTechTree25() {
    if (!state.techOpen) return;
    const p = techPanelRect();
    const page = techPageKeys25();
    const q = state.researchQueue || [];

    /* 背景壓暗：開大型頁時，底下任何舊 HUD 都不會搶焦點。 */
    ctx.fillStyle = "rgba(0,0,0,0.52)";
    ctx.fillRect(0, 0, screenWidth, screenHeight);

    drawPanel(p.x, p.y, p.width, p.height);

    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Arial";
    ctx.fillText("🔬 科技樹", p.x + 20, p.y + 32);
    ctx.fillStyle = "#9fa7aa";
    ctx.font = "11px Arial";
    ctx.fillText(`共 ${page.keys.length} 項 · 第 ${page.page + 1}/${page.maxPage + 1} 頁`, p.x + 128, p.y + 31);

    if (state.currentResearch && TECHS[state.currentResearch]) {
        const tech = TECHS[state.currentResearch];
        const pct = Math.floor(clamp(state.researchProgress, 0, 1) * 100);
        ctx.fillStyle = "#d8c656";
        ctx.font = "bold 11px Arial";
        ctx.fillText(`研究中：${tech.name} ${pct}%`, p.x + 330, p.y + 31);
        drawProgressBar(p.x + 515, p.y + 20, 180, 12, state.researchProgress, "#c4a73b", "");
    }

    /* 搜尋框 */
    const searchX = p.x + 18, searchY = p.y + 50, searchW = Math.min(390, p.width * 0.32);
    ctx.fillStyle = "rgba(4,6,7,0.98)";
    ctx.fillRect(searchX, searchY, searchW, 30);
    ctx.strokeStyle = state.techSearch ? "#d9c852" : "#51595d";
    ctx.strokeRect(searchX, searchY, searchW, 30);
    ctx.fillStyle = state.techSearch ? "#fff" : "#777f83";
    ctx.font = "12px Arial";
    ctx.fillText(state.techSearch ? `搜尋：${state.techSearch}` : "搜尋科技（按 / 開始）", searchX + 10, searchY + 20);

    /* 研究佇列 */
    const queueX = p.x + p.width - 410;
    ctx.fillStyle = "#bfc7ca";
    ctx.font = "11px Arial";
    ctx.fillText(`研究佇列 ${q.length}/8`, queueX, p.y + 68);
    ctx.fillStyle = "#858e92";
    ctx.font = "10px Arial";
    const queueText = q.length ? q.slice(0, 5).map(k => TECHS[k]?.name || k).join(" → ") : "空";
    ctx.fillText(queueText.slice(0, 62), queueX + 82, p.y + 68);

    /* 科技卡 */
    for (let i = 0; i < page.pageKeys.length; i++) {
        const key = page.pageKeys[i];
        const data = TECHS[key];
        const r = techNodeRect(i);
        const researched = hasTech(key);
        const unlocked = techState.unlocked.has(key);
        const researching = state.currentResearch === key;
        const queued = q.includes(key);

        ctx.fillStyle = researched ? "#294d30" : researching ? "#5b4f24" : queued ? "#4b4130" : unlocked ? "#2f3c50" : "#202326";
        ctx.fillRect(r.x, r.y, r.width, r.height);
        ctx.strokeStyle = researched ? "#70d27a" : researching ? "#e0ca51" : queued ? "#bba054" : unlocked ? "#6689bd" : "#4d5458";
        ctx.strokeRect(r.x, r.y, r.width, r.height);

        const branch = TECH_BRANCHES22[techBranch22(key)];
        ctx.fillStyle = branch?.color || "#899196";
        ctx.fillRect(r.x, r.y, 5, r.height);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px Arial";
        ctx.fillText(String(data.name || key).slice(0, 18), r.x + 12, r.y + 19);
        ctx.fillStyle = "#aeb5b8";
        ctx.font = "9px Arial";
        ctx.fillText(`${branch?.short || "科技"} · ${techEraText22(key)}`, r.x + 12, r.y + 35);
        ctx.fillText(String(data.description || "").slice(0, 30), r.x + 12, r.y + 51);
        ctx.fillText(`研究 ${data.time || 0}s`, r.x + 12, r.y + 67);
        ctx.fillStyle = researched ? "#7edb84" : researching ? "#e4d15a" : queued ? "#ceb863" : unlocked ? "#94b5e7" : "#747b7e";
        ctx.font = "bold 9px Arial";
        ctx.fillText(researched ? "已完成" : researching ? "研究中" : queued ? "排隊中" : unlocked ? "點擊研究" : "未解鎖", r.x + 12, r.y + 82);
    }

    /* 頁碼與操作 */
    const fy = p.y + p.height - 46;
    ctx.fillStyle = "#9fa7aa";
    ctx.font = "10px Arial";
    ctx.fillText("/ 搜尋 · Enter 可開始研究 · Esc 關閉", p.x + 18, fy + 22);

    const prevX = p.x + p.width - 220;
    const nextX = p.x + p.width - 112;
    const by = fy;
    ctx.fillStyle = page.page > 0 ? "#303b35" : "#202225";
    ctx.fillRect(prevX, by, 96, 30);
    ctx.strokeStyle = "#596166";
    ctx.strokeRect(prevX, by, 96, 30);
    ctx.fillStyle = page.page > 0 ? "#fff" : "#777";
    ctx.font = "bold 11px Arial";
    ctx.fillText("‹ 上一頁", prevX + 26, by + 20);

    ctx.fillStyle = page.page < page.maxPage ? "#303b35" : "#202225";
    ctx.fillRect(nextX, by, 96, 30);
    ctx.strokeStyle = "#596166";
    ctx.strokeRect(nextX, by, 96, 30);
    ctx.fillStyle = page.page < page.maxPage ? "#fff" : "#777";
    ctx.fillText("下一頁 ›", nextX + 26, by + 20);
}

drawTechTree = drawTechTree25;

handleTechClick = function(mx, my) {
    if (!state.techOpen) return false;
    const p = techPanelRect();
    const page = techPageKeys25();
    const prevX = p.x + p.width - 220;
    const nextX = p.x + p.width - 112;
    const by = p.y + p.height - 46;
    if (mx >= prevX && mx <= prevX + 96 && my >= by && my <= by + 30) {
        state.techPage25 = Math.max(0, page.page - 1);
        return true;
    }
    if (mx >= nextX && mx <= nextX + 96 && my >= by && my <= by + 30) {
        state.techPage25 = Math.min(page.maxPage, page.page + 1);
        return true;
    }
    for (let i = 0; i < page.pageKeys.length; i++) {
        const r = techNodeRect(i);
        if (mx >= r.x && mx <= r.x + r.width && my >= r.y && my <= r.y + r.height) {
            startResearch(page.pageKeys[i]);
            return true;
        }
    }
    return true;
};

/* 科技頁重新打開時回到第一頁；搜尋後也自動回到第一頁。 */
const keydown25_old = window.__rts0925KeydownInstalled || false;
if (!keydown25_old) {
    window.__rts0925KeydownInstalled = true;
    window.addEventListener("keydown", event => {
        if (!state.techOpen) return;
        if (event.key === "/") {
            state.techSearch = "";
            state.techPage25 = 0;
            event.preventDefault();
            return;
        }
        if (event.key === "Enter") {
            const page = techPageKeys25();
            const first = page.pageKeys.find(k => techState.unlocked.has(k) && !hasTech(k));
            if (first) startResearch(first);
            event.preventDefault();
            return;
        }
        if (event.key === "ArrowLeft" && !(event.ctrlKey || event.altKey || event.metaKey)) {
            state.techPage25 = Math.max(0, state.techPage25 - 1);
            event.preventDefault();
            return;
        }
        if (event.key === "ArrowRight" && !(event.ctrlKey || event.altKey || event.metaKey)) {
            const page = techPageKeys25();
            state.techPage25 = Math.min(page.maxPage, state.techPage25 + 1);
            event.preventDefault();
            return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && /[\w\u3400-\u9fff\- ]/.test(event.key)) {
            state.techPage25 = 0;
        }
    });
}

/* T 打開時，先關閉其餘高干擾頁面。 */
window.addEventListener("keydown", event => {
    if (event.key.toLowerCase() !== "t" || event.ctrlKey || event.altKey || event.metaKey) return;
    state.techOpen = !state.techOpen;
    if (state.techOpen) {
        state.techPage25 = 0;
        state.eraCatalogOpen = false;
        state.populationOpen = false;
        state.marketOpen = false;
        state.historyOpen = false;
        state.nationOpen = false;
        state.civ19Open = false;
        state.economyOpen = false;
        state.worldEventOpen = false;
        state.eraOpen = false;
        state.buildingType = null;
    }
    event.preventDefault();
});

recordHistory("V0.9.25：介面聚焦模式、科技樹分頁與 HUD 清理");
