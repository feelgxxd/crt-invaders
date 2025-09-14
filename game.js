// =====================
// Config & visuals
// =====================
const tileSize = 32;
const rows = 17;
const columns = 17;
const boardWidth = tileSize * columns; // 512
const boardHeight = tileSize * rows;   // 512
const gameSpeed = 60; // using requestAnimationFrame update frequency conceptually; movement uses delta

// bloom + CRT tuning (matches Snake)
const GRID_BG = "#0d0d0d";
const GRID_ALPHA = 0.05;
const SCANLINE_ALPHA = 0.06;
const SCANLINE_STEP = 2;
const BLOOM_BLUR_PX = 4;
const BLOOM_STRENGTH = 1.0;

// screen shake (elastic)
let shakeDuration = 0;
let shakeIntensity = 0;
let shakeDecay = 0.85;

// =====================
// Game state
// =====================
let board, context;
let bloomCanvas, bloomCtx;

let shipImg = new Image();
let alienImg = new Image();

let shipWidth = tileSize * 2;
let shipHeight = tileSize;
let ship = {
  x: Math.floor(columns/2 - 1) * tileSize,
  y: (rows - 2) * tileSize,
  width: shipWidth,
  height: shipHeight
};
let shipVelocityX = 6; //ship speed

// aliens
let alienArray = [];
let alienWidth = tileSize * 2;
let alienHeight = tileSize;
let alienColumns = 3;
let alienRows = 2;
let alienVelocityX = 1; // pixels per frame (small)
let alienCount = 0;

// bullets
let bulletArray = [];
let bulletSpeed = -8;

// score / level
let score = 0;
let level = 1;
let gameOver = false;

// particles
const particles = [];

// sfx
let eatSound = new Audio("sounds/explosion.mp3");
let gameOverSound = new Audio("sounds/gameover.mp3");

// input state
const keysDown = {};

// timing
let lastTime = 0;

// =====================
// Init
// =====================
window.onload = function() {
  board = document.getElementById("board");
  board.width = boardWidth;
  board.height = boardHeight;
  context = board.getContext("2d", { alpha: false });

  // offscreen bloom canvas
  bloomCanvas = document.createElement("canvas");
  bloomCanvas.width = board.width;
  bloomCanvas.height = board.height;
  bloomCtx = bloomCanvas.getContext("2d", { alpha: true });

  // pixel crispness
  context.imageSmoothingEnabled = false;
  bloomCtx.imageSmoothingEnabled = false;

  // load assets (if images missing, fallback to rects)
  shipImg.src = "./ship.png";
  alienImg.src = "./alien.png";

  // sounds (place eat.mp3 and gameover.mp3 under /sounds)
  eatSound = new Audio("sounds/explosion.mp3");
  eatSound.volume = 0.28;
  gameOverSound = new Audio("sounds/gameover.mp3");
  gameOverSound.volume = 0.45;

  // hide overlay initially
  document.getElementById("game-over-overlay").classList.add("hidden");

  createAliens();

  // input events
  document.addEventListener("keydown", (e)=> { keysDown[e.code]=true; onKeyDown(e); });
  document.addEventListener("keyup", (e)=> { keysDown[e.code]=false; onKeyUp(e); });

  // restart button
  document.getElementById("restart-btn").addEventListener("click", restartGame);

  // start loop
  requestAnimationFrame(loop);
};

// =====================
// Main loop
// =====================
function loop(ts) {
  if (!lastTime) lastTime = ts;
  const dt = (ts - lastTime) / 16.6667; // approx frames at 60fps -> dt scale
  lastTime = ts;

  if (!gameOver) {
    update(dt);
    render();
  }

  requestAnimationFrame(loop);
}

// =====================
// Update logic
// =====================
function update(dt) {
  // Ship movement (discrete tile moves on key press A/D)
  if (keysDown["KeyA"]) {
    // move left but clamp
    ship.x -= shipVelocityX * dt;
  }
  if (keysDown["KeyD"]) {
    ship.x += shipVelocityX * dt;
  }
  ship.x = Math.max(0, Math.min(board.width - ship.width, ship.x));

  // update aliens: move horizontally; if any collision with edges, flip and move down
  let willFlip = false;
  for (let a of alienArray) {
    if (!a.alive) continue;
    a.x += alienVelocityX;
    if (a.x + a.width >= board.width || a.x <= 0) willFlip = true;
  }
  if (willFlip) {
    alienVelocityX *= -1;
    for (let a of alienArray) {
      if (a.alive) a.y += alienHeight;
    }
  }

  // check alien reach bottom -> game over
  for (let a of alienArray) {
    if (a.alive && a.y + a.height >= ship.y) {
      triggerGameOver();
    }
  }

  // bullets
  for (let b of bulletArray) {
    b.y += b.vy;
  }

  // collisions: bullets -> aliens
  for (let i = bulletArray.length - 1; i >= 0; i--) {
    const b = bulletArray[i];
    // remove offscreen bullets
    if (b.y + b.height < 0) {
      bulletArray.splice(i,1);
      continue;
    }

    for (let j = 0; j < alienArray.length; j++) {
      const a = alienArray[j];
      if (!a.alive) continue;
      if (rectsOverlap(b, a)) {
        // kill alien
        a.alive = false;
        alienCount--;
        score += 100;
        document.getElementById("score").innerText = score;

        // spawn explosion particles at alien center BEFORE any other movement
        const cx = a.x + a.width/2;
        const cy = a.y + a.height/2;
        spawnParticles(cx, cy, {color: "rgba(120,255,120,1)"}); // greenish explosion

        // screen shake and SFX (reuse eatSound)
        shakeDuration = 8;
        shakeIntensity = 8;
        if (eatSound) { eatSound.currentTime = 0; eatSound.play(); }

        // remove bullet
        bulletArray.splice(i,1);
        break;
      }
    }
  }

  // level up if all aliens dead
  if (alienCount === 0) {
    levelUp();
  }

  // update particles
  updateParticles();

  // decay screen shake each frame if active (handled in render as well)
  if (shakeDuration > 0) {
    shakeDuration--;
    shakeIntensity *= shakeDecay;
    if (shakeIntensity < 0.05) {
      shakeIntensity = 0;
      shakeDuration = 0;
    }
  }
}

// =====================
// Rendering
// =====================
function render() {
  // clear and apply shake
  context.save();
  if (shakeDuration > 0 && shakeIntensity > 0) {
    const dx = (Math.random() - 0.5) * shakeIntensity;
    const dy = (Math.random() - 0.5) * shakeIntensity * 0.6;
    context.translate(dx, dy);
  }

  // 1) background grid
  drawBackgroundGrid(context);

  // 2) particles behind objects
  drawParticles(context);

  // clear bloom
  bloomCtx.clearRect(0,0,bloomCanvas.width,bloomCanvas.height);

  // 3) draw aliens (main pass + bloom proxy)
  drawAliens(context, bloomCtx);

  // 4) draw ship (main pass + bloom proxy)
  drawShip(context, bloomCtx);

  // 5) draw bullets (main pass + bloom proxy)
  drawBullets(context, bloomCtx);

  // 6) composite bloom
  applyBloom(context, bloomCanvas);

  // 7) hud: score + level
  drawHUD(context);

  // 8) scanlines overlay
  drawScanlines(context);

  context.restore();
}

// =====================
// Draw helpers
// =====================
function drawBackgroundGrid(ctx) {
  ctx.fillStyle = GRID_BG;
  ctx.fillRect(0,0,board.width,board.height);

  ctx.strokeStyle = `rgba(255,255,255,${GRID_ALPHA})`;
  ctx.lineWidth = 1;

  for (let x = 0; x <= board.width; x += tileSize) {
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,board.height); ctx.stroke();
  }
  for (let y = 0; y <= board.height; y += tileSize) {
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(board.width,y); ctx.stroke();
  }
}

function drawAliens(ctx, bloom) {
    for (let a of alienArray) {
      if (!a.alive) continue;
      if (alienImg.complete && alienImg.naturalWidth) {
        ctx.drawImage(alienImg, a.x, a.y, a.width, a.height);
        bloom.globalAlpha = 0.9;
        bloom.drawImage(alienImg, a.x, a.y, a.width, a.height);
        bloom.globalAlpha = 1;
      } else {
        ctx.fillStyle = "#00FFB0";
        ctx.fillRect(a.x, a.y, a.width, a.height);
        bloom.fillStyle = "rgba(120,255,120,0.8)";
        bloom.fillRect(a.x, a.y, a.width, a.height);
      }
    }
  }
  

  function drawShip(ctx, bloom) {
    if (shipImg.complete && shipImg.naturalWidth) {
      ctx.drawImage(shipImg, ship.x, ship.y, ship.width, ship.height);
      bloom.globalAlpha = 0.8;
      bloom.drawImage(shipImg, ship.x, ship.y, ship.width, ship.height);
      bloom.globalAlpha = 1;
    } else {
      ctx.fillStyle = "#FFB300";
      ctx.fillRect(ship.x, ship.y, ship.width, ship.height);
      bloom.fillStyle = "#FFB300";
      bloom.fillRect(ship.x, ship.y, ship.width, ship.height);
    }
  }  

function drawBullets(ctx, bloom) {
  for (let b of bulletArray) {
    ctx.fillStyle = "#CFE8FF";
    ctx.fillRect(b.x, b.y, b.width, b.height);
    bloom.fillStyle = "rgba(255, 0, 0, 0.9)";
    bloom.fillRect(b.x-1, b.y-1, b.width+2, b.height+2);
  }
}

function drawHUD(ctx) {
  ctx.fillStyle = "#FFB500";
  ctx.font = "12px 'Press Start 2P', monospace";
  ctx.fillText("Score: " + score, 8, 18);
  ctx.fillText("Level: " + level, board.width - 120, 18);
}

// =====================
// Aliens creation / level
// =====================
function createAliens() {
  alienArray = [];
  const startX = tileSize;
  const startY = tileSize;
  for (let c = 0; c < alienColumns; c++) {
    for (let r = 0; r < alienRows; r++) {
      alienArray.push({
        x: startX + c * alienWidth,
        y: startY + r * alienHeight,
        width: alienWidth,
        height: alienHeight,
        alive: true
      });
    }
  }
  alienCount = alienArray.length;
  document.getElementById("score").innerText = score;
  document.getElementById("level").innerText = level;
}

function levelUp() {
  level++;
  // small bonuses and faster aliens
  score += Math.floor(alienColumns * alienRows * 50);
  alienColumns = Math.min(alienColumns + 1, Math.floor(columns/2) - 2);
  alienRows = Math.min(alienRows + 1, rows - 4);
  alienVelocityX += (alienVelocityX > 0 ? 0.4 : -0.4);
  // reset bullets and respawn
  bulletArray = [];
  createAliens();
  // small screen pulse effect via shake
  shakeDuration = 10; shakeIntensity = 6;
}

// =====================
// Input handlers
// =====================
function onKeyDown(e) {
  if (gameOver) return;
  // shoot on ShiftDown (allow hold)
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    fireBullet();
  }
}

function onKeyUp(e) {
  // currently no-op, kept for future
}

// fire bullet from ship
function fireBullet() {
  // limit bullets on screen to a few
  if (bulletArray.length > 6) return;
  const bullet = {
    x: ship.x + ship.width*0.5 - tileSize/16,
    y: ship.y - 4,
    width: Math.max(2, Math.floor(tileSize/8)),
    height: Math.max(6, Math.floor(tileSize/2)),
    vy: bulletSpeed
  };
  bulletArray.push(bullet);
}

// =====================
// Utility - collisions
// =====================
function rectsOverlap(a,b) {
  return a.x < b.x + b.width &&
         a.x + a.width > b.x &&
         a.y < b.y + b.height &&
         a.y + a.height > b.y;
}

// =====================
// Particles (juicy, green explosion)
// =====================
function spawnParticles(cx, cy, opts = {}) {
  const color = opts.color || "rgba(255,120,120,1)";
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 3;
    particles.push({
      x: cx,
      y: cy,
      dx: Math.cos(angle) * speed,
      dy: Math.sin(angle) * speed,
      alpha: 1,
      size: Math.random() * 2 + 1.2,
      scale: 1,
      decay: 0.92,
      color
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.dx;
    p.y += p.dy;
    p.alpha *= p.decay;
    p.scale *= p.decay;
    if (p.alpha <= 0.03) {
      particles.splice(i,1);
    }
  }
}

function drawParticles(ctx) {
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * p.scale, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
}

// helper to extract rgb part from "rgba(r,g,b,a)" or "rgb(r,g,b)"
function extractRgb(rgba) {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) return "255,255,255";
  const parts = m[1].split(',').map(s=>s.trim());
  return parts[0]+','+parts[1]+','+parts[2];
}

// =====================
// Bloom composite (same as Snake)
// =====================
function applyBloom(ctx, bloomLayer) {
  if (BLOOM_BLUR_PX <= 0 || BLOOM_STRENGTH <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.filter = `blur(${BLOOM_BLUR_PX}px)`;
  ctx.globalAlpha = BLOOM_STRENGTH;
  ctx.drawImage(bloomLayer, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();
}

// =====================
// CRT scanlines (same as Snake)
// =====================
function drawScanlines(ctx) {
  ctx.save();
  ctx.globalAlpha = SCANLINE_ALPHA;
  ctx.fillStyle = "#000";
  for (let y = 0; y < board.height; y += SCANLINE_STEP) {
    ctx.fillRect(0, y, board.width, 1);
  }
  ctx.restore();
}

// =====================
// Game over / restart
// =====================
function triggerGameOver() {
  gameOver = true;
  gameOverSound.currentTime = 0;
  gameOverSound.play();
  document.getElementById("final-score").innerText = score;
  document.getElementById("game-over-overlay").classList.remove("hidden");
}

function restartGame() {
  // reset state
  score = 0;
  level = 1;
  ship.x = Math.floor(columns/2 - 1) * tileSize;
  ship.y = (rows - 2) * tileSize;
  bulletArray = [];
  particles.length = 0;
  alienColumns = 3;
  alienRows = 2;
  alienVelocityX = 1;
  createAliens();
  gameOver = false;
  lastTime = 0;
  document.getElementById("score").innerText = score;
  document.getElementById("level").innerText = level;
  document.getElementById("game-over-overlay").classList.add("hidden");
}